import { WallSegment } from "./WallSegment.js";

/**
 * Expand a polyline with optional rounded corners at each point.
 * Each point can have a `radius` property (0-10) that creates a circular arc.
 * Exported so other objects (e.g. PolyCurb) can reuse it.
 */
export function expandPolyline(points, closed = false) {
  if (points.length < 2) return points;
  
  const out = [];
  const numSegments = closed ? points.length : points.length - 1;
  
  // Process each segment
  for (let i = 0; i < numSegments; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = closed ? points[(i + 2) % points.length] : (i + 2 < points.length ? points[i + 2] : null);
    
    const radius = p2.radius ?? 0;
        
    // Add the start point only for the first iteration (or it gets added via arc endpoints)
    if (i === 0 && !closed) {
      out.push({ x: p1.x, z: p1.z });
    }
    
    // Vector from p1 to p2
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    
    if (len < 0.01) continue;
    
    // If this point has a radius and there's a next segment, add rounded corner
    if (radius > 0.1 && p3) {
      // Vector from p2 to p3
      const dx2 = p3.x - p2.x;
      const dz2 = p3.z - p2.z;
      const len2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);
            
      if (len2 > 0.01) {
        // Clamp radius to not exceed segment lengths
        // Use 0.49 (just under 50%) so the two arcs at adjacent corners never overlap.
        const maxRadius = Math.min(len * 0.49, len2 * 0.49);
        const clampedRadius = Math.min(radius, maxRadius);
                
        // Normalized direction vectors
        const dir1X = dx / len;
        const dir1Z = dz / len;
        const dir2X = dx2 / len2;
        const dir2Z = dz2 / len2;
        
        // Point before the arc starts (on the p1->p2 segment)
        const beforeX = p2.x - dir1X * clampedRadius;
        const beforeZ = p2.z - dir1Z * clampedRadius;
        out.push({ x: beforeX, z: beforeZ });
        
        // Point after the arc ends (on the p2->p3 segment)
        const afterX = p2.x + dir2X * clampedRadius;
        const afterZ = p2.z + dir2Z * clampedRadius;
        
        // Calculate the arc center
        // The center is perpendicular to both segments at distance determined by the angle
        const angle1 = Math.atan2(dir1Z, dir1X);
        const angle2 = Math.atan2(dir2Z, dir2X);
        
        let angleDiff = angle2 - angle1;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        
        // For a circular arc, calculate the center point
        const halfAngle = angleDiff / 2;
        const centerDist = clampedRadius / Math.sin(Math.abs(halfAngle));
        const bisectorAngle = angle1 + halfAngle;
        
        // Center is perpendicular to the bisector (flipped to cut the corner, not bulge out)
        const perpAngle = bisectorAngle + (angleDiff > 0 ? Math.PI/2 : -Math.PI/2);
        const centerX = p2.x + Math.cos(perpAngle) * centerDist;
        const centerZ = p2.z + Math.sin(perpAngle) * centerDist;
        
        // Generate arc points
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
        // Next segment too short, just add the point
        out.push({ x: p2.x, z: p2.z });
      }
    } else {
      // No radius or last point, just add it
      if (!closed || i < numSegments - 1) {
        out.push({ x: p2.x, z: p2.z });
      }
    }
  }
  
  return out;
}

/**
 * PolyWall — builds terrain-following WallSegments along a polyline of world-space points.
 */
export class PolyWall {
  /**
   * @param {object} feature  - track feature of type "polyWall"
   * @param {Track}  track    - used to sample terrain height at each segment
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(feature, track, scene, shadows) {
    this.segments = [];
    this._feature = feature;   // stored so the editor can identify this wall
    const { height, thickness, friction = 0.1, closed = false } = feature;
    const rawPoints = feature.points;
    if (!rawPoints || rawPoints.length < 2) return;

    const points = expandPolyline(rawPoints, closed);
    const numPoints = points.length;
    const edgeCount = closed ? numPoints : numPoints - 1;

    for (let i = 0; i < edgeCount; i++) {
      const p0 = points[i];
      const p1 = points[(i + 1) % numPoints];

      const dx     = p1.x - p0.x;
      const dz     = p1.z - p0.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      if (length < 0.01) continue;

      // heading: matches the convention used by StraightWall (cos(h)=dx/len, -sin(h)=dz/len)
      const heading = Math.atan2(-dz, dx);

      // Sub-segment so each piece is ~4 units long (terrain-following)
      const numSegs = Math.max(1, Math.round(length / 4));
      const segLen  = length / numSegs;
      const dirX    = dx / length;
      const dirZ    = dz / length;

      // How far below the lowest sampled terrain point to extend the box
      const SKIRT = 2;

      for (let s = 0; s < numSegs; s++) {
        const t       = (s + 0.5) * segLen;
        const px      = p0.x + dirX * t;
        const pz      = p0.z + dirZ * t;

        // Sample terrain at both ends of this segment
        const half = segLen / 2;
        const yA = track.getHeightAt(px - dirX * half, pz - dirZ * half);
        const yB = track.getHeightAt(px + dirX * half, pz + dirZ * half);

        // Parallelogram: each end matches its local terrain height
        const avgY    = (yA + yB) / 2;
        const totalH  = height + SKIRT;
        const centerY = avgY + (height - SKIRT) / 2;
        const yShiftA = (yA - yB) / 2;   // vertical offset at −X (start) end
        const yShiftB = (yB - yA) / 2;   // vertical offset at +X (end) end

        // Tiny overlap prevents gaps between segments
        const segW = segLen * 1.02;
        this.segments.push(
          new WallSegment(px, pz, centerY, segW, totalH, thickness,
            heading, friction, this.segments.length, "wall_poly", scene, shadows,
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
