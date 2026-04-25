import { Vector3 } from "@babylonjs/core";

// ─── Grip / drift ────────────────────────────────────────────────────────────

/** Speed below which drift physics is skipped when NOT already drifting (avoids jitter at rest). */
const MIN_DRIFT_SPEED = 15.0;

/** Minimum speed to hold an active drift while on the throttle. */
const MIN_DRIFT_SPEED_HOLD_THROTTLE = 10.0;

/** Minimum speed to hold an active drift while coasting (off throttle, no brake).
 *  Low so the drift can bleed out naturally through grip physics rather than
 *  snapping off at an arbitrary threshold. */
const MIN_DRIFT_SPEED_HOLD_COAST = 3.0;

/** Minimum speed to hold an active drift while braking — kills it sooner. */
const MIN_DRIFT_SPEED_HOLD_BRAKE = 12.0;

/** Exponent that controls how sharply grip drops off once slip exceeds the drift threshold.
 *  Higher = grip falls faster, shorter drift, snappier recovery.
 *  Lower  = grip falls slowly, longer floaty drift. */
const SLIP_DROPOFF_RATE = 6;

/** Grip correction strength at the low end of the normal-cornering zone.
 *  Fraction of lateral speed removed per frame at zero slip — gives tight, responsive
 *  cornering well below the drift threshold.
 *  Tapers linearly down to effectiveGrip at the threshold for a seamless transition. */
const GRIP_ZONE_CORRECTION = 0.35;

/** Minimum grip factor at extreme slip angles — prevents total loss of steering authority. */
const MIN_SLIP_FACTOR = 0.09;

/** Hard ceiling on the grip value used in the drift zone.
 *  No matter how grippy a truck is, once slip exceeds the drift threshold the
 *  traction available is capped here — guaranteeing any truck can break loose
 *  and slide.  Higher truck grip still improves cornering in the normal grip zone;
 *  only the drift zone is bounded. */
const MAX_DRIFT_GRIP = 0.13;

/** Multiplier applied to reverse-direction grip so reversing corrects quickly. */
const REVERSE_GRIP_BOOST = 15;

/** Slip angle (radians) above which the truck is considered spinning out. */
const SPINOUT_SLIP_THRESHOLD = 0.6;

/** Grip multiplier below which a spin-out is confirmed (car has lost meaningful traction). */
const SPINOUT_GRIP_THRESHOLD = 0.01;

// ─── Drag ────────────────────────────────────────────────────────────────────

/** Speed below which drag is not applied. */
const MIN_DRAG_SPEED = 0.1;

/** Drag coefficient while accelerating (throttle held). */
const DRAG_ACCELERATING = 0.3;

/** Drag coefficient while coasting (no throttle, no brake). */
const DRAG_COASTING = 0.45;

/** Drag coefficient while braking (brake held). */
const DRAG_BRAKING = 0.8;

/** Drag coefficient while airborne (minimal air resistance). */
const DRAG_AIRBORNE = 0.02;

// ─── Body roll ────────────────────────────────────────────────────────────────

/** Lateral speed → roll angle scale factor. */
const ROLL_FROM_LATERAL = 0.05;

/** Turn rate → roll angle scale factor (multiplied by speed). */
const ROLL_FROM_TURNING = 0.03;

/** Maximum body roll angle in radians (~15°). */
const MAX_ROLL = 0.24;

/** Roll interpolation speed when grounded. */
const ROLL_SPEED_GROUNDED = 8;

/** Roll interpolation speed when airborne (slower recovery). */
const ROLL_SPEED_AIRBORNE = 3;

/** Pitch offset smoothing speed from weight transfer. */
const PITCH_WEIGHT_TRANSFER_SPEED = 5;

/** Pitch from throttle/brake weight transfer. */
const PITCH_FROM_WEIGHT_TRANSFER = {
  throttle: -0.1,  // rear squat / nose up
  brake:    0.1,   // nose dive
};

/**
 * Handles drift physics, grip, drag, and velocity management
 */
export class DriftPhysics {
  constructor(state) {
    this.state = state;
    this._velocityDir = new Vector3();
    this._right = new Vector3();
    this._rollRight = new Vector3();
    this._currentPitchOffset = 0;
  }

