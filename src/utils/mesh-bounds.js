import { Vector3 } from "@babylonjs/core";

/**
 * Union bounding box of a set of meshes, in their own (model) space.
 *
 * Used to find the repeat pitch when a unit mesh is cloned into a stack —
 * e.g. the decorations' scaffold arch (lib/ScaffoldArch.js) and the obstacle
 * system's stackable tire pile (objects/Obstacle.js) — so the spacing (and,
 * for a stack resting on the ground, the offset so unit 0 sits at y=0) comes
 * straight from the model's own geometry rather than a hand-tuned constant.
 */
export function unitSizeOf(meshes) {
  let min = null;
  let max = null;
  for (const m of meshes) {
    if (!m.getTotalVertices || m.getTotalVertices() === 0) continue;
    const bb = m.getBoundingInfo?.().boundingBox;
    if (!bb) continue;
    if (!min) {
      min = bb.minimum.clone();
      max = bb.maximum.clone();
    } else {
      min = Vector3.Minimize(min, bb.minimum);
      max = Vector3.Maximize(max, bb.maximum);
    }
  }
  if (!min) return { x: 1, y: 1, minY: 0 };
  return {
    x: (max.x - min.x) || 1,
    y: (max.y - min.y) || 1,
    minY: min.y,
  };
}
