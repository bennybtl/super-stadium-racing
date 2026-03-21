import { TERRAIN_TYPES } from "./terrain.js";

/**
 * Track system for defining 3D terrain layouts with different surface types
 * Tracks are composed of features (ridges, hills, valleys, jumps, etc.)
 */

export class Track {
  constructor(name = "Untitled Track") {
    this.name = name;
    this.features = [];
  }

  // Add a ridge running perpendicular to the X axis (east-west)
  addRidgeEW(centerZ, width, height, terrainType = null) {
    this.features.push({
      type: "ridgeEW",
      centerZ,
      width,
      height,
      terrainType,
    });
    return this;
  }

  // Add a ridge running perpendicular to the Z axis (north-south)
  addRidgeNS(centerX, width, height, terrainType = null) {
    this.features.push({
      type: "ridgeNS",
      centerX,
      width,
      height,
      terrainType,
    });
    return this;
  }

  // Add a circular hill
  addHill(centerX, centerZ, radius, height, terrainType = null) {
    this.features.push({
      type: "hill",
      centerX,
      centerZ,
      radius,
      height,
      terrainType,
    });
    return this;
  }

  // Add a rectangular area with specific terrain type
  addTerrainRect(x, z, width, depth, terrainType) {
    this.features.push({
      type: "terrainRect",
      x,
      z,
      width,
      depth,
      terrainType,
    });
    return this;
  }

  // Add a circular area with specific terrain type
  addTerrainCircle(centerX, centerZ, radius, terrainType) {
    this.features.push({
      type: "terrainCircle",
      centerX,
      centerZ,
      radius,
      terrainType,
    });
    return this;
  }

  // Add a sloped rectangular region
  // The region slopes from one edge to another
  // heightAtMin/heightAtMax specify the height at the min and max values of the slope axis
  addSlopedRect(centerX, centerZ, width, depth, slopeAxis, heightAtMin, heightAtMax, terrainType = null) {
    this.features.push({
      type: "slopedRect",
      centerX,
      centerZ,
      width,
      depth,
      slopeAxis, // "x" or "z" - which axis the slope runs along
      heightAtMin, // height at the minimum value of the slope axis
      heightAtMax, // height at the maximum value of the slope axis
      terrainType,
    });
    return this;
  }

  // Get the height at a world position
  getHeightAt(x, z) {
    let totalHeight = 0;

    for (const feature of this.features) {
      switch (feature.type) {
        case "ridgeEW": {
          const distFromRidge = Math.abs(z - feature.centerZ);
          if (distFromRidge < feature.width) {
            const t = distFromRidge / feature.width;
            totalHeight += feature.height * Math.cos(t * Math.PI / 2);
          }
          break;
        }

        case "ridgeNS": {
          const distFromRidge = Math.abs(x - feature.centerX);
          if (distFromRidge < feature.width) {
            const t = distFromRidge / feature.width;
            totalHeight += feature.height * Math.cos(t * Math.PI / 2);
          }
          break;
        }

        case "hill": {
          const dx = x - feature.centerX;
          const dz = z - feature.centerZ;
          const distFromCenter = Math.sqrt(dx * dx + dz * dz);
          if (distFromCenter < feature.radius) {
            const t = distFromCenter / feature.radius;
            totalHeight += feature.height * Math.cos(t * Math.PI / 2);
          }
          break;
        }

        case "slopedRect": {
          const halfWidth = feature.width / 2;
          const halfDepth = feature.depth / 2;
          const minX = feature.centerX - halfWidth;
          const maxX = feature.centerX + halfWidth;
          const minZ = feature.centerZ - halfDepth;
          const maxZ = feature.centerZ + halfDepth;
          
          // Check if point is within the rectangle
          if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
            if (feature.slopeAxis === "x") {
              // Slope along X axis (left-right)
              const t = (x - minX) / feature.width; // 0 to 1
              totalHeight += feature.heightAtMin + (feature.heightAtMax - feature.heightAtMin) * t;
            } else if (feature.slopeAxis === "z") {
              // Slope along Z axis (forward-back)
              const t = (z - minZ) / feature.depth; // 0 to 1
              totalHeight += feature.heightAtMin + (feature.heightAtMax - feature.heightAtMin) * t;
            }
          }
          break;
        }
      }
    }

