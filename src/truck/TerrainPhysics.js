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
    
    // Add extra downward force when going downhill to keep truck grounded
    // if (track && this.state.velocity.length() > 5) {
    //   const forward = new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
    //   const checkDist = 2.0;
      
    //   const heightAhead = track.getHeightAt(
    //     mesh.position.x + forward.x * checkDist,
    //     mesh.position.z + forward.z * checkDist
    //   );
    //   const heightHere = track.getHeightAt(mesh.position.x, mesh.position.z);
    //   const heightDiff = heightAhead - heightHere;
      
    //   // If going downhill (heightDiff < 0), apply extra downward force
    //   if (heightDiff < -0.25) {
    //     const slopeFactor = Math.abs(heightDiff) / checkDist;
    //     const speedFactor = Math.min(1, this.state.velocity.length() / 30);
    //     const downhillForce = slopeFactor * speedFactor * 120; // Aggressive downward push
    //     this.state.verticalVelocity -= downhillForce * deltaTime;
    //   }
    // }
    
    // Check terrain collision and apply spring force
    const terrainHeight = track ? track.getHeightAt(mesh.position.x, mesh.position.z) : 0;
    const truckBottomY = terrainHeight + 0.4; // 0.4 = half truck height
    const penetration = truckBottomY - mesh.position.y;
    
    if (Math.random() < 0.01) { // Log 1% of frames to avoid spam
      console.log(`[TerrainPhysics] terrain=${terrainHeight.toFixed(2)}, truck.y=${mesh.position.y.toFixed(2)}, truckBottom=${truckBottomY.toFixed(2)}, penetration=${penetration.toFixed(3)}`);
    }

    // Terrain acts as a spring- pushes back when penetrated or very close
    if (penetration > -0.2) {
      const springForce = Math.max(0, penetration) * this.state.springStrength;
      const dampingForce = -this.state.verticalVelocity * this.state.damping;
      
      const totalForce = springForce + dampingForce;
      this.state.verticalVelocity += totalForce * deltaTime;
    }
    
    // Move truck vertically
    mesh.position.y += this.state.verticalVelocity * deltaTime;
    
    // Calculate suspension compression
    // When going downhill, truck may be slightly above terrain but still "grounded"
    let baseCompression = Math.max(0, Math.min(1, penetration / 0.2));
    
    // Check if we're actively following terrain downward (downhill case)
    let isFollowingTerrain = false;
    if (track && penetration < 0 && penetration > -0.1 && this.state.velocity.length() > 2) {
      const forward = new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
      const checkDist = 1.5;
      const heightAhead = track.getHeightAt(
        mesh.position.x + forward.x * checkDist,
        mesh.position.z + forward.z * checkDist
      );
      const heightHere = track.getHeightAt(mesh.position.x, mesh.position.z);
      
      // If terrain is dropping ahead and we're moving down with it
      if (heightAhead < heightHere - 0.3 && this.state.verticalVelocity < -2) {
        isFollowingTerrain = true;
        // Fake some compression as if we're on ground
        baseCompression = 0.3;
      }
    }
    
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
