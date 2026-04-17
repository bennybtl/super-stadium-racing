/**
 * TelemetryPlayer
 *
 * Loads a telemetry JSON file produced by TelemetryRecorder and reconstructs
 * a flat array of world-space waypoints with embedded speed targets:
 *
 *   [ { x, z, speed }, … ]
 *
 * This array can be passed directly to AIDriver as its path, replacing the
 * A*-generated path. AIDriver uses the `speed` field for throttle/brake
 * decisions instead of the generic curvature-scan heuristic.
 *
 * Reconstruction is checkpoint-relative: world position for a sample is
 *   lerp(cp[from].pos, cp[to].pos, sample.t)  +  rightVec * sample.lateral
 * so the path adapts automatically when checkpoints move.
 */
export class TelemetryPlayer {
  /**
   * Attempt to load telemetry for the given track.
   * Returns a TelemetryPlayer instance; call buildWaypoints() to get the path.
   *
   * @param {string}   trackId     — track key matching the recorded file
   * @param {object[]} checkpoints — [{x, z, index, heading}, …] sorted by index
   */
  constructor(trackId, checkpoints) {
    this.trackId = trackId;
    this.checkpoints = checkpoints;
    this._telemetry = null;
  }

  /**
   * Load telemetry from a plain JS object (already parsed JSON).
   * @param {object} json
   */
  loadFromObject(json) {
    if (!json || json.trackId !== this.trackId) {
      console.warn(`[TelemetryPlayer] trackId mismatch: expected "${this.trackId}", got "${json?.trackId}"`);
      return false;
    }
    this._telemetry = json;
    console.log(`[TelemetryPlayer] Loaded telemetry for "${this.trackId}": ` +
      `${json.segments.length} segments, ` +
      `${json.segments.reduce((n, s) => n + s.samples.length, 0)} samples.`);
    return true;
  }

  /** Whether telemetry data is loaded and ready. */
  get isLoaded() { return this._telemetry !== null; }

  /**
   * Reconstruct world-space waypoints from the loaded telemetry.
   * Returns null if no telemetry is loaded.
   *
   * @returns {{ x: number, z: number, speed: number }[] | null}
   */
  buildWaypoints() {
    if (!this._telemetry) return null;

    const waypoints = [];
    const cps = this.checkpoints;

    for (const seg of this._telemetry.segments) {
      const fromCp = cps[seg.fromCheckpoint % cps.length];
      const toCp   = cps[seg.toCheckpoint   % cps.length];

      if (!fromCp || !toCp) continue;

      // Axis vector from→to
      const axDx = toCp.x - fromCp.x;
      const axDz = toCp.z - fromCp.z;
      const axLen = Math.sqrt(axDx * axDx + axDz * axDz);

      // Right-perpendicular unit vector (CW 90°)
      const rightX = axLen > 0.001 ? axDz / axLen : 0;
      const rightZ = axLen > 0.001 ? -axDx / axLen : 0;

      for (const sample of seg.samples) {
        const wx = fromCp.x + axDx * sample.t + rightX * sample.lateral;
        const wz = fromCp.z + axDz * sample.t + rightZ * sample.lateral;
        waypoints.push({
          x:     parseFloat(wx.toFixed(3)),
          z:     parseFloat(wz.toFixed(3)),
          speed: sample.speed,
          grip:  sample.grip ?? 1,
        });
      }
    }

    console.log(`[TelemetryPlayer] Built ${waypoints.length} world-space waypoints.`);
    return waypoints.length > 0 ? waypoints : null;
  }
}
