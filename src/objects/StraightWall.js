import { WallSegment } from "./WallSegment.js";

/**
 * StraightWall — builds terrain-following WallSegments for a straight wall feature.
 */
export class StraightWall {
  /**
   * @param {object} feature  - track feature of type "wall"
   * @param {Track}  track    - used to sample terrain height at each segment
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(feature, track, scene, shadows) {
    this.segments = [];
    const segCount = feature.segments ?? Math.max(1, Math.round(feature.length / 4));
    const segLength = feature.length / segCount;
    const friction  = feature.friction ?? 0.1;

    // Direction the wall face runs along in world space
    const dirX = Math.cos(feature.heading);
    const dirZ = -Math.sin(feature.heading);

    // How far below the lowest sampled terrain point to extend the box
    const SKIRT = 2;

    for (let i = 0; i < segCount; i++) {
      const offset = -feature.length / 2 + (i + 0.5) * segLength;
      const px = feature.centerX + dirX * offset;
      const pz = feature.centerZ + dirZ * offset;
      const groundY = track.getHeightAt(px, pz);

      // Sample terrain at both ends of this segment to find the lowest point
      const half = segLength / 2;
      const yA = track.getHeightAt(px - dirX * half, pz - dirZ * half);
      const yB = track.getHeightAt(px + dirX * half, pz + dirZ * half);
      const bottomY   = Math.min(groundY, yA, yB) - SKIRT;
      const topY      = groundY + feature.height;
      const totalH    = topY - bottomY;
      const centerY   = bottomY + totalH / 2;

      // Tiny overlap (1.02×) prevents gaps between adjacent segments
      const segW = segLength * 1.02;
      this.segments.push(
        new WallSegment(px, pz, centerY, segW, totalH, feature.thickness,
          feature.heading, friction, this.segments.length, "wall", scene, shadows)
      );
    }
  }

  dispose() {
    for (const seg of this.segments) seg.dispose();
    this.segments = [];
  }
}
