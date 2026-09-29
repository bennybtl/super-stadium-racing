import { SIM_DT } from "../modes/fixed-step.js";
import { applySlowZones, applySpeedBoostZones, getActionZones } from "../sim/race-rules.js";
import { NEUTRAL_FRAME, toTruckInput } from "../sim/input-frame.js";

/**
 * Client-side prediction for the player's own truck (docs/MULTIPLAYER.md,
 * Phase 6).
 *
 * Each tick the client sends input for, it also simulates that tick locally —
 * the per-truck part of RaceSimulation.step (truck physics, wall collisions,
 * slow / speed-pad zones, nitro on the button's rising edge) with the same
 * input mapping (sim/input-frame.js) and the same seeded roughness stream as
 * the server — and records the full truck state. When a snapshot for tick t
 * arrives it's compared with the recorded state for t; if they differ, the
 * truck is rewound to t, set to the server's values, and the stored inputs
 * t+1…now are replayed.
 *
 * Mispredictions come from what isn't simulated here — other trucks, obstacle
 * hits, pickups, out-of-bounds and requested respawns — and from input the
 * server didn't get in time (it repeats the last frame; so does this). The
 * server stays the authority: nothing predicted is ever sent.
 */

// Differences below these are float noise, not a misprediction.
const POS_TOLERANCE = 0.01;      // m
const HEADING_TOLERANCE = 0.002; // rad
const SPEED_TOLERANCE = 0.05;    // m/s
// Keep this much history; a snapshot older than that can't be reconciled and
// the truck is simply reset to it.
const HISTORY_TICKS = 120;
// Never replay more than this many ticks in one go (the plan's ~200 ms cap
// is for rewind *depth*; half a second covers bad connections).
const MAX_REPLAY_TICKS = 30;
// A correction is blended out on screen over roughly this long, so a small
// one reads as a nudge, not a pop. Bigger than this is a respawn: just cut.
const SMOOTH_SEC = 0.1;
const SMOOTH_MAX_DIST = 3;

export class Prediction {
  /**
   * @param {object} o
   * @param {object} o.truck                      the player's Truck
   * @param {object} o.track
   * @param {object} o.terrainManager
   * @param {object} o.staticBodyCollisionManager a client-side one for this truck alone
   */
  constructor({ truck, track, terrainManager, staticBodyCollisionManager }) {
    this.truck = truck;
    this.track = track;
    this.terrainManager = terrainManager;
    this.collisions = staticBodyCollisionManager;
    this.slowZones = getActionZones(track, "slowZone");
    this.speedBoostZones = getActionZones(track, "speedBoost");
    this._td = [{ truck }];

    this.goTick = null;
    this.finished = false;
    this.boosts = 0;              // nitros left, as predicted
    this.lastTick = null;         // newest predicted tick
    this._inputs = new Map();     // tick → frame sent for it
    this._history = new Map();    // tick → { sim, boosts, frame }
    this._lastFrame = NEUTRAL_FRAME;

    // Diagnostics (debug overlay / console).
    this.stats = { corrections: 0, lastError: 0, replayed: 0, resets: 0 };
    // What a correction moved the truck by, still being blended out on screen.
    this._offset = { x: 0, y: 0, z: 0, h: 0 };
  }

  /** Remember the frames sent for these ticks ([[tick, frame], …]). */
  recordInputs(frames) {
    for (const [t, frame] of frames) this._inputs.set(t, frame);
  }

  get started() {
    return this.lastTick !== null;
  }

  /**
   * First snapshot of our truck: adopt the server's state at tick `t` and
   * predict forward from there.
   */
  start(snap, t) {
    this._adopt(snap);
    this.lastTick = t;
    this._record(t);
  }

  /**
   * Simulate every tick up to `tick` (inclusive) not yet predicted. `frameFor`
   * gives the frame sent for a tick; a tick with none repeats the previous
   * frame — as the server does for a missing input.
   */
  predictTo(tick, frames = []) {
    this.recordInputs(frames);
    if (!this.started) return;
    for (let t = this.lastTick + 1; t <= tick; t++) this._step(t);
    this.lastTick = Math.max(this.lastTick, tick);
    this._prune();
  }

