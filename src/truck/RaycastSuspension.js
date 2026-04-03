import { Vector3, PhysicsRaycastResult } from "@babylonjs/core";

/**
 * RaycastSuspension - Implements raycast-based suspension for physics truck
 * 
 * Uses raycasts from wheel positions to detect ground, applies spring/damper forces
 * to simulate suspension. Simpler and more stable than constraint-based suspension.
 */
export class RaycastSuspension {
  constructor(scene) {
    this.scene = scene;
    
    // Wheel configuration - 2-wheel model (like a motorcycle) for stability
    // Single front wheel and single rear wheel at center line
    this.wheels = [
      { name: "F", offsetX: 0, offsetZ: 1.5, isRear: false, compressionVelocity: 0, compression: 0 },
      { name: "R", offsetX: 0, offsetZ: -1.5, isRear: true, compressionVelocity: 0, compression: 0 },
    ];
    
    // Suspension parameters
    this.suspensionTravel = 0.5;     // Maximum suspension travel (meters)
    this.springStiffness = 30000;     // Spring constant (N/m) - increased since we only have 2 wheels
    this.damping = 6000;              // Damping coefficient (N*s/m)
    this.wheelRadius = 0.75;           // Wheel radius for ground offset
    this.restHeight = 0.4;            // Rest height of chassis above ground
    
    // Raycast results cache
    this.raycastResults = this.wheels.map(() => new PhysicsRaycastResult());
  }

  /**
   * Update suspension for all wheels
   * @param {PhysicsBody} body - The truck's physics body
   * @param {Mesh} mesh - The truck's mesh (for position)
   * @param {Track} track - The track for heightmap queries
   * @param {number} deltaTime - Time step
   * @returns {Object} Contact information for all wheels
   */
  update(body, mesh, track, deltaTime) {
    const contacts = [];
    const up = Vector3.Up();
    
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i];
      
      // Calculate wheel world position
      const wheelLocalPos = new Vector3(wheel.offsetX, 0, wheel.offsetZ);
      const wheelWorldPos = Vector3.TransformCoordinates(wheelLocalPos, mesh.getWorldMatrix());
      
      // Raycast downward from wheel position
      const rayStart = wheelWorldPos.add(up.scale(this.suspensionTravel * 0.5));
      const rayEnd = wheelWorldPos.add(up.scale(-(this.suspensionTravel + this.wheelRadius)));
      
      // Perform raycast using track heightmap (faster than physics raycast)
      let hitDistance = null;
      let hitPoint = null;
      
      if (track) {
        const groundHeight = track.getHeightAt(wheelWorldPos.x, wheelWorldPos.z);
        const wheelBottom = wheelWorldPos.y - this.wheelRadius;
        
        if (groundHeight > rayEnd.y && groundHeight < rayStart.y) {
          hitDistance = wheelWorldPos.y - groundHeight - this.wheelRadius;
          hitPoint = new Vector3(wheelWorldPos.x, groundHeight, wheelWorldPos.z);
        }
      }
      
      // Calculate suspension compression
      const previousCompression = wheel.compression;
      
      if (hitDistance !== null && hitDistance < this.suspensionTravel) {
        // Wheel is in contact with ground
        wheel.compression = this.suspensionTravel - hitDistance;
        
        // Calculate compression velocity for damping
        wheel.compressionVelocity = (wheel.compression - previousCompression) / deltaTime;
        
        // Spring force: F = k * x
        const springForce = wheel.compression * this.springStiffness;
        
        // Damping force: F = c * v
        const dampingForce = wheel.compressionVelocity * this.damping;
        
        // Total upward force
        const totalForce = springForce + dampingForce;
        
        // Apply force to physics body at wheel position
        const forceVector = up.scale(totalForce);
        body.applyForce(forceVector, wheelWorldPos);
        
        contacts.push({
          wheel,
          worldPosition: wheelWorldPos,
          hitPoint,
          compression: wheel.compression,
          force: totalForce
        });
      } else {
        // Wheel not touching ground
        wheel.compression = 0;
        wheel.compressionVelocity = 0;
      }
    }
    
    // No anti-roll needed for 2-wheel model
    
    return contacts;
  }

  /**
   * Get average compression of all wheels (for visual effects)
   */
  getAverageCompression() {
    const total = this.wheels.reduce((sum, wheel) => sum + wheel.compression, 0);
    return total / this.wheels.length;
  }

  /**
   * Check if truck is grounded (at least one wheel touching)
   */
  isGrounded() {
    return this.wheels.some(wheel => wheel.compression > 0.01);
  }

  /**
   * Get number of wheels in contact with ground
   */
  getGroundedWheelCount() {
    return this.wheels.filter(wheel => wheel.compression > 0.01).length;
  }
}
