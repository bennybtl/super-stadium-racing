/**
 * Custom ground shader with support for normal map decals
 * 
 * Uses a simpler approach: dynamically generates a combined normal map texture
 * by compositing multiple normal map decals onto a canvas, then applies it
 * to the standard material's bump texture.
 */

import { RawTexture, Texture, MaterialPluginBase, StandardMaterial, Color3 } from "@babylonjs/core";

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

// ---------------------------------------------------------------------------
// TerrainBlendPlugin — MaterialPluginBase that injects 8-neighbor terrain
// blending into a StandardMaterial at Babylon's standard CUSTOM_FRAGMENT_*
// injection points.  The StandardMaterial keeps all lighting, CSM shadow
// receiving, and normal-map processing — the plugin only overrides the
// per-pixel diffuse colour and specular intensity.
// ---------------------------------------------------------------------------

const _TERRAIN_BLEND_GLSL_DEFS = `
  // Terrain samplers — declared here because Babylon's plugin getSamplers() only
  // registers the names for binding; the GLSL declaration must be explicit.
  uniform sampler2D terrainIdSampler;
  uniform sampler2D terrainPropertySampler;
  // Terrain uniforms — also declared explicitly; the UBO path handles binding
  // but we need the declaration regardless of UBO vs non-UBO engine.
  uniform float terrainTypeCount;
  uniform float terrainCellCount;
  uniform float terrainWorldHalfSize;

  // Declared as module-level so both CUSTOM_FRAGMENT_UPDATE_DIFFUSE and the
  // specularColor override can access the result.
  vec4 _terrainBlendResult;

  float _decodeTerrainId(vec4 encoded) {
      return floor(encoded.r * 255.0 + 0.5);
  }
  vec4 _sampleTypeProps(float typeIndex) {
      float u = (typeIndex + 0.5) / terrainTypeCount;
      return texture2D(terrainPropertySampler, vec2(u, 0.5));
  }
  void _blendNeighbor(vec2 nc, float centerId, float w,
                      inout vec4 accum, inout float totalW) {
      if (w <= 0.0) return;
      float nId = _decodeTerrainId(texture2D(terrainIdSampler,
                      (nc + 0.5) / terrainCellCount));
      if (nId != centerId) {
          accum += _sampleTypeProps(nId) * w;
          totalW += w;
      }
  }
  vec4 _computeTerrainBlend(vec2 tUV) {
      float n = terrainCellCount;
      vec2 coord = clamp(tUV * n, vec2(0.0), vec2(n - 1.0));
      vec2 cell  = floor(coord);
      vec2 local = fract(coord);
      float cx = cell.x, cy = cell.y;
      float lx = local.x, ly = local.y;
      float nm = n - 1.0;
      float centerId    = _decodeTerrainId(texture2D(terrainIdSampler,
                              (cell + 0.5) / n));
      vec4  accum       = _sampleTypeProps(centerId);
      float totalWeight = 1.0;
      // Cardinal
      _blendNeighbor(vec2(min(cx+1.,nm), cy),          centerId, lx,           accum, totalWeight);
      _blendNeighbor(vec2(max(cx-1.,0.), cy),          centerId, 1.-lx,        accum, totalWeight);
      _blendNeighbor(vec2(cx, min(cy+1.,nm)),          centerId, ly,           accum, totalWeight);
      _blendNeighbor(vec2(cx, max(cy-1.,0.)),          centerId, 1.-ly,        accum, totalWeight);
      // Diagonal
      _blendNeighbor(vec2(min(cx+1.,nm), min(cy+1.,nm)), centerId, lx*ly,         accum, totalWeight);
      _blendNeighbor(vec2(max(cx-1.,0.), min(cy+1.,nm)), centerId, (1.-lx)*ly,    accum, totalWeight);
      _blendNeighbor(vec2(min(cx+1.,nm), max(cy-1.,0.)), centerId, lx*(1.-ly),    accum, totalWeight);
      _blendNeighbor(vec2(max(cx-1.,0.), max(cy-1.,0.)), centerId, (1.-lx)*(1.-ly), accum, totalWeight);
      return accum / totalWeight;
  }
`;

