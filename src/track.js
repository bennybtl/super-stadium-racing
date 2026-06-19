import { TERRAIN_TYPES } from "./terrain.js";
import { expandPolyline } from "./polyline-utils.js";
import { usePrimaryTerrainWithBlend } from "./terrain-blend-utils.js";

const TRACK_SCHEMA_VERSION = 2;

function getFeatureSerializationPriority(feature) {
  if (!feature || typeof feature !== 'object') return 10;
  if (feature.type === 'meshGrid') return 0;
  if (feature.type === 'bridgeMesh') return 1;
  return 10;
}

function getHillEllipseParams(feature) {
  return {
    radiusX: Math.max(0.001, feature.radiusX ?? 10),
    radiusZ: Math.max(0.001, feature.radiusZ ?? 10),
    angleRad: ((feature.angle ?? 0) * Math.PI) / 180,
  };
}

function getHillLocalCoords(feature, x, z) {
  const wx = x - feature.centerX;
  const wz = z - feature.centerZ;
  const { angleRad } = getHillEllipseParams(feature);
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  return {
    lx: wx * cosA + wz * sinA,
    lz: -wx * sinA + wz * cosA,
  };
}

/**
 * Ray-casting point-in-polygon test using the winding number algorithm
 * Returns true if (x, z) is inside the polygon formed by points
 */
