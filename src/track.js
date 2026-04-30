import { TERRAIN_TYPES } from "./terrain.js";
import { expandPolyline } from "./polyline-utils.js";

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
    this.borderTerrainType = TERRAIN_TYPES.PACKED_DIRT;
    this.image = null;
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
      collisionHeight: height,
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

  // Add a circular action zone at a world position.
  // zoneType: 'pickupSpawn' — tells PickupManager to restrict pickup spawns to this region.
  addActionZone(x, z, radius = 15, zoneType = 'pickupSpawn') {
    this.features.push({ type: 'actionZone', zoneType, x, z, radius });
    return this;
  }

  // Add a poly curb — a flat, terrain-following strip of alternating red/white
  // segments along a polyline.  Trucks can drive over curbs (no velocity blocking).
  // points: array of { x, z, radius? } control points.
  // height: bump height in metres (default 0.22).
  // width:  lateral strip width in metres (default 0.9).
  addPolyCurb(points, height = 0.22, width = 0.9, closed = false) {
    this.features.push({ type: 'polyCurb', points, height, width, closed });
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

          // Clamped grid sample helper
          const H = (r, c) => heights[
            Math.max(0, Math.min(rows - 1, r)) * cols +
            Math.max(0, Math.min(cols - 1, c))
          ] ?? 0;

          const bilinear =
            H(r0, c0) * (1 - tc) * (1 - tr) +
            H(r0, c1) *      tc  * (1 - tr) +
            H(r1, c0) * (1 - tc) *      tr  +
            H(r1, c1) *      tc  *      tr;

          const s = feature.smoothing ?? 0;
          if (s <= 0) {
            totalHeight += bilinear;
            break;
          }

          // Catmull-Rom 1D: interpolates p1→p2 with tangents derived from neighbours.
          // Unlike smoothstep, tangents match the actual grid slope so there are no
          // artificial flat spots or S-curve artifacts on steep sections.
          const cr = (p0, p1, p2, p3, t) => {
            const t2 = t * t, t3 = t2 * t;
            return 0.5 * (
              2 * p1 +
              (-p0 + p2) * t +
              (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
              (-p0 + 3 * p1 - 3 * p2 + p3) * t3
            );
          };

          // Bicubic: interpolate 4 rows along columns, then interpolate the results.
          const row0 = cr(H(r0-1,c0-1), H(r0-1,c0), H(r0-1,c1), H(r0-1,c1+1), tc);
          const row1 = cr(H(r0,  c0-1), H(r0,  c0), H(r0,  c1), H(r0,  c1+1), tc);
          const row2 = cr(H(r1,  c0-1), H(r1,  c0), H(r1,  c1), H(r1,  c1+1), tc);
          const row3 = cr(H(r1+1,c0-1), H(r1+1,c0), H(r1+1,c1), H(r1+1,c1+1), tc);
          const bicubic = cr(row0, row1, row2, row3, tr);

          totalHeight += bilinear + (bicubic - bilinear) * s;
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

        case "terrainPath": {
          const pts = feature.points;
          if (!pts || pts.length < 2) break;
          const halfWidth = (feature.width ?? 8) / 2;
          const cornerRadius = feature.cornerRadius ?? 0;
          const expanded = cornerRadius > 0.1
            ? this._expandPolylineForHill(pts.map(p => ({ ...p, radius: cornerRadius })))
            : pts;
          for (let j = 0; j < expanded.length - 1; j++) {
            const p1 = expanded[j];
            const p2 = expanded[j + 1];
            const dx = p2.x - p1.x;
            const dz = p2.z - p1.z;
            const len2 = dx * dx + dz * dz;
            if (len2 < 1e-8) continue;
            const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (z - p1.z) * dz) / len2));
            const projX = p1.x + t * dx;
            const projZ = p1.z + t * dz;
            const dist = Math.sqrt((x - projX) ** 2 + (z - projZ) ** 2);
            if (dist <= halfWidth) return feature.terrainType;
          }
          break;
        }

        case "polyHill": {
          const points = feature.points;
          if (!points || points.length < 2) break;
          const closed = feature.closed ?? false;
          const expandedPoints = this._expandPolylineForHill(points, closed);
          const halfWidth = (feature.width ?? feature.slope ?? 5) / 2;
          const numSegments = closed ? expandedPoints.length : expandedPoints.length - 1;
          let minDist = Infinity;

          for (let j = 0; j < numSegments; j++) {
            const p1 = expandedPoints[j];
            const p2 = expandedPoints[(j + 1) % expandedPoints.length];
            const dx = p2.x - p1.x;
            const dz = p2.z - p1.z;
            const len2 = dx * dx + dz * dz;
            if (len2 < 1e-8) continue;
            const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (z - p1.z) * dz) / len2));
            const projX = p1.x + t * dx;
            const projZ = p1.z + t * dz;
            const dist = Math.sqrt((x - projX) ** 2 + (z - projZ) ** 2);
            minDist = Math.min(minDist, dist);
          }

          if (minDist <= halfWidth) return feature.terrainType;
          break;
        }
      }
    }

    const halfW = (this.width ?? 160) / 2;
    const halfD = (this.depth ?? 160) / 2;
    const inEditableArea = Math.abs(x) <= halfW && Math.abs(z) <= halfD;
    if (!inEditableArea) {
      return this.borderTerrainType ?? this.defaultTerrainType;
    }

    return this.defaultTerrainType;
  }

  // Expand a polyline with optional rounded corners at each point
  _expandPolylineForHill(points, closed = false) {
    return expandPolyline(points, closed);
  }

  /**
   * Returns the highest bridge deck Y that is beneath `currentY` at (x, z),
   * or -Infinity if no bridge covers this XZ position.
   *
   * Used by TerrainPhysics so the truck spring lands on the bridge deck
   * instead of falling through to the ground below.
   *
   * @param {number} x
   * @param {number} z
   * @param {number} truckCenterY  — truck mesh center Y; used to skip decks the truck is passing under
   */
  getBridgeFloorAt(x, z, truckCenterY = Infinity) {
    let best = -Infinity;
    for (const feature of this.features) {
      if (feature.type !== 'bridge') continue;
      const hw = (feature.width ?? 20) / 2;
      const hd = (feature.depth ?? 8)  / 2;
      const angleRad = (feature.angle ?? 0) * Math.PI / 180;
      const cosA = Math.cos(angleRad);
      const sinA = Math.sin(angleRad);
      const dx = x - feature.centerX;
      const dz = z - feature.centerZ;
      const lx =  dx * cosA + dz * sinA;
      const lz = -dx * sinA + dz * cosA;
      const inFootprint = Math.abs(lx) <= hw && Math.abs(lz) <= hd;
      if (!inFootprint) continue;
      const terrainY   = this.getHeightAt(feature.centerX, feature.centerZ);
      const deckBottom = terrainY + (feature.height ?? 5);
      const deckTop    = deckBottom + (feature.thickness ?? 0.4);
      // If the truck center is below the deck's underside, the truck is driving
      // under the bridge — don't snap it up onto the deck.
      if (truckCenterY < deckBottom) continue;
      if (deckTop > best) best = deckTop;
    }
    return best;
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
      image: this.image ?? undefined,
      width: this.width,
      depth: this.depth,
      defaultTerrainType: this.defaultTerrainType?.name ?? 'packed_dirt',
      borderTerrainType: this.borderTerrainType?.name ?? this.defaultTerrainType?.name ?? 'packed_dirt',
      wear: this.wear ?? undefined,
      features: serializedFeatures,
    }, null, 2);
  }

  // Load track from JSON string
  static fromJSON(jsonString) {
    const data = JSON.parse(jsonString);
    const track = new Track(data.name, data.width ?? 160, data.depth ?? 160);
    track.image = data.image ?? null;
    
    if (data.defaultTerrainType) {
      const key = Object.keys(TERRAIN_TYPES).find(
        k => TERRAIN_TYPES[k].name === data.defaultTerrainType
      );
      if (key) track.defaultTerrainType = TERRAIN_TYPES[key];
    }

    if (data.borderTerrainType) {
      const borderKey = Object.keys(TERRAIN_TYPES).find(
        k => TERRAIN_TYPES[k].name === data.borderTerrainType
      );
      if (borderKey) {
        track.borderTerrainType = TERRAIN_TYPES[borderKey];
      } else {
        track.borderTerrainType = track.defaultTerrainType;
      }
    } else {
      // Backwards compatibility: legacy tracks had one terrain default for all empty cells.
      track.borderTerrainType = track.defaultTerrainType;
    }

    // Convert features and map terrainType names to TERRAIN_TYPES objects
    if (data.wear && typeof data.wear === 'object') {
      track.wear = { ...data.wear };
    }

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
