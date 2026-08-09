/**
 * Custom ground shader with support for normal map decals
 * 
 * Uses a simpler approach: dynamically generates a combined normal map texture
 * by compositing multiple normal map decals onto a canvas, then applies it
 * to the standard material's bump texture.
 */

import { RawTexture, RawTexture2DArray, Texture, MaterialPluginBase, StandardMaterial, Color3, Constants } from "@babylonjs/core";
import { TERRAIN_TYPES } from "../terrain.js";
import { _smoothstep, _getTerrainSlopeDegAt as _getTerrainSlopeDeg } from "../terrain-utils.js";
import { bakeAiPathWear } from "../terrain-utils.js";
import { resampleWrapped } from "../terrain-blend-utils.js";

const _terrainTypeList = Object.values(TERRAIN_TYPES);
const _terrainTypeIndexByName = new Map(_terrainTypeList.map((terrainType, index) => [terrainType?.name, index]));

export function getTerrainTypeIndexByName(name) {
  if (typeof name !== 'string' || name.length === 0) return -1;
  return _terrainTypeIndexByName.get(name) ?? -1;
}

const STEEP_DIRT_NORMAL_MAP = 'normals/7733-normal.jpg';
const STEEP_DIRT_SLOPE_START = 18;
const STEEP_DIRT_SLOPE_END = 34;
const STEEP_DIRT_SAMPLE_DISTANCE = 2.5;
const STEEP_DIRT_TILE_WORLD_UNITS = 10;
const STEEP_GRASS_NORMAL_MAP = TERRAIN_TYPES.LOAMY_DIRT.normalMap || 'normals/6481-normal.jpg';
const STEEP_GRASS_SLOPE_START = 16;
const STEEP_GRASS_SLOPE_END = 30;
const STEEP_GRASS_SAMPLE_DISTANCE = 6.5;
const STEEP_GRASS_TILE_WORLD_UNITS = 10;

const _normalMapModules = import.meta.glob('../assets/normals/*', { eager: true, query: '?url', import: 'default' });
const _normalMapUrls = {};
for (const [path, url] of Object.entries(_normalMapModules)) {
  const relativePath = path.replace('../assets/', '');
  const filename = path.split('/').at(-1);
  _normalMapUrls[relativePath] = url;
  _normalMapUrls[filename] = url;
}

/**
 * Pre-scale a source texture into a tile canvas of whole-pixel size, for use as
 * a repeating pattern.
 *
 * `createPattern` + `setTransform` resamples the source at every repeat, and the
 * filter cannot wrap across a tile edge. With a fractional tile size — 2000/180
 * × 10 = 111.111px — each repeat also lands on a different subpixel phase, so
 * the mismatch shows up as a line at every tile: a grid at the tiling spacing,
 * even when the source texture itself is perfectly seamless.
 *
 * Scaling once into an integer-sized canvas and tiling that 1:1 removes both:
 * the pattern repeats on exact pixel boundaries with no resampling at all.
 * Cached, since the same texture and tile size recur across cells and rebuilds.
 */
// A track uses under a dozen (texture, tile size) pairs, but each new track size
// mints fresh keys, so the map is bounded rather than left to grow for the life
// of the session. Tiles are small and cheap to rebuild; dropping the oldest is
// enough, no need for real LRU accounting.
const TILE_CACHE_LIMIT = 32;
const _tileCanvasCache = new Map();

function _cacheTile(cache, key, canvas) {
  if (cache.size >= TILE_CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, canvas);
  return canvas;
}
function _scaledTilePixels(img, tileWidth, tileHeight) {
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const source = document.createElement('canvas');
  source.width = sw;
  source.height = sh;
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  sourceCtx.drawImage(img, 0, 0);
  const pixels = sourceCtx.getImageData(0, 0, sw, sh).data;
  return resampleWrapped(pixels, sw, sh, tileWidth, tileHeight);
}

function _buildScaledTileCanvas(img, tileWidth, tileHeight) {
  const w = Math.max(1, Math.round(tileWidth));
  const h = Math.max(1, Math.round(tileHeight));
  const key = `${img.src}|${w}x${h}`;
  const cached = _tileCanvasCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tileCtx = canvas.getContext('2d');
  const scaled = tileCtx.createImageData(w, h);
  scaled.data.set(_scaledTilePixels(img, w, h));
  tileCtx.putImageData(scaled, 0, 0);

  return _cacheTile(_tileCanvasCache, key, canvas);
}

/**
 * Fill one terrain cell, snapped to whole texture pixels.
 *
 * `pixelsPerCell` is texture size ÷ cell count and is rarely a whole number
 * (2000 / 180 = 11.111…), so filling at raw fractional coordinates leaves every
 * cell edge antialiased. Two neighbouring cells then composite over the same
 * boundary pixel, and source-over applied twice does not add up to one full
 * cover: the pixel keeps a fraction of whatever was underneath. Over the grid
 * that reads as a faint checkerboard of lines.
 *
 * Snapping both edges to integers hands each boundary to exactly one cell —
 * cell i ends where cell i+1 begins, by construction, so there is no gap and no
 * double coverage.
 */
function _fillTerrainCell(ctx, col, row, pixelsPerCell) {
  const x0 = Math.round(col * pixelsPerCell);
  const y0 = Math.round(row * pixelsPerCell);
  const x1 = Math.round((col + 1) * pixelsPerCell);
  const y1 = Math.round((row + 1) * pixelsPerCell);
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

const _textureMapModules = import.meta.glob('../assets/textures/*', { eager: true, query: '?url', import: 'default' });
const _textureMapUrls = {};
for (const [path, url] of Object.entries(_textureMapModules)) {
  const relativePath = path.replace('../assets/', '');
  const filename = path.split('/').at(-1);
  _textureMapUrls[relativePath] = url;
  _textureMapUrls[filename] = url;
}

/**
 * Load and cache normal map images by filename.
 * @private
 */
const _normalMapCache = new Map();
async function _loadNormalMap(filename) {
  if (_normalMapCache.has(filename)) return _normalMapCache.get(filename);
  const url = _normalMapUrls[filename];
  if (!url) {
    console.warn(`[GroundShader] normal map not found: ${filename}`);
    _normalMapCache.set(filename, null);
    return null;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = resolve;
    img.src = url;
  });
  _normalMapCache.set(filename, img);
  return img;
}

