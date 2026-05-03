import { WallSegment } from "./WallSegment.js";

/**
 * Evaluate a cubic Bezier curve at parameter t (0 to 1).
 * p0, p1, p2, p3 are {x, z} points.
 */
function evaluateBezier(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    z: mt3 * p0.z + 3 * mt2 * t * p1.z + 3 * mt * t2 * p2.z + t3 * p3.z,
  };
}

/**
 * Expand a bezier polyline into sampled points.
 * Each anchor point can have handleIn and handleOut to control the curve shape.
 */
function expandBezierPolyline(points, closed = false) {
  if (points.length < 2) return points;
  const out = [];
  const numPoints = points.length;
  const segmentCount = closed ? numPoints : numPoints - 1;

  for (let i = 0; i < segmentCount; i++) {
    const p0 = points[i];
    const p3 = points[(i + 1) % numPoints];
    
    // Control points: use handles if defined, otherwise default to 1/3 of the way
    const p1 = p0.handleOut 
      ? { x: p0.x + p0.handleOut.x, z: p0.z + p0.handleOut.z }
      : { x: p0.x + (p3.x - p0.x) / 3, z: p0.z + (p3.z - p0.z) / 3 };
    
    const p2 = p3.handleIn
      ? { x: p3.x + p3.handleIn.x, z: p3.z + p3.handleIn.z }
      : { x: p3.x - (p3.x - p0.x) / 3, z: p3.z - (p3.z - p0.z) / 3 };

    // Sample the bezier curve
    const samples = 16; // points per segment
    for (let t = 0; t < samples; t++) {
      const u = t / samples;
      out.push(evaluateBezier(p0, p1, p2, p3, u));
    }
  }
  
  // Add final point (unless closed, then it wraps around)
  if (!closed) {
    const last = points[points.length - 1];
    out.push({ x: last.x, z: last.z });
  }
  
  return out;
}

/**
 * BezierWall — builds terrain-following WallSegments along a bezier curve path.
 */
export class BezierWall {
  /**
   * @param {object} feature  - track feature of type "bezierWall"
   * @param {Track}  track    - used to sample terrain height at each segment
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(feature, track, scene, shadows) {
    this.segments = [];
    this._feature = feature;
    const { height, thickness, friction = 0.1, closed = false } = feature;
    const rawPoints = feature.points;
    if (!rawPoints || rawPoints.length < 2) return;

    const points = expandBezierPolyline(rawPoints, closed);
    const numPoints = points.length;
    const edgeCount = closed ? numPoints : numPoints - 1;

    for (let i = 0; i < edgeCount; i++) {
      const p0 = points[i];
      const p1 = points[(i + 1) % numPoints];

      const dx     = p1.x - p0.x;
      const dz     = p1.z - p0.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      if (length < 0.01) continue;

      const heading = Math.atan2(-dz, dx);

      // Sub-segment so each piece is ~4 units long (terrain-following)
      const numSegs = Math.max(1, Math.round(length / 4));
      const segLen  = length / numSegs;
      const dirX    = dx / length;
      const dirZ    = dz / length;

      const SKIRT = 2;

      for (let s = 0; s < numSegs; s++) {
        const t       = (s + 0.5) * segLen;
        const px      = p0.x + dirX * t;
        const pz      = p0.z + dirZ * t;

        const half = segLen / 2;
        const yA = track.getHeightAt(px - dirX * half, pz - dirZ * half);
        const yB = track.getHeightAt(px + dirX * half, pz + dirZ * half);

        const avgY    = (yA + yB) / 2;
        const totalH  = height + SKIRT;
        const centerY = avgY + (height - SKIRT) / 2;
        const yShiftA = (yA - yB) / 2;
        const yShiftB = (yB - yA) / 2;

        const segW = segLen * 1.02;
        this.segments.push(
          new WallSegment(px, pz, centerY, segW, totalH, thickness,
            heading, friction, this.segments.length, null, "wall_bezier", scene, shadows,
            yShiftA, yShiftB)
        );
      }
    }
  }

  dispose() {
    for (const seg of this.segments) seg.dispose();
    this.segments = [];
  }
}
