import { Vector3 } from "@babylonjs/core";

/**
 * Handles input processing and acceleration/braking
 */
export class Controls {
  constructor(state) {
    this.state = state;
    this.brakingToStop = false; // Track if we're holding brake at stop
    this.lastBackInput = false;  // Track back button state
  }

  updateSteering(input, effectiveTurnSpeed, speedRatio, groundedness, deltaTime) {
    if (groundedness > 0.1) {
      // Invert steering when reversing so the truck turns the natural direction
      const forward = new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
      const fwdSpeed = this.state.velocity.dot(forward);
      const steerSign = fwdSpeed < 0 ? -1 : 1;

      // Stationary spin factor — controls how much turn authority the truck has at rest.
      // 0 = no turning when stopped, 1 = full turn speed regardless of velocity.
      // The lerp blends from stationarySpinRate at speed=0 up to 1.0 at full speed.
      const stationarySpinRate = this.state.stationarySpinRate ?? 0.35;
      const spinFactor = stationarySpinRate + (1.0 - stationarySpinRate) * speedRatio;

      if (input.left)  this.state.heading -= steerSign * effectiveTurnSpeed * spinFactor * groundedness * deltaTime;
      if (input.right) this.state.heading += steerSign * effectiveTurnSpeed * spinFactor * groundedness * deltaTime;
    }
  }

  updateAcceleration(input, forward, groundedness, deltaTime) {
    if (groundedness <= 0.1) return;

    // Clear brake-to-stop flag when back button is released
    if (!input.back && this.lastBackInput) {
      this.brakingToStop = false;
    }
    this.lastBackInput = input.back;

    if (input.forward) {
      this.brakingToStop = false; // Clear if accelerating forward
      this.handleForwardInput(forward, deltaTime);
    } else if (input.back) {
      this.handleBackwardInput(forward, deltaTime);
    }
  }

  handleForwardInput(forward, deltaTime) {
    // Project forward direction onto the surface tangent plane so engine force follows the slope.
    const normal = this.state.surfaceNormal ?? new Vector3(0, 1, 0);
    const surfaceFwd = forward.subtract(normal.scale(forward.dot(normal)));
    const sfLen = surfaceFwd.length();
    const accelDir = sfLen > 0.001 ? surfaceFwd.scaleInPlace(1 / sfLen) : forward;

    const forwardSpeed = this.state.velocity.dot(forward);
    
    if (forwardSpeed < -0.5) {
      // Moving backward - brake and reverse direction
      const brakeForce = this.state.velocity.scale(-5 * deltaTime);
      this.state.velocity.addInPlace(brakeForce);
      this.state.velocity.addInPlace(accelDir.scale(this.state.acceleration * 2 * deltaTime));
    } else {
      // Apply boost multipliers if active
      const effectiveAcceleration = this.getEffectiveAcceleration();
      const effectiveMaxSpeed = this.getEffectiveMaxSpeed();
      
      this.state.velocity.addInPlace(accelDir.scale(effectiveAcceleration * deltaTime));
      
      const speed = this.state.velocity.length();
      if (speed > effectiveMaxSpeed) {
        this.state.velocity.normalize().scaleInPlace(effectiveMaxSpeed);
      }
    }
  }

  handleBackwardInput(forward, deltaTime) {
    const normal = this.state.surfaceNormal ?? new Vector3(0, 1, 0);
    const surfaceFwd = forward.subtract(normal.scale(forward.dot(normal)));
    const sfLen = surfaceFwd.length();
    const accelDir = sfLen > 0.001 ? surfaceFwd.scaleInPlace(1 / sfLen) : forward;

    const forwardSpeed = this.state.velocity.dot(forward);
    const speed = this.state.velocity.length();
    
    if (forwardSpeed > 0.5) {
      // Moving forward - apply brakes (reduced from full braking power)
      const brakeForce = this.state.velocity.scale(-this.state.braking * deltaTime);
      this.state.velocity.addInPlace(brakeForce);
      
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
      this.state.velocity.addInPlace(accelDir.scale(this.state.acceleration * -2.5 * deltaTime));
      
      const reverseSpeed = this.state.velocity.dot(forward);
      if (reverseSpeed < this.state.maxReverseSpeed) {
        this.state.velocity = forward.scale(this.state.maxReverseSpeed);
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
  }

  getEffectiveAcceleration() {
    return this.state.acceleration * (this.state.boostActive ? this.state.boostAccelMult : 1.0);
  }

  getEffectiveMaxSpeed() {
    const base = this.state.maxSpeed * (this.state.boostActive ? this.state.boostSpeedMult : 1.0);
    // Inside a slow zone the truck cannot accelerate past the zone limit
    if (this.state.slowZoneActive) {
      return Math.min(base, this.state.slowZoneMaxSpeed);
    }
    return base;
  }

  calculateSpeedFactors(speed, terrainGripMultiplier, groundedness, input) {
    const speedRatio = Math.min(speed / this.state.maxSpeed, 1);

    // Detect acceleration state for weight-transfer model.
    const forward = new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
    const fwdSpeed = this.state.velocity.dot(forward);
    const isAccelerating = !!(input?.forward) && fwdSpeed >= -0.5;
    const isDecelerating = !!(input?.back)    && fwdSpeed >  0.5;

    // Weight transfer → steering feel:
    //   Throttle on  → weight shifts to rear  → front loses grip → understeer
    //   Brake on     → weight shifts to front → rear  loses grip → oversteer
    //   Coasting     → neutral, just a mild speed-based taper for tire limits
    // Weight transfer magnitude scales with the vehicle's weightTransfer stat.
    // Heavier/stiffer trucks shift weight more dramatically under load.
    const wt = this.state.weightTransfer ?? 1.0;
    const baseUndersteer     = speedRatio * 0.10;          // tires have finite lateral force
    const throttleUndersteer = isAccelerating ? speedRatio * 0.10 * wt : 0;
    const brakeOversteer     = isDecelerating ? speedRatio * 0.15 * wt : 0;

    const steerFactor     = Math.max(0.40, 1 - baseUndersteer - throttleUndersteer + brakeOversteer);
    const effectiveTurnSpeed = this.state.turnSpeed * steerFactor;

    const lateralGripFactor = Math.max(0.5, 1 - speedRatio * 0.3);
    const effectiveGrip = this.state.grip * lateralGripFactor * terrainGripMultiplier * groundedness;

    // Rear traction factor — how loaded/unloaded the rear axle is due to weight transfer.
    // Throttle: power can break rear traction loose (mild reduction).
    // Braking:  weight shifts forward, rear unloads significantly.
    // These mirror the same wt/speedRatio variables used for steerFactor above,
    // so the drift model and the steering model share one consistent weight-transfer source.
    const throttleRearLoose = isAccelerating ? speedRatio * 0.25 * wt : 0;
    const brakeRearLoose    = isDecelerating ? speedRatio * 0.60 * wt : 0;
    const rearTractionFactor = Math.max(0.3, 1.0 - throttleRearLoose - brakeRearLoose);

    return { speedRatio, effectiveTurnSpeed, effectiveGrip, rearTractionFactor };
  }
}
