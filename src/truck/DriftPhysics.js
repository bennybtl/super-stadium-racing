import { Vector3 } from "@babylonjs/core";

// ─── Grip / drift ────────────────────────────────────────────────────────────

/** Speed below which all slip correction is skipped (avoids divide-by-zero jitter). */
const MIN_DRIFT_SPEED = 0.1;

/** Exponent that controls how sharply grip drops off once slip exceeds the drift threshold.
 *  Higher = grip falls faster, shorter drift, snappier recovery.
 *  Lower  = grip falls slowly, longer floaty drift. */
const SLIP_DROPOFF_RATE = 5;

/** Grip correction strength at the low end of the normal-cornering zone.
 *  Fraction of lateral speed removed per frame at zero slip — gives tight, responsive
 *  cornering well below the drift threshold.
 *  Tapers linearly down to effectiveGrip at the threshold for a seamless transition. */
const GRIP_ZONE_CORRECTION = 0.25;

/** Minimum grip factor at extreme slip angles — prevents total loss of steering authority. */
const MIN_SLIP_FACTOR = 0.05;

/** Hard ceiling on the grip value used in the drift zone.
 *  No matter how grippy a truck is, once slip exceeds the drift threshold the
 *  traction available is capped here — guaranteeing any truck can break loose
 *  and slide.  Higher truck grip still improves cornering in the normal grip zone;
 *  only the drift zone is bounded. */
const MAX_DRIFT_GRIP = 0.04;

/** Multiplier applied to reverse-direction grip so reversing corrects quickly. */
const REVERSE_GRIP_BOOST = 15;

/** Slip angle (radians) above which the truck is considered spinning out. */
const SPINOUT_SLIP_THRESHOLD = 0.6;

/** Grip multiplier below which a spin-out is confirmed (car has lost meaningful traction). */
const SPINOUT_GRIP_THRESHOLD = 0.01;

// ─── Throttle-drift ───────────────────────────────────────────────────────────

/** Fraction of lateral grip retained while on the throttle during a drift.
 *  Lower = rear stays looser under power, slide holds its angle. */
const THROTTLE_LOOSE_FACTOR = 0.65;

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

/** Maximum body roll angle in radians (~10°). */
const MAX_ROLL = 0.18;

/** Roll interpolation speed when grounded. */
const ROLL_SPEED_GROUNDED = 8;

/** Roll interpolation speed when airborne (slower recovery). */
const ROLL_SPEED_AIRBORNE = 3;

/**
 * Handles drift physics, grip, drag, and velocity management
 */
export class DriftPhysics {
  constructor(state) {
    this.state = state;
  }

  applyGripAndDrift(speed, forward, effectiveGrip, brakeGripReduction = 1.0, isThrottling = false) {
    if (speed <= MIN_DRIFT_SPEED) {
      this.state.slipAngle = 0;
      this.state.isSpinningOut = false;
      return;
    }

    // No traction correction while airborne — effectiveGrip reaches 0 when groundedness = 0
    if (effectiveGrip <= 0) return;

    const velocityDir = this.state.velocity.clone().normalize();
    const forwardVelocity = this.state.velocity.dot(forward);
    const isReversing = forwardVelocity < 0;

    const targetDir = isReversing ? forward.scale(-1) : forward;

    // Slip angle: angle between velocity direction and heading direction
    this.state.slipAngle = Math.acos(Math.max(-1, Math.min(1, targetDir.dot(velocityDir))));

    // Right vector — XZ perpendicular to heading
    const right = new Vector3(forward.z, 0, -forward.x);
    const lateralSpeed = this.state.velocity.dot(right);

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
      // Drift zone: exponential drop-off — lateral momentum carries
      const throttleLooseFactor = (isThrottling && !isReversing) ? THROTTLE_LOOSE_FACTOR : 1.0;
      gripFactor = Math.max(MIN_SLIP_FACTOR, Math.exp(-excessSlip * SLIP_DROPOFF_RATE))
                 * driftGrip * throttleLooseFactor;
    }

    const reverseGripBoost = isReversing ? REVERSE_GRIP_BOOST : 1;
    const gripMultiplier = gripFactor * reverseGripBoost * brakeGripReduction;

    // Apply grip as lateral-only damping.
    // Only the sideways component decays; the longitudinal (heading-aligned) speed
    // is left untouched. When grip is low (drifting) the lateral speed bleeds off
    // slowly, giving a loose, momentum-driven feel rather than a sharp snap-back.
    const newLateralSpeed = lateralSpeed * (1 - gripMultiplier);
    this.state.velocity = forward.scale(forwardVelocity).add(right.scale(newLateralSpeed));

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
      const naturalDrag = this.state.velocity.scale(-coastingMultiplier * drag * deltaTime);
      this.state.velocity.addInPlace(naturalDrag);
    }
  }

  updateRoll(mesh, speed, groundedness, input, effectiveTurnSpeed, speedRatio, deltaTime) {
    // Apply combined roll (terrain + turn-based)
    const combinedRoll = (this.state.terrainRoll || 0) + this.state.currentRoll;
    mesh.rotation.z = combinedRoll;

    // Calculate target roll based on turning
    if (groundedness > 0.5 && speed > 1) {
      const right = new Vector3(Math.cos(this.state.heading), 0, -Math.sin(this.state.heading));
      const lateralSpeed = this.state.velocity.dot(right);
      
      let turnRate = 0;
      if (input.left) turnRate = -effectiveTurnSpeed * speedRatio;
      if (input.right) turnRate = effectiveTurnSpeed * speedRatio;
      
      const rollFromLateral = lateralSpeed * ROLL_FROM_LATERAL;
      const rollFromTurning = turnRate * speed * ROLL_FROM_TURNING;
      this.state.targetRoll = rollFromLateral + rollFromTurning;
      this.state.targetRoll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, this.state.targetRoll));
    } else {
      this.state.targetRoll = 0;
    }
    
    const rollSpeed = groundedness > 0.5 ? ROLL_SPEED_GROUNDED : ROLL_SPEED_AIRBORNE;
    this.state.currentRoll += (this.state.targetRoll - this.state.currentRoll) * rollSpeed * deltaTime;
  }
}