const _textureMapCache = new Map();
async function _loadTextureMap(filename) {
  if (_textureMapCache.has(filename)) return _textureMapCache.get(filename);
  const url = _textureMapUrls[filename];
  if (!url) {
    console.warn(`[GroundShader] texture not found: ${filename}`);
    _textureMapCache.set(filename, null);
    return null;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = resolve;
    img.src = url;
  });
  _textureMapCache.set(filename, img);
  return img;
}

function _getCellWorldCenter(terrainManager, col, row, worldWidth, worldDepth = worldWidth) {
  const n = terrainManager.cellsPerSide;
  const x = ((col + 0.5) / n) * worldWidth - worldWidth / 2;
  const z = ((row + 0.5) / n) * worldDepth - worldDepth / 2;
  return { x, z };
}

async function _paintSteepTerrainOverlay(
  ctx,
  track,
  terrainManager,
  textureSize,
  worldWidth,
  worldDepth,
  {
    normalMap,
    sourceTerrainNames,
    slopeStart,
    slopeEnd,
    sampleDistance,
    worldUnitsPerTile,
  }
) {
  if (!track) return;

  const img = await _loadNormalMap(normalMap);
  if (!img || img.naturalWidth <= 0) return;

  const pixelsPerCell = textureSize / terrainManager.cellsPerSide;
  const tileSizeX = (textureSize / worldWidth) * worldUnitsPerTile;
  const tileSizeY = (textureSize / worldDepth) * worldUnitsPerTile;
  const pattern = ctx.createPattern(_buildScaledTileCanvas(img, tileSizeX, tileSizeY), 'repeat');
  if (!pattern) return;

  const cellsByBlend = new Map();
  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      const cell = terrainManager.grid[row * terrainManager.cellsPerSide + col];
      const cellName = cell?.name ?? '';
      if (!sourceTerrainNames.includes(cellName)) continue;

      const { x, z } = _getCellWorldCenter(terrainManager, col, row, worldWidth, worldDepth);
      const slopeDeg = _getTerrainSlopeDeg(track, x, z, sampleDistance * terrainManager.cellSize);
      const blend = _smoothstep(slopeStart, slopeEnd, slopeDeg);
      if (blend <= 0) continue;

      const key = Math.round(blend * 20) / 20;
      if (!cellsByBlend.has(key)) cellsByBlend.set(key, []);
      cellsByBlend.get(key).push({ col, row });
    }
  }

  if (cellsByBlend.size === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = pattern;

  for (const [blend, cells] of cellsByBlend.entries()) {
    ctx.globalAlpha = Math.min(1, Math.max(0, blend));
    for (const { col, row } of cells) {
      _fillTerrainCell(ctx, col, row, pixelsPerCell);
    }
  }

  ctx.restore();
}

async function _paintSteepDirtOverlay(ctx, track, terrainManager, textureSize, worldWidth, worldDepth) {
  return _paintSteepTerrainOverlay(ctx, track, terrainManager, textureSize, worldWidth, worldDepth, {
    normalMap: STEEP_DIRT_NORMAL_MAP,
    sourceTerrainNames: ['packed_dirt', 'loose_dirt'],
    slopeStart: STEEP_DIRT_SLOPE_START,
    slopeEnd: STEEP_DIRT_SLOPE_END,
    sampleDistance: STEEP_DIRT_SAMPLE_DISTANCE,
    worldUnitsPerTile: STEEP_DIRT_TILE_WORLD_UNITS,
  });
}

async function _paintSteepGrassOverlay(ctx, track, terrainManager, textureSize, worldWidth, worldDepth) {
  return _paintSteepTerrainOverlay(ctx, track, terrainManager, textureSize, worldWidth, worldDepth, {
    normalMap: STEEP_GRASS_NORMAL_MAP,
    sourceTerrainNames: ['grass'],
    slopeStart: STEEP_GRASS_SLOPE_START,
    slopeEnd: STEEP_GRASS_SLOPE_END,
    sampleDistance: STEEP_GRASS_SAMPLE_DISTANCE,
    worldUnitsPerTile: STEEP_GRASS_TILE_WORLD_UNITS,
  });
}

const _waterTileCache = new Map();
function _buildWaterDepthTileCanvas(img, tileWidthPx, tileHeightPx, waterCfg) {
  const tileWidth = Math.max(4, Math.round(tileWidthPx));
  const tileHeight = Math.max(4, Math.round(tileHeightPx));
  // Cached like the other tiles: this runs from rebakeTerrainTexture, which
  // fires on every terrain edit, and the result only changes with the track's
  // dimensions. The water config is a module constant, so it needs no key.
  const cacheKey = `${img.src}|${tileWidth}x${tileHeight}`;
  const cached = _waterTileCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = tileWidth;
  canvas.height = tileHeight;
  const ctx = canvas.getContext('2d');

  // Same wrap-preserving downscale the other tiles use — drawImage would clamp
  // at the border and leave this tile seaming against itself when repeated.
  const image = ctx.createImageData(tileWidth, tileHeight);
  image.data.set(_scaledTilePixels(img, tileWidth, tileHeight));
  const data = image.data;

  const deepColor = waterCfg.diffuseDepthColor ?? new Color3(0.10, 0.30, 0.55);
  const deepR = Math.round((deepColor.r ?? 0.10) * 255);
  const deepG = Math.round((deepColor.g ?? 0.30) * 255);
  const deepB = Math.round((deepColor.b ?? 0.55) * 255);
  const threshold = waterCfg.diffuseDepthThreshold ?? 0.45;
  const softness = Math.max(0.01, waterCfg.diffuseDepthSoftness ?? 0.18);
  const opacity = Math.max(0, Math.min(1, waterCfg.diffuseTextureOpacity ?? 0.62));
  const gain = Math.max(0.1, waterCfg.diffuseDepthGain ?? 1.8);
  const minBlend = Math.max(0, Math.min(1, waterCfg.diffuseDepthMinBlend ?? 0.12));

  // Normalize luminance per tile so subtle source maps still produce visible depth contrast.
  let minLum = 1;
  let maxLum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const luminance = r * 0.299 + g * 0.587 + b * 0.114;
    if (luminance < minLum) minLum = luminance;
    if (luminance > maxLum) maxLum = luminance;
  }
  const lumRange = Math.max(1e-4, maxLum - minLum);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const rawLum = r * 0.299 + g * 0.587 + b * 0.114;
    const luminance = (rawLum - minLum) / lumRange;
    // Use darkness (not brightness) so thresholds are intuitive for "deep" regions.
    const depthSignal = 1 - luminance;
    let depthMask = Math.max(0, Math.min(1,
      _smoothstep(threshold, threshold + softness, depthSignal) * gain
    ));
    if (depthMask > 0) depthMask = minBlend + (1 - minBlend) * depthMask;
    const alpha = Math.round(depthMask * opacity * 255);

    data[i] = deepR;
    data[i + 1] = deepG;
    data[i + 2] = deepB;
    data[i + 3] = alpha;
  }

  ctx.putImageData(image, 0, 0);
  return _cacheTile(_waterTileCache, cacheKey, canvas);
}

