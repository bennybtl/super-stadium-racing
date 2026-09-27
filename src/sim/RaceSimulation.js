import {
  OutOfBoundsTracker, getActionZones, applySlowZones, applySpeedBoostZones,
  respawnTruck, respawnAtLastCheckpoint,
} from "./race-rules.js";
import { stepRubberBandMultiplier } from "../ai/RubberBand.js";

/**
 * RaceSimulation — the rules-and-physics side of a race, with no UI, audio,
 * camera or rendering. RaceMode drives it in the browser; a headless server
 * can drive the same class (docs/MULTIPLAYER.md, Phase 1).
 *
 * Owns the race state (sim clock, start, finish order, DNF grace, end) and runs
 * one fixed step via `step(dt, inputsById)`: truck physics, collisions, zones,
 * out-of-bounds, obstacles, pickups, checkpoints/laps, AI rubber-banding.
 * Trucks are RaceMode's truckData entries `{ id, truck, gameState, isPlayer,
 * hasStarted, lapStartTime, gridSlot, name }`.
 *
 * Anything the presentation reacts to comes out through `events` callbacks
 * (all optional), fired synchronously inside step()/reset():
 *   onRaceStart()                          race clock started
 *   onStartLine(td, pos)                   a truck crossed start/finish to begin lap 1
 *   onCheckpoint(td, index, count, pos)    mid-lap gate passed
 *   onLap(td, lapCount, lapTime)           lap completed (ms)
 *   onFinish(td, totalTime)                truck finished (ms)
 *   onOutOfBounds(td, remainingSec|null)   countdown tick (null = not counting)
 *   onRaceEnd(finishOrder)                 everyone finished or the DNF grace ran out
 */

// After the first finisher, the rest of the field gets this long to finish.
export const DNF_GRACE_MS = 45_000;
// AI last-known terrain grip (telemetry speed scaling), sampled at 10 Hz —
// cuts redundant per-step terrain lookups with minimal behaviour change.
const AI_GRIP_SAMPLE_INTERVAL_MS = 100;
export const NO_INPUT = Object.freeze({ forward: false, back: false, left: false, right: false });

export class RaceSimulation {
  /**
   * @param {object} o
   * @param {object[]} o.trucks        truckData list (see class doc)
   * @param {object}   o.track
   * @param {object}   o.terrainManager
   * @param {object}   o.checkpointManager
   * @param {object}   o.truckCollisionManager
   * @param {object}   o.staticBodyCollisionManager
   * @param {object}   o.obstacleManager
   * @param {object}   o.pickupManager
   * @param {object[]} [o.aiDrivers]
   * @param {number}   o.totalLaps
   * @param {number}   o.maxCheckpointNumber   0 = no start/finish gate (race starts on GO)
   * @param {object}   [o.startFinishCp]
   * @param {(index: number) => { pos, heading }} o.getGridSpawn
   * @param {string}   [o.focusId]   truck the AI level-of-detail and rubber band key off
   * @param {string}   [o.rubberBandLevel]
   * @param {object}   [o.profiler]  FrameProfiler-like `{ measure(label, fn) }`
   * @param {object}   [o.events]
   */
  constructor(o) {
    Object.assign(this, {
      trucks: o.trucks,
      track: o.track,
      terrainManager: o.terrainManager,
      checkpointManager: o.checkpointManager,
      truckCollisionManager: o.truckCollisionManager,
      staticBodyCollisionManager: o.staticBodyCollisionManager,
      obstacleManager: o.obstacleManager,
      pickupManager: o.pickupManager,
      aiDrivers: o.aiDrivers ?? [],
      totalLaps: o.totalLaps,
      maxCheckpointNumber: o.maxCheckpointNumber,
      startFinishCp: o.startFinishCp ?? null,
      getGridSpawn: o.getGridSpawn,
      focusId: o.focusId ?? null,
      rubberBandLevel: o.rubberBandLevel ?? 'off',
      profiler: o.profiler ?? null,
      events: o.events ?? {},
    });

    this.slowZones = getActionZones(this.track, 'slowZone');
    this.speedBoostZones = getActionZones(this.track, 'speedBoost');
    this.outOfBoundsZones = getActionZones(this.track, 'outOfBounds');
    this._oob = new OutOfBoundsTracker();

    // Race timing runs on sim time: clockMs advances only in fixed steps, so
    // pausing, a background tab or slow frames never count against a lap.
    // startMs / each truck's lapStartTime / the DNF deadline are all on it.
    this.clockMs = 0;
    this.started = false;
    this.startMs = null;
    this.finishOrder = [];     // truckData entries in finish order
    this.dnfDeadlineMs = null; // clock time the DNF grace ends (set on first finish)
    this.ended = false;
    this._aiGripSampleElapsedMs = 0;

    this._primeCheckpoints();
  }

