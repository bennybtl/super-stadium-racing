import { Pickup, PICKUP_MAX_TORUS_DIAMETER } from "../objects/Pickup.js";
import { TerrainQuery } from "./TerrainQuery.js";

// =============================================================================
// Tunable constants
// =============================================================================

/** Horizontal distance (m) at which a truck collects a pickup. */
const COLLECT_RADIUS = PICKUP_MAX_TORUS_DIAMETER * 1.5;

/** Milliseconds before a collected pickup reappears. */
const RESPAWN_DELAY_MS = 10_000;

/** Default number of pickups to scatter across the track. */
const DEFAULT_COUNT = 6;

/** Half-extent of the random spawn area in world units.
 *  The full track ground is 160×160, so 75 keeps pickups inside the visible surface. */
const SPAWN_HALF_EXTENT = 65;

/** Minimum distance (m) between any two pickup spawn points. */
const MIN_PICKUP_DIST = 10;
// const COIN_VALUES = [100, 200, 300, 400, 500];
// const COIN_SPAWN_CHANCE = 0.35;


// =============================================================================

/**
 * PickupManager — randomly scatters collectable items across the track and
 * handles per-frame collision detection, collection callbacks and respawning.
 *
 * Usage:
 *   const pm = new PickupManager(scene, track, shadows);
 *   pm.onPickupCollected = (type, truckData, payload) => { ... };
 *   // each frame:
 *   pm.update(trucks, dt);
 *   // on race reset:
 *   pm.rebuild();
 */
export class PickupManager {
  constructor(scene, track, shadows, count = DEFAULT_COUNT, audioManager = null) {
    this.scene   = scene;
    this.track   = track;
    this.shadows = shadows;
    this._count  = count;
    this._terrainQuery = new TerrainQuery(scene);

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

    /** @type {import('./AudioManager.js').AudioManager|null} */
    this.audioManager = audioManager;

    this._spawnAll();
  }

  setAudioManager(audioManager) {
    this.audioManager = audioManager;
  }

  // ── Creation ──────────────────────────────────────────────────────────────

  _spawnAll() {
    for (const { x, z } of this._generatePositions(this._count)) {
      const groundY = this._terrainQuery.heightAt(x, z);
      this._pickups.push(new Pickup(x, z, groundY, this._pickType(), this.scene, this.shadows));
    }
  }

  _pickType() {
    // Coins were the (removed) season economy; only boosts spawn now.
    // return Math.random() < COIN_SPAWN_CHANCE ? 'coin' : 'boost';
    return 'boost';
  }

  /**
   * Returns up to `count` positions spaced at least MIN_PICKUP_DIST apart.
   * If the track has one or more "pickupSpawn" action zones, exactly one
   * pickup position is generated per zone feature; otherwise the full track
   * surface is used with the requested count.
   */
  _generatePositions(count) {
    if (count <= 0) return [];

    const spawnZones = (this.track?.features ?? []).filter(
      f => f.type === 'actionZone' && f.zoneType === 'pickupSpawn'
    );

    return spawnZones.length > 0
      ? this._generateOnePositionPerZone(spawnZones)
      : this._generatePositionsRandom(count);
  }

  /** Scatter positions randomly across the whole track surface (legacy fallback). */
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

  /**
   * Generate one spawn position per action-zone feature.
   * This ensures polygon zones do not create extra pickups based on point count.
   */
  _generateOnePositionPerZone(zones) {
    const positions = [];
    for (const zone of zones) {
      let chosen = null;

      // Try a few candidate points to keep zone pickups reasonably separated.
      for (let i = 0; i < 24; i++) {
        const candidate = this._randomPointInZone(zone);
        if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.z)) continue;

        const tooClose = positions.some(p => {
          const dx = p.x - candidate.x;
          const dz = p.z - candidate.z;
          return Math.sqrt(dx * dx + dz * dz) < MIN_PICKUP_DIST;
        });
        if (!tooClose) {
          chosen = candidate;
          break;
        }
      }

      // Fallback to any valid sample so each zone still contributes one pickup.
      if (!chosen) {
        for (let i = 0; i < 12; i++) {
          const candidate = this._randomPointInZone(zone);
          if (Number.isFinite(candidate.x) && Number.isFinite(candidate.z)) {
            chosen = candidate;
            break;
          }
        }
      }

      if (chosen) positions.push(chosen);
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
          if (pickup.type === 'boost' && truckData?.isPlayer) {
            truck.audioController?.playReload?.();
            if (!truck.audioController) {
              this.audioManager?.playSound('reload');
            }
          }
          // let payload = undefined;
          // if (pickup.type === 'coin') {
          //   payload = {
          //     credits: COIN_VALUES[Math.floor(Math.random() * COIN_VALUES.length)],
          //     position: { x: pp.x, y: pp.y, z: pp.z },
          //   };
          // }
          // this.onPickupCollected?.(pickup.type, truckData, payload);
          this.onPickupCollected?.(pickup.type, truckData);

          const t = setTimeout(() => pickup.setVisible(true), RESPAWN_DELAY_MS);
          this._respawnTimers.push(t);
          break; // only one truck can collect per pickup per frame
        }
      }
    }
  }

  // ── Reset & Lifecycle ──────────────────────────────────────────────────

  /** Randomly spawn `count` items across the track, replacing any existing items. */
  spawn(count = this._count) {
    this.dispose();
    this._count = count;
    this._spawnAll();
  }

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
