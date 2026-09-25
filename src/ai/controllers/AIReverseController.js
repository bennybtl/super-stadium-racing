export const DEFAULT_REVERSE_CONFIG = {
  // Throttle held with forward speed below this (units/s) counts as pressing
  // into something.
  pressMaxSpeed: 1.0,
  // How long the AI presses before it gives up and backs out (ms).
  pressTriggerMs: 600,
  // Reverse at least this long so the truck actually clears the obstacle (ms).
  minReverseMs: 700,
  // Hard cap on one reverse maneuver (ms).
  maxReverseMs: 1800,
  // Stop reversing once the nose is within this angle of the target (rad).
  alignedAngle: Math.PI / 6,
  // Ignore new presses for this long after a maneuver so the truck can
  // build speed going forward again (ms).
  cooldownMs: 800,
  // Heading error that reaches full steering lock while reversing (rad).
  fullLockAngle: Math.PI / 4,
};

/**
 * AIReverseController
 *
 * Backs the truck out when it's pressing into a wall/obstacle, steering so the
 * nose swings toward the look-ahead target, then hands control back.
 * AIStuckRecoveryController's respawn remains the last resort.
 */
export class AIReverseController {
  constructor(config = {}) {
    this.config = { ...DEFAULT_REVERSE_CONFIG, ...config };
    this.reset();
  }

  reset() {
    this.active = false;
    this._pressMs = 0;
    this._reverseMs = 0;
    this._cooldownMs = 0;
  }

  /**
   * Returns an input override while reversing, otherwise null.
   * `input` is the normal forward-driving input computed this tick.
   */
  update({ dt, input, fwdSpeed, position, heading, target, brakingToStop }) {
    const c = this.config;
    const dtMs = dt * 1000;

    // Signed nose→target angle: positive = target is to the right.
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const tx = target.x - position.x, tz = target.z - position.z;
    const angle = Math.atan2(tx * fz - tz * fx, tx * fx + tz * fz);

    if (!this.active) {
      if (this._cooldownMs > 0) {
        this._cooldownMs -= dtMs;
        this._pressMs = 0;
        return null;
      }
      const pressing = input.forward && fwdSpeed < c.pressMaxSpeed;
      this._pressMs = pressing ? this._pressMs + dtMs : 0;
      if (this._pressMs < c.pressTriggerMs) return null;
      this.active = true;
      this._pressMs = 0;
      this._reverseMs = 0;
    }

    this._reverseMs += dtMs;
    const aligned = Math.abs(angle) < c.alignedAngle;
    if (this._reverseMs >= c.maxReverseMs || (this._reverseMs >= c.minReverseMs && aligned)) {
      this.active = false;
      this._cooldownMs = c.cooldownMs;
      return null;
    }

    // Reversing, the nose swings opposite the wheels, so steer away from the
    // target to rotate toward it. (Controls also flips yaw by velocity sign;
    // this command is already in "reverse" terms, so AIDriver skips its flip.)
    const steer = -Math.max(-1, Math.min(1, angle / c.fullLockAngle));
    // Controls won't start reversing while latched in brake-to-stop; release
    // `back` for a tick to clear the latch.
    const back = !(brakingToStop && Math.abs(fwdSpeed) < 0.3);
    return {
      forward: false,
      back,
      left: steer < 0,
      right: steer > 0,
      steer,
      brake: 1,
    };
  }
}