    return totalHeight;
  }

  // Get the terrain type at a world position (returns null if not specified)
  getTerrainTypeAt(x, z) {
    // Check features in reverse order so later additions take priority
    for (let i = this.features.length - 1; i >= 0; i--) {
      const feature = this.features[i];
      
      if (!feature.terrainType) continue;

      switch (feature.type) {
        case "ridgeEW": {
          const distFromRidge = Math.abs(z - feature.centerZ);
          if (distFromRidge < feature.width) {
            return feature.terrainType;
          }
          break;
        }

        case "ridgeNS": {
          const distFromRidge = Math.abs(x - feature.centerX);
          if (distFromRidge < feature.width) {
            return feature.terrainType;
          }
          break;
        }

        case "hill": {
          const dx = x - feature.centerX;
          const dz = z - feature.centerZ;
          const distFromCenter = Math.sqrt(dx * dx + dz * dz);
          if (distFromCenter < feature.radius) {
            return feature.terrainType;
          }
          break;
        }

        case "terrainRect": {
          const halfWidth = feature.width / 2;
          const halfDepth = feature.depth / 2;
          if (x >= feature.x - halfWidth && x <= feature.x + halfWidth &&
              z >= feature.z - halfDepth && z <= feature.z + halfDepth) {
            return feature.terrainType;
          }
          break;
        }

        case "terrainCircle": {
          const dx = x - feature.centerX;
          const dz = z - feature.centerZ;
          const distFromCenter = Math.sqrt(dx * dx + dz * dz);
          if (distFromCenter < feature.radius) {
            return feature.terrainType;
          }
          break;
        }

        case "slopedRect": {
          if (!feature.terrainType) break;
          const halfWidth = feature.width / 2;
          const halfDepth = feature.depth / 2;
          if (x >= feature.centerX - halfWidth && x <= feature.centerX + halfWidth &&
              z >= feature.centerZ - halfDepth && z <= feature.centerZ + halfDepth) {
            return feature.terrainType;
          }
          break;
        }
      }
    }

    return null;
  }

  // Serialize track to JSON string
  toJSON() {
    return JSON.stringify({
      name: this.name,
      features: this.features,
    }, null, 2);
  }

  // Load track from JSON string
  static fromJSON(jsonString) {
    const data = JSON.parse(jsonString);
    const track = new Track(data.name);
    track.features = data.features || [];
    return track;
  }

  // Clone this track
  clone() {
    return Track.fromJSON(this.toJSON());
  }
}

// Example tracks
export const EXAMPLE_TRACKS = {
  simple: () => {
    return new Track("Simple Ridge")
      .addRidgeEW(0, 3, 1);
  },

  crossroads: () => {
    return new Track("Crossroads")
      .addRidgeEW(0, 3, 1.2)
      .addRidgeNS(0, 3, 1.2);
  },

  rollercoaster: () => {
    return new Track("Rollercoaster")
      .addRidgeEW(-15, 4, 1.5)
      .addRidgeEW(0, 4, 2)
      .addRidgeEW(15, 4, 1.5)
      .addTerrainRect(-15, 0, 50, 8, TERRAIN_TYPES.LOOSE_DIRT);
  },

  hills: () => {
    return new Track("Hills")
      .addHill(-20, -20, 8, 2, TERRAIN_TYPES.PACKED_DIRT)
      .addHill(20, 20, 10, 2.5, TERRAIN_TYPES.PACKED_DIRT)
      .addHill(0, 0, 12, 1.5, TERRAIN_TYPES.LOOSE_DIRT);
  },

  mudPit: () => {
    return new Track("Mud Pit")
      .addRidgeEW(-10, 5, 1.5)
      .addRidgeEW(10, 5, 1.5)
      .addTerrainRect(0, 0, 60, 15, TERRAIN_TYPES.MUD)
      .addTerrainCircle(0, 0, 8, TERRAIN_TYPES.ASPHALT);
  },

  bankedTurn: () => {
    return new Track("Banked Turn")
      .addSlopedRect(-20, 0, 40, 80, "x", 8, 0, TERRAIN_TYPES.PACKED_DIRT)
      .addSlopedRect(20, 0, 10, 10, "x", 6, 0, TERRAIN_TYPES.PACKED_DIRT)
      .addRidgeEW(20, 5, 1.5)
      .addRidgeEW(-20, 5, 1.5);
  },
};
