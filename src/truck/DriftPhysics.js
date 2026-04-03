import { Vector3 } from "@babylonjs/core";

/**
 * Handles drift physics, grip, drag, and velocity management
 */
export class DriftPhysics {
  constructor(state) {
    this.state = state;
  }

  applyGripAndDrift(speed, forward, groundedness, brakeGripReduction = 1.0) {
    if (speed <= 0.1) {
      this.state.slipAngle = 0;
      this.state.isSpinningOut = false;
      return;
    }

    // No traction correction while airborne
    if (groundedness <= 0) return;

    const velocityDir = this.state.velocity.clone().normalize();
    const forwardVelocity = this.state.velocity.dot(forward);
    const isReversing = forwardVelocity < 0;
    
    // Target direction and velocity
    const targetDir = isReversing ? forward.scale(-1) : forward;
    const targetVelocity = targetDir.scale(speed);
    
    // Calculate slip angle
    this.state.slipAngle = Math.acos(Math.max(-1, Math.min(1, targetDir.dot(velocityDir))));
    
    // Grip effectiveness decreases with slip angle
    const slipAngleFactor = Math.max(0.2, 1 - Math.pow(this.state.slipAngle / 1.5, 2));
    const reverseGripBoost = isReversing ? 15 : 1;
    
    // Apply brake grip reduction (simulates weight transfer reducing rear grip)
    const gripMultiplier = slipAngleFactor * reverseGripBoost * groundedness * brakeGripReduction;
    
    // Apply grip
    this.state.velocity = Vector3.Lerp(this.state.velocity, targetVelocity, gripMultiplier);
    
    // Track spin-out state
    this.state.isSpinningOut = this.state.slipAngle > 0.6 && gripMultiplier < 0.01;
    this.state.isDrifting = this.state.slipAngle > this.state.driftThreshold;
  }

  applyDrag(speed, input, deltaTime, terrainDragMultiplier, groundedness = 1) {
    if (speed > 0.1) {
      // Minimal air resistance when airborne, full drag when grounded
      const airborne = groundedness <= 0;
      const coastingMultiplier = airborne ? 0.02 : (input.forward ? 0.3 : 0.8);
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
      
      const rollFromLateral = lateralSpeed * 0.04;
      const rollFromTurning = turnRate * speed * 0.02;
      this.state.targetRoll = rollFromLateral + rollFromTurning;
      this.state.targetRoll = Math.max(-0.25, Math.min(0.25, this.state.targetRoll));
    } else {
      this.state.targetRoll = 0;
    }
    
    const rollSpeed = groundedness > 0.5 ? 8 : 3;
    this.state.currentRoll += (this.state.targetRoll - this.state.currentRoll) * rollSpeed * deltaTime;
  }
}