// terrain UV from world position: maps [-halfSize, +halfSize] → [0, 1]
// Uses vPositionW (always available in StandardMaterial fragment shader).
const _TERRAIN_BLEND_UPDATE_DIFFUSE = `
  vec2 _tUV = vPositionW.xz / (terrainWorldHalfSize * 2.0) + 0.5;
  _terrainBlendResult = _computeTerrainBlend(_tUV);
  baseColor = vec4(_terrainBlendResult.rgb, 1.0);
`;

// Per-pixel specular intensity is now injected via a regex replacement
// of the specularColor declaration line — see getCustomCode() below.

/**
 * MaterialPlugin that injects terrain blending into StandardMaterial.
 * StandardMaterial keeps CSM shadow receiving, lighting, and normal mapping.
 */
export class TerrainBlendPlugin extends MaterialPluginBase {
  constructor(material, terrainIdTex, terrainPropertyTex, terrainTypeCount, terrainCellCount, terrainWorldHalfSize) {
    super(material, "TerrainBlend", 200, {});
    this._terrainIdTex        = terrainIdTex;
    this._terrainPropertyTex  = terrainPropertyTex;
    this._terrainTypeCount    = terrainTypeCount;
    this._terrainCellCount    = terrainCellCount;
    this._terrainWorldHalfSize = terrainWorldHalfSize;
    this._enable(true);
  }

  getSamplers(samplers) {
    samplers.push("terrainIdSampler", "terrainPropertySampler");
  }

  getUniforms() {
    // The uniform declarations are emitted in CUSTOM_FRAGMENT_DEFINITIONS.
    // Return the ubo list so Babylon's UBO path still maps names to slots
    // when the engine supports uniform buffer objects.
    return {
      ubo: [
        { name: "terrainTypeCount",      size: 1, type: "float" },
        { name: "terrainCellCount",      size: 1, type: "float" },
        { name: "terrainWorldHalfSize",  size: 1, type: "float" },
      ],
    };
  }

  bindForSubMesh(uniformBuffer, scene) {
    uniformBuffer.updateFloat("terrainTypeCount",     this._terrainTypeCount);
    uniformBuffer.updateFloat("terrainCellCount",     this._terrainCellCount);
    uniformBuffer.updateFloat("terrainWorldHalfSize", this._terrainWorldHalfSize);
    if (scene.texturesEnabled) {
      uniformBuffer.setTexture("terrainIdSampler",       this._terrainIdTex);
      uniformBuffer.setTexture("terrainPropertySampler", this._terrainPropertyTex);
    }
  }

  getCustomCode(shaderType) {
    if (shaderType !== "fragment") return null;
    return {
      "CUSTOM_FRAGMENT_DEFINITIONS":   _TERRAIN_BLEND_GLSL_DEFS,
      "CUSTOM_FRAGMENT_UPDATE_DIFFUSE": _TERRAIN_BLEND_UPDATE_DIFFUSE,
      // Replace the specularColor declaration line so per-pixel terrain
      // specular intensity overrides the material uniform.
      // The default shader line is: float glossiness=vSpecularColor.a;vec3 specularColor=vSpecularColor.rgb;
      "!float glossiness=vSpecularColor\\.a;vec3 specularColor=vSpecularColor\\.rgb;":
        "float glossiness=vSpecularColor.a;vec3 specularColor=vec3(_terrainBlendResult.a);",
    };
  }
}

/**
 * Create a StandardMaterial with TerrainBlendPlugin for the ground mesh.
 * Receives CSM shadows and hemisphere+directional lighting automatically.
 * Normal mapping uses StandardMaterial.bumpTexture (set by caller).
 *
 * @param {Scene}      scene
 * @param {RawTexture} terrainIdTex         cellsPerSide×cellsPerSide, R = type index
 * @param {RawTexture} terrainPropertyTex   numTypes×1, RGBA = (r,g,b,specular)
 * @param {number}     terrainTypeCount     number of terrain types
 * @param {number}     terrainCellCount     grid cells per side
 * @param {number}     terrainWorldHalfSize half of terrain world size (metres)
 * @returns {StandardMaterial}
 */
export function createTerrainMaterial(scene, terrainIdTex, terrainPropertyTex, terrainTypeCount, terrainCellCount, terrainWorldHalfSize) {
  const mat = new StandardMaterial("groundMat", scene);
  mat.specularColor = new Color3(1, 1, 1);
  mat.specularPower = 48;

  new TerrainBlendPlugin(mat, terrainIdTex, terrainPropertyTex, terrainTypeCount, terrainCellCount, terrainWorldHalfSize);

  return mat;
}
