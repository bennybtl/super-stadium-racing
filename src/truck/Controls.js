import { Vector3 } from "@babylonjs/core";
import { projectOnPlane } from "./surface-math.js";
import { GROUNDEDNESS } from "../constants.js";

const UP = new Vector3(0, 1, 0);

/**
 * Number of "gears". The [0, maxSpeed] range is split into this many equal
 * speed bands; acceleration halves each band, so higher gears pull weaker and
 * the top gear takes the longest to climb through. Overridable per vehicle via
 * `state.gearCount`.
 */
const GEAR_COUNT = 4;

/**
 * Soft speed cap: holding throttle can push past maxSpeed up to this multiple,
 * but very slowly (one gear weaker than the top gear), before a hard ceiling.
 */
const SOFT_CAP_FACTOR = 1.2;

// ─── Power oversteer / launch break ─────────────────────────────────────────
/** How strongly throttle overwhelms tire grip from low speed (0 = off). */
const THROTTLE_BREAK_STRENGTH = 0.9;
/** The launch break fades to zero by this fraction of maxSpeed — it's a
 *  low-speed effect; above it the normal speed-based drift takes over. */
const LOW_SPEED_BREAK_RATIO = 0.7;
/** Cap on how much grip the power break may remove (keep some control). */
const MAX_THROTTLE_BREAK = 0.85;

/**
 * Exponential bleed-off rate (s⁻¹) for yaw momentum once airborne. The truck
 * keeps the yaw rate it had at takeoff and eases it toward zero instead of
 * snapping to a dead stop — at ~2/s the spin fades to ~10% over roughly a second.
 */
const YAW_AIRBORNE_DECAY = 2.0;

// ─── Steering easing ─────────────────────────────────────────────────────────
/** How fast steering ramps toward full lock when a key is pressed (per second).
 *  4 ≈ 0 → full lock in 0.25s. Small taps only apply partial steering, which
 *  removes the twitchiness of instant full-rate turn-in. */
const STEER_RAMP_UP = 4;
/** How fast steering returns to center on release (per second). Faster than
 *  ramp-up so letting go straightens out promptly. */
const STEER_RAMP_DOWN = 7;

// ─── Weight-transfer steering / grip feel ────────────────────────────────────
// Gains in calculateSpeedFactors(). All scale with speedRatio; the throttle/brake
// ones also scale with the vehicle's `weightTransfer` stat. These are the primary
// "how does it corner" feel knobs — tweak here rather than in the formula.

/** Baseline understeer at top speed (finite tire lateral force). */
const BASE_UNDERSTEER = 0.10;
// /** Baseline understeer at low speed */
// This ends up making the cars too twitchy
const BASE_OVERSTEER = 0.10;
/** Added understeer under throttle (weight shifts rearward, front lightens). */
const THROTTLE_UNDERSTEER_GAIN = 0.10;
/** Oversteer under braking (weight shifts forward, rear lightens). */
const BRAKE_OVERSTEER_GAIN = 0.15;
/** Floor on steering factor so turn-in is never fully lost. */
const MIN_STEER_FACTOR = 0.40;
/** Lateral-grip taper with speed, and its floor (tire limit at speed). */
const LATERAL_GRIP_SPEED_TAPER = 0.30;
const MIN_LATERAL_GRIP_FACTOR = 0.50;
/** Rear-axle unload under throttle / braking, feeding the drift model. */
const THROTTLE_REAR_UNLOAD = 0.25;
const BRAKE_REAR_UNLOAD = 0.60;
/** Floor on rear traction factor. */
const MIN_REAR_TRACTION = 0.30;
/** Power-oversteer surface-looseness map: looseness = GAIN/grip − BIAS, clamped 0..1. */
const SURFACE_LOOSE_GAIN = 3.4;
const SURFACE_LOOSE_BIAS = 0.9;
const SURFACE_LOOSE_MIN_GRIP = 0.15;

/**
 * Handles input processing and acceleration/braking
 */
export class Controls {
  constructor(state) {
    this.state = state;
    this.brakingToStop = false; // Track if we're holding brake at stop
    this.lastBackInput = false;  // Track back button state
    this._forward = new Vector3();
    this._surfaceFwd = new Vector3();
    this._yawRate = 0; // last applied heading change rate (rad/s), carried when airborne
    this._steerAmount = 0; // eased steering position, -1 (left) .. 1 (right)
  }

