/**
 * Shared terrain texture utilities
 */

import { TERRAIN_TYPES } from "./terrain.js";

const TERRAIN_TYPE_LIST = Object.values(TERRAIN_TYPES);
const TERRAIN_TYPE_INDEX = new Map(TERRAIN_TYPE_LIST.map((terrainType, index) => [terrainType, index]));

const _diffuseTextureCache = new Map();

function _applyCanvasBlur(ctx, width, height, radiusPx) {
  if (!radiusPx || radiusPx <= 0) return;
  const copy = document.createElement('canvas');
  copy.width = width;
  copy.height = height;
  const copyCtx = copy.getContext('2d');
  copyCtx.drawImage(ctx.canvas, 0, 0, width, height);

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.filter = `blur(${radiusPx}px)`;
  ctx.drawImage(copy, 0, 0, width, height);
  ctx.restore();
}

function _getDiffuseTextureEntry(filename) {
  if (!filename) return null;
  if (_diffuseTextureCache.has(filename)) return _diffuseTextureCache.get(filename);

  const entry = { img: new Image(), loaded: false, failed: false, promise: null };
  entry.img.crossOrigin = 'anonymous';
  entry.promise = new Promise(resolve => {
    entry.img.onload = () => {
      entry.loaded = true;
      resolve(entry);
    };
    entry.img.onerror = () => {
      entry.failed = true;
      resolve(entry);
    };
  });
  entry.img.src = new URL(`./assets/${filename}`, import.meta.url).href;
  _diffuseTextureCache.set(filename, entry);
  return entry;
}

function _buildTextureEdges(cellsPerSide, pixelsPerCell) {
  const edges = new Array(cellsPerSide + 1);
  for (let i = 0; i <= cellsPerSide; i++) {
    edges[i] = Math.floor(i * pixelsPerCell);
  }
  return edges;
}

function _writeColorPixel(data, width, x, y, r, g, b, a = 255) {
  const base = (y * width + x) * 4;
  data[base] = r;
  data[base + 1] = g;
  data[base + 2] = b;
  data[base + 3] = a;
}

export function buildTerrainTexturePixelData(terrainManager, pixelsPerCell, isEditing = false) {
  const n = terrainManager.cellsPerSide;
  const xEdges = _buildTextureEdges(n, pixelsPerCell);
  const yEdges = _buildTextureEdges(n, pixelsPerCell);
  const width = xEdges[n];
  const height = yEdges[n];
  const data = new Uint8Array(width * height * 4);

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const cell = terrainManager.grid[row * n + col];
      if (!cell) continue;

      const x0 = xEdges[col];
      const y0 = yEdges[row];
      const cellW = Math.max(1, xEdges[col + 1] - x0);
      const cellH = Math.max(1, yEdges[row + 1] - y0);

      if (isEditing) {
        const r = Math.round((cell.color?.r ?? 0) * 255);
        const g = Math.round((cell.color?.g ?? 0) * 255);
        const b = Math.round((cell.color?.b ?? 0) * 255);
        for (let py = 0; py < cellH; py++) {
          for (let pxx = 0; pxx < cellW; pxx++) {
            _writeColorPixel(data, width, x0 + pxx, y0 + py, r, g, b);
          }
        }
        continue;
      }

      const rCell = col + 1 < n ? terrainManager.grid[row * n + col + 1] : null;
      const lCell = col > 0     ? terrainManager.grid[row * n + col - 1] : null;
      const bCell = row + 1 < n ? terrainManager.grid[(row + 1) * n + col] : null;
      const aCell = row > 0     ? terrainManager.grid[(row - 1) * n + col] : null;

      const rDiff = rCell && rCell !== cell;
      const lDiff = lCell && lCell !== cell;
      const bDiff = bCell && bCell !== cell;
      const aDiff = aCell && aCell !== cell;
      const anyBlend = rDiff || lDiff || bDiff || aDiff;

      for (let py = 0; py < cellH; py++) {
        for (let pxx = 0; pxx < cellW; pxx++) {
          let blendR = cell.color.r * 255;
          let blendG = cell.color.g * 255;
          let blendB = cell.color.b * 255;
          let totalWeight = 1.0;

          if (anyBlend) {
            const distR = cellW - 1 - pxx;
            const distL = pxx;
            const distB = cellH - 1 - py;
            const distA = py;

            if (rDiff && distR < cellW) {
              const w = 1 - distR / cellW;
              totalWeight += w;
              blendR += rCell.color.r * 255 * w;
              blendG += rCell.color.g * 255 * w;
              blendB += rCell.color.b * 255 * w;
            }
            if (lDiff && distL < cellW) {
              const w = 1 - distL / cellW;
              totalWeight += w;
              blendR += lCell.color.r * 255 * w;
              blendG += lCell.color.g * 255 * w;
              blendB += lCell.color.b * 255 * w;
            }
            if (bDiff && distB < cellH) {
              const w = 1 - distB / cellH;
              totalWeight += w;
              blendR += bCell.color.r * 255 * w;
              blendG += bCell.color.g * 255 * w;
              blendB += bCell.color.b * 255 * w;
            }
            if (aDiff && distA < cellH) {
              const w = 1 - distA / cellH;
              totalWeight += w;
              blendR += aCell.color.r * 255 * w;
              blendG += aCell.color.g * 255 * w;
              blendB += aCell.color.b * 255 * w;
            }
          }

          const r = Math.round(Math.max(0, Math.min(255, blendR / totalWeight)));
          const g = Math.round(Math.max(0, Math.min(255, blendG / totalWeight)));
          const b = Math.round(Math.max(0, Math.min(255, blendB / totalWeight)));
          _writeColorPixel(data, width, x0 + pxx, y0 + py, r, g, b);
        }
      }
    }
  }

  return { width, height, data };
}

