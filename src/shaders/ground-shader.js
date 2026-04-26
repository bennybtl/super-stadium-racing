/**
 * Custom ground shader with support for normal map decals
 * 
 * Uses a simpler approach: dynamically generates a combined normal map texture
 * by compositing multiple normal map decals onto a canvas, then applies it
 * to the standard material's bump texture.
 */

import { RawTexture, Texture, Vector2, RenderTargetTexture, PostProcess, Effect, Constants } from "@babylonjs/core";

/**
 * Load and cache normal map images by filename.
 * @private
 */
const _normalMapCache = new Map();
async function _loadNormalMap(filename) {
  if (_normalMapCache.has(filename)) return _normalMapCache.get(filename);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  const path = new URL(`../assets/${filename}`, import.meta.url).href;
  await new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = resolve;
    img.src = path;
  });
  _normalMapCache.set(filename, img);
  return img;
}

/**
 * Paint the per-terrain-type base normal map layer.
 * Each cell uses the normal map specified by its terrain type.
 * @private
 */
async function _paintTerrainNormalBase(ctx, terrainManager, textureSize, worldSize, worldUnitsPerTile = 10) {
  const pixelsPerCell = (textureSize / worldSize) * terrainManager.cellSize;
  // tileSize is expressed in canvas pixels and spans worldUnitsPerTile world-units,
  // so the texture can be larger than a single cell and tiles continuously
  // across cell boundaries.
  const tileSize = (textureSize / worldSize) * worldUnitsPerTile;

  // Pre-load all unique normal maps referenced by the current grid
  const uniqueMaps = [...new Set(
    terrainManager.grid.map(cell => cell.normalMap).filter(Boolean)
  )];
  const imgMap = {};
  await Promise.all(uniqueMaps.map(async (name) => {
    imgMap[name] = await _loadNormalMap(name);
  }));

  // Group cells by their normalMap so we can paint each map in one pass.
  // Also track per-cell intensity since the same normalMap can have different intensities.
  const cellsByMap = {};
  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      const cell = terrainManager.grid[row * terrainManager.cellsPerSide + col];
      const name = cell.normalMap;
      if (!name) continue;
      if (!cellsByMap[name]) cellsByMap[name] = [];
      cellsByMap[name].push({ col, row, intensity: cell.normalMapIntensity ?? 1.0 });
    }
  }

  // For each unique map, create a repeating pattern scaled to tileSize and
  // fill every cell that uses it, respecting per-cell intensity via globalAlpha.
  // Because the pattern origin is the canvas origin (0,0), it tiles continuously
  // across cell boundaries. Cells with different intensities are drawn separately.
  for (const [name, cells] of Object.entries(cellsByMap)) {
    const img = imgMap[name];

    // First fill all cells with the flat normal (rgb 128,128,255) at full opacity
    // as a base, then composite the actual texture on top with the correct alpha.
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = 'rgb(128,128,255)';
    for (const { col, row } of cells)
      ctx.fillRect(col * pixelsPerCell, row * pixelsPerCell, pixelsPerCell, pixelsPerCell);

    if (img && img.naturalWidth > 0) {
      const pattern = ctx.createPattern(img, 'repeat');
      const scale = tileSize / img.naturalWidth;
      pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0]));
      ctx.fillStyle = pattern;

      // Group cells by intensity to minimise globalAlpha state changes
      const byIntensity = {};
      for (const c of cells) {
        const key = c.intensity;
        if (!byIntensity[key]) byIntensity[key] = [];
        byIntensity[key].push(c);
      }
      for (const [intensity, group] of Object.entries(byIntensity)) {
        ctx.globalAlpha = Number(intensity);
        for (const { col, row } of group)
          ctx.fillRect(col * pixelsPerCell, row * pixelsPerCell, pixelsPerCell, pixelsPerCell);
      }
    }

    ctx.restore();
  }
}

/**
 * Create a composite normal map texture from multiple decals
 * @param {Scene} scene - Babylon scene
 * @param {Array} normalMapDecals - Array of decal feature objects from track
 * @param {TerrainManager} terrainManager - Terrain manager (provides per-cell normal maps)
 * @param {number} textureSize - Size of the generated texture (power of 2)
 * @param {number} worldSize - Size of the world space the texture covers
 * @returns {Promise<RawTexture>}
 */
