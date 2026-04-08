import { Vector3, Color3 } from "@babylonjs/core";

// Terrain types with their properties
export const TERRAIN_TYPES = {
  ASPHALT: {
    name: "asphalt",
    gripMultiplier: 3.5,    // Best grip
    color: new Color3(0.2, 0.2, 0.25),
    dragMultiplier: 0.5,
    normalMap: '616-normal.jpg',
    normalMapIntensity: 0.6, // Subtle road surface texture
    specular: 0.18,          // Slightly shiny pavement
  },
  PACKED_DIRT: {
    name: "packed_dirt",
    gripMultiplier: 2.0,    // Baseline
    color: new Color3(0.54, 0.28, 0.08),
    dragMultiplier: 0.8,
    normalMap: '6481-normal.jpg',
    normalMapIntensity: 0.8, // Moderate dirt texture
    specular: 0.13,          // Matte dry dirt
  },
  LOOSE_DIRT: {
    name: "loose_dirt",
    gripMultiplier: 0.5,    // Slides more
    color: new Color3(0.69, 0.43, 0.23),
    dragMultiplier: 1.0,
    normalMap: '6481-normal.jpg',
    normalMapIntensity: 1.0, // Full intensity — rough loose surface
    specular: 0.13,          // Matte dry dirt
  },
  MUD: {
    name: "mud",
    gripMultiplier: 0.15,    // Very slippery
    color: new Color3(0.34, 0.18, 0.08),
    dragMultiplier: 2.9,    // Slows you down
    normalMap: 'mud.png',
    normalMapIntensity: 0.9, // Deep muddy surface detail
    specular: 0.65,          // Glistening wet mud
  },
  WATER: {
    name: "water",
    gripMultiplier: 0.3,     // Low grip
    color: new Color3(0.1, 0.3, 1),
    dragMultiplier: 6.0,     // Very high drag
    normalMap: 'water.jpg',
    normalMapIntensity: 0.5, // Gentle ripple detail
    specular: 0.92,          // Highly reflective water surface
  },
  ROCKY: {
    name: "rocky",
    gripMultiplier: 0.4,     // Unpredictable rocky surface
    color: new Color3(0.42, 0.30, 0.22), // Dark reddish-brown rock
    dragMultiplier: 5.0,     // Dramatic slowing — holes catch and drag the truck
    normalMap: 'rocky.jpg',
    normalMapIntensity: 1.5, // Strong rocky surface detail
    specular: 0.14,          // Matte rock
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

  // Set terrain type for a rectangular area
  setTerrainRect(x, z, width, height, terrainType) {
    const halfGrid = this.gridSize / 2;
    const startX = Math.floor((x + halfGrid) / this.cellSize);
    const startZ = Math.floor((z + halfGrid) / this.cellSize);
    const endX = Math.floor((x + width + halfGrid) / this.cellSize);
    const endZ = Math.floor((z + height + halfGrid) / this.cellSize);
    
    for (let gz = startZ; gz < endZ; gz++) {
      for (let gx = startX; gx < endX; gx++) {
        if (gx >= 0 && gx < this.cellsPerSide && gz >= 0 && gz < this.cellsPerSide) {
          const index = gz * this.cellsPerSide + gx;
          this.grid[index] = terrainType;
        }
      }
    }
  }

  // Set terrain type in a circular area
  setTerrainCircle(centerX, centerZ, radius, terrainType) {
    const halfGrid = this.gridSize / 2;
    const radiusInCells = Math.ceil(radius / this.cellSize);
    const centerCellX = Math.floor((centerX + halfGrid) / this.cellSize);
    const centerCellZ = Math.floor((centerZ + halfGrid) / this.cellSize);
    
    for (let gz = centerCellZ - radiusInCells; gz <= centerCellZ + radiusInCells; gz++) {
      for (let gx = centerCellX - radiusInCells; gx <= centerCellX + radiusInCells; gx++) {
        if (gx >= 0 && gx < this.cellsPerSide && gz >= 0 && gz < this.cellsPerSide) {
          // Check if cell center is within circle
          const worldX = (gx - this.cellsPerSide / 2 + 0.5) * this.cellSize;
          const worldZ = (gz - this.cellsPerSide / 2 + 0.5) * this.cellSize;
          const dx = worldX - centerX;
          const dz = worldZ - centerZ;
          
          if (dx * dx + dz * dz <= radius * radius) {
            const index = gz * this.cellsPerSide + gx;
            this.grid[index] = terrainType;
          }
        }
      }
    }
  }

  // Set terrain type for a specific cell by grid coordinates
  setTerrainCell(col, row, terrainType) {
    if (col >= 0 && col < this.cellsPerSide && row >= 0 && row < this.cellsPerSide) {
      const index = row * this.cellsPerSide + col;
      this.grid[index] = terrainType;
    }
  }
}