  get focus() {
    return this.trucks.find(td => td.id === this.focusId) ?? null;
  }

  _measure(label, fn) {
    return this.profiler ? this.profiler.measure(label, fn) : fn();
  }

  _emit(name, ...args) {
    this.events[name]?.(...args);
  }

  /** Trucks begin just before the start/finish gate, so it's the first they cross. */
  _primeCheckpoints() {
    this.trucks.forEach(td => {
      td.gameState.lastCheckpointPassed = this.maxCheckpointNumber > 0 ? this.maxCheckpointNumber - 1 : 0;
    });
  }

  // ── Race flow ──────────────────────────────────────────────────────────────

  /** Put every truck back on its grid slot, stopped. */
  placeOnGrid({ parked = false } = {}) {
    this.trucks.forEach((td, index) => {
      const { pos, heading } = this.getGridSpawn(index);
      respawnTruck(td.truck, pos, heading, this.staticBodyCollisionManager);
      // Handbrake hold: a sloped grid spot would otherwise let the truck roll
      // during the countdown, since neither AI's paused input nor the player's
      // neutral input engages any brake.
      td.truck.state.parked = parked;
    });
  }

  /** Countdown over: release the handbrakes; without a start/finish gate the
   *  race (and every lap clock) starts now. */
  go() {
    this.trucks.forEach(td => { td.truck.state.parked = false; });
    if (this.maxCheckpointNumber === 0 && !this.started) {
      this._startClock();
      this.trucks.forEach(td => { td.lapStartTime = this.clockMs; });
    }
  }

  _startClock() {
    this.started = true;
    this.startMs = this.clockMs;
    this._emit('onRaceStart');
  }

  /** Full race reset: state, grid, AI, rebuilt track colliders. */
  reset() {
    this.started = false;
    this.startMs = null;
    this.ended = false;
    this.finishOrder.length = 0;
    this.dnfDeadlineMs = null;

    // placeOnGrid uses the proper respawn path: teleportTo zeroes the physics
    // body and notifyTeleport flushes the collision manager's stale previous
    // position. A bare mesh.position assignment leaves prevPos at the truck's
    // pre-reset spot, so the swept-AABB static-collision test drags the truck
    // straight back onto the track the moment stepping resumes.
    this.placeOnGrid();
    this.trucks.forEach(td => {
      td.lapStartTime = null;
      td.gameState.reset();
      td.hasStarted = false;
      td.truck.state.rubberBandSpeedMult = 1;
    });
    this._primeCheckpoints();

    // Reset AI navigation + recovery state to match a freshly-built driver.
    // Without this the stuck-recovery and checkpoint-guidance watchers keep
    // stale state across the reset (a pending stuck-flag or gate-miss), and
    // fire a respawn the moment the countdown ends — teleporting AI trucks
    // off the grid back onto the track instead of starting them on the line.
    this.aiDrivers.forEach(d => {
      d.reset();
      d.currentCheckpointTarget = 0;
      d.lastCheckpointPassed = 0;
    });
  }

