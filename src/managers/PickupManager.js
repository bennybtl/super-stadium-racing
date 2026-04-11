import { Pickup } from "../objects/Pickup.js";

// =============================================================================
// Tunable constants
// =============================================================================

/** Horizontal distance (m) at which a truck collects a pickup. */
const COLLECT_RADIUS = 1.8;

/** Milliseconds before a collected pickup reappears. */
const RESPAWN_DELAY_MS = 8_000;

/** Default number of pickups to scatter across the track. */
const DEFAULT_COUNT = 6;

/** Half-extent of the random spawn area in world units.
 *  The full track ground is 160×160, so 75 keeps pickups inside the visible surface. */
const SPAWN_HALF_EXTENT = 65;

/** Minimum distance (m) between any two pickup spawn points. */
const MIN_PICKUP_DIST = 14;

// =============================================================================

/**
 * PickupManager — randomly scatters collectable items across the track and
 * handles per-frame collision detection, collection callbacks and respawning.
 *
 * Usage:
 *   const pm = new PickupManager(scene, track, shadows);
 *   pm.onPickupCollected = (type, truckData) => { ... };
 *   // each frame:
 *   pm.update(trucks, dt);
 *   // on race reset:
 *   pm.rebuild();
 */
export class PickupManager {
  constructor(scene, track, shadows, count = DEFAULT_COUNT) {
    this.scene   = scene;
    this.track   = track;
    this.shadows = shadows;
    this._count  = count;

    /** @type {Pickup[]} */
    this._pickups = [];
    /** @type {ReturnType<typeof setTimeout>[]} */
    this._respawnTimers = [];

    /**
     * Assigned by the owning mode.
     * Called with (type: string, truckData: object) whenever a truck
     * drives through a pickup.
     * @type {((type: string, truckData: object) => void) | null}
     */
    this.onPickupCollected = null;

    this._spawnAll();
  }

  // ── Creation ──────────────────────────────────────────────────────────────

  _spawnAll() {
    for (const { x, z } of this._generatePositions(this._count)) {
      const groundY = this.track.getHeightAt(x, z);
      this._pickups.push(new Pickup(x, z, groundY, 'boost', this.scene, this.shadows));
    }
  }

  /** Returns up to `count` positions spaced at least MIN_PICKUP_DIST apart. */
  _generatePositions(count) {
    const positions = [];
    let attempts = 0;
    const maxAttempts = count * 40;

    while (positions.length < count && attempts < maxAttempts) {
      attempts++;
      const x = (Math.random() - 0.5) * SPAWN_HALF_EXTENT * 2;
      const z = (Math.random() - 0.5) * SPAWN_HALF_EXTENT * 2;

      const tooClose = positions.some(p => {
        const dx = p.x - x, dz = p.z - z;
        return Math.sqrt(dx * dx + dz * dz) < MIN_PICKUP_DIST;
      });
      if (!tooClose) positions.push({ x, z });
    }
    return positions;
  }

  // ── Per-frame ─────────────────────────────────────────────────────────────

  /**
   * Animate pickups and test for collection by any truck.
   * Call once per frame after trucks have moved.
   * @param {object[]} trucks  - array of truckData objects ({ truck, ... }) or raw Truck instances
   * @param {number}   dt      - frame delta time (seconds)
   */
  update(trucks, dt) {
    for (const pickup of this._pickups) {
      pickup.update(dt);
      if (!pickup.isVisible) continue;

      for (const truckData of trucks) {
        const truck = truckData.truck ?? truckData;
        if (!truck.mesh) continue;

        const tp = truck.mesh.position;
        const pp = pickup.position;
        const dx = tp.x - pp.x;
        const dz = tp.z - pp.z;

        if (Math.sqrt(dx * dx + dz * dz) < COLLECT_RADIUS) {
          pickup.setVisible(false);
          this.onPickupCollected?.(pickup.type, truckData);

          const t = setTimeout(() => pickup.setVisible(true), RESPAWN_DELAY_MS);
          this._respawnTimers.push(t);
          break; // only one truck can collect per pickup per frame
        }
      }
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  /** Cancel all pending respawn timers and make every pickup visible immediately. */
  rebuild() {
    this._respawnTimers.forEach(clearTimeout);
    this._respawnTimers = [];
    this._pickups.forEach(p => p.setVisible(true));
  }

  // ── Disposal ──────────────────────────────────────────────────────────────

  dispose() {
    this._respawnTimers.forEach(clearTimeout);
    this._respawnTimers = [];
    this._pickups.forEach(p => p.dispose());
    this._pickups = [];
  }
}
