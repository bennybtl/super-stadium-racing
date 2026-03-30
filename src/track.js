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

  // Add a square (rectangular) hill or depression with a cosine-smoothed transition band.
  // width/depth: size of the flat top. height: elevation (negative = pit).
  // transition: width of the slope skirt around the rectangle edges.
  addSquareHill(centerX, centerZ, width, depth, height, transition = 4, terrainType = null) {
    this.features.push({
      type: "squareHill",
      centerX,
      centerZ,
      width,
      depth,
      height,
      transition,
      terrainType,
    });
    return this;
  }

  // Add a rectangular area with specific terrain type
  addTerrainRect(centerX, centerZ, width, depth, terrainType) {
    this.features.push({
      type: "terrainRect",
      centerX,
      centerZ,
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

  // Add a square hill that slopes from one edge to the other.
  // slopeAxis: 'x'→0°, 'z'→90°. Converted to angle (degrees).
  // heightAtMin/heightAtMax: elevation at the − and + ends of the slope direction.
  // transition: cosine falloff band outside the rectangle (0 = hard edge).
  addSlopedRect(centerX, centerZ, width, depth, slopeAxis, heightAtMin, heightAtMax, terrainType = null, transition = 0) {
    const angle = slopeAxis === 'z' ? 90 : 0;
    this.features.push({
      type: "squareHill",
      centerX,
      centerZ,
      width,
      depth,
      angle,
      heightAtMin,
      heightAtMax,
      terrainType,
      transition,
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

  getTerrainSlopeAt(x, z, heading, fwdSlopeDist = 1.0, offset = 0) {
    const ox = x + Math.sin(heading) * offset;
    const oz = z + Math.cos(heading) * offset;
    const hx = ox + Math.sin(heading) * fwdSlopeDist;
    const hz = oz + Math.cos(heading) * fwdSlopeDist;
    const hbx = ox - Math.sin(heading) * fwdSlopeDist;
    const hbz = oz - Math.cos(heading) * fwdSlopeDist;

    const slopeRad = Math.atan2(
      this.getHeightAt(hx, hz) - this.getHeightAt(hbx, hbz),
      fwdSlopeDist * 2
    );
    const slopeDeg = slopeRad * 180 / Math.PI;
    return slopeDeg;
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

        case "squareHill": {
          const hw = feature.width / 2;
          const hd = (feature.depth ?? feature.width) / 2;
          const transition = feature.transition ?? 4;
          // Rotate world offset into the box's local space
          const wx = x - feature.centerX;
          const wz = z - feature.centerZ;
          const angleRad = (feature.angle ?? 0) * Math.PI / 180;
          const cosA = Math.cos(angleRad);
          const sinA = Math.sin(angleRad);
          const lx =  wx * cosA + wz * sinA;
          const lz = -wx * sinA + wz * cosA;
          const edgeDx = Math.max(0, Math.abs(lx) - hw);
          const edgeDz = Math.max(0, Math.abs(lz) - hd);
          const dist = Math.sqrt(edgeDx * edgeDx + edgeDz * edgeDz);
          if (dist >= transition) break;
          const falloff = dist === 0 ? 1 : Math.cos((dist / transition) * Math.PI / 2);
          if (feature.heightAtMin !== undefined) {
            // Slope runs along local X (the rotated width axis)
            const t = (Math.max(-hw, Math.min(hw, lx)) + hw) / feature.width;
            const innerHeight = feature.heightAtMin + (feature.heightAtMax - feature.heightAtMin) * t;
            totalHeight += innerHeight * falloff;
          } else {
            totalHeight += feature.height * falloff;
          }
          break;
        }

        case "meshGrid": {
          const { centerX: cx, centerZ: cz, width, depth, cols, rows, heights } = feature;
          if (!heights || cols < 2 || rows < 2) break;
          const halfW = width / 2, halfD = depth / 2;
          if (x < cx - halfW || x > cx + halfW || z < cz - halfD || z > cz + halfD) break;
          // Fractional grid coordinate [0, cols-1] and [0, rows-1]
          const fc = (x - (cx - halfW)) * (cols - 1) / width;
          const fr = (z - (cz - halfD)) * (rows - 1) / depth;
          const c0 = Math.max(0, Math.min(Math.floor(fc), cols - 2));
          const r0 = Math.max(0, Math.min(Math.floor(fr), rows - 2));
          const c1 = c0 + 1, r1 = r0 + 1;
          const tc = fc - c0, tr = fr - r0;
          totalHeight +=
            (heights[r0 * cols + c0] ?? 0) * (1 - tc) * (1 - tr) +
            (heights[r0 * cols + c1] ?? 0) *      tc  * (1 - tr) +
            (heights[r1 * cols + c0] ?? 0) * (1 - tc) *      tr  +
            (heights[r1 * cols + c1] ?? 0) *      tc  *      tr;
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
          if (x >= feature.centerX - halfWidth && x <= feature.centerX + halfWidth &&
              z >= feature.centerZ - halfDepth && z <= feature.centerZ + halfDepth) {
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

        case "squareHill": {
          const hw = feature.width / 2;
          const hd = (feature.depth ?? feature.width) / 2;
          const transition = feature.transition ?? 4;
          const wx = x - feature.centerX;
          const wz = z - feature.centerZ;
          const angleRad = (feature.angle ?? 0) * Math.PI / 180;
          const cosA = Math.cos(angleRad);
          const sinA = Math.sin(angleRad);
          const lx =  wx * cosA + wz * sinA;
          const lz = -wx * sinA + wz * cosA;
          const edgeDx = Math.max(0, Math.abs(lx) - hw);
          const edgeDz = Math.max(0, Math.abs(lz) - hd);
          const dist = Math.sqrt(edgeDx * edgeDx + edgeDz * edgeDz);
          if (dist < transition) return feature.terrainType;
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
