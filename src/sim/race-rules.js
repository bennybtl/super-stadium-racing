import { Vector3 } from "@babylonjs/core";
import { TRUCK_HALF_HEIGHT } from "../constants.js";
import { isPointInPolygon } from "../utils/polyline-utils.js";

/**
 * Race rules that act on truck state — action zones, out-of-bounds, respawn.
 * Pure (no UI, audio or rendering) so the same rules run in the browser and in
 * a headless race (see RaceSimulation, docs/MULTIPLAYER.md). DriveMode's
 * methods of the same names delegate here.
 *
 * `trucks` arguments accept Truck instances or truckData objects with `.truck`.
 */

/** Action-zone features of one `zoneType` (slowZone, outOfBounds, speedBoost, fireworks). */
export function getActionZones(track, zoneType) {
  return track.features.filter(f => f.type === "actionZone" && f.zoneType === zoneType);
}

export function isPointInActionZone(x, z, zone) {
  if (!zone) return false;

  if (zone.shape === 'polygon' && Array.isArray(zone.points)) {
    return isPointInPolygon(x, z, zone.points);
  }

  const cx = zone.x ?? 0;
  const cz = zone.z ?? 0;
  const r = Math.max(0, zone.radius ?? 0);
  const dx = x - cx;
  const dz = z - cz;
  return (dx * dx + dz * dz) < r * r;
}

/** Clamp speed for trucks inside any slow zone. */
export function applySlowZones(trucks, slowZones) {
  if (!slowZones || slowZones.length === 0) return;

  for (const truckOrData of trucks) {
    const truck = truckOrData?.truck ?? truckOrData;
    if (!truck?.mesh || !truck?.state) continue;

    const pos = truck.mesh.position;
    const zone = slowZones.find(z => isPointInActionZone(pos.x, pos.z, z));

    truck.state.slowZoneActive = zone;
    if (!zone) continue;

    // slowStrength is the slow *amount* on a 0-10 scale (UI shows it ×10 as a
    // %): higher = slower. Cap the truck that fraction below its own top speed,
    // so a low strength barely slows and a high one forces a crawl.
    const slowFraction = Math.min(1, (zone.slowStrength ?? 3) / 10);
    const limit = truck.state.maxSpeed * (1 - slowFraction);

    if (truck.state.velocity.length() > limit) {
      truck.state.velocity.normalize().scaleInPlace(limit);
    }
  }
}

/**
 * Arm a timed speed boost on any truck inside a speed-boost zone. The boost
 * re-arms each step while inside, then lingers for `boostDuration` seconds
 * after the truck leaves (a boost-pad feel). Strength scales top speed and
 * acceleration.
 */
export function applySpeedBoostZones(trucks, boostZones) {
  if (!boostZones || boostZones.length === 0) return;

  for (const truckOrData of trucks) {
    const truck = truckOrData?.truck ?? truckOrData;
    if (!truck?.mesh || !truck?.state) continue;

    const pos = truck.mesh.position;
    const zone = boostZones.find(z => isPointInActionZone(pos.x, pos.z, z));
    if (!zone) continue;

    const strength = Math.max(1, zone.boostStrength ?? 1.5);
    truck.state.speedBoostActive = true;
    truck.state.speedBoostTimer = Math.max(0.05, zone.boostDuration ?? 1.5);
    truck.state.speedBoostSpeedMult = strength;
    // Acceleration gets a slightly punchier multiplier so the truck actually
    // reaches the raised top speed within the boost window.
    truck.state.speedBoostAccelMult = 1 + (strength - 1) * 1.5;
  }
}

export function isOutsideTrackBounds(x, z, track) {
  if (!track) return false;
  const halfWidth = (track.width ?? 0) / 2;
  const halfDepth = (track.depth ?? 0) / 2;
  return Math.abs(x) > halfWidth || Math.abs(z) > halfDepth;
}

/**
 * Per-truck out-of-bounds countdowns. A truck inside an out-of-bounds zone (or
 * past the track edge, when the track opts into `oobDeadSpace`) counts down;
 * at zero `onTimeout` fires (the caller respawns it) and the truck is immune
 * for a short grace so it can't re-trigger straight away.
 *
 * Runs on the time it is given: the grace counts down in the same `dt` steps
 * as the countdown, so pausing never eats into it.
 */
export class OutOfBoundsTracker {
  constructor() {
    this._stateById = new Map();
  }

