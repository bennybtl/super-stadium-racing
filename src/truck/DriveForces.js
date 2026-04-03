import { Vector3 } from "@babylonjs/core";

/**
 * DriveForces - Handles acceleration and braking forces for physics truck
 * 
 * Applies forces to the chassis based on throttle/brake input and wheel contacts.
 * Uses force-based approach instead of direct velocity manipulation.
 */
export class DriveForces {
  constructor() {
    // Drive parameters
    this.motorTorque = 35000;        // Maximum motor force (N) - increased for better acceleration
    this.brakingForce = 12000;       // Maximum braking force (N)
    this.reverseMultiplier = 0.6;    // Reverse is weaker than forward
    
    // Speed limits (for force scaling)
    this.maxSpeed = 40;              // m/s (~90 mph) - increased top speed
    this.maxReverseSpeed = 12;       // m/s (~27 mph)
    
    // Traction control
    this.minWheelsForTraction = 2;   // Need at least 2 wheels grounded
  }

  /**
   * Update drive forces based on input
   * @param {PhysicsBody} body - The truck's physics body
   * @param {Object} input - Input state {throttle, brake, boost}
   * @param {Array} wheelContacts - Array of wheel contact info from suspension
   * @param {Vector3} forward - Forward direction vector
   * @param {number} currentSpeed - Current forward speed
   * @param {number} deltaTime - Time step
   */
  update(body, input, wheelContacts, forward, currentSpeed, deltaTime) {
    // Check if we have enough wheels on ground for traction
    const groundedWheels = wheelContacts.filter(c => c.compression > 0.01);
    if (groundedWheels.length < this.minWheelsForTraction) {
      return; // No traction, skip force application
    }

    // Determine if moving forward or backward
    const isReversing = currentSpeed < -0.5;
    const isMovingForward = currentSpeed > 0.5;
    
    // Calculate throttle force
    let driveForce = 0;
    
    if (input.throttle > 0) {
      // Forward acceleration
      const speedRatio = Math.max(0, 1 - currentSpeed / this.maxSpeed);
      driveForce = input.throttle * this.motorTorque * speedRatio;
      
      // Boost multiplier
      if (input.boost) {
        driveForce *= 2.0;
      }
    } else if (input.throttle < 0) {
      // Reverse acceleration
      const speedRatio = Math.max(0, 1 - Math.abs(currentSpeed) / this.maxReverseSpeed);
      driveForce = input.throttle * this.motorTorque * this.reverseMultiplier * speedRatio;
    }
    
    // Calculate brake force
    let brakeForce = 0;
    if (input.brake > 0) {
      // Braking opposes current velocity
      brakeForce = -Math.sign(currentSpeed) * input.brake * this.brakingForce;
    }
    
    // Combine forces
    const totalForce = driveForce + brakeForce;
    
    if (Math.abs(totalForce) > 0.1) {
      // Apply force at rear axle height for proper weight transfer
      // When accelerating: force pushes rear wheels forward (at ground level)
      // -> creates pitch moment -> front lifts up, rear squats down
      const forceVector = forward.scale(totalForce);
      
      // Calculate rear axle position (below center of mass, at rear)
      const rearAxleOffset = new Vector3(0, -0.8, -1.5); // Below COM, at rear wheel Z
      const rearAxleWorld = body.transformNode.position.add(
        Vector3.TransformNormal(rearAxleOffset, body.transformNode.getWorldMatrix())
      );
      
      body.applyForce(forceVector, rearAxleWorld);
    }
  }

  /**
   * Apply basic drag force to slow down the truck
   */
  applyDrag(body, currentSpeed, dragMultiplier = 1.0) {
    if (Math.abs(currentSpeed) < 0.1) return;
    
    // Quadratic drag: F = -c * v^2 * sign(v)
    const dragCoefficient = 8 * dragMultiplier;
    const dragForce = -dragCoefficient * currentSpeed * Math.abs(currentSpeed);
    
    const velocity = body.getLinearVelocity();
    const velocityDirection = velocity.normalize();
    const dragVector = velocityDirection.scale(dragForce);
    
    body.applyForce(dragVector, body.transformNode.position);
  }
}
