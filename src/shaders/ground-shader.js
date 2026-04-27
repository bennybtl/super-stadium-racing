/**
 * Custom ground shader with support for normal map decals
 * 
 * Uses a simpler approach: dynamically generates a combined normal map texture
 * by compositing multiple normal map decals onto a canvas, then applies it
 * to the standard material's bump texture.
 */

import { RawTexture, Texture, Vector2, RenderTargetTexture, PostProcess, Effect, Constants, ShaderMaterial, Vector3, Color3 } from "@babylonjs/core";

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
    rawTexture.gammaSpace = false;
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
  rawTexture.gammaSpace = false;
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
  return texture2D(terrainPropertySampler, vec2(u, 0.5));
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
  renderTarget.gammaSpace = false;
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

  // customRenderFunction must be assigned BEFORE registering the compilation
  // callback. When Babylon's effect cache is warm (e.g. re-entering editor
  // mode after a game session), executeWhenCompiled fires synchronously inside
  // the PostProcess constructor, meaning render() would be called before
  // customRenderFunction exists — producing a black bake.
  let _effectReady = false;
  let _bakeCount = 0;
  const engine = scene.getEngine();

  console.debug(`[TerrainRTT:${name}] created, waiting for shader compilation`);

  const rebake = () => {
    const target = renderTarget.renderTarget;
    if (!_effectReady) {
      console.warn(`[TerrainRTT:${name}] rebake() called before effect ready — ignoring`);
      return;
    }
    if (!target) {
      console.warn(`[TerrainRTT:${name}] rebake() called but renderTarget is null`);
      return;
    }
    _bakeCount++;
    console.debug(`[TerrainRTT:${name}] baking (call #${_bakeCount})`);
    scene.postProcessManager.directRender([postProcess], target, true);
    engine.restoreDefaultFramebuffer();
    console.debug(`[TerrainRTT:${name}] bake complete`);
  };

  // customRenderFunction is NOT used — Babylon's RenderingManager only calls it
  // when iterating rendering groups that contain meshes. Since this RTT has an
  // empty render list, customRenderFunction would never fire. We bake directly
  // via directRender instead.

  postProcess.onEffectCreatedObservable.addOnce((effect) => {
    console.debug(`[TerrainRTT:${name}] effect created`);
    effect.executeWhenCompiled(() => {
      console.debug(`[TerrainRTT:${name}] shader compiled, triggering bake`);
      _effectReady = true;
      rebake();
    });
  });

  renderTarget.onDisposeObservable.addOnce(() => {
    postProcess.dispose();
  });

  return { renderTarget, rebake };
}

export function createTerrainRenderTargetTexture(scene, terrainIdTex, terrainPropertyTex, terrainTypeCount, terrainCellCount, textureSize) {
  const { renderTarget: diffuseTexture, rebake: rebakeDiffuse } = _createTerrainRenderTargetTexture(scene, "terrainDiffuse", terrainIdTex, terrainPropertyTex, terrainTypeCount, terrainCellCount, textureSize, 0);
  const { renderTarget: specularTexture, rebake: rebakeSpecular } = _createTerrainRenderTargetTexture(scene, "terrainSpecular", terrainIdTex, terrainPropertyTex, terrainTypeCount, terrainCellCount, textureSize, 1);
  const rebake = () => { rebakeDiffuse(); rebakeSpecular(); };
  return { diffuseTexture, specularTexture, rebake };
}

// ---------------------------------------------------------------------------
// ShaderMaterial-based terrain renderer
// Replaces the RTT bake + StandardMaterial stack.  The terrain blending runs
// per-fragment directly on the ground mesh, reading terrainIdTex live.
// No rebake is needed after terrain edits — updateTerrainIdTexture() is enough.
// ---------------------------------------------------------------------------

const GROUND_TERRAIN_VERTEX_SHADER = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

uniform mat4 worldViewProjection;
uniform mat4 world;

varying vec2 vUV;
varying vec3 vPositionW;
varying vec3 vNormalW;

