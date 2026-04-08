import { Vector3 } from "@babylonjs/core";
import { TRUCK_HALF_HEIGHT as _DEFAULT_HALF_HEIGHT } from "../constants.js";

/**
 * Tunable constants for downhill terrain tracking.
 * Tweak these to adjust how aggressively the truck hugs the ground on descents.
 */
const DOWNHILL = {
  // --- Terrain-following detection (first pass) ---
  // How far above terrain the truck can be and still trigger following (m)
  followMaxGap:          0.15,
  // Minimum truck speed (m/s) before checking terrain following
  followMinSpeed:        2,
  // Look-ahead distance (m) for terrain height sampling
  followLookAhead:       1.5,
  // Terrain must drop at least this much over followLookAhead to trigger following
  followHeightDrop:      0.3,
  // Must be descending faster than this (m/s, negative = down) to trigger following
  followVertVelMin:     -1.5,
  // Fake suspension compression injected when following terrain downhill
  followFakeCompression: 0.5,

  // --- Suspension compression ---
  // How much downward velocity contributes to extra compression
  velCompressionFactor:  0.03,
  // Base compression scale applied to baseCompression
  compressionBaseScale:  0.08,
  // Exponential smoothing factor for suspension compression (0–1, higher = snappier)
  suspensionSmoothing:   0.3,
  // Maximum suspension compression value
  maxCompression:        0.25,
  // Compression value at which groundedness reaches 1.0
  groundednessRef:       0.08,

  // --- Groundedness boost (second pass) ---
  // Max distance above terrain to still consider the boost check (m)
  boostMaxGap:           0.4,
  // Must be descending faster than this (m/s) to trigger boost
  boostVertVelMin:      -0.5,
  // Minimum truck speed (m/s) to trigger boost
  boostMinSpeed:         2,
  // Look-ahead distance (m) for boost check
  boostLookAhead:        2.0,
  // Terrain must drop at least this much over boostLookAhead to apply boost
  boostHeightDrop:       0.3,
  // Groundedness clamped to at least this value when tracking downhill
  boostGroundedness:     0.8,
};

/**
 * Handles terrain-related physics: gravity, suspension, slope collision
 */
export class TerrainPhysics {
  constructor(state, halfHeight = _DEFAULT_HALF_HEIGHT) {
    this.state = state;
    this.halfHeight = halfHeight;
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
    
    // --- Pass 1: terrain-following detection ---
    // If the truck is slightly above terrain but moving downhill with it,
    // inject fake compression so it stays "grounded" through the descent.
    let isFollowingTerrain = false;
    if (
      track &&
      penetration < 0 &&
      penetration > -DOWNHILL.followMaxGap &&
      this.state.velocity.length() > DOWNHILL.followMinSpeed
    ) {
      const forward = new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
      const heightAhead = track.getHeightAt(
        mesh.position.x + forward.x * DOWNHILL.followLookAhead,
        mesh.position.z + forward.z * DOWNHILL.followLookAhead
      );
      const heightHere = track.getHeightAt(mesh.position.x, mesh.position.z);

      if (heightAhead < heightHere - DOWNHILL.followHeightDrop &&
          this.state.verticalVelocity < DOWNHILL.followVertVelMin) {
        isFollowingTerrain = true;
        baseCompression = DOWNHILL.followFakeCompression;
      }
    }

    let targetCompression = 0;
    if (baseCompression > 0) {
      const velocityCompression = Math.max(0, -this.state.verticalVelocity * DOWNHILL.velCompressionFactor);
      targetCompression = (baseCompression * DOWNHILL.compressionBaseScale) + velocityCompression;
    }

    this.state.suspensionCompression += (targetCompression - this.state.suspensionCompression) * DOWNHILL.suspensionSmoothing;
    this.state.suspensionCompression = Math.max(0, Math.min(DOWNHILL.maxCompression, this.state.suspensionCompression));

    // --- Pass 2: groundedness boost ---
    // Even if suspension compression is low, keep the truck considered "grounded"
    // when it is clearly tracking a descending slope.
    let groundedness = Math.min(1, this.state.suspensionCompression / DOWNHILL.groundednessRef);

    if (
      groundedness < DOWNHILL.boostGroundedness &&
      penetration > -DOWNHILL.boostMaxGap &&
      this.state.verticalVelocity < DOWNHILL.boostVertVelMin &&
      track &&
      this.state.velocity.length() > DOWNHILL.boostMinSpeed
    ) {
      const forward = new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
      const heightAhead = track.getHeightAt(
        mesh.position.x + forward.x * DOWNHILL.boostLookAhead,
        mesh.position.z + forward.z * DOWNHILL.boostLookAhead
      );
      const heightHere = track.getHeightAt(mesh.position.x, mesh.position.z);

      if (heightAhead < heightHere - DOWNHILL.boostHeightDrop) {
        groundedness = Math.max(groundedness, DOWNHILL.boostGroundedness);
      }
    }
    
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

    const truckBottom = mesh.position.y - this.halfHeight;

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
    const maxSlopeAngle = Math.PI / 3;
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
