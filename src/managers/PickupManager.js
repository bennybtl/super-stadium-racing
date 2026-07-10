import { Pickup, PICKUP_MAX_TORUS_DIAMETER } from "../objects/Pickup.js";
import { TerrainQuery } from "./TerrainQuery.js";

// =============================================================================
// Tunable constants
// =============================================================================

/** Horizontal distance (m) at which a truck collects a pickup. */
const COLLECT_RADIUS = PICKUP_MAX_TORUS_DIAMETER * 1.5;

/** Half-extent of the random spawn area in world units (no-zone fallback only).
 *  The full track ground is 160×160, so 65 keeps pickups inside the visible surface. */
const SPAWN_HALF_EXTENT = 65;

/** Minimum distance (m) between any two randomly-placed pickup spawn points. */
const MIN_PICKUP_DIST = 10;

/** Chance that an empty spawn zone spawns a pickup when a truck completes a lap. */
const LAP_SPAWN_CHANCE = 0.5;
/** Per-tier chance to bump a lap pickup's value up (capped by the lap number). */
const VALUE_UPGRADE_CHANCE = 0.5;
/** Highest nitro multiplier a pickup can award. */
const MAX_PICKUP_VALUE = 3;
/** Cap on pickups active on the track at once (keeps late-race laps from flooding it). */
const MAX_ACTIVE_PICKUPS = 6;


// =============================================================================

/**
 * PickupManager — spawns collectable nitro as trucks complete laps and handles
 * per-frame collection detection + callbacks.
 *
 * Pickups appear at the track's "pickupSpawn" action zones (each empty zone
 * rolls independently per completed lap); their value scales with the lap
 * (1x/2x/3x). Collecting a pickup removes it, freeing its zone to refill later.
 *
 * Usage:
 *   const pm = new PickupManager(scene, track, shadows);
 *   pm.onPickupCollected = (type, truckData, value) => { ... };
 *   pm.update(trucks, dt);    // each frame
 *   pm.spawnForLap(lapCount);  // when any truck completes a lap
 *   pm.clearAll();             // on race reset
 */
export class PickupManager {
  constructor(scene, track, shadows, audioManager = null) {
    this.scene   = scene;
    this.track   = track;
    this.shadows = shadows;
    this._terrainQuery = new TerrainQuery(scene);

    /** @type {Pickup[]} */
    this._pickups = [];

    /**
     * Assigned by the owning mode. Called with (type, truckData, value)
     * whenever a truck drives through a pickup.
     * @type {((type: string, truckData: object, value: number) => void) | null}
     */
    this.onPickupCollected = null;

    /** @type {import('./AudioManager.js').AudioManager|null} */
    this.audioManager = audioManager;
  }

  setAudioManager(audioManager) {
    this.audioManager = audioManager;
  }

  // ── Spawn-position helpers ──────────────────────────────────────────────────