export async function createCompositeNormalMap(scene, normalMapDecals, terrainManager, textureSize = 2048, worldSize = 160) {
  const canvas = document.createElement('canvas');
  canvas.width = textureSize;
  canvas.height = textureSize;
  const ctx = canvas.getContext('2d');
  await _paintTerrainNormalBase(ctx, terrainManager, textureSize, worldSize);
  
  // If no decals, build the raw texture from the canvas and return it.
  if (!normalMapDecals || normalMapDecals.length === 0) {
    const imageData = ctx.getImageData(0, 0, textureSize, textureSize);
    const rawTexture = RawTexture.CreateRGBATexture(
      imageData.data,
      textureSize,
      textureSize,
      scene,
      false,
      true,
      Texture.BILINEAR_SAMPLINGMODE
    );
    rawTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
    rawTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
    rawTexture.vScale = -1;
    rawTexture.vOffset = 1;
    return rawTexture;
  }
  
  const pixelsPerUnit = textureSize / worldSize;

  // Load all normal map decal images
  const decalImages = await Promise.all(
    normalMapDecals.map(async (decal) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const normalMapPath = new URL(`../assets/${decal.normalMap}`, import.meta.url).href;
      
      return new Promise((resolve) => {
        img.onload = () => resolve({ decal, img });
        img.onerror = () => resolve({ decal, img: null });
        img.src = normalMapPath;
      });
    })
  );
  
  // Draw each decal onto the canvas
  for (const { decal, img } of decalImages) {
    if (!img) continue;
    
    const { centerX, centerZ, width, depth, angle = 0, repeatU = 1, repeatV = 1, intensity = 0.5 } = decal;
    
    const canvasCenterX = (centerX + worldSize / 2) * pixelsPerUnit;
    const canvasCenterY = (centerZ + worldSize / 2) * pixelsPerUnit;
    const canvasWidth = width * pixelsPerUnit;
    const canvasHeight = depth * pixelsPerUnit;
    
    ctx.save();
    ctx.translate(canvasCenterX, canvasCenterY);
    ctx.rotate(angle * Math.PI / 180);
    ctx.scale(-1, 1); // Flip horizontally in local space to match texture orientation
    
    const tilePixelWidth = canvasWidth / repeatU;
    const tilePixelHeight = canvasHeight / repeatV;
    
    ctx.globalAlpha = intensity;
    ctx.globalCompositeOperation = 'source-over';
    
    for (let ty = 0; ty < Math.ceil(repeatV); ty++) {
      for (let tx = 0; tx < Math.ceil(repeatU); tx++) {
        const x = -canvasWidth / 2 + tx * tilePixelWidth;
        const y = -canvasHeight / 2 + ty * tilePixelHeight;
        
        const drawWidth = (tx === Math.floor(repeatU) && repeatU % 1 !== 0)
          ? tilePixelWidth * (repeatU % 1)
          : tilePixelWidth;
        const drawHeight = (ty === Math.floor(repeatV) && repeatV % 1 !== 0)
          ? tilePixelHeight * (repeatV % 1)
          : tilePixelHeight;
        
        ctx.drawImage(img, x, y, drawWidth, drawHeight);
      }
    }
    
    ctx.restore();
  }
  
  const imageData = ctx.getImageData(0, 0, textureSize, textureSize);
  const rawTexture = RawTexture.CreateRGBATexture(
    imageData.data,
    textureSize,
    textureSize,
    scene,
    false,
    true,
    Texture.BILINEAR_SAMPLINGMODE
  );
  rawTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
  rawTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
  rawTexture.vScale = -1;
  rawTexture.vOffset = 1;
  return rawTexture;
}

/**
 * Update an existing composite normal map with new decals
 * This is more efficient than recreating from scratch
 * @param {RawTexture} rawTexture - Existing composite texture
 * @param {Scene} scene - Babylon scene
 * @param {Array} normalMapDecals - Array of decal feature objects
 * @param {TerrainManager} [terrainManager]
 * @param {number} [worldSize]
 * @returns {Promise<void>}
 */