void main() {
    vec4 worldPos = world * vec4(position, 1.0);
    vPositionW = worldPos.xyz;
    // Normal matrix: inverse-transpose of the upper-left 3x3 of world.
    // For uniform scaling (terrain mesh never shears) this simplifies to mat3(world).
    vNormalW = normalize(mat3(world) * normal);
    vUV = uv;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const GROUND_TERRAIN_FRAGMENT_SHADER = `
#extension GL_OES_standard_derivatives : enable

varying vec2 vUV;
varying vec3 vPositionW;
varying vec3 vNormalW;

// Terrain index texture: R channel = terrain type index (0-255), nearest sampling
uniform sampler2D terrainIdSampler;
// Terrain property texture: RGBA = (R,G,B,specular) per terrain type, 1×numTypes
uniform sampler2D terrainPropertySampler;
// Composite normal map (canvas-baked, per-terrain-type base + decals)
uniform sampler2D bumpSampler;

uniform float terrainTypeCount;   // number of terrain types (width of terrainPropertySampler)
uniform float terrainCellCount;   // grid cells per side

// Lighting uniforms
uniform vec3  sunDirection;  // world-space direction FROM surface TOWARD sun (normalized)
uniform vec3  sunDiffuse;    // sun diffuse colour
uniform vec3  skyColor;      // hemisphere ambient – sky (up) colour
uniform vec3  groundColor;   // hemisphere ambient – ground (down) colour
uniform vec3  eyePosition;   // camera world position
uniform float specularPower; // Blinn-Phong exponent

// ---- helpers ---------------------------------------------------------------

float decodeTerrainId(vec4 encoded) {
    return floor(encoded.r * 255.0 + 0.5);
}

vec4 sampleTypeProperties(float typeIndex) {
    float u = (typeIndex + 0.5) / terrainTypeCount;
    return texture2D(terrainPropertySampler, vec2(u, 0.5));
}

// Blend contribution from one neighbor into accum/totalWeight.
// Only accumulates if the neighbor has a different type than the center.
void blendNeighbor(vec2 nc, float centerId, float w,
                   inout vec4 accum, inout float totalWeight) {
    if (w <= 0.0) return;
    float nId = decodeTerrainId(texture2D(terrainIdSampler, (nc + 0.5) / terrainCellCount));
    if (nId != centerId) {
        accum += sampleTypeProperties(nId) * w;
        totalWeight += w;
    }
}

// ---------------------------------------------------------------------------

void main() {
    // The terrainIdTex and compositeNormalMap were built/stored with v=0 at the
    // top of the data array (image convention), but when uploaded to WebGL the
    // texture is NOT Y-flipped, so v=0 is the bottom of the texture in UV space.
    // The ground mesh UV v=0 is at -Z (terrain grid row 0 = most-negative Z),
    // which coincides with the bottom of the GL texture.  So no flip is needed
    // here — ground mesh UV maps directly to terrainIdTex UV.
    //
    // The RTT pipeline needed vScale=-1/vOffset=1 because an RTT bake introduces
    // its own Y-inversion; the ShaderMaterial reads the raw texture directly.
    vec2 terrainUV = vUV;

    // ---- 8-neighbor terrain blending (4 cardinal + 4 diagonal) ----
    float n = terrainCellCount;
    vec2 coord = clamp(terrainUV * n, vec2(0.0), vec2(n - 1.0));
    vec2 cell  = floor(coord);
    vec2 local = fract(coord);

    float centerId   = decodeTerrainId(texture2D(terrainIdSampler, (cell + 0.5) / n));
    vec4  centerProps = sampleTypeProperties(centerId);
    vec4  accum      = centerProps;
    float totalWeight = 1.0;

    float cx = cell.x, cy = cell.y;
    float lx = local.x, ly = local.y;
    float nx_max = n - 1.0;

    // Cardinal
    blendNeighbor(vec2(min(cx + 1.0, nx_max), cy), centerId, lx,        accum, totalWeight);
    blendNeighbor(vec2(max(cx - 1.0, 0.0),    cy), centerId, 1.0 - lx,  accum, totalWeight);
    blendNeighbor(vec2(cx, min(cy + 1.0, nx_max)), centerId, ly,        accum, totalWeight);
    blendNeighbor(vec2(cx, max(cy - 1.0, 0.0)),    centerId, 1.0 - ly,  accum, totalWeight);

    // Diagonal
    blendNeighbor(vec2(min(cx + 1.0, nx_max), min(cy + 1.0, nx_max)), centerId, lx * ly,               accum, totalWeight);
    blendNeighbor(vec2(max(cx - 1.0, 0.0),    min(cy + 1.0, nx_max)), centerId, (1.0 - lx) * ly,       accum, totalWeight);
    blendNeighbor(vec2(min(cx + 1.0, nx_max), max(cy - 1.0, 0.0)),    centerId, lx * (1.0 - ly),       accum, totalWeight);
    blendNeighbor(vec2(max(cx - 1.0, 0.0),    max(cy - 1.0, 0.0)),    centerId, (1.0 - lx) * (1.0 - ly), accum, totalWeight);

    vec4  terrainResult   = accum / totalWeight;
    vec3  albedo          = terrainResult.rgb;
    float specularIntensity = terrainResult.a;

    // ---- Normal map (TBN built from screen-space derivatives) ----
    vec4 bumpSample = texture2D(bumpSampler, terrainUV);
    vec3 bumpTangentNormal = bumpSample.rgb * 2.0 - 1.0;

    vec3 dPdx  = dFdx(vPositionW);
    vec3 dPdy  = dFdy(vPositionW);
    vec2 dUVdx = dFdx(vUV);
    vec2 dUVdy = dFdy(vUV);
    float det  = dUVdx.x * dUVdy.y - dUVdx.y * dUVdy.x;
    vec3 tangent, bitangent;
    if (abs(det) > 1e-6) {
        float invDet = 1.0 / det;
        tangent   = normalize(( dUVdy.y * dPdx - dUVdx.y * dPdy) * invDet);
        bitangent = normalize((-dUVdy.x * dPdx + dUVdx.x * dPdy) * invDet);
    } else {
        tangent   = vec3(1.0, 0.0, 0.0);
        bitangent = vec3(0.0, 0.0, 1.0);
    }
    vec3 normalW = normalize(mat3(tangent, bitangent, vNormalW) * bumpTangentNormal);

    // ---- Phong lighting ----
    vec3 viewDir = normalize(eyePosition - vPositionW);

    // Hemisphere ambient
    float upFactor = dot(normalW, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5;
    vec3 ambient = mix(groundColor, skyColor, upFactor);

    // Directional sun – diffuse
    float NdotL = max(dot(normalW, sunDirection), 0.0);
    vec3  diffuse = sunDiffuse * NdotL;

    // Blinn-Phong specular
    vec3  halfVec = normalize(sunDirection + viewDir);
    float spec    = pow(max(dot(normalW, halfVec), 0.0), specularPower);
    vec3  specular = sunDiffuse * spec * specularIntensity;

    vec3 finalColor = (ambient + diffuse) * albedo + specular;
    gl_FragColor = vec4(finalColor, 1.0);
}
`;

/**
 * Create a ShaderMaterial that renders terrain blending + normal map + Phong
 * lighting directly on the ground mesh, without any RTT bake step.
 *
 * After terrain edits call updateTerrainIdTexture() — no rebake required.
 *
 * @param {Scene}      scene
 * @param {RawTexture} terrainIdTex          cellsPerSide×cellsPerSide, R = type index
 * @param {RawTexture} terrainPropertyTex    numTypes×1, RGBA = (r,g,b,specular)
 * @param {RawTexture} compositeNormalMap    canvas-baked normal map
 * @param {number}     terrainTypeCount      number of terrain types
 * @param {number}     terrainCellCount      grid cells per side
 * @returns {ShaderMaterial}
 */
export function createTerrainShaderMaterial(scene, terrainIdTex, terrainPropertyTex, compositeNormalMap, terrainTypeCount, terrainCellCount) {
  const mat = new ShaderMaterial(
    "groundTerrainMat",
    scene,
    {
      vertexSource:   GROUND_TERRAIN_VERTEX_SHADER,
      fragmentSource: GROUND_TERRAIN_FRAGMENT_SHADER,
    },
    {
      attributes: ["position", "normal", "uv"],
      uniforms: [
        "worldViewProjection", "world",
        "terrainTypeCount", "terrainCellCount",
        "sunDirection", "sunDiffuse",
        "skyColor", "groundColor",
        "eyePosition", "specularPower",
      ],
      samplers: ["terrainIdSampler", "terrainPropertySampler", "bumpSampler"],
    }
  );

  mat.setTexture("terrainIdSampler",       terrainIdTex);
  mat.setTexture("terrainPropertySampler", terrainPropertyTex);
  mat.setTexture("bumpSampler",            compositeNormalMap);
  mat.setFloat("terrainTypeCount",  terrainTypeCount);
  mat.setFloat("terrainCellCount",  terrainCellCount);
  mat.setFloat("specularPower",     48.0);

  // Per-frame uniforms pushed each time the material is bound to a mesh.
  // Sun direction and ambient colours are effectively constant but reading
  // them from the scene objects keeps this decoupled from hard-coded values.
  mat.onBindObservable.add(() => {
    const sun     = scene.getLightByName("sun");
    const ambient = scene.getLightByName("ambient");

    if (sun) {
      // sun.direction points FROM light TOWARD scene; negate for "toward light"
      const d = sun.direction;
      mat.setVector3("sunDirection", new Vector3(-d.x, -d.y, -d.z).normalize());
      mat.setColor3("sunDiffuse", sun.diffuse);
    }

    if (ambient) {
      mat.setColor3("skyColor",    ambient.diffuse);
      mat.setColor3("groundColor", ambient.groundColor);
    }

    const cam = scene.activeCamera;
    if (cam) {
      mat.setVector3("eyePosition", cam.globalPosition);
    }
  });

  return mat;
}
