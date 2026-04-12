import { TERRAIN_TYPES } from "./terrain.js";

/**
 * Track system for defining 3D terrain layouts with different surface types
 * Tracks are composed of features (ridges, hills, valleys, jumps, etc.)
 */

export class Track {
  constructor(name = "Untitled Track", width = 160, depth = 160) {
    this.name = name;
    this.width = width;
    this.depth = depth;
    this.features = [];
    this.defaultTerrainType = TERRAIN_TYPES.PACKED_DIRT;
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

  addTerrain(centerX, centerZ, width, depth, shape = 'rect', terrainType = 'compactDirt') {
    this.features.push({
      type: "terrain",
      shape,
      centerX,
      centerZ,
      width,
      depth,
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

  // Add a flag at the specified position
  addFlag(x, z, color = "red") {
    this.features.push({ type: "flag", x, z, color });
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

        case "polyHill": {
          const { points, height = 3, slope = 5, closed = false } = feature;
          if (!points || points.length < 2) break;
          
          // Expand polyline with rounded corners based on radius
          const expandedPoints = this._expandPolylineForHill(points, closed);
          
          // Find distance to the expanded polyline
          let minDist = Infinity;
          const numSegments = closed ? expandedPoints.length : expandedPoints.length - 1;
          
          for (let i = 0; i < numSegments; i++) {
            const p1 = expandedPoints[i];
            const p2 = expandedPoints[(i + 1) % expandedPoints.length];
            
            // Calculate distance from point to line segment
            const dx = p2.x - p1.x;
            const dz = p2.z - p1.z;
            const len2 = dx * dx + dz * dz;
            
            if (len2 < 0.0001) {
              // Degenerate segment, use point distance
              const pdx = x - p1.x;
              const pdz = z - p1.z;
              minDist = Math.min(minDist, Math.sqrt(pdx * pdx + pdz * pdz));
              continue;
            }
            
            // Project point onto line segment
            const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (z - p1.z) * dz) / len2));
            const projX = p1.x + t * dx;
            const projZ = p1.z + t * dz;
            const distToSeg = Math.sqrt((x - projX) ** 2 + (z - projZ) ** 2);
            minDist = Math.min(minDist, distToSeg);
          }
          
          // Apply triangular profile: full height at center, 0 at width/2
          const halfWidth = (feature.width ?? feature.slope ?? 5) / 2;
          if (minDist < halfWidth) {
            // Linear falloff from center to edge: 1 at center, 0 at edge
            const linearFalloff = 1 - (minDist / halfWidth);
            totalHeight += height * linearFalloff;
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
        case "hill": {
          const dx = x - feature.centerX;
          const dz = z - feature.centerZ;
          const distFromCenter = Math.sqrt(dx * dx + dz * dz);
          if (distFromCenter < feature.radius) {
            return feature.terrainType;
          }
          break;
        }

        case "terrain": {
          if (feature.shape === 'rect') {
            const halfWidth = feature.width / 2;
            const halfDepth = feature.depth / 2;
            const wx = x - feature.centerX;
            const wz = z - feature.centerZ;
            const angleRad = (feature.rotation ?? 0) * Math.PI / 180;
            const cosA = Math.cos(angleRad);
            const sinA = Math.sin(angleRad);
            const lx =  wx * cosA + wz * sinA;
            const lz = -wx * sinA + wz * cosA;
            if (Math.abs(lx) <= halfWidth && Math.abs(lz) <= halfDepth) {
              return feature.terrainType;
            }
          } else if (feature.shape === 'circle') {
            const radAngle = (feature.rotation ?? 0) * Math.PI / 180;
            const cosA = Math.cos(radAngle);
            const sinA = Math.sin(radAngle);
            const dx = x - feature.centerX;
            const dz = z - feature.centerZ;
            
            // Reverse rotate the point to local axes
            const localX =  dx * cosA + dz * sinA;
            const localZ = -dx * sinA + dz * cosA;

            const hw = (feature.width ?? 10) / 2;
            const hd = (feature.depth ?? 10) / 2;

            // Standard ellipse formula inside bounds check
            if ((localX * localX) / (hw * hw) + (localZ * localZ) / (hd * hd) <= 1) {
              return feature.terrainType;
            }
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

    return this.defaultTerrainType;
  }

  // Expand a polyline with optional rounded corners at each point
  _expandPolylineForHill(points, closed = false) {
    if (points.length < 2) return points;
    
    const out = [];
    const numSegments = closed ? points.length : points.length - 1;
    
    for (let i = 0; i < numSegments; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      const p3 = closed ? points[(i + 2) % points.length] : (i + 2 < points.length ? points[i + 2] : null);
      
      const radius = p2.radius ?? 0;
      
      if (i === 0 && !closed) {
        out.push({ x: p1.x, z: p1.z });
      }
      
      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      
      if (len < 0.01) continue;
      
      if (radius > 0.1 && p3) {
        const dx2 = p3.x - p2.x;
        const dz2 = p3.z - p2.z;
        const len2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);
        
        if (len2 > 0.01) {
          const maxRadius = Math.min(len * 0.45, len2 * 0.45);
          const clampedRadius = Math.min(radius, maxRadius);
          
          const dir1X = dx / len;
          const dir1Z = dz / len;
          const dir2X = dx2 / len2;
          const dir2Z = dz2 / len2;
          
          const beforeX = p2.x - dir1X * clampedRadius;
          const beforeZ = p2.z - dir1Z * clampedRadius;
          out.push({ x: beforeX, z: beforeZ });
          
          const afterX = p2.x + dir2X * clampedRadius;
          const afterZ = p2.z + dir2Z * clampedRadius;
          
          const angle1 = Math.atan2(dir1Z, dir1X);
          const angle2 = Math.atan2(dir2Z, dir2X);
          
          let angleDiff = angle2 - angle1;
          while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
          while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
          
          const halfAngle = angleDiff / 2;
          const centerDist = clampedRadius / Math.sin(Math.abs(halfAngle));
          const bisectorAngle = angle1 + halfAngle;
          const perpAngle = bisectorAngle + (angleDiff > 0 ? Math.PI/2 : -Math.PI/2);
          const centerX = p2.x + Math.cos(perpAngle) * centerDist;
          const centerZ = p2.z + Math.sin(perpAngle) * centerDist;
          
          const arcSteps = Math.max(4, Math.ceil(Math.abs(angleDiff) * clampedRadius / 1.5));
          const startAngle = Math.atan2(beforeZ - centerZ, beforeX - centerX);
          const endAngle = Math.atan2(afterZ - centerZ, afterX - centerX);
          
          let arcAngleDiff = endAngle - startAngle;
          while (arcAngleDiff > Math.PI) arcAngleDiff -= 2 * Math.PI;
          while (arcAngleDiff < -Math.PI) arcAngleDiff += 2 * Math.PI;
          
          const arcRadius = Math.sqrt((beforeX - centerX) ** 2 + (beforeZ - centerZ) ** 2);
          
          for (let step = 1; step <= arcSteps; step++) {
            const t = step / arcSteps;
            const angle = startAngle + arcAngleDiff * t;
            const arcX = centerX + Math.cos(angle) * arcRadius;
            const arcZ = centerZ + Math.sin(angle) * arcRadius;
            out.push({ x: arcX, z: arcZ });
          }
        } else {
          out.push({ x: p2.x, z: p2.z });
        }
      } else {
        if (!closed || i < numSegments - 1) {
          out.push({ x: p2.x, z: p2.z });
        }
      }
    }
    
    return out;
  }

  // Serialize track to JSON string
  toJSON() {
    // Deep clone features and convert terrainType objects to names
    const serializedFeatures = this.features.map(feature => {
      const serialized = { ...feature };
      if (feature.terrainType && typeof feature.terrainType === 'object') {
        // Convert terrainType object to just the name
        serialized.terrainType = feature.terrainType.name;
      }
      return serialized;
    });

    return JSON.stringify({
      name: this.name,
      width: this.width,
      depth: this.depth,
      defaultTerrainType: this.defaultTerrainType?.name ?? 'packed_dirt',
      features: serializedFeatures,
    }, null, 2);
  }

  // Load track from JSON string
  static fromJSON(jsonString) {
    const data = JSON.parse(jsonString);
    const track = new Track(data.name, data.width ?? 160, data.depth ?? 160);
    
    if (data.defaultTerrainType) {
      const key = Object.keys(TERRAIN_TYPES).find(
        k => TERRAIN_TYPES[k].name === data.defaultTerrainType
      );
      if (key) track.defaultTerrainType = TERRAIN_TYPES[key];
    }
    // Convert features and map terrainType names to TERRAIN_TYPES objects
    track.features = (data.features || []).map(feature => {
      const loaded = { ...feature };

      // Migrate legacy terrainRect / terrainCircle to unified terrain+shape format
      if (loaded.type === 'terrainRect') {
        loaded.type  = 'terrain';
        loaded.shape = 'rect';
      } else if (loaded.type === 'terrainCircle') {
        loaded.type  = 'terrain';
        loaded.shape = 'circle';
      }

      // Backwards compat for shapes using 'radius' instead of width/depth
      if (loaded.shape === 'circle' && loaded.radius !== undefined) {
        loaded.width = loaded.radius * 2;
        loaded.depth = loaded.radius * 2;
        loaded.rotation = 0;
        delete loaded.radius;
      }

      if (feature.terrainType && typeof feature.terrainType === 'string') {
        // Convert terrainType name string to TERRAIN_TYPES object
        const terrainKey = Object.keys(TERRAIN_TYPES).find(
          key => TERRAIN_TYPES[key].name === feature.terrainType
        );
        loaded.terrainType = terrainKey ? TERRAIN_TYPES[terrainKey] : null;
      }
      return loaded;
    });
    
    return track;
  }

  // Clone this track
  clone() {
    return Track.fromJSON(this.toJSON());
  }
}