async function _paintWaterDepthOverlay(ctx, terrainManager, textureSize, worldWidth, worldDepth = worldWidth) {
  const waterCfg = TERRAIN_TYPES.WATER;
  const waterTextureName = _textureMapUrls[waterCfg.diffuseTexture] ? waterCfg.diffuseTexture : waterCfg.normalMap;
  if (!waterTextureName) return;

  const img = await (_textureMapUrls[waterTextureName] ? _loadTextureMap(waterTextureName) : _loadNormalMap(waterTextureName));
  if (!img || img.naturalWidth <= 0) return;

  const pixelsPerCell = textureSize / terrainManager.cellsPerSide;
  const worldUnitsPerTile = waterCfg.diffuseTextureWorldUnitsPerTile ?? 12;
  // Per axis, like every other tiling pass — averaging the two stretches the
  // repeat on a non-square track.
  const tileSizeX = (textureSize / worldWidth) * worldUnitsPerTile;
  const tileSizeY = (textureSize / worldDepth) * worldUnitsPerTile;
  const waterTile = _buildWaterDepthTileCanvas(img, tileSizeX, tileSizeY, waterCfg);
  const pattern = ctx.createPattern(waterTile, 'repeat');
  if (!pattern) return;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = pattern;

  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      const cell = terrainManager.grid[row * terrainManager.cellsPerSide + col];
      if (cell?.name !== 'water') continue;
      _fillTerrainCell(ctx, col, row, pixelsPerCell);
    }
  }

  ctx.restore();
}

// Per-terrain-type detail textures, packed into one sampler2DArray.
//
// These used to be baked into a single 2000px canvas stretched over the whole
// ground, which capped detail at ~10 texels per metre on a 200m track — grass
// blades and dirt grain washed out into flat mush, and the cap got worse as
// tracks got bigger. Sampling the source textures per-fragment instead, tiled by
// world position, makes detail independent of track size.
//
// A 2D array (not an atlas) because the layer index can be non-uniform per
// fragment without the UV-wrap seams an atlas would need textureGrad to avoid.
// Layers are index-aligned with TERRAIN_TYPES, so the terrain id sampled from
// the grid doubles as the layer index.
const DETAIL_TILE_PIXELS = 1024;
// Normal maps tile every ~10 world units against the diffuse's ~40, so a quarter
// of the pixels already gives finer relief than the albedo has colour.
const DETAIL_NORMAL_TILE_PIXELS = 512;

/**
 * Pack one image per terrain type into a texture array, index-aligned with
 * TERRAIN_TYPES so a terrain id doubles as the layer index. Types with no image
 * (or a file that failed to load) get `emptyFill`, chosen so the shader's use of
 * that layer is a no-op.
 * @private
 */
async function _buildTypeTextureArray(scene, { size, sourceName, loadImage, emptyFill }) {
  const layers = _terrainTypeList.length;
  const bytesPerLayer = size * size * 4;
  const data = new Uint8Array(layers * bytesPerLayer);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  for (let i = 0; i < layers; i++) {
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = emptyFill;
    ctx.fillRect(0, 0, size, size);

    const name = sourceName(_terrainTypeList[i]);
    if (name) {
      const img = await loadImage(name);
      if (img && img.naturalWidth > 0) ctx.drawImage(img, 0, 0, size, size);
    }
    data.set(ctx.getImageData(0, 0, size, size).data, i * bytesPerLayer);
  }

  const array = new RawTexture2DArray(
    data,
    size,
    size,
    layers,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    true,   // mip maps — the plain runs to the horizon, so minification matters
    false,
    Texture.TRILINEAR_SAMPLINGMODE
  );
  array.wrapU = Texture.WRAP_ADDRESSMODE;
  array.wrapV = Texture.WRAP_ADDRESSMODE;
  array.anisotropicFilteringLevel = 8;
  // Sampled straight in the plugin rather than through a material texture slot,
  // like the other raw terrain textures — no gamma conversion on the way in.
  array.gammaSpace = false;
  return array;
}

/**
 * Build the per-type albedo detail array. Static across tracks — the terrain type
 * list never changes at runtime — so it is built once per scene.
 * @param {Scene} scene
 * @returns {Promise<RawTexture2DArray>}
 */
export async function createTerrainDetailTextureArray(scene) {
  return _buildTypeTextureArray(scene, {
    size: DETAIL_TILE_PIXELS,
    sourceName: (terrainType) => terrainType?.diffuseTexture,
    loadImage: _loadTextureMap,
    // White is the identity for the multiply the shader does, so a type with no
    // texture renders as its flat colour.
    emptyFill: '#ffffff',
  });
}

/**
 * Build the per-type detail NORMAL array — the relief counterpart of the albedo
 * array, and for the same reason: the composite bake could only afford ~10
 * texels/m for grain that repeats every 10 world units.
 * @param {Scene} scene
 * @returns {Promise<RawTexture2DArray>}
 */
export async function createTerrainDetailNormalArray(scene) {
  return _buildTypeTextureArray(scene, {
    size: DETAIL_NORMAL_TILE_PIXELS,
    sourceName: (terrainType) => terrainType?.normalMap,
    loadImage: _loadNormalMap,
    // Flat normal: decodes to (0,0,1), i.e. no perturbation at all.
    emptyFill: 'rgb(128,128,255)',
  });
}

