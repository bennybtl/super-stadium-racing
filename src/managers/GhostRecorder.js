// Ghost data schema version. Bump when the frame shape changes so stale
// localStorage ghosts from an older format are rejected on load.
export const GHOST_SCHEMA_VERSION = 2;

// Sample the ghost at a fixed rate rather than once per rendered frame. This
// bounds the stored size and, together with the per-frame timestamp, decouples
// playback speed from the display refresh rate (a lap recorded at 120fps plays
// back correctly at 60fps and vice-versa).
const SAMPLE_INTERVAL_MS = 1000 / 30; // 30 Hz

const round2 = (v) => Math.round(v * 100) / 100;   // ~cm precision
const round3 = (v) => Math.round(v * 1000) / 1000; // rad

/**
 * Records a truck's world position/heading over a lap as timestamped samples.
 * Frames are `{ t, x, y, z, h }` where `t` is milliseconds since start().
 */
export class GhostRecorder {
  constructor(sampleIntervalMs = SAMPLE_INTERVAL_MS) {
    this.sampleIntervalMs = sampleIntervalMs;
    this.frames = [];
    this.recording = false;
    this._elapsedMs = 0;
    this._sinceSampleMs = 0;
  }

  /** Milliseconds elapsed on the current recording (the live lap time). */
  get elapsedMs() { return this._elapsedMs; }

  start() {
    this.frames = [];
    this.recording = true;
    this._elapsedMs = 0;
    this._sinceSampleMs = 0;
  }

  record(position, heading, dtMs) {
    if (!this.recording) return;
    // Always capture the first sample at t=0, then throttle to the sample rate.
    if (this.frames.length === 0 || this._sinceSampleMs >= this.sampleIntervalMs) {
      this._sinceSampleMs = 0;
      this.frames.push({
        t: Math.round(this._elapsedMs),
        x: round2(position.x),
        y: round2(position.y),
        z: round2(position.z),
        h: round3(heading),
      });
    }
    this._elapsedMs += dtMs;
    this._sinceSampleMs += dtMs;
  }

  stop() {
    this.recording = false;
    return this.frames.length > 0 ? this.frames : null;
  }

  reset() {
    this.frames = [];
    this.recording = false;
    this._elapsedMs = 0;
    this._sinceSampleMs = 0;
  }
}
