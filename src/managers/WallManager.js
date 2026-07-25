import { PolyWall } from "../objects/PolyWall.js";
import { PolyCurb } from "../objects/PolyCurb.js";

/**
 * WallManager - Creates and manages race track walls (poly).
 *
 * Wall construction and disposal is delegated to the object classes in
 * src/objects/. This manager spawns walls from track features and owns their
 * reset/dispose lifecycle. Truck-vs-wall collision is resolved by
 * StaticBodyCollisionManager (wall segments opt in via `truckCollider`
 * metadata); this manager also exposes wall/curb descriptors for AI pathing.
 */
export class WallManager {
  constructor(scene, track, shadows) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;

    // Wall objects (PolyWall)
    this._walls = [];

    // Curb objects (PolyCurb) — stored separately so they are never included
    // in _segments and therefore never trigger velocity-cancellation logic.
    // Trucks can freely drive over curbs; their visual presence comes from
    // the WallSegment boxes with alternating red/white material.
    this._curbs = [];
  }

  // ─── Convenience getter — flat list of all WallSegment instances ─────────
  get _segments() {
    return this._walls.flatMap(w => w.segments);
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
   * Returns an array of { x, z, halfLength, heading } descriptors for every
   * wall segment so AIDriver can mark those grid cells as blocked.
   */
  getWallSegments() {
    return this._segments.map(seg => ({
      x: seg.position.x,
      z: seg.position.z,
      halfLength: seg.halfLength,
      halfDepth:  seg.halfThick,
      heading:    seg.heading,
    }));
  }
  /**
   * Returns an array of { x, z, halfLength, halfDepth, heading } descriptors
   * for every curb segment so AIDriver treats polycurbs as pathfinding
   * obstacles.  Curbs are intentionally excluded from _segments (trucks can
   * drive over them physically) but they mark the track limits that the AI
   * should route around.
   */
  getCurbSegments() {
    return this._curbs.flatMap(curb =>
      curb.segments.map(seg => ({
        x:          seg.position.x,
        z:          seg.position.z,
        halfLength: seg.halfLength,
        halfDepth:  seg.halfThick,
        heading:    seg.heading,
      }))
    );
  }
  // ─── Private helpers ─────────────────────────────────────────────────────

  dispose() {
    for (const wall of this._walls) wall.dispose();
    this._walls = [];
    for (const curb of this._curbs) curb.dispose();
    this._curbs = [];
  }
}
