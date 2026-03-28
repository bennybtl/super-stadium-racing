import { WallSegment } from "./WallSegment.js";

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
    const { points, height, thickness, friction = 0.1 } = feature;
    if (!points || points.length < 2) return;

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];

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

      for (let s = 0; s < numSegs; s++) {
        const t       = (s + 0.5) * segLen;
        const px      = p0.x + dirX * t;
        const pz      = p0.z + dirZ * t;
        const groundY = track.getHeightAt(px, pz);

        // Tiny overlap prevents gaps between segments
        const segW = segLen * 1.02;
        this.segments.push(
          new WallSegment(px, pz, groundY, segW, height, thickness,
            heading, friction, "wall_poly", scene, shadows)
        );
      }
    }
  }

  dispose() {
    for (const seg of this.segments) seg.dispose();
    this.segments = [];
  }
}