  /** Teleport a truck to the last checkpoint it physically passed; the grid
   *  spawn if it hasn't started yet. */
  respawnToLastCheckpoint(td) {
    respawnAtLastCheckpoint(td.truck, {
      lastCheckpointNumber: td.gameState.lastCheckpointPassed,
      hasStarted: td.hasStarted,
      checkpointManager: this.checkpointManager,
      track: this.track,
      staticBodyCollisionManager: this.staticBodyCollisionManager,
      fallbackCheckpoint: this.startFinishCp,
      fallbackSpawn: () => this.getGridSpawn(td.gridSlot ?? (td.isPlayer ? 0 : 1)),
    });
  }

  /** Grace since the first finish ran out: every truck still racing is
   *  finished without a time, in truck-array order. */
  _handleDNF() {
    this.trucks
      .filter(td => !td.gameState.raceFinished)
      .forEach(td => {
        td.gameState.finishRace(null); // mark finished without a time
        this.finishOrder.push(td);
        console.debug(`[RaceSimulation] DNF: ${td.name}`);
      });
    this._end();
  }

  _end() {
    if (this.ended) return;
    this.ended = true;
    this.dnfDeadlineMs = null;
    // Freeze trucks that DNF'd (still moving with no path to finish).
    this.trucks.forEach(td => {
      if (!td.gameState.raceFinished) td.truck.state.velocity.setAll(0);
    });
    this._emit('onRaceEnd', this.finishOrder);
  }

  // ── Step ───────────────────────────────────────────────────────────────────

  /**
   * One fixed step. `inputsById[id]` is that truck's input this step; missing
   * means no input. AI trucks take their input from their driver inside
   * Truck.updateSim(), and finished trucks coast with none.
   */
  step(dt, inputsById = {}) {
    const { trucks, track } = this;
    const focusPos = this.focus?.truck.mesh.position ?? null;

    this.clockMs += dt * 1000;
    if (this.dnfDeadlineMs !== null && this.clockMs >= this.dnfDeadlineMs && !this.ended) {
      this.dnfDeadlineMs = null;
      this._handleDNF();
    }

    this._measure('collision.truck.pre', () => this.truckCollisionManager.preUpdate(trucks, dt));

    this._measure('trucks.update', () => trucks.forEach((td) => {
      const input = (td.gameState.raceFinished || !td.isPlayer) ? NO_INPUT : (inputsById[td.id] ?? NO_INPUT);
      td.truck.updateSim(input, dt, this.terrainManager, track, focusPos, this.profiler);
    }));

    this._measure('collision.staticBodies', () => this.staticBodyCollisionManager.update(trucks, dt));
    this._measure('zones.slow', () => applySlowZones(trucks, this.slowZones));
    this._measure('zones.boost', () => applySpeedBoostZones(trucks, this.speedBoostZones));

    this._measure('zones.oob', () => trucks.forEach((td) => {
      const remaining = this._oob.update({
        truckId: td.id,
        truck: td.truck,
        outOfBoundsZones: this.outOfBoundsZones,
        track,
        dt,
        durationSec: td.isPlayer ? 5 : 2,
        onTimeout: () => this.respawnToLastCheckpoint(td),
      });
      this._emit('onOutOfBounds', td, remaining);
    }));

    this._measure('collision.truck.resolve', () => this.truckCollisionManager.update(trucks, dt));
    this._measure('obstacles.update', () => this.obstacleManager.update(trucks));
    this._measure('pickups.update', () => this.pickupManager.update(trucks, dt));

    // Keep each AI truck's last-known terrain grip updated for telemetry speed scaling.
    this._measure('ai.gripSample', () => {
      this._aiGripSampleElapsedMs += dt * 1000;
      if (this._aiGripSampleElapsedMs < AI_GRIP_SAMPLE_INTERVAL_MS) return;
      trucks.forEach(td => {
        if (!td.isPlayer && td.truck.driver) {
          td.truck._lastTerrainGrip = this.terrainManager.getTerrainAt(td.truck.mesh.position).gripMultiplier;
        }
      });
      this._aiGripSampleElapsedMs = 0;
    });

    this._measure('checkpoints.laps', () => trucks.forEach((td) => this._updateLaps(td)));
    this._measure('ai.rubberBand', () => this._rubberBand(dt));
  }

