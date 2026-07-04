import { MeshBuilder, Vector3 } from "@babylonjs/core";
import { TRUCK_WIDTH, TRUCK_HEIGHT, TRUCK_DEPTH } from "../constants.js";
import { TruckBody } from "../truck/TruckBody.js";

// Shortest signed angular difference from `a` to `b` (handles wraparound), so
// heading interpolation never spins the long way around at the ±π seam.
function angleDelta(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * Replays a recorded best lap as a translucent truck puppet. Position is a pure
 * function of elapsed lap time via update(ms, dt): the caller drives it from the
 * current lap clock, so playback speed is frame-rate independent and re-showing
 * a hidden ghost resumes at the correct spot rather than a frozen index.
 */
export class GhostPlayer {
  constructor(scene, frames, { dims = null, vehicleDef = null } = {}) {
    this.scene = scene;
    this.frames = frames ?? [];
    this._cursor = 0;

    // Invisible box stands in for the physics box the puppet parents to.
    this._root = MeshBuilder.CreateBox("ghostRoot", {
      width:  dims?.width  ?? TRUCK_WIDTH,
      height: dims?.height ?? TRUCK_HEIGHT,
      depth:  dims?.depth  ?? TRUCK_DEPTH,
    }, scene);
    this._root.isVisible = false;
    this._root.isPickable = false;
    this._root.rotationQuaternion = null;

    this._body = new TruckBody(this._root, scene, null, {}, vehicleDef, { ghost: true });
    this._state = { heading: 0, velocity: new Vector3(), suspensionCompression: 0, currentRoll: 0 };
    this._noInput = { left: false, right: false, forward: false, back: false };
  }

  /**
   * Position + animate the ghost at lap-elapsed time `ms` (dt for wheel spin).
   */
  update(ms, dt) {
    if (this.frames.length === 0) return;
    const lastT = this.frames[this.frames.length - 1].t;
    // Clamp: once the player's lap outlasts the ghost, freeze it at the finish.
    const t = Math.max(0, Math.min(ms, lastT));

    if (t < this.frames[this._cursor].t) this._cursor = 0;
    while (this._cursor < this.frames.length - 1 && this.frames[this._cursor + 1].t <= t) {
      this._cursor++;
    }
    const a = this.frames[this._cursor];
    const b = this.frames[Math.min(this._cursor + 1, this.frames.length - 1)];
    const span = b.t - a.t;
    const alpha = span > 0 ? (t - a.t) / span : 0;

    this._root.position.set(
      a.x + (b.x - a.x) * alpha,
      a.y + (b.y - a.y) * alpha,
      a.z + (b.z - a.z) * alpha,
    );
    const heading = a.h + angleDelta(a.h, b.h) * alpha;
    this._root.rotation.y = heading;

    // Synthesize just enough motion state to spin the wheels believably.
    const spanSec = span / 1000;
    if (spanSec > 0) {
      this._state.velocity.set((b.x - a.x) / spanSec, (b.y - a.y) / spanSec, (b.z - a.z) / spanSec);
    } else {
      this._state.velocity.setAll(0);
    }
    this._state.heading = heading;
    const speed = Math.hypot(this._state.velocity.x, this._state.velocity.z);
    this._body.update(this._state, this._noInput, speed, dt, null, 0, null);
  }

  /** Swap in a new recorded lap without rebuilding the puppet. */
  setFrames(frames) {
    this.frames = frames ?? [];
    this._cursor = 0;
  }

  setVisible(v) {
    this._root.setEnabled(v);
  }

  dispose() {
    this._body?.dispose();
    this._root?.dispose();
    this._body = null;
    this._root = null;
  }
}
