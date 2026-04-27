/**
 * Shared terrain texture utilities
 */

import { TERRAIN_TYPES } from "./terrain.js";

const TERRAIN_TYPE_LIST = Object.values(TERRAIN_TYPES);
const TERRAIN_TYPE_INDEX = new Map(TERRAIN_TYPE_LIST.map((terrainType, index) => [terrainType, index]));

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
  const height = 1;
  const data = new Uint8Array(width * height * 4);
  const normalMapNames = [];
  const normalMapIndexMap = new Map();
  for (let i = 0; i < width; i++) {
    const terrainType = TERRAIN_TYPE_LIST[i];
    const r = Math.round((terrainType.color?.r ?? 0) * 255);
    const g = Math.round((terrainType.color?.g ?? 0) * 255);
    const b = Math.round((terrainType.color?.b ?? 0) * 255);
    const spec = Math.round((terrainType.specular ?? 0.03) * 255);
    const base = i * 4;
    data[base] = r;
    data[base + 1] = g;
    data[base + 2] = b;
    data[base + 3] = spec;

    // Track normal map names for future GPU normal map sampling.
    const normalMapName = terrainType.normalMap || "";
    if (normalMapName && !normalMapIndexMap.has(normalMapName)) {
      normalMapIndexMap.set(normalMapName, normalMapNames.length);
      normalMapNames.push(normalMapName);
    }
  }

  return { width, height, data, normalMapNames };
}