  /**
   * Rubber-band: nudge each AI's effective top speed toward the focus truck
   * based on race-progress gap (laps + checkpoints). The focus truck's speed is
   * never touched.
   */
  _rubberBand(dt) {
    const focus = this.focus;
    if (!focus || !this.started || this.ended || this.rubberBandLevel === 'off') return;
    const total = Math.max(1, this.checkpointManager.getTotalCheckpoints());
    const focusProgress = focus.gameState.lapCount * total + focus.gameState.checkpointCount;
    this.trucks.forEach(td => {
      if (td.isPlayer || td.gameState.raceFinished) return;
      const gs = td.gameState;
      const gapLaps = (focusProgress - (gs.lapCount * total + gs.checkpointCount)) / total;
      td.truck.state.rubberBandSpeedMult = stepRubberBandMultiplier(
        td.truck.state.rubberBandSpeedMult ?? 1,
        gapLaps,
        this.rubberBandLevel,
        dt
      );
    });
  }

  /** Checkpoint crossings for one truck: race start, lap completion, finish. */
  _updateLaps(td) {
    if (td.gameState.raceFinished) return;
    const { checkpointManager, maxCheckpointNumber, totalLaps } = this;

    const truck = td.truck;
    const result = checkpointManager.update(
      truck.mesh.position,
      truck.state.velocity,
      td.gameState.lastCheckpointPassed,
      td.id
    );
    if (!result?.passed) return;
    const pos = { x: truck.mesh.position.x, z: truck.mesh.position.z };

    // Start/finish crossing: start the race clock and reset the sequence so lap
    // flow begins at CP 1.
    if (result.index === maxCheckpointNumber && !td.hasStarted) {
      td.hasStarted = true;
      if (!this.started) this._startClock();
      td.lapStartTime = this.clockMs;
      td.gameState.lastCheckpointPassed = 0;
      td.gameState.checkpointCount = 0;
      checkpointManager.resetForTruck(td.id);
      // Notify the AI driver so it recalculates its path toward checkpoint #1.
      if (!td.isPlayer && truck.driver) truck.driver.onCheckpointPassed(maxCheckpointNumber, pos);
      this._emit('onStartLine', td, pos);
      return;
    }

    const newCount = td.gameState.incrementCheckpoint(result.index);
    if (!td.isPlayer && truck.driver) truck.driver.onCheckpointPassed(result.index, pos);
    this._emit('onCheckpoint', td, result.index, newCount, pos);

    if (newCount !== checkpointManager.getTotalCheckpoints()) return;

    // -- Lap complete --
    const lapTime = td.lapStartTime != null ? this.clockMs - td.lapStartTime : 0;
    td.lapStartTime = this.clockMs;
    const lapCount = td.gameState.completeLap(lapTime);
    checkpointManager.resetForTruck(td.id);

    // Any truck finishing a lap has a chance to spawn a pickup, more valuable
    // on later laps (up to 3x nitro).
    this.pickupManager.spawnForLap(lapCount);
    this._emit('onLap', td, lapCount, lapTime);

    if (lapCount < totalLaps) return;

    // -- Race finished for this truck --
    const totalTime = this.clockMs - this.startMs;
    td.gameState.finishRace(totalTime);
    this.finishOrder.push(td);

    // Stop the AI driver issuing further steering inputs.
    if (!td.isPlayer && truck.driver) truck.driver.paused = true;

    // The first finisher starts the DNF grace for everyone still racing.
    if (this.dnfDeadlineMs === null && !this.ended && this.finishOrder.length < this.trucks.length) {
      console.debug(`[RaceSimulation] ${td.name} finished — DNF timer started (${DNF_GRACE_MS / 1000}s)`);
      this.dnfDeadlineMs = this.clockMs + DNF_GRACE_MS;
    }
    this._emit('onFinish', td, totalTime);

    // All drivers finished — end the race immediately.
    if (this.finishOrder.length === this.trucks.length) this._end();
  }
}