  updateSteering(input, effectiveTurnSpeed, speedRatio, groundedness, deltaTime) {
    if (groundedness > GROUNDEDNESS.STEER) {
      // Invert steering when reversing so the truck turns the natural direction
      this._forward.set(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
      const fwdSpeed = this.state.velocity.dot(this._forward);
      const steerSign = fwdSpeed < 0 ? -1 : 1;

      // Stationary spin factor — controls how much turn authority the truck has at rest.
      // 0 = no turning when stopped, 1 = full turn speed regardless of velocity.
      // The lerp blends from stationarySpinRate at speed=0 up to 1.0 at full speed.
      const stationarySpinRate = this.state.stationarySpinRate ?? 0.35;
      const spinFactor = stationarySpinRate + (1.0 - stationarySpinRate) * speedRatio;

      // Ease the steer amount toward the input target so turn-in ramps up
      // instead of snapping to full rate; taps produce small corrections.
      const steerTarget = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const rampRate = steerTarget === 0 ? STEER_RAMP_DOWN : STEER_RAMP_UP;
      const maxStep = rampRate * (this.state.steerRampScale ?? 1) * deltaTime;
      const diff = steerTarget - this._steerAmount;
      this._steerAmount += Math.max(-maxStep, Math.min(maxStep, diff));

      const delta = steerSign * effectiveTurnSpeed * spinFactor * groundedness * deltaTime * this._steerAmount;
      this.state.heading += delta;

      // Remember the rate so it can carry over the moment the wheels leave the ground.
      this._yawRate = deltaTime > 0 ? delta / deltaTime : 0;
    } else {
      // Airborne: no steering authority, but let the yaw momentum from takeoff
      // continue and bleed off so a turn-in-progress eases out instead of stopping dead.
      this.state.heading += this._yawRate * deltaTime;
      this._yawRate *= Math.exp(-YAW_AIRBORNE_DECAY * deltaTime);
    }
  }

  updateAcceleration(input, forward, groundedness, deltaTime) {
    if (groundedness <= GROUNDEDNESS.STEER) return;

    // Clear brake-to-stop flag when back button is released
    if (!input.back && this.lastBackInput) {
      this.brakingToStop = false;
    }
    this.lastBackInput = input.back;

    // Boost is treated as its own propulsion source: if active, keep driving
    // forward even when throttle is released (unless player/AI is braking).
    const boostProvidesThrottle = (this.state.boostActive || this.state.speedBoostActive) && !input.back;

    if (input.forward || boostProvidesThrottle) {
      this.brakingToStop = false; // Clear if accelerating forward
      this.handleForwardInput(forward, deltaTime);
    } else if (input.back) {
      this.handleBackwardInput(forward, deltaTime);
    }
  }

  /** Drive direction: heading projected onto the surface tangent plane so engine
   *  force follows the slope. Writes into and returns the reusable _surfaceFwd. */
  _surfaceDriveDir(forward) {
    const normal = this.state.surfaceNormal ?? UP;
    return projectOnPlane(this._surfaceFwd, forward, normal, forward);
  }

  handleForwardInput(forward, deltaTime) {
    if (this.state.noDriveUntil && Date.now() < this.state.noDriveUntil) {
      // Currently in no-drive cooldown (e.g. after head-on collision), skip applying drive force
      return;
    }
    const accelDir = this._surfaceDriveDir(forward);

    const forwardSpeed = this.state.velocity.dot(forward);

    if (forwardSpeed < -1.5) {
      // Moving backward - brake and reverse direction
      const brakeScale = -5 * deltaTime;
      this.state.velocity.x += this.state.velocity.x * brakeScale;
      this.state.velocity.y += this.state.velocity.y * brakeScale;
      this.state.velocity.z += this.state.velocity.z * brakeScale;

      const accel = this.state.acceleration * 2 * deltaTime;
      this.state.velocity.x += accelDir.x * accel;
      this.state.velocity.y += accelDir.y * accel;
      this.state.velocity.z += accelDir.z * accel;
    } else {
      // Apply boost multipliers if active
      const baseAccel = this.getEffectiveAcceleration();
      const maxSpeed = this.getEffectiveMaxSpeed();
      const gearCount = Math.max(1, this.state.gearCount ?? GEAR_COUNT);

      // Gear model: split [0, maxSpeed] into `gearCount` bands and halve the
      // acceleration each band, so higher gears pull progressively weaker and
      // the top gear takes the longest to reach.
      const ratio = maxSpeed > 0 ? Math.max(0, forwardSpeed) / maxSpeed : 0;
      let gear = Math.min(gearCount - 1, Math.floor(ratio * gearCount));
      // Soft cap: once past maxSpeed, keep accelerating but one gear weaker than
      // the top gear, crawling toward the SOFT_CAP_FACTOR × maxSpeed ceiling.
      if (forwardSpeed >= maxSpeed) gear = gearCount;
      const accelMult = Math.pow(0.8, gear);

      const accel = baseAccel * accelMult * deltaTime;
      this.state.velocity.x += accelDir.x * accel;
      this.state.velocity.y += accelDir.y * accel;
      this.state.velocity.z += accelDir.z * accel;

      // Hard ceiling at the soft-cap limit (maxSpeed × SOFT_CAP_FACTOR).
      const ceiling = maxSpeed * SOFT_CAP_FACTOR;
      const speedSq =
        this.state.velocity.x * this.state.velocity.x +
        this.state.velocity.y * this.state.velocity.y +
        this.state.velocity.z * this.state.velocity.z;
      if (speedSq > ceiling * ceiling) {
        const invLen = ceiling / Math.sqrt(speedSq);
        this.state.velocity.x *= invLen;
        this.state.velocity.y *= invLen;
        this.state.velocity.z *= invLen;
      }
    }
  }

  handleBackwardInput(forward, deltaTime) {
    const accelDir = this._surfaceDriveDir(forward);

    const forwardSpeed = this.state.velocity.dot(forward);
    const speed = this.state.velocity.length();
    
    if (forwardSpeed > 0.5) {
      // Moving forward - apply brakes (reduced from full braking power)
      const brakeScale = -this.state.braking * deltaTime;
      this.state.velocity.x += this.state.velocity.x * brakeScale;
      this.state.velocity.y += this.state.velocity.y * brakeScale;
      this.state.velocity.z += this.state.velocity.z * brakeScale;
      
      // Mark that we're braking to stop
      if (speed < 2) {
        this.brakingToStop = true;
      }
    } else if (speed < 0.3 && this.brakingToStop) {
      // Holding brake at stop - prevent any movement
      this.state.velocity.scaleInPlace(0);
      
      // Don't start reversing until brake is released and pressed again
      // (this state will be cleared when back input is released)
    } else if (!this.brakingToStop) {
      // Released brake after stop - now can accelerate backward
      const accel = this.state.acceleration * -2.5 * deltaTime;
      this.state.velocity.x += accelDir.x * accel;
      this.state.velocity.y += accelDir.y * accel;
      this.state.velocity.z += accelDir.z * accel;
      
      const reverseSpeed = this.state.velocity.dot(forward);
      if (reverseSpeed < this.state.maxReverseSpeed) {
        this.state.velocity.x = forward.x * this.state.maxReverseSpeed;
        this.state.velocity.y = 0;
        this.state.velocity.z = forward.z * this.state.maxReverseSpeed;
      }
    }
  }

  updateBoost(deltaTime) {
    if (this.state.boostActive) {
      this.state.boostTimer -= deltaTime;
      if (this.state.boostTimer <= 0) {
        this.state.boostActive = false;
        this.state.boostTimer = 0;
      }
    }
    // Speed-boost zones arm a separate, timed boost that lingers after the truck
    // leaves the zone. While inside, the game loop re-arms speedBoostTimer.
    if (this.state.speedBoostActive) {
      this.state.speedBoostTimer -= deltaTime;
      if (this.state.speedBoostTimer <= 0) {
        this.state.speedBoostActive = false;
        this.state.speedBoostTimer = 0;
        this.state.speedBoostSpeedMult = 1;
        this.state.speedBoostAccelMult = 1;
      }
    }
  }

  getEffectiveAcceleration() {
    const nitro = this.state.boostActive ? this.state.boostAccelMult : 1.0;
    const zone  = this.state.speedBoostActive ? this.state.speedBoostAccelMult : 1.0;
    return this.state.acceleration * nitro * zone;
  }

  getEffectiveMaxSpeed() {
    const nitro = this.state.boostActive ? this.state.boostSpeedMult : 1.0;
    const zone  = this.state.speedBoostActive ? this.state.speedBoostSpeedMult : 1.0;
    const base = this.state.maxSpeed * nitro * zone;
    // Inside a slow zone the truck cannot accelerate past the zone limit
    if (this.state.slowZoneActive) {
      return Math.min(base, this.state.slowZoneMaxSpeed);
    }
    return base;
  }

  calculateSpeedFactors(speed, terrainGripMultiplier, groundedness, input) {
    const speedRatio = Math.min(speed / this.state.maxSpeed, 1);

    // Detect acceleration state for weight-transfer model.
    this._forward.set(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
    const fwdSpeed = this.state.velocity.dot(this._forward);
    const isAccelerating = !!(input?.forward) && fwdSpeed >= -0.5;
    const isDecelerating = !!(input?.back)    && fwdSpeed >  0.5;

    // Weight transfer → steering feel:
    //   Throttle on  → weight shifts to rear  → front loses grip → understeer
    //   Brake on     → weight shifts to front → rear  loses grip → oversteer
    //   Coasting     → neutral, just a mild speed-based taper for tire limits
    // Weight transfer magnitude scales with the vehicle's weightTransfer stat.
    // Heavier/stiffer trucks shift weight more dramatically under load.
    const wt = this.state.weightTransfer ?? 1.0;
    const baseUndersteer     = speedRatio * BASE_UNDERSTEER;
    const throttleUndersteer = isAccelerating ? speedRatio * THROTTLE_UNDERSTEER_GAIN * wt : 0;
    const baseOversteer      = Math.max(0.2, (1 - speedRatio) * BASE_OVERSTEER);
    const brakeOversteer     = isDecelerating ? speedRatio * BRAKE_OVERSTEER_GAIN * wt : 0;

    const steerFactor     = Math.max(MIN_STEER_FACTOR, 1 - baseUndersteer - throttleUndersteer + brakeOversteer + baseOversteer);
    const effectiveTurnSpeed = this.state.turnSpeed * steerFactor;

    const lateralGripFactor = Math.max(MIN_LATERAL_GRIP_FACTOR, 1 - speedRatio * LATERAL_GRIP_SPEED_TAPER);
    const effectiveGrip = this.state.grip * lateralGripFactor * terrainGripMultiplier * groundedness;

    // Rear traction factor — how loaded/unloaded the rear axle is due to weight transfer.
    // Throttle: power can break rear traction loose (mild reduction).
    // Braking:  weight shifts forward, rear unloads significantly.
    // These mirror the same wt/speedRatio variables used for steerFactor above,
    // so the drift model and the steering model share one consistent weight-transfer source.
    const throttleRearLoose = isAccelerating ? speedRatio * THROTTLE_REAR_UNLOAD * wt : 0;
    const brakeRearLoose    = isDecelerating ? speedRatio * BRAKE_REAR_UNLOAD * wt : 0;
    const rearTractionFactor = Math.max(MIN_REAR_TRACTION, 1.0 - throttleRearLoose - brakeRearLoose);

    // Power oversteer / launch break: a high-power engine overwhelms tire grip
    // from low speed — strongest at a standstill and on low-grip surfaces, fading
    // out as speed builds (where the normal speed-based drift takes over). Kept
    // SEPARATE from rearTractionFactor so it doesn't disturb the throttle/brake
    // classification in the drift model; handed to applyGripAndDrift directly.
    //   surfaceLoose: ~0 on grippy asphalt (3.8), ~0.8 on packed dirt (2.0),
    //                 saturating to 1 on loose/muddy surfaces.
    const lowSpeedFactor = Math.max(0, 1 - speedRatio / LOW_SPEED_BREAK_RATIO);
    const surfaceLoose = Math.max(0, Math.min(1,
      SURFACE_LOOSE_GAIN / Math.max(SURFACE_LOOSE_MIN_GRIP, terrainGripMultiplier) - SURFACE_LOOSE_BIAS));
    const throttleBreak = isAccelerating
      ? Math.min(MAX_THROTTLE_BREAK, lowSpeedFactor * surfaceLoose * THROTTLE_BREAK_STRENGTH * wt * groundedness)
      : 0;

    return { speedRatio, effectiveTurnSpeed, effectiveGrip, rearTractionFactor, throttleBreak };
  }
}
