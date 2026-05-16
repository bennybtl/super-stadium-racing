import { Color3 } from "@babylonjs/core";
import { TERRAIN_COLORS } from "./constants";

// Terrain types with their properties
export const TERRAIN_TYPES = {
  ASPHALT: {
    name: "asphalt",
    gripMultiplier: 2.8,    // Best grip
    color: TERRAIN_COLORS.asphalt,
    smokeColor: new Color3(0.9, 0.9, 0.9), // Light gray smoke
    diffuseTexture: 'textures/asphalt_2.texture.png',
    diffuseTextureWorldUnitsPerTile: 20,
    diffuseTextureOpacity: 0.7,
    dragMultiplier: 0.3,
    roughness: 0,            // Perfectly smooth
    normalMap: 'normals/616-normal.jpg',
    normalMapIntensity: 0.6, // Subtle road surface texture
    specular: 0.18,          // Slightly shiny pavement
  },
  PACKED_DIRT: {
    name: "packed_dirt",
    gripMultiplier: 2.0,    // Baseline
    color: TERRAIN_COLORS.packed_dirt,
    diffuseTexture: 'textures/packed_dirt.texture.png',
    diffuseTextureWorldUnitsPerTile: 40,
    diffuseTextureOpacity: 0.5,
    dragMultiplier: 0.8,
    roughness: 0.1,          // Very slight — compacted surface
    normalMap: 'normals/cloud_h-normal.png',
    normalMapIntensity: 0.8, // Moderate dirt texture
    specular: 0.10,          // Matte dry dirt
  },
  LOAMY_DIRT: {
    name: "loamy_dirt",
    gripMultiplier: 0.5,    // Slides more
    color: TERRAIN_COLORS.loamy_dirt,
    diffuseTexture: 'textures/loamy-soil.texture.png',
    diffuseTextureWorldUnitsPerTile: 40,
    diffuseTextureOpacity: 0.7,
    dragMultiplier: 1.2,
    roughness: 0.25,         // Noticeable ruts and loose clumps
    normalMap: 'normals/6481-normal.jpg',
    normalMapIntensity: 1.0, // Full intensity — rough loose surface
    specular: 0.03,          // Matte dry dirt
  },
  LOOSE_DIRT: {
    name: "loose_dirt",
    gripMultiplier: 1.5,    // Slides more
    color: TERRAIN_COLORS.loose_dirt,
    diffuseTexture: 'textures/dirt.texture.png',
    diffuseTextureWorldUnitsPerTile: 30,
    diffuseTextureOpacity: 0.6,
    dragMultiplier: 0.9,
    roughness: 0.15,         // Noticeable ruts and loos6e clumps
    normalMap: 'normals/6481-normal.jpg',
    normalMapIntensity: 1.0, // Full intensity — rough loose surface
    specular: 0.05,          // Matte dry dirt
  },
  MUD: {
    name: "mud",
    gripMultiplier: 0.15,    // Very slippery
    color: TERRAIN_COLORS.mud,
    diffuseTexture: 'textures/mud.texture.png',
    diffuseTextureWorldUnitsPerTile: 40,
    diffuseTextureOpacity: 0.7,
    dragMultiplier: 2.9,    // Slows you down
    roughness: 0.15,         // Sloppy but soft — low-impact bumps
    normalMap: 'normals/mud.normal.png',
    normalMapIntensity: 0.5, // Deep muddy surface detail
    specular: 0.2,          // Glistening wet mud
  },
  WATER: {
    name: "water",
    gripMultiplier: 0.3,     // Low grip
    color: TERRAIN_COLORS.water,
    smokeColor: new Color3(0.8, 0.9, 1.0), // Light blue smoke
    dragMultiplier: 6.0,     // Very high drag
    roughness: 0,            // Smooth surface — drag is the hazard
    diffuseTexture: 'normal/water.jpg',
    diffuseTextureWorldUnitsPerTile: 12,
    diffuseTextureOpacity: 0.3,
    diffuseDepthThreshold: 0.35,
    diffuseDepthSoftness: 0.28,
    diffuseDepthGain: 1.2,
    diffuseDepthMinBlend: 0.1,
    diffuseDepthColor: new Color3(0.05, 0.36, 0.72),
    normalMap: 'normals/water.normal.jpg',
    normalMapIntensity: 0.5, // Gentle ripple detail
    specular: 0.92,          // Highly reflective water surface
  },
  ROCKY: {
    name: "rocky",
    gripMultiplier: 1.0,     // Unpredictable rocky surface
    color: TERRAIN_COLORS.rocky, // Dark reddish-brown rock
    dragMultiplier: 2.5,     // Slowing — holes catch and drag the truck
    roughness: 0.75,         // Very rough — hard impacts and significant jostling
    normalMap: 'normals/rocky.normal.jpg',
    normalMapIntensity: 1.5, // Strong rocky surface detail
    specular: 0.14,          // Matte rock
  },
  GRASS: {
    name: "grass",
    gripMultiplier: 0.15,     // Slippery, especially when wet
    color: TERRAIN_COLORS.grass, // Green grass
    diffuseTexture: 'textures/grass.texture.png',
    diffuseTextureWorldUnitsPerTile: 40,
    diffuseTextureOpacity: 0.7,
    dragMultiplier: 1.2,     // Slightly slows down
    roughness: 0.3,          // Slightly rough — soft impacts
    normalMap: 'normals/grass.normal.jpg',
    normalMapIntensity: 1.5, // Strong grass surface detail
    specular: 0.14,          // Matte grass
  },
};

export class TerrainManager {
  constructor(gridSize = 80, cellSize = 2, worldWidth = gridSize, worldDepth = gridSize) {
    this.gridSize = gridSize;
    this.cellSize = cellSize;
    this.cellsPerSide = Math.floor(gridSize / cellSize);
    this.worldWidth = worldWidth;
    this.worldDepth = worldDepth;
    
    // Create a grid of terrain cells
    this.grid = [];
    for (let i = 0; i < this.cellsPerSide * this.cellsPerSide; i++) {
      // Default everything to packed dirt
      this.grid[i] = TERRAIN_TYPES.PACKED_DIRT;
    }
  }

  // Set terrain type for a specific cell by grid coordinates
  setTerrainCell(col, row, terrainType) {
    if (col >= 0 && col < this.cellsPerSide && row >= 0 && row < this.cellsPerSide) {
      const index = row * this.cellsPerSide + col;
      this.grid[index] = terrainType;
    }
  }

  // Get terrain type at a world position
  getTerrainAt(position) {
    // Convert world position to nearest cell center in worldWidth/worldDepth space.
    const halfWorldW = this.worldWidth / 2;
    const halfWorldD = this.worldDepth / 2;
    const x = Math.round(((position.x + halfWorldW) / this.worldWidth) * this.cellsPerSide - 0.5);
    const z = Math.round(((position.z + halfWorldD) / this.worldDepth) * this.cellsPerSide - 0.5);
    
    // Bounds check
    if (x < 0 || x >= this.cellsPerSide || z < 0 || z >= this.cellsPerSide) {
      return TERRAIN_TYPES.PACKED_DIRT;
    }
    
    const index = z * this.cellsPerSide + x;
    return this.grid[index] || TERRAIN_TYPES.PACKED_DIRT;
  }

}
