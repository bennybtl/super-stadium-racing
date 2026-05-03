/**
 * Expand a polyline by rounding corners at each interior point.
 *
 * Each point may carry an optional `radius` property. If a uniform radius is
 * needed for all corners, map the points beforehand:
 *   points.map(p => ({ ...p, radius: myRadius }))
 *
 * @param {Array<{x: number, z: number, radius?: number}>} points
 * @param {boolean} closed  Whether the polyline wraps back to the first point.
 * @returns {Array<{x: number, z: number}>}
 */
export function expandPolyline(points, closed = false) {
  if (points.length < 2) return points;

  const out = [];
  const numSegments = closed ? points.length : points.length - 1;

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
        const maxRadius = Math.min(len * 0.45, len2 * 0.45);
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
        const perpAngle = bisectorAngle + (angleDiff > 0 ? Math.PI / 2 : -Math.PI / 2);
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
          out.push({ x: centerX + Math.cos(angle) * arcRadius, z: centerZ + Math.sin(angle) * arcRadius });
        }
      } else {
        // Next segment too short, just add the point
        out.push({ x: p2.x, z: p2.z });
      }
    } else {
      // No radius — always add p2. For closed loops this includes the wrap-around
      // point on the last iteration (p2 = points[0]) so the loop closes correctly.
      out.push({ x: p2.x, z: p2.z });
    }
  }

  return out;
}