export async function updateCompositeNormalMap(rawTexture, scene, normalMapDecals, terrainManager, worldSize = 160) {
  const textureSize = rawTexture.getSize().width;
  const canvas = document.createElement('canvas');
  canvas.width = textureSize;
  canvas.height = textureSize;
  const ctx = canvas.getContext('2d');
  await _paintTerrainNormalBase(ctx, terrainManager, textureSize, worldSize);
  
  if (normalMapDecals && normalMapDecals.length > 0) {
    const pixelsPerUnit = textureSize / worldSize;

    const decalImages = await Promise.all(
      normalMapDecals.map(async (decal) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        const normalMapPath = new URL(`../assets/${decal.normalMap}`, import.meta.url).href;
        return new Promise((resolve) => {
          img.onload = () => resolve({ decal, img });
          img.onerror = () => resolve({ decal, img: null });
          img.src = normalMapPath;
        });
      })
    );

    for (const { decal, img } of decalImages) {
      if (!img) continue;
      const { centerX, centerZ, width, depth, angle = 0, repeatU = 1, repeatV = 1, intensity = 0.5 } = decal;
      const canvasCenterX = (centerX + worldSize / 2) * pixelsPerUnit;
      const canvasCenterY = (centerZ + worldSize / 2) * pixelsPerUnit;
      const canvasWidth = width * pixelsPerUnit;
      const canvasHeight = depth * pixelsPerUnit;

      ctx.save();
      ctx.translate(canvasCenterX, canvasCenterY);
      ctx.rotate(angle * Math.PI / 180);
      ctx.scale(-1, 1);

      const tilePixelWidth = canvasWidth / repeatU;
      const tilePixelHeight = canvasHeight / repeatV;
      ctx.globalAlpha = intensity;
      ctx.globalCompositeOperation = 'source-over';

      for (let ty = 0; ty < Math.ceil(repeatV); ty++) {
        for (let tx = 0; tx < Math.ceil(repeatU); tx++) {
          const x = -canvasWidth / 2 + tx * tilePixelWidth;
          const y = -canvasHeight / 2 + ty * tilePixelHeight;
          const drawWidth = (tx === Math.floor(repeatU) && repeatU % 1 !== 0)
            ? tilePixelWidth * (repeatU % 1)
            : tilePixelWidth;
          const drawHeight = (ty === Math.floor(repeatV) && repeatV % 1 !== 0)
            ? tilePixelHeight * (repeatV % 1)
            : tilePixelHeight;
          ctx.drawImage(img, x, y, drawWidth, drawHeight);
        }
      }

      ctx.restore();
    }
  }

  const imageData = ctx.getImageData(0, 0, textureSize, textureSize);
  rawTexture.update(imageData.data);
}

const TERRAIN_EXPAND_SHADER_NAME = "terrainExpand";
Effect.ShadersStore[`${TERRAIN_EXPAND_SHADER_NAME}PixelShader`] = `
#ifdef GL_ES
precision highp float;
#endif

varying vec2 vUV;
uniform sampler2D terrainIdSampler;
uniform sampler2D terrainPropertySampler;
uniform int outputMode;
uniform float terrainTypeCount;
uniform float terrainCellCount;

float decodeTerrainId(vec4 encoded) {
  return floor(encoded.r * 255.0 + 0.5);
}

vec4 sampleTypeProperties(float typeIndex) {
  float u = (typeIndex + 0.5) / terrainTypeCount;
  float v = 0.25;
  return texture2D(terrainPropertySampler, vec2(u, v));
}

vec4 sampleTerrainId(vec2 cellUV) {
  return texture2D(terrainIdSampler, cellUV);
}

void main() {
  vec2 coord = clamp(vUV * terrainCellCount, vec2(0.0), vec2(terrainCellCount - 1.0));
  vec2 cell = floor(coord);
  vec2 local = fract(coord);

  vec2 centerCellUV = (cell + vec2(0.5)) / terrainCellCount;
  float centerId = decodeTerrainId(sampleTerrainId(centerCellUV));
  vec4 centerProps = sampleTypeProperties(centerId);
  vec4 accum = vec4(centerProps.rgb, centerProps.a);
  float totalWeight = 1.0;

  float neighborId;
  vec4 neighborProps;
  float w;
  vec2 neighborCell;

  neighborCell = vec2(min(cell.x + 1.0, terrainCellCount - 1.0), cell.y);
  neighborId = decodeTerrainId(sampleTerrainId((neighborCell + vec2(0.5)) / terrainCellCount));
  if (neighborId != centerId) {
    w = local.x;
    if (w > 0.0) {
      neighborProps = sampleTypeProperties(neighborId);
      accum += vec4(neighborProps.rgb, neighborProps.a) * w;
      totalWeight += w;
    }
  }

  neighborCell = vec2(max(cell.x - 1.0, 0.0), cell.y);
  neighborId = decodeTerrainId(sampleTerrainId((neighborCell + vec2(0.5)) / terrainCellCount));
  if (neighborId != centerId) {
    w = 1.0 - local.x;
    if (w > 0.0) {
      neighborProps = sampleTypeProperties(neighborId);
      accum += vec4(neighborProps.rgb, neighborProps.a) * w;
      totalWeight += w;
    }
  }

  neighborCell = vec2(cell.x, min(cell.y + 1.0, terrainCellCount - 1.0));
  neighborId = decodeTerrainId(sampleTerrainId((neighborCell + vec2(0.5)) / terrainCellCount));
  if (neighborId != centerId) {
    w = local.y;
    if (w > 0.0) {
      neighborProps = sampleTypeProperties(neighborId);
      accum += vec4(neighborProps.rgb, neighborProps.a) * w;
      totalWeight += w;
    }
  }

  neighborCell = vec2(cell.x, max(cell.y - 1.0, 0.0));
  neighborId = decodeTerrainId(sampleTerrainId((neighborCell + vec2(0.5)) / terrainCellCount));
  if (neighborId != centerId) {
    w = 1.0 - local.y;
    if (w > 0.0) {
      neighborProps = sampleTypeProperties(neighborId);
      accum += vec4(neighborProps.rgb, neighborProps.a) * w;
      totalWeight += w;
    }
  }

  vec4 result = accum / totalWeight;
  if (outputMode == 0) {
    gl_FragColor = vec4(result.rgb, 1.0);
  } else {
    gl_FragColor = vec4(vec3(result.a), 1.0);
  }
}
`;