/**
 * GLSL for the per-type detail lookup: world units per tile in x, texture
 * opacity in y. Generated rather than uniform-bound because the values are
 * compile-time constants of the terrain type table.
 * @private
 */
function _buildDetailParamsGlsl() {
  const lines = _terrainTypeList.map((terrainType, index) => {
    const tile = Number(terrainType?.diffuseTextureWorldUnitsPerTile ?? 20).toFixed(1);
    // No texture for this type: opacity 0 leaves the flat colour untouched.
    const opacity = Number(terrainType?.diffuseTexture ? (terrainType?.diffuseTextureOpacity ?? 1) : 0).toFixed(3);
    // Normal maps carry their own tiling — finer than the diffuse — and their own
    // strength. Intensity 0 for a type with no map leaves the surface flat.
    const normalTile = Number(terrainType?.normalMapWorldUnitsPerTile ?? 10).toFixed(1);
    const normalIntensity = Number(terrainType?.normalMap ? (terrainType?.normalMapIntensity ?? 1) : 0).toFixed(3);
    return `      if (typeIndex < ${(index + 0.5).toFixed(1)}) return vec4(${tile}, ${opacity}, ${normalTile}, ${normalIntensity});`;
  });
  lines.push('      return vec4(20.0, 0.0, 10.0, 0.0);');
  return lines.join('\n');
}

export async function createWaterDepthOverlayTexture(scene, terrainManager, textureSize = 2048, worldWidth = 160, worldDepth = worldWidth) {
  const canvas = document.createElement('canvas');
  canvas.width = textureSize;
  canvas.height = textureSize;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, textureSize, textureSize);
  await _paintWaterDepthOverlay(ctx, terrainManager, textureSize, worldWidth, worldDepth);

  const imageData = ctx.getImageData(0, 0, textureSize, textureSize);
  const rawTexture = RawTexture.CreateRGBATexture(
    imageData.data,
    textureSize,
    textureSize,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE
  );
  rawTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
  rawTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
  rawTexture.gammaSpace = false;
  return rawTexture;
}

export async function updateWaterDepthOverlayTexture(rawTexture, terrainManager, worldWidth = 160, worldDepth = worldWidth) {
  const textureSize = rawTexture.getSize().width;
  const canvas = document.createElement('canvas');
  canvas.width = textureSize;
  canvas.height = textureSize;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, textureSize, textureSize);
  await _paintWaterDepthOverlay(ctx, terrainManager, textureSize, worldWidth, worldDepth);
  const imageData = ctx.getImageData(0, 0, textureSize, textureSize);
  rawTexture.update(imageData.data);
}

/**
 * Lay the flat-normal base the composite normal map is built on.
 *
 * The per-terrain-type grain used to be painted here, at whatever resolution the
 * whole-track bake could afford (~10 texels/m). The shader now tiles each type's
 * normal map live from terrainDetailNormalSampler, so painting it here too would
 * apply the same relief twice — once sharp, once blurred. What stays baked is
 * everything world-positioned that tiling cannot express: the steep-slope
 * overlays, the AI-path ruts, and normal-map decals, all composited over this.
 * @private
 */
async function _paintTerrainNormalBase(ctx, _terrainManager, textureSize) {
  ctx.save();
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = 'rgb(128,128,255)';
  ctx.fillRect(0, 0, textureSize, textureSize);
  ctx.restore();
}

/**
 * Paint normal-map decals onto the composite canvas.
 *
 * Each decal is a rotated rect repeated `repeatU × repeatV` times across itself.
 * Whole repeats come from a pre-scaled, wrap-preserving tile so they meet
 * seamlessly — the same treatment the terrain passes get. A fractional trailing
 * repeat is a deliberate partial tile, so it is cropped from the source rather
 * than squeezed into a smaller draw, which would distort it against its
 * neighbours.
 */