  applyGripAndDrift(speed, forward, effectiveGrip, rearTractionFactor = 1.0) {
    // Pick the appropriate minimum speed threshold.
    // When already drifting, use lower thresholds so the drift can bleed out
    // naturally through grip rather than snapping off abruptly.
    // rearTractionFactor < 1 when braking (weight forward) — use tighter hold threshold.
    const isBraking    = rearTractionFactor < 0.85;
    const isThrottling = rearTractionFactor < 1.0 && !isBraking;
    let minSpeed;
    if (this.state.isDrifting) {
      if (isBraking)       minSpeed = MIN_DRIFT_SPEED_HOLD_BRAKE;
      else if (isThrottling) minSpeed = MIN_DRIFT_SPEED_HOLD_THROTTLE;
      else                 minSpeed = MIN_DRIFT_SPEED_HOLD_COAST;
    } else {
      minSpeed = MIN_DRIFT_SPEED;
    }

    if (speed <= minSpeed) {
      // Below threshold: strip lateral velocity and clear drift state so
      // effects don't linger.
      const forwardVelocity = this.state.velocity.dot(forward);
      const vy = this.state.velocity.y;
      this.state.velocity.x = forward.x * forwardVelocity;
      this.state.velocity.z = forward.z * forwardVelocity;
      this.state.velocity.y = vy;
      this.state.slipAngle = 0;
      this.state.isDrifting = false;
      this.state.isSpinningOut = false;
      return;
    }

    // No traction correction while airborne — effectiveGrip reaches 0 when groundedness = 0
    if (effectiveGrip <= 0) return;

    const vx = this.state.velocity.x;
    const vy = this.state.velocity.y;
    const vz = this.state.velocity.z;
    const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (vLen <= 1e-6) return;
    const invVLen = 1 / vLen;
    this._velocityDir.set(vx * invVLen, vy * invVLen, vz * invVLen);

    const forwardVelocity = this.state.velocity.dot(forward);
    const isReversing = forwardVelocity < 0;

    // Slip angle: angle between velocity direction and heading direction
    const targetDot = isReversing
      ? -(forward.x * this._velocityDir.x + forward.y * this._velocityDir.y + forward.z * this._velocityDir.z)
      :  (forward.x * this._velocityDir.x + forward.y * this._velocityDir.y + forward.z * this._velocityDir.z);
    this.state.slipAngle = Math.acos(Math.max(-1, Math.min(1, targetDot)));

    // Right vector — XZ perpendicular to heading
    this._right.set(forward.z, 0, -forward.x);
    const lateralSpeed = this.state.velocity.dot(this._right);

    // Two-regime grip curve:
    //   Grip zone  (slip ≤ driftThresh): strong correction → normal cornering.
    //   Drift zone (slip > driftThresh): exponential drop-off → loose drift.
    //
    // driftGrip caps the traction used in the drift zone so that no truck —
    // regardless of grip upgrades — can self-correct fast enough to prevent sliding.
    // The grip zone taper ends at the same driftGrip value so the boundary is seamless.
    const driftGrip = Math.min(effectiveGrip, MAX_DRIFT_GRIP);
    const driftThresh = this.state.driftThreshold || 0.3;
    const excessSlip = Math.max(0, this.state.slipAngle - driftThresh);

    let gripFactor;
    if (this.state.slipAngle <= driftThresh) {
      // Grip zone: linear taper from GRIP_ZONE_CORRECTION → driftGrip
      const t = this.state.slipAngle / driftThresh; // 0 at straight-ahead, 1 at threshold
      gripFactor = GRIP_ZONE_CORRECTION * (1 - t) + driftGrip * t;
    } else {
      // Drift zone: exponential drop-off — lateral momentum carries.
      // rearTractionFactor already encodes both throttle looseness (mild) and
      // brake rear-unloading (significant), so no separate THROTTLE_LOOSE_FACTOR needed.
      gripFactor = Math.max(MIN_SLIP_FACTOR, Math.exp(-excessSlip * SLIP_DROPOFF_RATE))
                 * driftGrip;
    }

    const reverseGripBoost = isReversing ? REVERSE_GRIP_BOOST : 1;
    const gripMultiplier = gripFactor * reverseGripBoost * rearTractionFactor;

    // Apply grip as lateral-only damping.
    // Only the sideways component decays; the longitudinal (heading-aligned) speed
    // is left untouched. When grip is low (drifting) the lateral speed bleeds off
    // slowly, giving a loose, momentum-driven feel rather than a sharp snap-back.
    const newLateralSpeed = lateralSpeed * (1 - gripMultiplier);
    const velocityY = this.state.velocity.y;
    this.state.velocity.x = forward.x * forwardVelocity + this._right.x * newLateralSpeed;
    this.state.velocity.z = forward.z * forwardVelocity + this._right.z * newLateralSpeed;
    this.state.velocity.y = velocityY;

    this.state.isSpinningOut = this.state.slipAngle > SPINOUT_SLIP_THRESHOLD && gripMultiplier < SPINOUT_GRIP_THRESHOLD;
    this.state.isDrifting = this.state.slipAngle > driftThresh;
  }

