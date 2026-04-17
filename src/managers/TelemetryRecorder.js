/**
 * TelemetryRecorder
 *
 * Records a player's lap as segment-normalised telemetry so it can later be
 * used to drive an AI truck via TelemetryPlayer.
 *
 * Format stored per inter-checkpoint segment:
 *   {
 *     fromCheckpoint: <number>,
 *     toCheckpoint:   <number>,
 *     samples: [
 *       { t: <0-1>, lateral: <world units>, speed: <units/s> },
 *       …
 *     ]
 *   }
 *
 * Coordinates are stored relative to the straight line between the two
 * checkpoint centres so the data survives minor track edits.
 *
 *   t       — progress along cp[from]→cp[to] line (0 = at from, 1 = at to)
 *   lateral — signed perpendicular distance from that line
 *             (positive = right of the direction of travel, negative = left)
 *   speed   — forward speed in world units per second at the moment of sampling
 */
export class TelemetryRecorder {
  /**
   * @param {string}   trackId     — unique track key (e.g. "Sidewinder")
   * @param {object[]} checkpoints — [{x, z, index, heading}, …] sorted by index
   * @param {number}   [sampleIntervalMs=100] — how often to capture a sample
   */
  constructor(trackId, checkpoints, sampleIntervalMs = 100) {
    this.trackId = trackId;
    this.checkpoints = checkpoints; // sorted by index
    this.sampleIntervalMs = sampleIntervalMs;

    this.recording = false;
    this._segments = [];       // completed segments
    this._currentSegment = null;
    this._sampleTimer = 0;
    this._currentCheckpointIndex = 0; // which CP the player is heading toward
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Begin recording. Call once the race/lap starts. */
  start(firstCheckpointTarget = 0) {
    this.recording = true;
    this._segments = [];
    this._sampleTimer = 0;
    this._currentCheckpointIndex = firstCheckpointTarget;
    this._openSegment(firstCheckpointTarget);
    console.log(`[TelemetryRecorder] Recording started for "${this.trackId}"`);
  }

  /** Stop recording without saving. */
  stop() {
    this.recording = false;
    this._currentSegment = null;
    console.log('[TelemetryRecorder] Recording stopped.');
  }

  /**
   * Call every frame from the game loop while recording.
   * @param {object} position  — {x, z} world position of the truck
   * @param {number} fwdSpeed  — forward speed (units/s), may be negative
   * @param {number} deltaMs   — frame time in milliseconds
   * @param {number} [grip=1]  — current terrainGripMultiplier from truck.update() debug info
   */
  update(position, fwdSpeed, deltaMs, grip = 1) {
    if (!this.recording || !this._currentSegment) return;

    this._sampleTimer += deltaMs;
    if (this._sampleTimer < this.sampleIntervalMs) return;
    this._sampleTimer -= this.sampleIntervalMs;

    this._captureSample(position, fwdSpeed, grip);
  }

  /**
   * Notify the recorder that the player passed a checkpoint.
   * @param {number} checkpointIndex — the index of the checkpoint just passed
   * @param {object} position        — {x, z} world position at the moment of passing
   * @param {number} fwdSpeed
   * @param {number} [grip=1]        — terrainGripMultiplier at the moment of passing
   */
  onCheckpointPassed(checkpointIndex, position, fwdSpeed, grip = 1) {
    if (!this.recording) return;

    // Close the current segment with a final sample right at the checkpoint
    this._captureSample(position, fwdSpeed, grip);
    if (this._currentSegment) {
      this._segments.push(this._currentSegment);
    }

    // Open a new segment heading to the next checkpoint
    const nextIndex = (checkpointIndex + 1) % this.checkpoints.length;
    this._currentCheckpointIndex = nextIndex;
    this._openSegment(nextIndex);
  }

  /**
   * Finalise recording and return the telemetry object, or null if no data.
   * Also triggers a JSON download in the browser.
   * @returns {object|null}
   */
  export() {
    if (this._segments.length === 0) {
      console.warn('[TelemetryRecorder] Nothing to export.');
      return null;
    }

    const telemetry = {
      trackId: this.trackId,
      recordedAt: new Date().toISOString(),
      checkpointCount: this.checkpoints.length,
      segments: this._segments,
    };

    // Trigger browser download
    const blob = new Blob([JSON.stringify(telemetry, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telemetry_${this.trackId}.json`;
    a.click();
    URL.revokeObjectURL(url);

    console.log(`[TelemetryRecorder] Exported ${this._segments.length} segments, ` +
      `${this._segments.reduce((n, s) => n + s.samples.length, 0)} total samples.`);

    return telemetry;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _openSegment(toCheckpointIndex) {
    const fromIndex = (toCheckpointIndex - 1 + this.checkpoints.length) % this.checkpoints.length;
    this._currentSegment = {
      fromCheckpoint: fromIndex,
      toCheckpoint: toCheckpointIndex,
      samples: [],
    };
    this._sampleTimer = 0;
  }

  _captureSample(position, fwdSpeed, grip = 1) {
    const seg = this._currentSegment;
    if (!seg) return;

    const from = this.checkpoints[seg.fromCheckpoint];
    const to   = this.checkpoints[seg.toCheckpoint];

    // Vector from→to (the segment axis)
    const axDx = to.x - from.x;
    const axDz = to.z - from.z;
    const axLen = Math.sqrt(axDx * axDx + axDz * axDz);

    let t = 0;
    let lateral = 0;

    if (axLen > 0.001) {
      // Unit vector along the axis
      const axUx = axDx / axLen;
      const axUz = axDz / axLen;
      // Right-perpendicular (rotated 90° CW)
      const rightX = axUz;
      const rightZ = -axUx;

      // Vector from the 'from' checkpoint to the truck
      const dx = position.x - from.x;
      const dz = position.z - from.z;

      t       = Math.max(0, (dx * axUx + dz * axUz) / axLen);
      lateral = dx * rightX + dz * rightZ;
    }

    seg.samples.push({
      t:       parseFloat(t.toFixed(4)),
      lateral: parseFloat(lateral.toFixed(3)),
      speed:   parseFloat(Math.max(0, fwdSpeed).toFixed(2)),
      grip:    parseFloat(grip.toFixed(3)),
    });
  }
}
