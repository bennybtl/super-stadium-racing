import { Vector3 } from "@babylonjs/core";
import { TRUCK_HALF_HEIGHT } from "../constants.js";
/**
 * Handles terrain-related physics: gravity, suspension, slope collision
 */
export class TerrainPhysics {
  constructor(state) {
    this.state = state;
    this.gravity = -30;
  }

  update(mesh, deltaTime, track) {
    // Apply gravity
    this.state.verticalVelocity += this.gravity * deltaTime;
    
    // Check terrain collision and apply spring force
    const terrainHeight = track ? track.getHeightAt(mesh.position.x, mesh.position.z) : 0;
    const truckBottomY = terrainHeight + 0.4; // 0.4 = half truck height
    const penetration = truckBottomY - mesh.position.y;
    
    // Terrain acts as a spring - pushes back when penetrated or very close
    if (penetration > -0.2) {
      const springForce = Math.max(0, penetration) * this.state.springStrength;
      const dampingForce = -this.state.verticalVelocity * this.state.damping;
      
      const totalForce = springForce + dampingForce;
      this.state.verticalVelocity += totalForce * deltaTime;
    }
    
    // Move truck vertically
    mesh.position.y += this.state.verticalVelocity * deltaTime;
    
    // Calculate suspension compression
    const baseCompression = Math.max(0, Math.min(1, penetration / 0.2));
    let targetCompression = 0;
    if (baseCompression > 0) {
      const velocityCompression = Math.max(0, -this.state.verticalVelocity * 0.03);
      targetCompression = (baseCompression * 0.08) + velocityCompression;
    }
    
    this.state.suspensionCompression += (targetCompression - this.state.suspensionCompression) * 0.3;
    this.state.suspensionCompression = Math.max(0, Math.min(0.25, this.state.suspensionCompression));
    
    // Calculate groundedness from compression
    const groundedness = Math.min(1, this.state.suspensionCompression / 0.08);
    
    // Calculate visual pitch/roll when on or near ground
    if (groundedness > 0.3 && track) {
      this.updateTerrainOrientation(mesh, track, deltaTime);
    } else {
      // Smoothly return to flat when airborne
      const airFactor = 1 - Math.exp(-10 * deltaTime);
      this.state.terrainPitch += (0 - this.state.terrainPitch) * airFactor;
      this.state.terrainRoll  += (0 - this.state.terrainRoll)  * airFactor;
      mesh.rotation.x = -this.state.terrainPitch;
    }
    
    return { groundedness, penetration };
  }

  updateTerrainOrientation(mesh, track, deltaTime) {
    const forward = new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
    const right = new Vector3(Math.cos(this.state.heading), 0, -Math.sin(this.state.heading));
    const slopeCheckDist = 0.3;
    
    const heightAheadVisual = track.getHeightAt(
      mesh.position.x + forward.x * slopeCheckDist,
      mesh.position.z + forward.z * slopeCheckDist
    );
    const heightBehindVisual = track.getHeightAt(
      mesh.position.x - forward.x * slopeCheckDist,
      mesh.position.z - forward.z * slopeCheckDist
    );
    const targetPitch = Math.atan2(heightAheadVisual - heightBehindVisual, slopeCheckDist * 2);
    
    const heightRight = track.getHeightAt(
      mesh.position.x + right.x * slopeCheckDist,
      mesh.position.z + right.z * slopeCheckDist
    );
    const heightLeft = track.getHeightAt(
      mesh.position.x - right.x * slopeCheckDist,
      mesh.position.z - right.z * slopeCheckDist
    );
    const targetRoll = Math.atan2(heightRight - heightLeft, slopeCheckDist * 2);

    // Exponential smoothing — frame-rate independent, damps sudden angle spikes
    const factor = 1 - Math.exp(-10 * deltaTime);
    this.state.terrainPitch += (targetPitch - this.state.terrainPitch) * factor;
    this.state.terrainRoll  += (targetRoll  - this.state.terrainRoll)  * factor;

    mesh.rotation.x = -this.state.terrainPitch;
  }

  checkSteepSlope(mesh, deltaTime, track) {
    if (!track || this.state.velocity.length() <= 0.1) {
      return mesh.position.add(this.state.velocity.scale(deltaTime));
    }

    const truckBottom = mesh.position.y - TRUCK_HALF_HEIGHT;

    // Skip slope blocking when the truck is airborne — the slope is below the truck
    const terrainHere = track.getHeightAt(mesh.position.x, mesh.position.z);
    if (truckBottom > terrainHere + 0.2) {
      return mesh.position.add(this.state.velocity.scale(deltaTime));
    }

    const moveDir = this.state.velocity.clone().normalize();
    const moveDirHeading = Math.atan2(moveDir.x, moveDir.z);

    const slopeDeg = track.getTerrainSlopeAt(mesh.position.x, mesh.position.z, moveDirHeading, 1, 3);
    const slopeAngle = slopeDeg * Math.PI / 180;

    // Only block upward slopes steeper than 45 degrees
    const maxSlopeAngle = Math.PI / 4;
    if (slopeDeg > 0 && slopeAngle > maxSlopeAngle) {
      // Also skip if the forward sample terrain is below the truck's bottom —
      // the slope is literally below the truck's trajectory (e.g. cresting a hill)
      const forwardX = mesh.position.x + moveDir.x * 4;
      const forwardZ = mesh.position.z + moveDir.z * 4;
      const terrainAtForward = track.getHeightAt(forwardX, forwardZ);
      if (terrainAtForward < truckBottom) {
        return mesh.position.add(this.state.velocity.scale(deltaTime));
      }

      const velocityIntoSlope = this.state.velocity.dot(moveDir);
      if (velocityIntoSlope > 0) {
        const normalComponent = moveDir.scale(velocityIntoSlope * 0.9);
        this.state.velocity.subtractInPlace(normalComponent);
      }
    }
    
    return mesh.position.add(this.state.velocity.scale(deltaTime));
  }
}
