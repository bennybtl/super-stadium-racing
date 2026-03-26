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

  // Add a checkpoint gate for racing
  // heading is in radians (0 = facing +Z, PI/2 = facing +X)
  // checkpointNumber: optional number for ordered checkpoints (1, 2, 3, etc.)
  addCheckpoint(centerX, centerZ, heading, width = 8, checkpointNumber = null) {
    this.features.push({
      type: "checkpoint",
      centerX,
      centerZ,
      heading,
      width,
      checkpointNumber,
      passed: false, // Track if checkpoint has been passed
    });
    return this;
  }

  // Add a straight wall (immovable)
  // heading: radians — the wall runs perpendicular to this direction
  // length: wall length along its face, height: wall height, thickness: wall depth (default 0.5)
  // segments: how many boxes to split the wall into so it follows the terrain (null = auto)
  addWall(centerX, centerZ, heading, length = 10, height = 2, thickness = 0.5, segments = null) {
    this.features.push({
      type: "wall",
      centerX,
      centerZ,
      heading,
      length,
      height,
      thickness,
      segments,
    });
    return this;
  }

  // Add a curved wall approximated by box segments along an arc (immovable)
  // centerX/centerZ: centre of the arc's parent circle
  // radius: distance from centre to wall face
  // startAngle/endAngle: arc extents in radians (0 = +X axis, increases counter-clockwise)
  // segments: number of box segments used to approximate the curve (more = smoother)
  // height/thickness: dimensions of each segment
  addCurvedWall(centerX, centerZ, radius, startAngle, endAngle, height = 2, segments = 12, thickness = 0.5) {
    this.features.push({
      type: "curvedWall",
      centerX,
      centerZ,
      radius,
      startAngle,
      endAngle,
      height,
      segments,
      thickness,
    });
    return this;
  }

  // Add a wall defined by a series of world-space points. Straight segments
  // are generated between each consecutive pair of points, with terrain-following
  // sub-segmentation so the wall hugs hills and dips.
  // points: array of { x, z } coordinates
  // height/thickness/friction: applied uniformly to all segments
  addPolyWall(points, height = 2, thickness = 0.5, friction = 0.1) {
    this.features.push({
      type: "polyWall",
      points,
      height,
      thickness,
      friction,
    });
    return this;
  }

  // Add a stack of 3 movable tires at a world position.
  // x/z: centre of the stack base on the terrain.
  addTireStack(x, z) {
    this.features.push({ type: "tireStack", x, z });
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
