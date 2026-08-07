import { PolyWall } from "../objects/PolyWall.js";
import { PolyCurb } from "../objects/PolyCurb.js";

/**
 * WallManager - Creates and manages race track walls (poly).
 *
 * Wall construction and disposal is delegated to the object classes in
 * src/objects/. This manager spawns walls from track features and owns their
 * reset/dispose lifecycle. Truck-vs-wall collision is resolved by
 * StaticBodyCollisionManager (walls opt in via `polylineCollider` metadata on
 * their ribbon); this manager also exposes wall/curb descriptors for AI
 * pathing, derived from the same centerlines.
 */
export class WallManager {
  constructor(scene, track, shadows) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;

    // Wall objects (PolyWall)
    this._walls = [];

    // Curb objects (PolyCurb) — trucks can freely drive over curbs, so these
    // carry no truck collider; they only matter for AI track limits.
    this._curbs = [];
  }

  createPolyWall(feature) {
    this._walls.push(new PolyWall(feature, this.track, this.scene, this.shadows));
  }

  createPolyCurb(feature) {
    this._curbs.push(new PolyCurb(feature, this.track, this.scene, this.shadows));
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  reset() {
    this.dispose();
  }

  rebuild() {
    this.reset();
    for (const feature of this.track.features) {
      if (feature.type === "polyWall")   this.createPolyWall(feature);
      if (feature.type === "polyCurb")   this.createPolyCurb(feature);
    }
  }

  // ─── AI Helpers ──────────────────────────────────────────────────────────

  /**
   * Returns an array of { x, z, halfLength, halfDepth, heading } descriptors
   * chorded along every wall centerline so AIDriver can mark those grid cells
   * as blocked.
   */
  getWallSegments() {
    return this._walls.flatMap(w => this._colliderDescriptors(w.collider, 4));
  }
  /**
   * Same descriptors for curbs so AIDriver treats polycurbs as pathfinding
   * obstacles. Curbs have no truck collider (trucks can drive over them
   * physically) but they mark the track limits that the AI should route around.
   */
  getCurbSegments() {
    return this._curbs.flatMap(c => this._colliderDescriptors(c.collider, 2));
  }

  /** Chord a centerline collider into oriented-box descriptors of ~targetLen. */
  _colliderDescriptors(collider, targetLen) {
    if (!collider) return [];
    const { xs, zs, halfThick, closed, step } = collider;
    const n = xs.length;
    if (n < 2) return [];

    const stride = Math.max(1, Math.round(targetLen / (step || targetLen)));
    const segCount = closed ? n : n - 1;
    const out = [];
    for (let a = 0; a < segCount; a += stride) {
      const b = a + stride >= segCount ? (closed ? 0 : n - 1) : a + stride;
      const dx = xs[b] - xs[a];
      const dz = zs[b] - zs[a];
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      out.push({
        x: (xs[a] + xs[b]) / 2,
        z: (zs[a] + zs[b]) / 2,
        halfLength: len / 2,
        halfDepth: halfThick,
        heading: Math.atan2(-dz, dx),
      });
    }
    return out;
  }
  // ─── Private helpers ─────────────────────────────────────────────────────

  dispose() {
    for (const wall of this._walls) wall.dispose();
    this._walls = [];
    for (const curb of this._curbs) curb.dispose();
    this._curbs = [];
  }
}
