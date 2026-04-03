import { Vector3 } from "@babylonjs/core";

/**
 * SteeringControl - Handles steering forces for physics truck
 * 
 * Applies torque to rotate the chassis based on steering input.
 * Uses physics-based approach with speed-dependent handling.
 */
export class SteeringControl {
  constructor() {
    // Steering parameters
    this.steerTorque = 1500;         // Maximum steering torque (N*m) - increased for sharper turns
    this.maxSteerAngle = 1.0;        // Maximum steering angle (radians, ~46 degrees) - increased
    this.steerSpeed = 7.0;           // How fast steering responds - faster
    
    // Speed-dependent steering
    this.highSpeedSteerReduction = 0.5;  // Less steering at high speed (but still more than before)
    this.lowSpeedThreshold = 5;          // Below this, full steering
    this.highSpeedThreshold = 25;        // Above this, reduced steering (increased threshold)
    
    // Counter-steer assist (helps prevent spinning out)
    this.counterSteerStrength = 0.2;
    
    // Current steering angle
    this.currentSteerAngle = 0;
  }

  /**
   * Update steering forces
   * @param {PhysicsBody} body - The truck's physics body
   * @param {Object} input - Input state {steering}
   * @param {number} currentSpeed - Current forward speed
   * @param {number} groundedWheelCount - Number of wheels touching ground
   * @param {number} deltaTime - Time step
   */
  update(body, input, currentSpeed, groundedWheelCount, deltaTime) {
    // No steering in air
    if (groundedWheelCount < 2) {
      return;
    }

    // Calculate speed-dependent steering factor
    const speedAbs = Math.abs(currentSpeed);
    let steerFactor = 1.0;
    
    if (speedAbs < this.lowSpeedThreshold) {
      steerFactor = 1.0; // Full steering at low speed
    } else if (speedAbs < this.highSpeedThreshold) {
      // Interpolate between full and reduced steering
      const t = (speedAbs - this.lowSpeedThreshold) / (this.highSpeedThreshold - this.lowSpeedThreshold);
      steerFactor = 1.0 - t * (1.0 - this.highSpeedSteerReduction);
    } else {
      steerFactor = this.highSpeedSteerReduction; // Reduced steering at high speed
    }
    
    // Reverse steering when going backward
    const reverseMultiplier = currentSpeed < -0.5 ? -1 : 1;
    
    // Calculate target steering angle
    const targetSteer = input.steering * this.maxSteerAngle * steerFactor * reverseMultiplier;
    
    // Smoothly interpolate to target angle
    this.currentSteerAngle += (targetSteer - this.currentSteerAngle) * this.steerSpeed * deltaTime;
    
    // Get current angular velocity
    const angularVel = body.getAngularVelocity();
    const currentYawRate = angularVel.y;
    
    // Calculate desired yaw rate based on steering
    const desiredYawRate = this.currentSteerAngle * 2.0; // Scale angle to rotation rate
    
    // Calculate yaw rate error
    const yawError = desiredYawRate - currentYawRate;
    
    // Apply torque to achieve desired yaw rate
    let torqueMagnitude = yawError * this.steerTorque;
    
    // Counter-steer assist: if spinning too fast, reduce torque
    if (Math.abs(currentYawRate) > Math.abs(desiredYawRate) * 1.5) {
      torqueMagnitude *= this.counterSteerStrength;
    }
    
    // Apply angular impulse around Y axis (Babylon.js doesn't have applyTorque directly)
    // Angular impulse = torque * deltaTime (approximation for integration)
    const angularImpulse = new Vector3(0, torqueMagnitude * deltaTime, 0);
    body.applyAngularImpulse(angularImpulse);
  }

  /**
   * Get current steering angle for visual feedback
   */
  getCurrentSteerAngle() {
    return this.currentSteerAngle;
  }

  /**
   * Reset steering (for respawn)
   */
  reset() {
    this.currentSteerAngle = 0;
  }
}