async function _paintNormalMapDecals(ctx, normalMapDecals, textureSize, worldWidth, worldDepth) {
  if (!normalMapDecals || normalMapDecals.length === 0) return;

  const pixelsPerUnitX = textureSize / worldWidth;
  const pixelsPerUnitY = textureSize / worldDepth;

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
    if (!img || img.naturalWidth <= 0) continue;
    const { centerX, centerZ, width, depth, angle = 0, repeatU = 1, repeatV = 1, intensity = 0.5 } = decal;

    const canvasCenterX = (centerX + worldWidth / 2) * pixelsPerUnitX;
    const canvasCenterY = (centerZ + worldDepth / 2) * pixelsPerUnitY;
    const canvasWidth = width * pixelsPerUnitX;
    const canvasHeight = depth * pixelsPerUnitY;
    const tilePixelWidth = canvasWidth / repeatU;
    const tilePixelHeight = canvasHeight / repeatV;

    const tile = _buildScaledTileCanvas(img, tilePixelWidth, tilePixelHeight);

    ctx.save();
    ctx.translate(canvasCenterX, canvasCenterY);
    ctx.rotate(angle * Math.PI / 180);
    ctx.scale(-1, 1); // Flip horizontally in local space to match texture orientation
    ctx.globalAlpha = intensity;
    ctx.globalCompositeOperation = 'source-over';

    for (let ty = 0; ty < Math.ceil(repeatV); ty++) {
      for (let tx = 0; tx < Math.ceil(repeatU); tx++) {
        const x = -canvasWidth / 2 + tx * tilePixelWidth;
        const y = -canvasHeight / 2 + ty * tilePixelHeight;
        const fracU = (tx === Math.floor(repeatU) && repeatU % 1 !== 0) ? repeatU % 1 : 1;
        const fracV = (ty === Math.floor(repeatV) && repeatV % 1 !== 0) ? repeatV % 1 : 1;
        ctx.drawImage(
          tile,
          0, 0, tile.width * fracU, tile.height * fracV,
          x, y, tilePixelWidth * fracU, tilePixelHeight * fracV
        );
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
 * @param {number} worldWidth - Width of world space the texture covers
 * @param {number} worldDepth - Depth of world space the texture covers
 * @returns {Promise<RawTexture>}
 */
// Tire-rut relief: composite the pre-baked rut layer onto the normal map. The
// layer is rasterized in terrain-utils from the SAME stamps as the wear colour
// overlay — one pass feeds both — and arrives premultiplied with its own
// coverage, so laying it down here is a single blend per pixel.
function _paintAiPathRutNormals(ctx, track, textureSize, worldWidth, worldDepth) {
  const { width, height, rut, hasRuts } = bakeAiPathWear(track, textureSize, worldWidth, worldDepth);
  if (!hasRuts) return;

  const imageData = ctx.getImageData(0, 0, width, height);
  const px = imageData.data;

  for (let base = 0; base < px.length; base += 4) {
    const coverage = rut[base + 3];
    if (coverage <= 0) continue;
    const keep = 1 - coverage;
    px[base]     = px[base]     * keep + rut[base];
    px[base + 1] = px[base + 1] * keep + rut[base + 1];
    px[base + 2] = px[base + 2] * keep + rut[base + 2];
  }

  ctx.putImageData(imageData, 0, 0);
}

export async function createCompositeNormalMap(scene, normalMapDecals, terrainManager, track, textureSize = 2048, worldWidth = 160, worldDepth = worldWidth) {
  const canvas = document.createElement('canvas');
  canvas.width = textureSize;
  canvas.height = textureSize;
  const ctx = canvas.getContext('2d');
  await _paintTerrainNormalBase(ctx, terrainManager, textureSize, worldWidth, worldDepth);
  await _paintSteepDirtOverlay(ctx, track, terrainManager, textureSize, worldWidth, worldDepth);
  await _paintSteepGrassOverlay(ctx, track, terrainManager, textureSize, worldWidth, worldDepth);
  _paintAiPathRutNormals(ctx, track, textureSize, worldWidth, worldDepth);

  // No decals is not a special case: the painter no-ops and the texture is built
  // from the passes above exactly the same way.
  await _paintNormalMapDecals(ctx, normalMapDecals, textureSize, worldWidth, worldDepth);

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
 * @param {number} [worldWidth]
 * @param {number} [worldDepth]
 * @returns {Promise<void>}
 */
export async function updateCompositeNormalMap(rawTexture, scene, normalMapDecals, terrainManager, track, worldWidth = 160, worldDepth = worldWidth) {
  const textureSize = rawTexture.getSize().width;
  const canvas = document.createElement('canvas');
  canvas.width = textureSize;
  canvas.height = textureSize;
  const ctx = canvas.getContext('2d');
  await _paintTerrainNormalBase(ctx, terrainManager, textureSize, worldWidth, worldDepth);
  await _paintSteepDirtOverlay(ctx, track, terrainManager, textureSize, worldWidth, worldDepth);
  await _paintSteepGrassOverlay(ctx, track, terrainManager, textureSize, worldWidth, worldDepth);
  _paintAiPathRutNormals(ctx, track, textureSize, worldWidth, worldDepth);

  await _paintNormalMapDecals(ctx, normalMapDecals, textureSize, worldWidth, worldDepth);

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
  uniform sampler2D terrainWaterOverlaySampler;
  uniform sampler2D terrainWearOverlaySampler;
  // Per-type detail textures, one layer per terrain type, tiled in world space.
  // The precision qualifier is required: ESSL3 gives sampler2DArray no default
  // one (unlike sampler2D), and omitting it fails to compile.
  uniform highp sampler2DArray terrainDetailSampler;
  // Matching per-type relief, tiled the same way.
  uniform highp sampler2DArray terrainDetailNormalSampler;

  // How far past the ground mesh the terrain grid's edge value survives before
  // the surrounding border terrain has fully taken over, in metres. The grid
  // clamps outside the play area, which is what makes the ground/outskirts join
  // seamless — but it also extrudes whatever sits on the edge (a mud patch, a
  // track path) in a straight band to the horizon. This fades those away.
  const float terrainOutsideFade = 60.0;

  // How hard the tiled per-type relief tilts the surface normal, on top of each
  // type's own normalMapIntensity. Turn down if the ground reads too crunchy.
  const float terrainDetailNormalStrength = 0.4;

  // Compile-time constants injected from JS.
  const float terrainTypeCount = __TERRAIN_TYPE_COUNT__;
  const float terrainCellCount = __TERRAIN_CELL_COUNT__;
  const float terrainWorldHalfWidth = __TERRAIN_WORLD_HALF_WIDTH__;
  const float terrainWorldHalfDepth = __TERRAIN_WORLD_HALF_DEPTH__;
  const float terrainForcedTypeIndex = __TERRAIN_FORCED_TYPE_INDEX__;
  const float terrainOutsideTypeIndex = __TERRAIN_OUTSIDE_TYPE_INDEX__;

  // Declared as module-level so both CUSTOM_FRAGMENT_UPDATE_DIFFUSE and the
  // specularColor override can access the result.
  vec4 _terrainBlendResult;
  // Blended detail texture for this fragment: rgb = tiled texture, a = how much
  // of the flat terrain colour it replaces.
  vec4 _terrainDetailResult;
  // Blended detail relief: tangent-space xy slope, already scaled by the type's
  // normal intensity. z is unused — the surface is near-horizontal and the
  // perturbation below rebuilds it.
  vec2 _terrainDetailNormalResult;

  float _decodeTerrainId(vec4 encoded) {
      return floor(encoded.r * 255.0 + 0.5);
  }
  vec4 _sampleTypeProps(float typeIndex) {
      float u = (typeIndex + 0.5) / terrainTypeCount;
      return texture2D(terrainPropertySampler, vec2(u, 0.5));
  }
  // Per-type detail tiling (x = world units per tile) and texture opacity (y),
  // generated from the terrain type table.
  vec4 _detailParams(float typeIndex) {
__TERRAIN_DETAIL_PARAMS__
  }
  // World-space tiling, so detail stays the same size no matter how big the
  // track is. Layer index is the terrain id; array layers avoid the wrap seams
  // an atlas would have at tile boundaries.
  // NOTE: texture(), not texture2D() like the samplers above. Babylon rewrites
  // texture2D( -> texture( when it migrates this shader to ESSL3 for WebGL2,
  // which is why the ES1 spelling works elsewhere in here — but there is no
  // texture2D overload taking a sampler2DArray to spell in the first place, so
  // this one is written as the ES3 call it ends up being. The plugin only runs
  // on WebGL2, so that migration always happens.
  //
  // Never write the literal version pragma in here, not even in a comment:
  // ProcessShaderConversion treats any source containing it as already migrated
  // and skips the pass entirely, after which the varyings fail to compile.
  vec4 _sampleDetail(float typeIndex, vec2 worldXZ) {
      vec4 params = _detailParams(typeIndex);
      vec3 rgb = texture(terrainDetailSampler, vec3(worldXZ / params.x, typeIndex)).rgb;
      return vec4(rgb, params.y);
  }
  // Tangent-space slope from the type's normal map, tiled in world XZ. Because
  // the tiling IS world XZ, the tangent frame is world X and world Z — no TBN to
  // reconstruct, and it works the same on the ground mesh and the flat plain.
  // Green is negated to match invertNormalMapY on the baked composite map, so
  // both relief sources agree on which way is up. If bumps read as dents, this
  // is the sign to flip.
  vec2 _sampleDetailNormal(float typeIndex, vec2 worldXZ) {
      vec4 params = _detailParams(typeIndex);
      vec3 n = texture(terrainDetailNormalSampler, vec3(worldXZ / params.z, typeIndex)).xyz * 2.0 - 1.0;
      return vec2(n.x, -n.y) * params.w;
  }
    // Cell overlays are painted as hard-edged rectangles, one per terrain cell,
    // so they need the same neighbour weighting the type blend gets or their
    // edges stay visible as squares.
    vec4 _sampleSmoothedOverlay(sampler2D overlaySampler, vec2 tUV, vec2 coord) {
      float n = terrainCellCount;
      vec2 invN = vec2(1.0 / n);
      vec4 accum = vec4(0.0);
      float totalW = 0.0;
      const float sigma = 0.65;
      const float invTwoSigma2 = 1.0 / (2.0 * sigma * sigma);
      for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
          vec2 offset = vec2(float(dx), float(dy));
          vec2 sampleUv = clamp(tUV + offset * invN, vec2(0.0), vec2(1.0));
          vec2 sampleCenter = floor(coord) + offset + 0.5;
          vec2 delta = sampleCenter - coord;
          float dist2 = dot(delta, delta);
          float w = exp(-dist2 * invTwoSigma2);
          accum += texture2D(overlaySampler, sampleUv) * w;
          totalW += w;
        }
      }
      return accum / max(totalW, 1e-5);
    }
    // 3x3 Gaussian kernel over cell neighbours using distance from the current
    // fragment position (in cell space) to each neighbour cell center.
    // This keeps blending continuous inside each tile instead of a constant
    // value per tile.
  vec4 _computeTerrainBlend(vec2 tUV, vec2 worldXZ) {
      if (terrainForcedTypeIndex >= 0.0) {
        _terrainDetailResult = _sampleDetail(terrainForcedTypeIndex, worldXZ);
        _terrainDetailNormalResult = _sampleDetailNormal(terrainForcedTypeIndex, worldXZ);
        return _sampleTypeProps(terrainForcedTypeIndex);
      }
      float n  = terrainCellCount;
      float nm = n - 1.0;
      vec2 coord = clamp(tUV * n, vec2(0.001), vec2(nm + 0.999));
      vec2 cell  = floor(coord);
      vec4  accum  = vec4(0.0);
      vec4  detail = vec4(0.0);
      vec2  detailNormal = vec2(0.0);
      float totalW = 0.0;
      const float sigma = 0.75;
      const float invTwoSigma2 = 1.0 / (2.0 * sigma * sigma);
      for (int dy = -1; dy <= 1; dy++) {
          for (int dx = -1; dx <= 1; dx++) {
              vec2  nc   = clamp(cell + vec2(float(dx), float(dy)), vec2(0.0), vec2(nm));
            vec2 center = nc + 0.5;
            vec2 delta = center - coord;
            float dist2 = dot(delta, delta);
            float w = exp(-dist2 * invTwoSigma2);
              float nId  = _decodeTerrainId(texture2D(terrainIdSampler, (nc + 0.5) / n));
              accum  += _sampleTypeProps(nId) * w;
              // Detail rides the same weights as the colour blend, so a type
              // boundary crossfades texture and tint together.
              detail += _sampleDetail(nId, worldXZ) * w;
              detailNormal += _sampleDetailNormal(nId, worldXZ) * w;
              totalW += w;
          }
      }
      _terrainDetailResult = detail / totalW;
      _terrainDetailNormalResult = detailNormal / totalW;
      return accum / totalW;
  }
`;

// terrain UV from world position: maps [-halfSize, +halfSize] → [0, 1]
// Uses vPositionW (always available in StandardMaterial fragment shader).
const _TERRAIN_BLEND_UPDATE_DIFFUSE = `
  vec2 _tUV = vec2(
    vPositionW.x / (terrainWorldHalfWidth * 2.0) + 0.5,
    vPositionW.z / (terrainWorldHalfDepth * 2.0) + 0.5
  );
  vec2 _coord = clamp(_tUV * terrainCellCount, vec2(0.001), vec2((terrainCellCount - 1.0) + 0.999));
  _terrainBlendResult = _computeTerrainBlend(_tUV, vPositionW.xz);
  // Outside the ground mesh (the outskirt plain), hand over to the track's
  // border terrain so the grid's clamped edge cells don't run to the horizon.
  // Zero everywhere on the ground itself, and skipped for a forced-type surface
  // (bridge decks), which are one type by definition.
  if (terrainForcedTypeIndex < 0.0) {
    vec2 _outside = max(
      abs(vPositionW.xz) - vec2(terrainWorldHalfWidth, terrainWorldHalfDepth),
      vec2(0.0)
    );
    float _outsideT = smoothstep(0.0, 1.0, clamp(length(_outside) / terrainOutsideFade, 0.0, 1.0));
    // Sampled unconditionally: a branch here would put a texture fetch in
    // non-uniform control flow, where implicit mip derivatives are undefined.
    // terrainForcedTypeIndex is a compile-time constant, so the outer test folds.
    _terrainBlendResult = mix(_terrainBlendResult, _sampleTypeProps(terrainOutsideTypeIndex), _outsideT);
    _terrainDetailResult = mix(_terrainDetailResult, _sampleDetail(terrainOutsideTypeIndex, vPositionW.xz), _outsideT);
    _terrainDetailNormalResult = mix(_terrainDetailNormalResult, _sampleDetailNormal(terrainOutsideTypeIndex, vPositionW.xz), _outsideT);
  }
  vec4 _waterOverlay = _sampleSmoothedOverlay(terrainWaterOverlaySampler, _tUV, _coord);
  vec4 _wearOverlay = texture2D(terrainWearOverlaySampler, _tUV);
  float _wearLighten = _wearOverlay.r;
  float _wearDarken  = _wearOverlay.g;
  vec3 _terrainRgb = mix(_terrainBlendResult.rgb, _waterOverlay.rgb, _waterOverlay.a);
  // Straight lerp from the flat terrain colour to the tiled texture, weighted by
  // the type's diffuseTextureOpacity. That is the one dial on how photographic a
  // surface looks: 0 leaves the plain palette, 1 is all texture. (It used to
  // multiply a white-bleached tint instead, which darkened as you turned it down
  // rather than fading toward the flat colour, making the parameter useless for
  // exactly the tuning it is named for.)
  _terrainRgb = mix(_terrainRgb, _terrainDetailResult.rgb, _terrainDetailResult.a);
  // Wear rides on top of the detail so ruts still read through the texture.
  _terrainRgb = clamp(_terrainRgb * (1.0 + _wearLighten * 0.22), 0.0, 1.0);
  _terrainRgb = clamp(_terrainRgb * (1.0 - _wearDarken  * 0.22), 0.0, 1.0);
  _terrainBlendResult.a = clamp(_terrainBlendResult.a + max(_wearLighten, _wearDarken) * 0.06, 0.0, 1.0);
  baseColor = vec4(_terrainRgb, 1.0);
  // Tilt the surface normal by the tiled per-type relief. This block runs after
  // Babylon's bumpFragment, so normalW already carries the baked composite map
  // (ruts, decals, steep-slope overlays) and this adds the fine grain the bake
  // is too coarse to hold. Tangent frame is world X/Z, matching how the detail
  // is tiled, so the two just add.
  normalW = normalize(normalW + vec3(_terrainDetailNormalResult.x, 0.0, _terrainDetailNormalResult.y) * terrainDetailNormalStrength);
`;

// Per-pixel specular intensity is now injected via a regex replacement
// of the specularColor declaration line — see getCustomCode() below.

/**
 * MaterialPlugin that injects terrain blending into StandardMaterial.
 * StandardMaterial keeps CSM shadow receiving, lighting, and normal mapping.
 */
export class TerrainBlendPlugin extends MaterialPluginBase {
  constructor(material, terrainIdTex, terrainPropertyTex, terrainWaterOverlayTex, terrainWearOverlayTex, terrainDetailTex, terrainTypeCount, terrainCellCount, terrainWorldHalfWidth, terrainWorldHalfDepth, options = {}) {
    // Per-track dimensions (cell count, world half-extents) are baked into the
    // shader SOURCE via getCustomCode(). Babylon's effect cache is keyed by the
    // defines string, NOT by injected custom-code, so two ground materials with
    // identical defines can share one compiled shader — and a freshly-built
    // material for a different-aspect track would silently reuse the previous
    // track's baked-in dimensions (mesh correct, UV mapping stale). That surfaced
    // as an intermittent "terrain stretched when loading a different-aspect track"
    // bug. Registering these values as numeric plugin defines folds them into the
    // effect cache key (see prepareDefines), so a track with different dimensions
    // always compiles its own effect. The defines themselves are unused in GLSL.
    super(material, "TerrainBlend", 200, {
      TERRAIN_CELLCOUNT_KEY: 0,
      TERRAIN_HALFWIDTH_KEY: 0,
      TERRAIN_HALFDEPTH_KEY: 0,
      TERRAIN_OUTSIDETYPE_KEY: 0,
    });
    this._terrainIdTex        = terrainIdTex;
    this._terrainPropertyTex  = terrainPropertyTex;
    this._terrainWaterOverlayTex = terrainWaterOverlayTex;
    this._terrainWearOverlayTex = terrainWearOverlayTex;
    this._terrainDetailTex = terrainDetailTex;
    // Passed via options rather than another positional argument — the list is
    // long enough. Falls back to the albedo array so an un-updated caller binds
    // *something* rather than leaving the sampler unbound (which reads black,
    // i.e. a normal of (-1,-1,-1)).
    this._terrainDetailNormalTex = options?.detailNormalTexture ?? terrainDetailTex;
    this._terrainTypeCount    = terrainTypeCount;
    this._terrainCellCount    = terrainCellCount;
    this._terrainWorldHalfWidth = terrainWorldHalfWidth;
    this._terrainWorldHalfDepth = terrainWorldHalfDepth;
    this._forcedTerrainTypeIndex = Number.isFinite(options?.forcedTerrainTypeIndex)
      ? Math.max(-1, Math.round(options.forcedTerrainTypeIndex))
      : -1;
    // Which type the terrain fades to beyond the ground mesh. Baked into the
    // shader source like the other per-track values rather than bound as a
    // uniform: this material does not use uniform buffers, and a plugin uniform
    // declared through getUniforms() never reaches the GLSL on that path.
    this._outsideTerrainTypeIndex = Number.isFinite(options?.outsideTerrainTypeIndex)
      ? Math.max(0, Math.round(options.outsideTerrainTypeIndex))
      : 0;
    this._enable(true);
  }

  /** Retarget the outside fade. Recompiles the effect (the index is baked in). */
  setOutsideTerrainTypeIndex(index) {
    if (!Number.isFinite(index) || index < 0) return;
    const next = Math.round(index);
    if (next === this._outsideTerrainTypeIndex) return;
    this._outsideTerrainTypeIndex = next;
    this.markAllDefinesAsDirty();
  }

  // Fold the per-track dimensions into the material defines so the effect cache
  // key differs whenever they do — preventing a stale-shader reuse across tracks
  // of different size/aspect. Values are unused by the GLSL; only their presence
  // in the defines string (the effect key) matters.
  prepareDefines(defines) {
    defines.TERRAIN_CELLCOUNT_KEY = this._terrainCellCount ?? 0;
    defines.TERRAIN_HALFWIDTH_KEY = this._terrainWorldHalfWidth ?? 0;
    defines.TERRAIN_HALFDEPTH_KEY = this._terrainWorldHalfDepth ?? 0;
    defines.TERRAIN_OUTSIDETYPE_KEY = this._outsideTerrainTypeIndex ?? 0;
  }

  getSamplers(samplers) {
    samplers.push("terrainIdSampler", "terrainPropertySampler", "terrainWaterOverlaySampler", "terrainWearOverlaySampler", "terrainDetailSampler", "terrainDetailNormalSampler");
  }

  bindForSubMesh(uniformBuffer, scene) {
    if (scene.texturesEnabled) {
      uniformBuffer.setTexture("terrainIdSampler", this._terrainIdTex);
      uniformBuffer.setTexture("terrainPropertySampler", this._terrainPropertyTex);
      uniformBuffer.setTexture("terrainWaterOverlaySampler", this._terrainWaterOverlayTex);
      uniformBuffer.setTexture("terrainWearOverlaySampler", this._terrainWearOverlayTex);
      uniformBuffer.setTexture("terrainDetailSampler", this._terrainDetailTex);
      uniformBuffer.setTexture("terrainDetailNormalSampler", this._terrainDetailNormalTex);
    }
  }

  getCustomCode(shaderType) {
    if (shaderType !== "fragment") return null;

    const terrainTypeCount = Number(this._terrainTypeCount || 1).toFixed(1);
    const terrainCellCount = Number(this._terrainCellCount || 1).toFixed(1);
    const terrainWorldHalfWidth = Number(this._terrainWorldHalfWidth || 80).toFixed(1);
    const terrainWorldHalfDepth = Number(this._terrainWorldHalfDepth || 80).toFixed(1);
    const terrainForcedTypeIndex = Number(this._forcedTerrainTypeIndex ?? -1).toFixed(1);
    const defs = _TERRAIN_BLEND_GLSL_DEFS
      .replace("__TERRAIN_TYPE_COUNT__", terrainTypeCount)
      .replace("__TERRAIN_CELL_COUNT__", terrainCellCount)
      .replace("__TERRAIN_WORLD_HALF_WIDTH__", terrainWorldHalfWidth)
      .replace("__TERRAIN_WORLD_HALF_DEPTH__", terrainWorldHalfDepth)
      .replace("__TERRAIN_FORCED_TYPE_INDEX__", terrainForcedTypeIndex)
      .replace("__TERRAIN_OUTSIDE_TYPE_INDEX__", Number(this._outsideTerrainTypeIndex ?? 0).toFixed(1))
      .replace("__TERRAIN_DETAIL_PARAMS__", _buildDetailParamsGlsl());

    return {
      "CUSTOM_FRAGMENT_DEFINITIONS": defs,
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
 * @param {RawTexture} terrainWaterOverlayTex world-space RGBA water tint/opacity overlay
 * @param {RawTexture} terrainWearOverlayTex  world-space RGBA wear mask overlay
 * @param {number}     terrainTypeCount     number of terrain types
 * @param {number}     terrainCellCount     grid cells per side
 * @param {number}     terrainWorldHalfWidth half of terrain world width (metres)
 * @param {number}     terrainWorldHalfDepth half of terrain world depth (metres)
 * @param {object}     [options]             { outsideTerrainTypeIndex } — the type the
 *                                           terrain fades to beyond the ground mesh
 *                                           (see setTerrainOutsideType);
 *                                           { detailNormalTexture } — per-type relief
 *                                           array (see createTerrainDetailNormalArray)
 * @returns {StandardMaterial}
 */
export function createTerrainMaterial(scene, terrainIdTex, terrainPropertyTex, terrainWaterOverlayTex, terrainWearOverlayTex, terrainDetailTex, terrainTypeCount, terrainCellCount, terrainWorldHalfWidth, terrainWorldHalfDepth = terrainWorldHalfWidth, options = {}) {
  const mat = new StandardMaterial("groundMat", scene);
  mat.specularColor = new Color3(1, 1, 1);
  mat.specularPower = 48;

  const webglVersion = scene?.getEngine?.()?.webGLVersion ?? 2;
  const supportsTerrainBlendPlugin = webglVersion >= 2;

  if (supportsTerrainBlendPlugin) {
    new TerrainBlendPlugin(
      mat,
      terrainIdTex,
      terrainPropertyTex,
      terrainWaterOverlayTex,
      terrainWearOverlayTex,
      terrainDetailTex,
      terrainTypeCount,
      terrainCellCount,
      terrainWorldHalfWidth,
      terrainWorldHalfDepth,
      {
        outsideTerrainTypeIndex: options?.outsideTerrainTypeIndex,
        detailNormalTexture: options?.detailNormalTexture,
      }
    );
  } else {
    // WebGL1 fallback: use a stable flat color material
    const fallback = TERRAIN_TYPES.PACKED_DIRT?.color;
    mat.diffuseColor = fallback?.clone ? fallback.clone() : new Color3(0.47, 0.36, 0.25);
    mat.specularColor = new Color3(0.08, 0.08, 0.08);
    mat.specularPower = 24;
    console.warn("[GroundShader] TerrainBlendPlugin disabled: WebGL2 unavailable (fallback material active).");
  }

  return mat;
}

/**
 * Point a terrain material's outside-fade at a terrain type by name — what the
 * surface becomes past the ground mesh, once the grid's clamped edge cells have
 * faded out. Call when the track's border terrain changes; it binds as a uniform,
 * so there is no shader recompile.
 * @param {StandardMaterial} material
 * @param {string} terrainTypeName
 */
export function setTerrainOutsideType(material, terrainTypeName) {
  const plugin = material?.pluginManager?.getPlugin?.("TerrainBlend");
  plugin?.setOutsideTerrainTypeIndex?.(getTerrainTypeIndexByName(terrainTypeName));
}
