import { Vector3 } from "@babylonjs/core";
import { tangentBasis } from "./surface-math.js";
import { GROUNDEDNESS } from "../constants.js";

// ─── Grip / drift ────────────────────────────────────────────────────────────
//
// The per-vehicle drift-grip values — driftThreshold, gripZoneCorrection,
// maxDriftGrip, slipDropoffRate, minSlipFactor, minDriftSpeed, and the three
// minDriftSpeedHold* thresholds — are NOT defined here. They are derived from the
// four high-level handling knobs in DriftTuning.js (resolveHandling) and written
// onto truck state, which is their single source of truth. This file reads them
// straight off `this.state`. The constants below are the ones DriftTuning does not
// own — global feel rules that apply to every vehicle.

/** Multiplier applied to reverse-direction grip so reversing corrects quickly. */
const REVERSE_GRIP_BOOST = 15;

/** How far throttle power-break lowers the drift threshold (0..1). Dropping the
 *  threshold under power lets the rear tip into the low-grip drift zone at a much
 *  smaller slip angle, so flooring it from low speed actually breaks loose
 *  instead of just letting an existing slide decay slower. */
const THROTTLE_BREAK_THRESHOLD_DROP = 0.6;

/** How fast lateral velocity bleeds out (s⁻¹) once speed falls below the drift
 *  gate. A finite rate instead of an instant strip-to-zero — the old hard snap
 *  made the truck "catch" and jitter at the end of a slide as the drift state
 *  flip-flopped across the speed gate. ~5 ≈ gone in a third of a second. */
const LOW_SPEED_LATERAL_DAMP = 5;

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
const ROLL_FROM_LATERAL = 0.04;

/** Turn rate → roll angle scale factor (multiplied by speed). */
const ROLL_FROM_TURNING = 0.02;

/** Maximum body roll angle in radians (~15°). */
const MAX_ROLL = 0.20;

/** Body height baseline used for MAX_ROLL scaling (default truck ride height). */
const MAX_ROLL_BODY_Y_BASE = 0.66;

/** Prevent extreme roll changes for very low/high body offsets. */
const MAX_ROLL_SCALE_MIN = 0.5;
const MAX_ROLL_SCALE_MAX = 1.6;

/** Prevent extreme pitch changes for very low/high body offsets. */
const PITCH_SCALE_MIN = 0.5;
const PITCH_SCALE_MAX = 1.6;

/** Roll interpolation speed when grounded. */
const ROLL_SPEED_GROUNDED = 6;

