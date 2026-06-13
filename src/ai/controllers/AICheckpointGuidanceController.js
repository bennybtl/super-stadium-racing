export const DEFAULT_CHECKPOINT_GUIDANCE_CONFIG = {
  // Start steering directly through the next gate once within this distance of
  // its centre (world units). Outside this radius the normal look-ahead path
  // drives, so racing lines on long straights are unaffected.
  approachRadius: 20,
  // Aim point is placed this far PAST the gate centre (along the gate's forward
  // direction) so the steering line is pulled through the gate, not merely to it.
  throughDistance: 6,
  // Stop guiding once the truck is this far past the gate plane (it is through).
  passMargin: 0.5,
  // A plane crossing counts as a "drove around it" miss only when the lateral
  // offset is beyond the gate's half-width but still within this corridor —
  // wider crossings are unrelated traffic on the far side of the track.
  missCorridor: 25,
  // After a detected miss, wait this long (seconds) for the truck to recover on
  // its own before teleporting it back through the gate.
  graceSeconds: 2.0,
};

/**
 * AICheckpointGuidanceController
 *
 * Two cooperating behaviours that stop AI drivers from looping forever after
 * failing to physically pass a sequential checkpoint gate:
 *
 * 1. STEER-THROUGH (primary) — when approaching the next gate, override the
 *    look-ahead target with a point just past the gate centre so the truck
 *    drives through the posts instead of cutting the corner around them.
 *
 * 2. MISS-DETECT + RESPAWN (backup) — watch the next gate's plane; if the truck
 *    crosses it outside the gate width (a real "drove around it" event) and has
 *    not recovered within a short grace window, teleport it back through the gate.
 *
 * The next gate is `driver.checkpoints[driver.currentCheckpointTarget]`, kept in
 * sync with the race by `onCheckpointPassed`. All guidance is gated on proximity
 * so it never interferes with normal driving far from a gate.
 */
export class AICheckpointGuidanceController {
  constructor(driver, config = {}) {
    this.driver = driver;
    this.approachRadius = config.approachRadius ?? DEFAULT_CHECKPOINT_GUIDANCE_CONFIG.approachRadius;
    this.throughDistance = config.throughDistance ?? DEFAULT_CHECKPOINT_GUIDANCE_CONFIG.throughDistance;
    this.passMargin = config.passMargin ?? DEFAULT_CHECKPOINT_GUIDANCE_CONFIG.passMargin;
    this.missCorridor = config.missCorridor ?? DEFAULT_CHECKPOINT_GUIDANCE_CONFIG.missCorridor;
    this.graceSeconds = config.graceSeconds ?? DEFAULT_CHECKPOINT_GUIDANCE_CONFIG.graceSeconds;

    this._resetWatch();
  }

  _resetWatch() {
    this._watchGateNumber = null;
    this._prevAlong = null;
    this._missPending = false;
    this._missTimer = 0;
  }

  reset() {
    this._resetWatch();
  }

  /** The gate the AI is currently trying to pass, or null. */
  _currentGate() {
    const d = this.driver;
    if (!Array.isArray(d.checkpoints) || d.checkpoints.length === 0) return null;
    const idx = d.currentCheckpointTarget;
    if (!Number.isInteger(idx) || idx < 0 || idx >= d.checkpoints.length) return null;
    return d.checkpoints[idx];
  }

  /**
   * Steering target that pulls the truck through the next gate, or null when it
   * is too far away (let the normal look-ahead path drive) or already through.
   */
  getApproachTarget(position) {
    const gate = this._currentGate();
    if (!gate) return null;

    const dx = gate.x - position.x;
    const dz = gate.z - position.z;
    if (dx * dx + dz * dz > this.approachRadius * this.approachRadius) return null;

    const fwdX = Math.sin(gate.heading);
    const fwdZ = Math.cos(gate.heading);
    const along = (position.x - gate.x) * fwdX + (position.z - gate.z) * fwdZ;
    if (along > this.passMargin) return null; // already through the gate

    return {
      x: gate.x + fwdX * this.throughDistance,
      z: gate.z + fwdZ * this.throughDistance,
    };
  }

  /**
   * Per-tick miss watch. Detects the truck crossing the next gate's plane
   * outside its width and, after the grace window, respawns it through the gate.
   */
  update({ position, dt }) {
    const d = this.driver;
    const gate = this._currentGate();
    if (!gate) {
      this._resetWatch();
      return;
    }

    // New target gate — restart the watch for it.
    if (gate.index !== this._watchGateNumber) {
      this._watchGateNumber = gate.index;
      this._prevAlong = null;
      this._missPending = false;
      this._missTimer = 0;
    }

    const fwdX = Math.sin(gate.heading);
    const fwdZ = Math.cos(gate.heading);
    const perpX = Math.cos(gate.heading);
    const perpZ = -Math.sin(gate.heading);
    const rx = position.x - gate.x;
    const rz = position.z - gate.z;
    const along = rx * fwdX + rz * fwdZ;
    const perp = Math.abs(rx * perpX + rz * perpZ);
    const halfWidth = (gate.width ?? 10) / 2;

    // Forward plane crossing this tick, off to the side of the gate → missed.
    if (this._prevAlong !== null && this._prevAlong < 0 && along >= 0) {
      if (perp > halfWidth && perp < halfWidth + this.missCorridor) {
        this._missPending = true;
        this._missTimer = 0;
      }
    }
    this._prevAlong = along;

    if (this._missPending) {
      this._missTimer += dt;
      if (this._missTimer >= this.graceSeconds) {
        this._missPending = false;
        this._missTimer = 0;
        d._spawnRecovery?.respawnThroughGate(gate);
      }
    }
  }
}
