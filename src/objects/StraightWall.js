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

    for (let i = 0; i < segCount; i++) {
      const offset = -feature.length / 2 + (i + 0.5) * segLength;
      const px = feature.centerX + dirX * offset;
      const pz = feature.centerZ + dirZ * offset;
      const groundY = track.getHeightAt(px, pz);

      // Tiny overlap (1.02×) prevents gaps between adjacent segments
      const segW = segLength * 1.02;
      this.segments.push(
        new WallSegment(px, pz, groundY, segW, feature.height, feature.thickness,
          feature.heading, friction, "wall", scene, shadows)
      );
    }
  }

  dispose() {
    for (const seg of this.segments) seg.dispose();
    this.segments = [];
  }
}