  /**
   * Advance one truck's countdown. Returns remaining seconds (float) while
   * active, or null when inactive.
   */
  update({
    truckId,
    truck,
    outOfBoundsZones,
    track,
    dt,
    durationSec = 5,
    graceSecAfterRespawn = 1.5,
    onTimeout,
  }) {
    if (!truck?.mesh) return null;
    // Dead-space bounds are an opt-in per-track setting; explicit out-of-bounds
    // zones always apply. Bail early only when neither source is active.
    const deadSpaceEnabled = track?.oobDeadSpace === true;
    if (!outOfBoundsZones?.length && !deadSpaceEnabled) return null;

    let state = this._stateById.get(truckId);
    if (!state) {
      state = { remainingSec: durationSec, immuneSec: 0 };
      this._stateById.set(truckId, state);
    }

    const pos = truck.mesh.position;
    const inExplicitZone = outOfBoundsZones?.some(z => isPointInActionZone(pos.x, pos.z, z)) ?? false;
    // When enabled for the track, leaving the track perimeter (the dead space)
    // also counts as out of bounds.
    const inTrackDeadSpace = deadSpaceEnabled && isOutsideTrackBounds(pos.x, pos.z, track);

    if (state.immuneSec > 0) {
      state.immuneSec = Math.max(0, state.immuneSec - dt);
      state.remainingSec = durationSec;
      return null;
    }

    if (!inExplicitZone && !inTrackDeadSpace) {
      state.remainingSec = durationSec;
      return null;
    }

    state.remainingSec = Math.max(0, state.remainingSec - dt);
    if (state.remainingSec <= 0) {
      onTimeout?.();
      state.remainingSec = durationSec;
      state.immuneSec = graceSecAfterRespawn;
      return null;
    }

    return state.remainingSec;
  }
}

/**
 * Teleport a truck to a position/heading and flush the collision manager's
 * stale prevPos so the swept-AABB broadphase doesn't treat the teleport as
 * a wall-crossing trajectory. Use this for every respawn.
 */
export function respawnTruck(truck, position, heading, staticBodyCollisionManager) {
  truck.teleportTo(position, heading);
  staticBodyCollisionManager?.notifyTeleport(truck);
}

/**
 * Resolve the start/finish gate from a (possibly reversed) CheckpointManager.
 * The gate with the highest checkpointNumber is the finish; its heading already
 * reflects the traversal direction (reverse rebuilds flip it), so spawning
 * behind it works for both forward and reverse. Returns null if unnumbered.
 */
export function getStartFinishCheckpoint(checkpointManager) {
  const numbered = checkpointManager.checkpointMeshes
    .map(cp => cp.feature)
    .filter(f => f.checkpointNumber != null);
  if (numbered.length === 0) return null;
  return numbered.reduce(
    (max, f) => (f.checkpointNumber > max.checkpointNumber ? f : max),
    numbered[0],
  );
}

/**
 * Teleport `truck` back to the last checkpoint it physically cleared: the
 * nearest gate carrying `lastCheckpointNumber` (so an alternative branch lands
 * on the gate the truck actually took), the start/finish line before the
 * first checkpoint, or `fallbackSpawn()` when the truck hasn't started or
 * nothing resolves. Gates come from the CheckpointManager, not raw track
 * features, so reverse races (flipped headings, renumbered sequence) work.
 *
 * @param {object} truck  a Truck instance
 * @param {object} o
 * @param {number}   o.lastCheckpointNumber
 * @param {boolean}  o.hasStarted
 * @param {object}   o.checkpointManager
 * @param {object}   o.track                     (for getHeightAt)
 * @param {object}   o.staticBodyCollisionManager
 * @param {object}   [o.fallbackCheckpoint]      used when no gate is numbered
 * @param {() => { pos: Vector3, heading: number }} o.fallbackSpawn
 */
export function respawnAtLastCheckpoint(truck, {
  lastCheckpointNumber, hasStarted, checkpointManager, track,
  staticBodyCollisionManager, fallbackCheckpoint = null, fallbackSpawn,
}) {
  const toSpawn = () => {
    const { pos, heading } = fallbackSpawn();
    respawnTruck(truck, pos, heading, staticBodyCollisionManager);
  };
  if (!hasStarted) return toSpawn();

  let cpFeature;
  if (lastCheckpointNumber > 0) {
    const gates = checkpointManager.checkpointMeshes
      .map(cp => cp.feature)
      .filter(f => f.checkpointNumber === lastCheckpointNumber);
    const px = truck.mesh.position.x;
    const pz = truck.mesh.position.z;
    cpFeature = gates.reduce((best, g) => {
      if (!best) return g;
      const bd = (best.centerX - px) ** 2 + (best.centerZ - pz) ** 2;
      const gd = (g.centerX - px) ** 2 + (g.centerZ - pz) ** 2;
      return gd < bd ? g : best;
    }, null);
  } else {
    cpFeature = getStartFinishCheckpoint(checkpointManager) ?? fallbackCheckpoint;
  }

  if (!cpFeature) return toSpawn();
  const y = track.getHeightAt(cpFeature.centerX, cpFeature.centerZ) + TRUCK_HALF_HEIGHT;
  respawnTruck(
    truck,
    new Vector3(cpFeature.centerX, y, cpFeature.centerZ),
    cpFeature.heading,
    staticBodyCollisionManager,
  );
}