function isPointInPolygon(x, z, points) {
  if (!points || points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const zi = points[i].z;
    const xj = points[j].x;
    const zj = points[j].z;
    const intersects = ((zi > z) !== (zj > z))
      && (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-8) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Track system for defining 3D terrain layouts with different surface types
 * Tracks are composed of features (ridges, hills, valleys, jumps, etc.)
 */

export class Track {
  constructor(name = "Untitled Track", width = 160, depth = 160) {
    this.schemaVersion = TRACK_SCHEMA_VERSION;
    this.name = name;
    this.id = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]+/g, '');
    this.hidden = true;
    this.packId = null;
    this.width = width;
    this.depth = depth;
    this.features = [];
    this.defaultTerrainType = TERRAIN_TYPES.PACKED_DIRT;
    this.borderTerrainType = TERRAIN_TYPES.PACKED_DIRT;
    this.image = null;
  }

  // Add a hill (ellipse when radiusX !== radiusZ)
  addHill(centerX, centerZ, radiusX, radiusZ, height, angle = 0, terrainType = null) {
    this.features.push({
      type: "hill",
      centerX,
      centerZ,
      radiusX,
      radiusZ,
      angle,
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

  // Add a generic movable obstacle at a world position.
  // obstacleType: 'barrel' | 'hayBale' | 'tireStack'
  addObstacle(x, z, obstacleType = 'barrel', angle = 0, color = 'yellow') {
    this.features.push({ type: 'obstacle', obstacleType, x, z, angle, color });
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
          const { radiusX, radiusZ } = getHillEllipseParams(feature);
          const { lx, lz } = getHillLocalCoords(feature, x, z);
          const t2 = (lx * lx) / (radiusX * radiusX) + (lz * lz) / (radiusZ * radiusZ);
          if (t2 < 1) {
            const t = Math.sqrt(t2);
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
          const halfW = width / 2;
          const halfD = depth / 2;

          // Rotate the world point into the mesh's local (axis-aligned) frame so
          // the grid can carry an arbitrary `angle` (degrees), like squareHill.
          const dwx = x - cx;
          const dwz = z - cz;
          const angleRad = (feature.angle ?? 0) * Math.PI / 180;
          const cosA = Math.cos(angleRad);
          const sinA = Math.sin(angleRad);
          const lx =  dwx * cosA + dwz * sinA;
          const lz = -dwx * sinA + dwz * cosA;

          // Regional meshes (falloff band defined) contribute only inside their
          // bounds and ease to zero across the falloff band, so several small
          // meshes can stack without bleeding edge heights across the whole map.
          // Legacy full-track meshes (regional !== true) keep the original
          // clamp-to-edge spread so existing tracks render unchanged.
          let weight = 1;
          if (feature.regional) {
            const edgeDx = Math.max(0, Math.abs(lx) - halfW);
            const edgeDz = Math.max(0, Math.abs(lz) - halfD);
            const dist = Math.sqrt(edgeDx * edgeDx + edgeDz * edgeDz);
            const falloff = feature.falloff ?? 0;
            if (falloff <= 0) {
              if (dist > 0) break;            // hard bounds — nothing outside
            } else {
              if (dist >= falloff) break;     // beyond the blend band
              weight = dist === 0 ? 1 : Math.cos((dist / falloff) * Math.PI / 2);
            }
          }

          // Clamp the sample to mesh bounds (local space) so border heights hold
          // out to the edge before the falloff weight blends them away.
          const sampleLx = Math.max(-halfW, Math.min(halfW, lx));
          const sampleLz = Math.max(-halfD, Math.min(halfD, lz));
          // Fractional grid coordinate [0, cols-1] and [0, rows-1]
          const fc = (sampleLx + halfW) * (cols - 1) / Math.max(width, 1e-6);
          const fr = (sampleLz + halfD) * (rows - 1) / Math.max(depth, 1e-6);
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
            totalHeight += bilinear * weight;
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

          totalHeight += (bilinear + (bicubic - bilinear) * s) * weight;
          break;
        }

        case "polyHill": {
          const { points, height = 3, slope = 5, closed = false, filled = false } = feature;
          if (!points || points.length < 2) break;
          
          const expandedPoints = this._expandPolylineForHill(points, closed);
          const halfWidth = (feature.width ?? feature.slope ?? 5) / 2;
          
          // Filled mode: uniform height inside polygon, falloff at edges
          if (filled && closed) {
            if (isPointInPolygon(x, z, expandedPoints)) {
              totalHeight += height;
            } else {
              // Falloff zone outside polygon boundary
              let minDist = Infinity;
              const numSegments = expandedPoints.length;
              for (let i = 0; i < numSegments; i++) {
                const p1 = expandedPoints[i];
                const p2 = expandedPoints[(i + 1) % numSegments];
                const dx = p2.x - p1.x;
                const dz = p2.z - p1.z;
                const len2 = dx * dx + dz * dz;
                if (len2 < 0.0001) continue;
                const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (z - p1.z) * dz) / len2));
                const projX = p1.x + t * dx;
                const projZ = p1.z + t * dz;
                const dist = Math.sqrt((x - projX) ** 2 + (z - projZ) ** 2);
                minDist = Math.min(minDist, dist);
              }
              if (minDist < halfWidth) {
                const falloff = 1 - (minDist / halfWidth);
                totalHeight += height * falloff;
              }
            }
          } else {
            // Original behavior: distance-based falloff from centerline
            let minDist = Infinity;
            const numSegments = closed ? expandedPoints.length : expandedPoints.length - 1;
            for (let i = 0; i < numSegments; i++) {
              const p1 = expandedPoints[i];
              const p2 = expandedPoints[(i + 1) % expandedPoints.length];
              const dx = p2.x - p1.x;
              const dz = p2.z - p1.z;
              const len2 = dx * dx + dz * dz;
              if (len2 < 0.0001) {
                const pdx = x - p1.x;
                const pdz = z - p1.z;
                minDist = Math.min(minDist, Math.sqrt(pdx * pdx + pdz * pdz));
                continue;
              }
              const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (z - p1.z) * dz) / len2));
              const projX = p1.x + t * dx;
              const projZ = p1.z + t * dz;
              const distToSeg = Math.sqrt((x - projX) ** 2 + (z - projZ) ** 2);
              minDist = Math.min(minDist, distToSeg);
            }
            if (minDist < halfWidth) {
              const linearFalloff = 1 - (minDist / halfWidth);
              totalHeight += height * linearFalloff;
            }
          }
          break;
        }
      }
    }

    // Fade height from the editable boundary through the full outside border area
    // so elevation transitions smoothly to flat terrain.
    const halfW = (this.width ?? 160) / 2;
    const halfD = (this.depth ?? 160) / 2;
    const HEIGHT_BLEND_INNER = 0;
    const HEIGHT_BLEND_OUTER = 10;
    const signedDistToEdge = Math.min(halfW - Math.abs(x), halfD - Math.abs(z));

    let blendedHeight;
    if (signedDistToEdge >= HEIGHT_BLEND_INNER) {
      blendedHeight = totalHeight;
    } else if (signedDistToEdge <= -HEIGHT_BLEND_OUTER) {
      blendedHeight = 0;
    } else {
      const span = HEIGHT_BLEND_INNER + HEIGHT_BLEND_OUTER;
      const t = (signedDistToEdge + HEIGHT_BLEND_OUTER) / span;
      const blend = Math.max(0, Math.min(1, t));
      blendedHeight = totalHeight * blend;
    }

    // Add subtle vertical breakup in the outside border strip so the border
    // is less uniformly flat while keeping the track edge transition smooth.
    if (signedDistToEdge < 0) {
      const BORDER_Y_JITTER = 1.0;
      const borderT = Math.max(0, Math.min(1, -signedDistToEdge / HEIGHT_BLEND_OUTER));
      const jitterMask = Math.max(0, Math.min(1, (borderT - 0.2) / 0.8));
      const n1 = Math.sin((x + 31.7) * 0.37 + (z - 17.3) * 0.53) * 43758.5453;
      const n2 = Math.sin((x - 11.1) * 0.91 - (z + 23.9) * 0.41) * 24634.6345;
      const jitter = ((n1 - Math.floor(n1)) * 2 - 1) * 0.65 + ((n2 - Math.floor(n2)) * 2 - 1) * 0.35;
      blendedHeight += jitter * BORDER_Y_JITTER * jitterMask;
    }

    return blendedHeight;
  }

  // Get the terrain type at a world position (returns null if not specified)
  getTerrainTypeAt(x, z) {
    // Check features in reverse order so later additions take priority
    for (let i = this.features.length - 1; i >= 0; i--) {
      const feature = this.features[i];
      
      if (!feature.terrainType) continue;

      switch (feature.type) {
        case "hill": {
          const { radiusX, radiusZ } = getHillEllipseParams(feature);
          const { lx, lz } = getHillLocalCoords(feature, x, z);
          const t2 = (lx * lx) / (radiusX * radiusX) + (lz * lz) / (radiusZ * radiusZ);
          const blendWidth = Math.max(0, feature.blendWidth ?? 0);
          if (blendWidth <= 0) {
            if (t2 < 1) return feature.terrainType;
            break;
          }
          // Dither the terrain boundary across the blend band straddling the
          // ellipse edge. signedDistToEdge > 0 inside, < 0 outside.
          const signedDistToEdge = (1 - Math.sqrt(t2)) * Math.min(radiusX, radiusZ);
          if (usePrimaryTerrainWithBlend(x, z, signedDistToEdge, blendWidth, blendWidth)) {
            return feature.terrainType;
          }
          break;
        }

        case "terrain": {
          const blendWidth = Math.max(0, feature.blendWidth ?? 0);
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
            const edgeDx = Math.max(0, Math.abs(lx) - halfWidth);
            const edgeDz = Math.max(0, Math.abs(lz) - halfDepth);
            const insideDist = Math.min(halfWidth - Math.abs(lx), halfDepth - Math.abs(lz));
            const signedDistToEdge = insideDist >= 0
              ? insideDist
              : -Math.sqrt(edgeDx * edgeDx + edgeDz * edgeDz);
            if (usePrimaryTerrainWithBlend(x, z, signedDistToEdge, blendWidth, blendWidth)) {
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
            const ellipseDist = Math.sqrt((localX * localX) / (hw * hw) + (localZ * localZ) / (hd * hd));
            const signedDistToEdge = (1 - ellipseDist) * Math.min(hw, hd);
            if (usePrimaryTerrainWithBlend(x, z, signedDistToEdge, blendWidth, blendWidth)) {
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
          const blendWidth = Math.max(0, feature.blendWidth ?? 0);
          if (blendWidth <= 0) {
            if (dist < transition) return feature.terrainType;
            break;
          }
          // The terrain region reaches the outer rim of the height transition
          // zone; dither across the blend band straddling that boundary.
          const signedDistToEdge = transition - dist;
          if (usePrimaryTerrainWithBlend(x, z, signedDistToEdge, blendWidth, blendWidth)) {
            return feature.terrainType;
          }
          break;
        }

        case "terrainPath": {
          const pts = feature.points;
          if (!pts || pts.length < 2) break;
          const halfWidth = (feature.width ?? 8) / 2;
          const blendWidth = Math.max(0, feature.blendWidth ?? 0);
          const cornerRadius = feature.cornerRadius ?? 0;
          const closed = feature.closed ?? false;
          const expanded = cornerRadius > 0.1
            ? this._expandPolylineForHill(pts.map(p => ({ ...p, radius: cornerRadius })), closed)
            : pts;
          const numSegments = closed ? expanded.length : expanded.length - 1;
          let minDist = Infinity;
          for (let j = 0; j < numSegments; j++) {
            const p1 = expanded[j];
            const p2 = expanded[(j + 1) % expanded.length];
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
          if (!Number.isFinite(minDist)) break;
          const signedDistToEdge = halfWidth - minDist;
          if (usePrimaryTerrainWithBlend(x, z, signedDistToEdge, blendWidth, blendWidth)) {
            return feature.terrainType;
          }
          break;
        }

        case "polyHill": {
          const points = feature.points;
          if (!points || points.length < 2) break;
          const closed = feature.closed ?? false;
          const filled = feature.filled ?? false;
          const expandedPoints = this._expandPolylineForHill(points, closed);
          const halfWidth = (feature.width ?? feature.slope ?? 5) / 2;
          
          // Filled mode: entire interior is terrain type
          if (filled && closed && isPointInPolygon(x, z, expandedPoints)) {
            return feature.terrainType;
          }
          
          // Falloff zone: check distance to polyline
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

    // Blend across the full border transition zone around the editable area:
    // inside the edge + outside the edge. This avoids a hard ring where border
    // terrain starts and gives the shader enough gradient to smooth the seam.
    const BORDER_BLEND_INNER = 10;
    const BORDER_BLEND_OUTER = 10;
    const signedDistToEdge = Math.min(halfW - Math.abs(x), halfD - Math.abs(z));

    const useDefaultTerrain = usePrimaryTerrainWithBlend(
      x,
      z,
      signedDistToEdge,
      BORDER_BLEND_INNER,
      BORDER_BLEND_OUTER
    );
    return useDefaultTerrain
      ? this.defaultTerrainType
      : (this.borderTerrainType ?? this.defaultTerrainType);
  }

  // Expand a polyline with optional rounded corners at each point
  _expandPolylineForHill(points, closed = false) {
    return expandPolyline(points, closed);
  }

  // Serialize track to JSON string
  toJSON() {
    // Deep clone features, convert terrainType objects to names, and emit
    // drive surfaces first so runtime reconstruction sees their surfaces before
    // walls/curbs that may sample them while building.
    const serializedFeatures = this.features
      .map((feature, index) => ({ feature, index }))
      .sort((a, b) => {
        const priorityDiff = getFeatureSerializationPriority(a.feature) - getFeatureSerializationPriority(b.feature);
        return priorityDiff !== 0 ? priorityDiff : a.index - b.index;
      })
      .map(({ feature }) => {
        const serialized = { ...feature };
        if (feature.terrainType && typeof feature.terrainType === 'object') {
          // Convert terrainType object to just the name
          serialized.terrainType = feature.terrainType.name;
        }
        return serialized;
      });

    return JSON.stringify({
      schemaVersion: this.schemaVersion ?? TRACK_SCHEMA_VERSION,
      id: this.id,
      packId: this.packId,
      hidden: this.hidden,
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
    track.schemaVersion = Number.isFinite(data.schemaVersion)
      ? data.schemaVersion
      : 1;
    track.image = data.image ?? null;
    track.id = data.id ?? track.id;
    track.packId = data.packId ?? track.packId;
    track.hidden = data.hidden ?? track.hidden;
    if (data.defaultTerrainType) {
      const key = Object.keys(TERRAIN_TYPES).find(
        k => TERRAIN_TYPES[k].name === data.defaultTerrainType
      );
      if (key) track.defaultTerrainType = TERRAIN_TYPES[key];
    }

    const borderKey = Object.keys(TERRAIN_TYPES).find(
      k => TERRAIN_TYPES[k].name === data.borderTerrainType
    );
    if (borderKey) {
      track.borderTerrainType = TERRAIN_TYPES[borderKey];
    } else {
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