/** Roll interpolation speed when airborne (slower recovery). */
const ROLL_SPEED_AIRBORNE = 2;

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
    this._surfaceForward = new Vector3();
    this._surfaceNormal = new Vector3(0, 1, 0);
    this._surfaceRight = new Vector3(1, 0, 0);
    this._rollRight = new Vector3();
    this._currentPitchOffset = 0;
  }

  applyGripAndDrift(speed, forward, effectiveGrip, rearTractionFactor = 1.0, deltaTime = 1 / 60, throttleBreak = 0) {
    const surfaceForward = this._surfaceForward;
    const surfaceNormal = this._surfaceNormal;
    const surfaceRight = this._surfaceRight;

    // Orthonormal basis on the terrain tangent plane (normal, forward, right).
    if (this.state.surfaceNormal) surfaceNormal.copyFrom(this.state.surfaceNormal);
    else surfaceNormal.set(0, 1, 0);
    tangentBasis(surfaceNormal, forward, surfaceNormal, surfaceForward, surfaceRight);

    const minSpeed = this._resolveMinDriftSpeed(rearTractionFactor, throttleBreak);

    if (speed <= minSpeed) {
      // Below threshold: bleed lateral velocity out quickly (but smoothly) and
      // clear drift state so effects don't linger. An instant strip-to-zero here
      // caused a visible "catch" + jitter at the end of a slide.
      const forwardVelocity = this.state.velocity.dot(surfaceForward);
      const lateralSpeed = this.state.velocity.dot(surfaceRight);
      const normalVelocity = this.state.velocity.dot(surfaceNormal);
      const retainedLat = Math.exp(-LOW_SPEED_LATERAL_DAMP * deltaTime);
      this._setSurfaceVelocity(surfaceForward, forwardVelocity, surfaceRight, lateralSpeed * retainedLat, surfaceNormal, normalVelocity);
      this.state.slipAngle = 0;
      this.state.isDrifting = false;
      this.state.isSpinningOut = false;
      return;
    }

    // No traction correction while airborne — effectiveGrip reaches 0 when groundedness = 0
    if (effectiveGrip <= 0) return;

    const vLen = this.state.velocity.length();
    if (vLen <= 1e-6) return;

    const forwardVelocity = this.state.velocity.dot(surfaceForward);
    const isReversing = forwardVelocity < 0;
    const lateralSpeed = this.state.velocity.dot(surfaceRight);
    const normalVelocity = this.state.velocity.dot(surfaceNormal);

    // Slip angle: angle between velocity and heading (flipped when reversing so a
    // reversing truck reads slip relative to its actual travel direction).
    const headingDot = forwardVelocity / vLen;
    const targetDot = isReversing ? -headingDot : headingDot;
    this.state.slipAngle = Math.acos(Math.max(-1, Math.min(1, targetDot)));

    // driftGrip caps drift-zone traction so any truck can break loose; power
    // oversteer drops the slip threshold so the rear lets go at a smaller angle.
    const driftGrip = Math.min(effectiveGrip, this.state.maxDriftGrip);
    const driftThresh = this.state.driftThreshold * (1 - throttleBreak * THROTTLE_BREAK_THRESHOLD_DROP);
    const gripFactor = this._gripFactorForSlip(this.state.slipAngle, driftThresh, driftGrip);

    const reverseGripBoost = isReversing ? REVERSE_GRIP_BOOST : 1;
    // lateralRetention (Lateral Bias knob): <1 keeps more lateral momentum (slidey),
    // >1 grips harder. throttleBreak bleeds the correction so the rear steps out.
    const lateralRetention = this.state.lateralRetention ?? 1;
    const gripMultiplier = gripFactor * reverseGripBoost * rearTractionFactor * lateralRetention * (1 - throttleBreak);

    // Apply grip as lateral-only damping (longitudinal speed untouched). gripMultiplier
    // is the fraction removed per 1/60 s step, so raise the retained fraction to the
    // (dt·60) power to stay framerate-independent.
    const perStepGrip = Math.min(1, Math.max(0, gripMultiplier));
    const retained = Math.pow(1 - perStepGrip, deltaTime * 60);
    this._setSurfaceVelocity(surfaceForward, forwardVelocity, surfaceRight, lateralSpeed * retained, surfaceNormal, normalVelocity);

    this.state.isSpinningOut = this.state.slipAngle > SPINOUT_SLIP_THRESHOLD && gripMultiplier < SPINOUT_GRIP_THRESHOLD;
    this.state.isDrifting = this.state.slipAngle > driftThresh;
  }

  /** Minimum speed gate for drift, by input state. Already-drifting uses lower hold
   *  thresholds so a slide bleeds out through grip instead of snapping off; power
   *  oversteer (throttleBreak) drops the gate further so a low-speed throttle-and-
   *  steer can initiate a slide. */
  _resolveMinDriftSpeed(rearTractionFactor, throttleBreak) {
    const isBraking    = rearTractionFactor < 0.85;
    const isThrottling = rearTractionFactor < 1.0 && !isBraking;
    let minSpeed;
    if (this.state.isDrifting) {
      if (isBraking)         minSpeed = this.state.minDriftSpeedHoldBrake;
      else if (isThrottling) minSpeed = this.state.minDriftSpeedHoldThrottle;
      else                   minSpeed = this.state.minDriftSpeedHoldCoast;
    } else {
      minSpeed = this.state.minDriftSpeed;
    }
    return minSpeed * (1 - throttleBreak);
  }

  /** Two-regime grip curve. Grip zone (slip ≤ thresh): linear taper from
   *  gripZoneCorrection → driftGrip for tight, responsive cornering. Drift zone
   *  (slip > thresh): exponential drop-off so lateral momentum carries. The taper
   *  ends at driftGrip so the boundary is seamless. */
  _gripFactorForSlip(slipAngle, driftThresh, driftGrip) {
    if (slipAngle <= driftThresh) {
      const t = slipAngle / driftThresh; // 0 straight-ahead, 1 at threshold
      return this.state.gripZoneCorrection * (1 - t) + driftGrip * t;
    }
    const excessSlip = slipAngle - driftThresh;
    return Math.max(this.state.minSlipFactor, Math.exp(-excessSlip * this.state.slipDropoffRate)) * driftGrip;
  }

  /** Recompose velocity from its tangent-plane components (forward · normal · right). */
  _setSurfaceVelocity(fwd, fScalar, right, rScalar, normal, nScalar) {
    this.state.velocity.set(
      fwd.x * fScalar + right.x * rScalar + normal.x * nScalar,
      fwd.y * fScalar + right.y * rScalar + normal.y * nScalar,
      fwd.z * fScalar + right.z * rScalar + normal.z * nScalar
    );
  }

  applyDrag(speed, input, deltaTime, terrainDragMultiplier, groundedness = 1) {
    if (speed > MIN_DRAG_SPEED) {
      // Minimal air resistance when airborne, full drag when grounded.
      // Three distinct ground states so releasing the brake actually matters:
      //   accelerating → light drag
      //   coasting (no input) → medium drag
      //   braking (back held) → heavy drag
      const airborne = groundedness <= 0;
      const dragCoasting = this.state.dragCoasting ?? DRAG_COASTING;
      let coastingMultiplier;
      if (airborne)           coastingMultiplier = DRAG_AIRBORNE;
      else if (input.forward) coastingMultiplier = DRAG_ACCELERATING;
      else if (input.back)    coastingMultiplier = DRAG_BRAKING;
      else                    coastingMultiplier = dragCoasting;
      const drag = airborne ? 1.0 : terrainDragMultiplier;
      const dragFactor = coastingMultiplier * drag * deltaTime;
      this.state.velocity.x -= this.state.velocity.x * dragFactor;
      this.state.velocity.z -= this.state.velocity.z * dragFactor;
    }
  }

  updateRoll(mesh, speed, groundedness, input, effectiveTurnSpeed, speedRatio, deltaTime) {
    const leaning = groundedness > GROUNDEDNESS.VISUAL_LEAN && speed > 1;

    // Body-height scale (taller bodies lean/pitch more); shared by roll and pitch.
    const bodyHeightY = Math.max(0.05, this.state.bodyHeightY ?? MAX_ROLL_BODY_Y_BASE);
    const bodyScaleRaw = bodyHeightY / MAX_ROLL_BODY_Y_BASE;

    // Target roll from cornering: lateral slide + turn rate, clamped to maxRoll.
    if (leaning) {
      this._rollRight.set(Math.cos(this.state.heading), 0, -Math.sin(this.state.heading));
      const lateralSpeed = this.state.velocity.dot(this._rollRight);
      let turnRate = 0;
      if (input.left)  turnRate = -effectiveTurnSpeed * speedRatio;
      if (input.right) turnRate =  effectiveTurnSpeed * speedRatio;

      const rollScale = Math.max(MAX_ROLL_SCALE_MIN, Math.min(MAX_ROLL_SCALE_MAX, bodyScaleRaw));
      const maxRoll = MAX_ROLL * rollScale;
      const targetRoll = lateralSpeed * ROLL_FROM_LATERAL + turnRate * speed * ROLL_FROM_TURNING;
      this.state.targetRoll = Math.max(-maxRoll, Math.min(maxRoll, targetRoll));
    } else {
      this.state.targetRoll = 0;
    }

    const rollSpeed = groundedness > GROUNDEDNESS.VISUAL_LEAN ? ROLL_SPEED_GROUNDED : ROLL_SPEED_AIRBORNE;
    this.state.currentRoll += (this.state.targetRoll - this.state.currentRoll) * rollSpeed * deltaTime;

    // Target pitch offset from throttle/brake weight transfer (nose dive / squat).
    let targetPitchOffset = 0;
    if (leaning) {
      const wt = this.state.weightTransfer ?? 1.0;
      const pitchScale = Math.max(PITCH_SCALE_MIN, Math.min(PITCH_SCALE_MAX, bodyScaleRaw));
      if (input.forward) targetPitchOffset += PITCH_FROM_WEIGHT_TRANSFER.throttle * speedRatio * wt * pitchScale;
      if (input.back)    targetPitchOffset += PITCH_FROM_WEIGHT_TRANSFER.brake    * speedRatio * wt * pitchScale;
    }
    this._currentPitchOffset += (targetPitchOffset - this._currentPitchOffset) * Math.min(1, PITCH_WEIGHT_TRANSFER_SPEED * deltaTime);

    // Single orientation-apply: this is the only writer of the truck's visual pitch
    // and roll. TerrainPhysics computes the contributions — state.flightPitch
    // (velocity/slope pitch) and state.terrainRoll — and here we add the
    // weight-transfer pitch and cornering roll, then compose. (Heading/rotation.y
    // is applied separately by Truck.)
    mesh.rotation.x = -(this.state.flightPitch ?? 0) + this._currentPitchOffset;
    mesh.rotation.z = (this.state.terrainRoll || 0) + this.state.currentRoll;
  }
}