export function buildTerrainIdTexturePixelData(terrainManager) {
  const n = terrainManager.cellsPerSide;
  const data = new Uint8Array(n * n * 4);

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const cell = terrainManager.grid[row * n + col];
      const typeIndex = cell ? (TERRAIN_TYPE_INDEX.get(cell) ?? 0) : 0;
      const base = (row * n + col) * 4;
      data[base] = typeIndex;
      data[base + 1] = 0;
      data[base + 2] = 0;
      data[base + 3] = 255;
    }
  }

  return { width: n, height: n, data };
}

export function updateTerrainIdTexture(terrainIdTex, terrainManager) {
  const idData = buildTerrainIdTexturePixelData(terrainManager);
  terrainIdTex.update(idData.data);
}

export function buildTerrainTypePropertyTexturePixelData() {
  const width = TERRAIN_TYPE_LIST.length;
  const height = 2;
  const data = new Uint8Array(width * height * 4);
  const normalMapNames = [];
  const normalMapIndexMap = new Map();
  for (let i = 0; i < width; i++) {
    const terrainType = TERRAIN_TYPE_LIST[i];
    const r = Math.round((terrainType.color?.r ?? 0) * 255);
    const g = Math.round((terrainType.color?.g ?? 0) * 255);
    const b = Math.round((terrainType.color?.b ?? 0) * 255);
    const spec = Math.round((terrainType.specular ?? 0.03) * 255);
    const row0Base = i * 4;
    data[row0Base] = r;
    data[row0Base + 1] = g;
    data[row0Base + 2] = b;
    data[row0Base + 3] = spec;

    const normalMapName = terrainType.normalMap || "";
    let normalIndex = 0;
    if (normalMapName) {
      if (!normalMapIndexMap.has(normalMapName)) {
        normalMapIndexMap.set(normalMapName, normalMapNames.length);
        normalMapNames.push(normalMapName);
      }
      normalIndex = normalMapIndexMap.get(normalMapName);
    }

    const normalIntensity = Math.round(Math.max(0, Math.min(1, terrainType.normalMapIntensity ?? 0)) * 255);
    const roughness = Math.round(Math.max(0, Math.min(1, terrainType.roughness ?? 0)) * 255);
    const row1Base = width * 4 + i * 4;
    data[row1Base] = normalIndex;
    data[row1Base + 1] = normalIntensity;
    data[row1Base + 2] = roughness;
    data[row1Base + 3] = 255;
  }

  return { width, height, data, normalMapNames };
}

export function buildTerrainSpecularTexturePixelData(terrainManager, pixelsPerCell) {
  const n = terrainManager.cellsPerSide;
  const xEdges = _buildTextureEdges(n, pixelsPerCell);
  const yEdges = _buildTextureEdges(n, pixelsPerCell);
  const width = xEdges[n];
  const height = yEdges[n];
  const data = new Uint8Array(width * height * 4);

  function cellGrey(cell) {
    return Math.round((cell.specular ?? 0.03) * 255);
  }

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const cell = terrainManager.grid[row * n + col];
      if (!cell) continue;

      const sv = cellGrey(cell);
      const x0 = xEdges[col];
      const y0 = yEdges[row];
      const cellW = Math.max(1, xEdges[col + 1] - x0);
      const cellH = Math.max(1, yEdges[row + 1] - y0);

      const rCell = col + 1 < n ? terrainManager.grid[row * n + col + 1] : null;
      const lCell = col > 0     ? terrainManager.grid[row * n + col - 1] : null;
      const bCell = row + 1 < n ? terrainManager.grid[(row + 1) * n + col] : null;
      const aCell = row > 0     ? terrainManager.grid[(row - 1) * n + col] : null;

      const rDiff = rCell && rCell !== cell;
      const lDiff = lCell && lCell !== cell;
      const bDiff = bCell && bCell !== cell;
      const aDiff = aCell && aCell !== cell;
      const anyBlend = rDiff || lDiff || bDiff || aDiff;

      for (let py = 0; py < cellH; py++) {
        for (let pxx = 0; pxx < cellW; pxx++) {
          let blendV = sv;
          let totalWeight = 1.0;

          if (anyBlend) {
            const distR = cellW - 1 - pxx;
            const distL = pxx;
            const distB = cellH - 1 - py;
            const distA = py;

            if (rDiff && distR < cellW) {
              const w = 1 - distR / cellW;
              totalWeight += w;
              blendV += cellGrey(rCell) * w;
            }
            if (lDiff && distL < cellW) {
              const w = 1 - distL / cellW;
              totalWeight += w;
              blendV += cellGrey(lCell) * w;
            }
            if (bDiff && distB < cellH) {
              const w = 1 - distB / cellH;
              totalWeight += w;
              blendV += cellGrey(bCell) * w;
            }
            if (aDiff && distA < cellH) {
              const w = 1 - distA / cellH;
              totalWeight += w;
              blendV += cellGrey(aCell) * w;
            }
          }

          const v = Math.round(Math.max(0, Math.min(255, blendV / totalWeight)));
          _writeColorPixel(data, width, x0 + pxx, y0 + py, v, v, v);
        }
      }
    }
  }

  return { width, height, data };
}

