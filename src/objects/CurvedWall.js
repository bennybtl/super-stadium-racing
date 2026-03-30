import { WallSegment } from "./WallSegment.js";

/**
 * CurvedWall — builds terrain-following WallSegments along an arc.
 */
export class CurvedWall {
  /**
   * @param {object} feature  - track feature of type "curvedWall"
   * @param {Track}  track    - used to sample terrain height at each segment
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(feature, track, scene, shadows) {
    this.segments = [];
    const { centerX, centerZ, radius, startAngle, endAngle, height, segments, thickness } = feature;
    const friction = feature.friction ?? 0.1;

    const arcSpan       = endAngle - startAngle;
    const segmentAngle  = arcSpan / segments;
    // Chord length, slightly overlapping to avoid gaps between segments
    const segmentLength = 2 * radius * Math.sin(Math.abs(segmentAngle) / 2) * 1.05;

    // How far below the lowest sampled terrain point to extend the box
    const SKIRT = 2;

    for (let i = 0; i < segments; i++) {
      const midAngle = startAngle + (i + 0.5) * segmentAngle;

      // Position on the arc (negate sin so CCW matches world Z convention)
      const px = centerX + Math.cos(midAngle) * radius;
      const pz = centerZ - Math.sin(midAngle) * radius;
      const groundY = track.getHeightAt(px, pz);

      // Sample terrain at both ends of this arc segment
      const halfA = midAngle - segmentAngle / 2;
      const halfB = midAngle + segmentAngle / 2;
      const yA = track.getHeightAt(centerX + Math.cos(halfA) * radius, centerZ - Math.sin(halfA) * radius);
      const yB = track.getHeightAt(centerX + Math.cos(halfB) * radius, centerZ - Math.sin(halfB) * radius);
      const bottomY = Math.min(groundY, yA, yB) - SKIRT;
      const topY    = groundY + height;
      const totalH  = topY - bottomY;
      const centerY = bottomY + totalH / 2;

      // Each segment faces outward from the arc centre (perpendicular to the radius)
      const heading = midAngle + Math.PI / 2;

      this.segments.push(
        new WallSegment(px, pz, centerY, segmentLength, totalH, thickness,
          heading, friction, this.segments.length, "wall_arc", scene, shadows)
      );
    }
  }

  dispose() {
    for (const seg of this.segments) seg.dispose();
    this.segments = [];
  }
}