  applyDrag(speed, input, deltaTime, terrainDragMultiplier, groundedness = 1) {
    if (speed > MIN_DRAG_SPEED) {
      // Minimal air resistance when airborne, full drag when grounded.
      // Three distinct ground states so releasing the brake actually matters:
      //   accelerating → light drag
      //   coasting (no input) → medium drag
      //   braking (back held) → heavy drag
      const airborne = groundedness <= 0;
      let coastingMultiplier;
      if (airborne)           coastingMultiplier = DRAG_AIRBORNE;
      else if (input.forward) coastingMultiplier = DRAG_ACCELERATING;
      else if (input.back)    coastingMultiplier = DRAG_BRAKING;
      else                    coastingMultiplier = DRAG_COASTING;
      const drag = airborne ? 1.0 : terrainDragMultiplier;
      const dragFactor = coastingMultiplier * drag * deltaTime;
      this.state.velocity.x -= this.state.velocity.x * dragFactor;
      this.state.velocity.z -= this.state.velocity.z * dragFactor;
    }
  }

  updateRoll(mesh, speed, groundedness, input, effectiveTurnSpeed, speedRatio, deltaTime) {
    // Calculate target roll based on turning
    let lateralSpeed = 0;
    let turnRate = 0;
    let rollFromLateral = 0;
    let rollFromTurning = 0;

    if (groundedness > 0.2 && speed > 1) {
      this._rollRight.set(Math.cos(this.state.heading), 0, -Math.sin(this.state.heading));
      lateralSpeed = this.state.velocity.dot(this._rollRight);

      if (input.left) turnRate = -effectiveTurnSpeed * speedRatio;
      if (input.right) turnRate = effectiveTurnSpeed * speedRatio;

      rollFromLateral = lateralSpeed * ROLL_FROM_LATERAL;
      rollFromTurning = turnRate * speed * ROLL_FROM_TURNING;
      this.state.targetRoll = rollFromLateral + rollFromTurning;
      this.state.targetRoll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, this.state.targetRoll));
    } else {
      this.state.targetRoll = 0;
    }

    const rollSpeed = groundedness > 0.2 ? ROLL_SPEED_GROUNDED : ROLL_SPEED_AIRBORNE;
    this.state.currentRoll += (this.state.targetRoll - this.state.currentRoll) * rollSpeed * deltaTime;

    // Apply combined roll (terrain + turn-based)
    const combinedRoll = (this.state.terrainRoll || 0) + this.state.currentRoll;
    mesh.rotation.z = combinedRoll;

    // Add a small front/rear pitch offset based on weight transfer from throttle/brake.
    // Smooth it so the visual pitch transitions naturally.
    let targetPitchOffset = 0;
    if (groundedness > 0.2 && speed > 1) {
      const wt = this.state.weightTransfer ?? 1.0;
      if (input.forward) targetPitchOffset += PITCH_FROM_WEIGHT_TRANSFER.throttle * speedRatio * wt;
      if (input.back)    targetPitchOffset += PITCH_FROM_WEIGHT_TRANSFER.brake    * speedRatio * wt;
    }
    this._currentPitchOffset += (targetPitchOffset - this._currentPitchOffset) * Math.min(1, PITCH_WEIGHT_TRANSFER_SPEED * deltaTime);
    mesh.rotation.x += this._currentPitchOffset;
  }
}
