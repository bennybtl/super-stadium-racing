import { Vector3, Color3 } from "@babylonjs/core";

// Terrain types with their properties
export const TERRAIN_TYPES = {
  ASPHALT: {
    name: "asphalt",
    gripMultiplier: 4.0,    // Best grip
    color: new Color3(0.2, 0.2, 0.25),
    smokeColor: new Color3(0.9, 0.9, 0.9), // Light gray smoke
    dragMultiplier: 0.5,
    roughness: 0,            // Perfectly smooth
    normalMap: '616-normal.jpg',
    normalMapIntensity: 0.6, // Subtle road surface texture
    specular: 0.18,          // Slightly shiny pavement
  },
  PACKED_DIRT: {
    name: "packed_dirt",
    gripMultiplier: 2.0,    // Baseline
    color: new Color3(0.54, 0.28, 0.08),
    dragMultiplier: 0.8,
    roughness: 0.1,          // Very slight — compacted surface
    normalMap: '6481-normal.jpg',
    normalMapIntensity: 0.8, // Moderate dirt texture
    specular: 0.13,          // Matte dry dirt
  },
  LOOSE_DIRT: {
    name: "loose_dirt",
    gripMultiplier: 0.5,    // Slides more
    color: new Color3(0.69, 0.43, 0.23),
    dragMultiplier: 1.0,
    roughness: 0.25,         // Noticeable ruts and loose clumps
    normalMap: '6481-normal.jpg',
    normalMapIntensity: 1.0, // Full intensity — rough loose surface
    specular: 0.13,          // Matte dry dirt
  },
  MUD: {
    name: "mud",
    gripMultiplier: 0.15,    // Very slippery
    color: new Color3(0.34, 0.18, 0.08),
    dragMultiplier: 2.9,    // Slows you down
    roughness: 0.15,         // Sloppy but soft — low-impact bumps
    normalMap: 'mud.png',
    normalMapIntensity: 0.9, // Deep muddy surface detail
    specular: 0.65,          // Glistening wet mud
  },
  WATER: {
    name: "water",
    gripMultiplier: 0.3,     // Low grip
    color: new Color3(0.1, 0.3, 1),
    smokeColor: new Color3(0.8, 0.9, 1.0), // Light blue smoke
    dragMultiplier: 6.0,     // Very high drag
    roughness: 0,            // Smooth surface — drag is the hazard
    normalMap: 'water.jpg',
    normalMapIntensity: 0.5, // Gentle ripple detail
    specular: 0.92,          // Highly reflective water surface
  },
  ROCKY: {
    name: "rocky",
    gripMultiplier: 1.0,     // Unpredictable rocky surface
    color: new Color3(0.42, 0.30, 0.22), // Dark reddish-brown rock
    dragMultiplier: 5.0,     // Dramatic slowing — holes catch and drag the truck
    roughness: 0.75,         // Very rough — hard impacts and significant jostling
    normalMap: 'rocky.jpg',
    normalMapIntensity: 1.5, // Strong rocky surface detail
    specular: 0.14,          // Matte rock
  },
  GRASS: {
    name: "grass",
    gripMultiplier: 0.15,     // Slippery, especially when wet
    color: new Color3(0.05, 0.4, 0.1), // Green grass
    dragMultiplier: 1.2,     // Slightly slows down
    roughness: 0.3,          // Slightly rough — soft impacts
    normalMap: 'grass.jpg',
    normalMapIntensity: 1.5, // Strong grass surface detail
    specular: 0.14,          // Matte grass
  },
};

export class TerrainManager {
  constructor(gridSize = 80, cellSize = 2) {
    this.gridSize = gridSize;
    this.cellSize = cellSize;
    this.cellsPerSide = Math.floor(gridSize / cellSize);
    
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
    // Convert world position to grid coordinates
    // Since we sample at cell centers (cellIndex + 0.5), we need to round to nearest cell
    const halfGrid = this.gridSize / 2;
    const x = Math.round((position.x + halfGrid) / this.cellSize - 0.5);
    const z = Math.round((position.z + halfGrid) / this.cellSize - 0.5);
    
    // Bounds check
    if (x < 0 || x >= this.cellsPerSide || z < 0 || z >= this.cellsPerSide) {
      return TERRAIN_TYPES.PACKED_DIRT;
    }
    
    const index = z * this.cellsPerSide + x;
    return this.grid[index] || TERRAIN_TYPES.PACKED_DIRT;
  }

}
