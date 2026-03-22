import { Vector3 } from "@babylonjs/core";

/**
 * Handles input processing and acceleration/braking
 */
export class Controls {
  constructor(state) {
    this.state = state;
  }

  updateSteering(input, effectiveTurnSpeed, speedRatio, groundedness, deltaTime) {
    if (groundedness > 0.1) {
      if (input.left) this.state.heading -= effectiveTurnSpeed * speedRatio * groundedness * deltaTime;
      if (input.right) this.state.heading += effectiveTurnSpeed * speedRatio * groundedness * deltaTime;
    }
  }

  updateAcceleration(input, forward, groundedness, deltaTime) {
    if (groundedness <= 0.1) return;

    if (input.forward) {
      this.handleForwardInput(forward, deltaTime);
    } else if (input.back) {
      this.handleBackwardInput(forward, deltaTime);
    }
  }

  handleForwardInput(forward, deltaTime) {
    const forwardSpeed = this.state.velocity.dot(forward);
    
    if (forwardSpeed < -0.5) {
      // Moving backward - brake and reverse direction
      const brakeForce = this.state.velocity.scale(-5 * deltaTime);
      this.state.velocity.addInPlace(brakeForce);
      this.state.velocity.addInPlace(forward.scale(this.state.acceleration * 2 * deltaTime));
    } else {
      // Apply boost multipliers if active
      const effectiveAcceleration = this.getEffectiveAcceleration();
      const effectiveMaxSpeed = this.getEffectiveMaxSpeed();
      
      this.state.velocity.addInPlace(forward.scale(effectiveAcceleration * deltaTime));
      
      const speed = this.state.velocity.length();
      if (speed > effectiveMaxSpeed) {
        this.state.velocity.normalize().scaleInPlace(effectiveMaxSpeed);
      }
    }
  }

  handleBackwardInput(forward, deltaTime) {
    const forwardSpeed = this.state.velocity.dot(forward);
    
    if (forwardSpeed > 0.5) {
      // Moving forward - apply brakes
      const brakeForce = this.state.velocity.scale(-1.5 * deltaTime);
      this.state.velocity.addInPlace(brakeForce);
    } else {
      // Accelerate backward
      this.state.velocity.addInPlace(forward.scale(this.state.acceleration * -2.5 * deltaTime));
      
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
    return this.state.maxSpeed * (this.state.boostActive ? this.state.boostSpeedMult : 1.0);
  }

  calculateSpeedFactors(speed, terrainGripMultiplier, groundedness) {
    const speedRatio = Math.min(speed / this.state.maxSpeed, 1);
    const understeerFactor = 1 - (speedRatio * 0.5);
    const effectiveTurnSpeed = this.state.turnSpeed * understeerFactor;
    
    const oversteerFactor = Math.max(0.5, 1 - (speedRatio * 0.3));
    const effectiveGrip = this.state.grip * oversteerFactor * terrainGripMultiplier * groundedness;
    
    return { speedRatio, effectiveTurnSpeed, effectiveGrip };
  }
}