  /** Scatter `count` positions randomly across the track (no-zone fallback). */
  _generatePositionsRandom(count) {
    const positions  = [];
    let attempts     = 0;
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

  _pointInZone(x, z, zone) {
    if (zone?.shape === 'polygon' && Array.isArray(zone.points) && zone.points.length >= 3) {
      let inside = false;
      const pts = zone.points;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x;
        const zi = pts[i].z;
        const xj = pts[j].x;
        const zj = pts[j].z;
        const intersects = ((zi > z) !== (zj > z))
          && (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-8) + xi);
        if (intersects) inside = !inside;
      }
      return inside;
    }
    const dx = x - (zone?.x ?? 0);
    const dz = z - (zone?.z ?? 0);
    const r = Math.max(0, zone?.radius ?? 0);
    return (dx * dx + dz * dz) <= r * r;
  }

  _randomPointInZone(zone) {
    if (zone?.shape === 'polygon' && Array.isArray(zone.points) && zone.points.length >= 3) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of zone.points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }

      for (let i = 0; i < 30; i++) {
        const x = minX + Math.random() * (maxX - minX);
        const z = minZ + Math.random() * (maxZ - minZ);
        if (this._pointInZone(x, z, zone)) return { x, z };
      }

      // Fallback: polygon centroid
      let sx = 0, sz = 0;
      for (const p of zone.points) {
        sx += p.x;
        sz += p.z;
      }
      return { x: sx / zone.points.length, z: sz / zone.points.length };
    }

    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (zone?.radius ?? 0);
    return {
      x: (zone?.x ?? 0) + Math.cos(angle) * r,
      z: (zone?.z ?? 0) + Math.sin(angle) * r,
    };
  }

  // ── Per-frame ─────────────────────────────────────────────────────────────

  /**
   * Animate pickups and test for collection by any truck.
   * Call once per frame after trucks have moved.
   * @param {object[]} trucks  - array of truckData objects ({ truck, ... }) or raw Truck instances
   * @param {number}   dt      - frame delta time (seconds)
   */
  update(trucks, dt) {
    let anyCollected = false;

    for (const pickup of this._pickups) {
      pickup.update(dt);
      if (!pickup.isVisible || pickup._collected) continue;

      for (const truckData of trucks) {
        const truck = truckData.truck ?? truckData;
        if (!truck.mesh) continue;

        const tp = truck.mesh.position;
        const pp = pickup.position;
        const dx = tp.x - pp.x;
        const dz = tp.z - pp.z;

        if (Math.sqrt(dx * dx + dz * dz) < COLLECT_RADIUS) {
          pickup.setVisible(false);
          pickup._collected = true;
          anyCollected = true;
          if (pickup.type === 'boost' && truckData?.isPlayer) {
            truck.audioController?.playReload?.();
            if (!truck.audioController) {
              this.audioManager?.playSound('reload');
            }
          }
          // Lap-spawned pickups are one-time: collecting removes them (a new one
          // appears when a truck completes another lap).
          this.onPickupCollected?.(pickup.type, truckData, pickup.value);
          break; // only one truck can collect per pickup per frame
        }
      }
    }

    if (anyCollected) {
      for (const p of this._pickups) if (p._collected) p.dispose();
      this._pickups = this._pickups.filter(p => !p._collected);
    }
  }

  // ── Lap-triggered spawning ─────────────────────────────────────────────────

  /**
   * When a truck completes a lap, each empty "pickupSpawn" zone independently
   * rolls to spawn a pickup (value scaled to the lap, up to MAX_PICKUP_VALUE).
   * Tracks with no zones fall back to a single track-wide roll.
   * @param {number} lapCount - the lap the truck just completed
   * @returns {Pickup[]} the pickups spawned this lap
   */
  spawnForLap(lapCount) {
    const zones = (this.track?.features ?? []).filter(
      f => f.type === 'actionZone' && f.zoneType === 'pickupSpawn'
    );

    // No authored zones: fall back to a single track-wide roll at a random spot.
    if (zones.length === 0) {
      if (Math.random() < LAP_SPAWN_CHANCE && this._pickups.length < MAX_ACTIVE_PICKUPS) {
        const [pos] = this._generatePositionsRandom(1);
        if (pos) return [this._spawnPickup(pos, lapCount)];
      }
      return [];
    }

    const spawned = [];
    for (const zone of zones) {
      if (this._pickups.length >= MAX_ACTIVE_PICKUPS) break;
      if (this._zoneOccupied(zone)) continue;
      if (Math.random() >= LAP_SPAWN_CHANCE) continue;
      const pos = this._randomPointInZone(zone);
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) continue;
      spawned.push(this._spawnPickup(pos, lapCount));
    }
    if (spawned.length) {
      console.debug(`[Pickup] lap ${lapCount}: spawned ${spawned.length} (${spawned.map(p => p.value + 'x').join(', ')})`);
    }
    return spawned;
  }

  /** True if an active pickup already sits inside `zone`. */
  _zoneOccupied(zone) {
    return this._pickups.some(p => this._pointInZone(p.position.x, p.position.z, zone));
  }

  /** Create a pickup at `pos` with a lap-scaled value and track it. */
  _spawnPickup(pos, lapCount) {
    const value = this._rollValue(lapCount);
    const groundY = this._terrainQuery.heightAt(pos.x, pos.z);
    const pickup = new Pickup(pos.x, pos.z, groundY, 'boost', this.scene, this.shadows, value);
    this._pickups.push(pickup);
    return pickup;
  }

  /** Value 1..min(lapCount, MAX), each step gated by an upgrade roll. */
  _rollValue(lapCount) {
    const cap = Math.max(1, Math.min(lapCount, MAX_PICKUP_VALUE));
    let value = 1;
    while (value < cap && Math.random() < VALUE_UPGRADE_CHANCE) value++;
    return value;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /** Remove every active pickup (used on race reset). */
  clearAll() {
    this._pickups.forEach(p => p.dispose());
    this._pickups = [];
  }
}