function _createTerrainRenderTargetTexture(scene, name, terrainIdTex, terrainPropertyTex, terrainTypeCount, terrainCellCount, textureSize, outputMode) {
  const renderTarget = new RenderTargetTexture(
    name,
    { width: textureSize, height: textureSize },
    scene,
    {
      generateMipMaps: false,
      type: Constants.TEXTURETYPE_UNSIGNED_BYTE,
      format: Constants.TEXTUREFORMAT_RGBA,
      samplingMode: Texture.BILINEAR_SAMPLINGMODE,
      generateDepthBuffer: false,
      generateStencilBuffer: false,
    }
  );

  renderTarget.wrapU = Texture.CLAMP_ADDRESSMODE;
  renderTarget.wrapV = Texture.CLAMP_ADDRESSMODE;
  renderTarget.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;

  const postProcess = new PostProcess(
    `${name}_postprocess`,
    TERRAIN_EXPAND_SHADER_NAME,
    ["outputMode", "terrainTypeCount", "terrainCellCount"],
    ["terrainIdSampler", "terrainPropertySampler"],
    1.0,
    null,
    Texture.NEAREST_SAMPLINGMODE,
    scene.getEngine(),
    true,
    undefined,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    "postprocess",
    undefined,
    false,
    Constants.TEXTUREFORMAT_RGBA
  );

  postProcess.externalTextureSamplerBinding = false;
  postProcess.autoClear = true;
  postProcess.onApply = (effect) => {
    effect.setInt("outputMode", outputMode);
    effect.setFloat("terrainTypeCount", terrainTypeCount);
    effect.setFloat("terrainCellCount", terrainCellCount);
    effect.setTexture("terrainIdSampler", terrainIdTex);
    effect.setTexture("terrainPropertySampler", terrainPropertyTex);
  };

  postProcess.onEffectCreatedObservable.addOnce((effect) => {
    effect.executeWhenCompiled(() => {
      renderTarget.render();
      renderTarget.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    });
  });

  const engine = scene.getEngine();
  renderTarget.customRenderFunction = () => {
    const target = renderTarget.renderTarget;
    if (!target) {
      return;
    }
    scene.postProcessManager.directRender([postProcess], target, true);
    engine.restoreDefaultFramebuffer();
  };

  return renderTarget;
}

export function createTerrainRenderTargetTexture(scene, terrainIdTex, terrainPropertyTex, terrainTypeCount, terrainCellCount, textureSize) {
  const diffuseTexture = _createTerrainRenderTargetTexture(scene, "terrainDiffuse", terrainIdTex, terrainPropertyTex, terrainTypeCount, terrainCellCount, textureSize, 0);
  const specularTexture = _createTerrainRenderTargetTexture(scene, "terrainSpecular", terrainIdTex, terrainPropertyTex, terrainTypeCount, terrainCellCount, textureSize, 1);
  return { diffuseTexture, specularTexture };
}
