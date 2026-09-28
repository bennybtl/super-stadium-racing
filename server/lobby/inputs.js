/**
 * Input ingest for the lobby child — the whole anti-cheat surface, since the
 * server runs the simulation and clients only ever send inputs
 * (docs/MULTIPLAYER.md, Phase 3).
 *
 * Wire frame (client → server, one per tick):
 *   { t: tick, s: steer -1..1, g: throttle -1..1, b: boostHeld, r: respawnHeld }
 *
 * Rules:
 *   - malformed fields are normalised (non-finite → 0, analog clamped to ±1,
 *     flags coerced to booleans); a frame without an integer tick is dropped;
 *   - only ticks in [current, current + WINDOW_AHEAD] are accepted, and at most
 *     one frame per tick (the first wins). A frame for a tick already simulated
 *     is dropped — the server never rewinds, so a late input can't change
 *     anything (the plan's "- 8" slack only matters with rewind, which it
 *     rules out);
 *   - a tick with no frame repeats the last applied one — a player who stops
 *     sending keeps driving, never pauses the race;
 *   - boost and respawn are *held* flags; the race acts on their rising edge,
 *     so a repeated or extrapolated frame can't fire them twice.
 */

// Inputs may arrive up to this many ticks early (clients stamp ahead by their
// latency; the slack absorbs jitter).
export const WINDOW_AHEAD = 8;

// Analog → the truck's digital controls (throttle is on/off in the sim today).
const THROTTLE_DEADZONE = 0.1;
const STEER_DEADZONE = 0.1;

export const NEUTRAL_FRAME = Object.freeze({ s: 0, g: 0, b: false, r: false });

const clampUnit = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

/** A clean `{ t, s, g, b, r }` from untrusted data, or null without a usable tick. */
export function sanitizeFrame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw.t;
  if (!Number.isInteger(t) || t < 0) return null;
  return { t, s: clampUnit(raw.s), g: clampUnit(raw.g), b: raw.b === true, r: raw.r === true };
}

/** The truck-input object Truck.updateSim expects, from a frame. */
export function toTruckInput(frame) {
  return {
    forward: frame.g > THROTTLE_DEADZONE,
    back: frame.g < -THROTTLE_DEADZONE,
    left: frame.s < -STEER_DEADZONE,
    right: frame.s > STEER_DEADZONE,
    steer: Math.abs(frame.s) > STEER_DEADZONE ? frame.s : 0,
  };
}

/** One player's pending frames and last applied input. */
export class PlayerInputs {
  constructor() {
    this._pending = new Map(); // tick → frame
    this._last = NEUTRAL_FRAME;
    /** Last tick for which a real (not extrapolated) frame was applied; -1 = none. */
    this.lastProcessedTick = -1;
    this.rejected = { malformed: 0, stale: 0, future: 0, duplicate: 0 };
  }

  /**
   * Offer an untrusted frame at server tick `currentTick` (the next tick to be
   * simulated). Returns 'accepted' or the rejection reason.
   */
  offer(raw, currentTick) {
    const frame = sanitizeFrame(raw);
    let verdict = 'accepted';
    if (!frame) verdict = 'malformed';
    else if (frame.t < currentTick) verdict = 'stale';
    else if (frame.t > currentTick + WINDOW_AHEAD) verdict = 'future';
    else if (this._pending.has(frame.t)) verdict = 'duplicate';
    if (verdict !== 'accepted') {
      this.rejected[verdict]++;
      return verdict;
    }
    this._pending.set(frame.t, frame);
    return verdict;
  }

  /**
   * The frame to apply at `tick`: the one received for it, else the last
   * applied one. Also reports the boost/respawn rising edges.
   */
  take(tick) {
    const real = this._pending.get(tick);
    // Everything at or before this tick is spent.
    for (const t of this._pending.keys()) if (t <= tick) this._pending.delete(t);

    const prev = this._last;
    const frame = real ?? prev;
    if (real) this.lastProcessedTick = tick;
    this._last = frame;
    return {
      frame,
      extrapolated: !real,
      boostPressed: frame.b && !prev.b,
      respawnPressed: frame.r && !prev.r,
    };
  }
}