  /**
   * A snapshot of our truck at tick `t`. Returns the position error found
   * (0 when the prediction held).
   */
  reconcile(snap, t) {
    if (!this.started) return 0;
    if ((snap.flags & 4) !== 0) this.finished = true;
    const h = this._history.get(t);
    if (!h) {
      if (t <= this.lastTick) {
        // Older than our history: can't compare, so take the server's word.
        this.stats.resets++;
        this._adopt(snap);
        this.lastTick = t;
        this._history.clear();
        this._record(t);
      }
      return 0;
    }
    const s = h.sim;
    const err = Math.hypot(s.position.x - snap.x, s.position.y - snap.y, s.position.z - snap.z);
    const dh = Math.abs(Math.atan2(Math.sin(s.state.heading - snap.h), Math.cos(s.state.heading - snap.h)));
    const v = s.state.velocity;
    const dv = Math.hypot(v.x - snap.vx, v.y - snap.vy, v.z - snap.vz);
    if (err < POS_TOLERANCE && dh < HEADING_TOLERANCE && dv < SPEED_TOLERANCE && h.boosts === snap.n) return 0;

    // Rewind to t with the server's values over our own internals, then replay.
    const before = this._history.get(this.lastTick)?.sim;
    this.truck.restoreSimState(s);
    this._adopt(snap);
    this._lastFrame = h.frame;
    this._record(t);
    const end = Math.min(this.lastTick, t + MAX_REPLAY_TICKS);
    for (let k = t + 1; k <= end; k++) this._step(k);
    this.lastTick = end;
    this.stats.corrections++;
    this.stats.lastError = err;
    this.stats.replayed = end - t;

    // Show the jump as a short glide rather than a pop.
    const after = this._history.get(this.lastTick)?.sim;
    if (before && after) {
      const o = this._offset;
      const dx = before.position.x - after.position.x;
      const dy = before.position.y - after.position.y;
      const dz = before.position.z - after.position.z;
      if (Math.hypot(dx, dz) < SMOOTH_MAX_DIST) {
        o.x += dx; o.y += dy; o.z += dz;
        o.h += Math.atan2(Math.sin(before.state.heading - after.state.heading), Math.cos(before.state.heading - after.state.heading));
      } else {
        o.x = o.y = o.z = o.h = 0;
      }
    }
    return err;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  // The truck mesh is sim state; like FixedStepLoop, the rendered pose is put
  // on it after stepping and taken back off before the next frame's steps.

  /** Put the newest predicted (sim) pose back on the mesh. Call before stepping. */
  restorePose() {
    const h = this._history.get(this.lastTick)?.sim;
    if (!h) return;
    this.truck.mesh.position.copyFrom(h.position);
    this.truck.mesh.rotation.copyFrom(h.rotation);
  }

  /**
   * Show the truck `alpha` (0..1) of the way from the previous predicted tick
   * to the newest, plus what's left of any correction being blended out.
   */
  present(alpha, dt) {
    const cur = this._history.get(this.lastTick)?.sim;
    if (!cur) return;
    const prev = this._history.get(this.lastTick - 1)?.sim ?? cur;
    const o = this._offset;
    const k = Math.exp(-dt / SMOOTH_SEC);
    o.x *= k; o.y *= k; o.z *= k; o.h *= k;
    const lerp = (a, b) => a + (b - a) * alpha;
    const lerpAngle = (a, b) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * alpha;
    const mesh = this.truck.mesh;
    mesh.position.set(
      lerp(prev.position.x, cur.position.x) + o.x,
      lerp(prev.position.y, cur.position.y) + o.y,
      lerp(prev.position.z, cur.position.z) + o.z,
    );
    mesh.rotation.set(
      lerpAngle(prev.rotation.x, cur.rotation.x),
      lerpAngle(prev.rotation.y, cur.rotation.y) + o.h,
      lerpAngle(prev.rotation.z, cur.rotation.z),
    );
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** One tick of the per-truck rules, in RaceSimulation.step's order. */
  _step(tick) {
    const truck = this.truck;
    const st = truck.state;
    const racing = this.goTick !== null && tick >= this.goTick;
    const frame = this._inputs.get(tick) ?? this._lastFrame;
    const prev = this._lastFrame;
    this._lastFrame = frame;

    // Server: grid handbrake until GO (sim.go() runs before GO's step), and no
    // controls then or once finished.
    st.parked = !racing;
    const applied = racing && !this.finished ? frame : NEUTRAL_FRAME;
    if (racing && !this.finished && frame.b && !prev.b && this.boosts > 0 && !st.boostActive) {
      this.boosts--;
      st.boostActive = true;
      st.boostTimer = st.boostDuration;
    }

    truck.updateSim(toTruckInput(applied), SIM_DT, this.terrainManager, this.track, null, null);
    this.collisions.update(this._td, SIM_DT);
    applySlowZones(this._td, this.slowZones);
    applySpeedBoostZones(this._td, this.speedBoostZones);
    this._record(tick);
  }

  _record(tick) {
    this._history.set(tick, { sim: this.truck.captureSimState(), boosts: this.boosts, frame: this._lastFrame });
  }

  /** Set our truck to a snapshot's authoritative values. */
  _adopt(snap) {
    const truck = this.truck;
    const st = truck.state;
    truck.mesh.position.set(snap.x, snap.y, snap.z);
    truck.mesh.rotation.y = snap.h;
    st.heading = snap.h;
    st.velocity.set(snap.vx, snap.vy, snap.vz);
    st.flightPitch = snap.p ?? st.flightPitch;
    st.terrainRoll = snap.rl ?? st.terrainRoll;
    st.boostActive = (snap.flags & 2) !== 0;
    st.boostTimer = snap.bt ?? 0;
    st.speedBoostActive = (snap.flags & 8) !== 0;
    st.speedBoostTimer = snap.sbt ?? 0;
    st.noDriveTimer = snap.nd ?? 0;
    st.noSteerTimer = snap.ns ?? 0;
    st.suspensionCompression = snap.sc ?? st.suspensionCompression;
    this.boosts = snap.n ?? this.boosts;
    truck.driftPhysics.updateRoll(truck.mesh);
    truck.syncPhysicsBody();
    // The wall sweep starts from here, not from wherever we'd predicted.
    this.collisions.notifyTeleport(truck);
  }

  _prune() {
    const oldest = this.lastTick - HISTORY_TICKS;
    for (const t of this._history.keys()) if (t < oldest) this._history.delete(t);
    for (const t of this._inputs.keys()) if (t < oldest) this._inputs.delete(t);
  }
}
