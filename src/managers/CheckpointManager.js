import { Checkpoint } from "../objects/Checkpoint.js";

/**
 * CheckpointManager - Creates and manages racing checkpoints.
 *
 * Construction and disposal of individual gates is handled by the Checkpoint
 * object class. This manager is responsible for spawning gates from track
 * features, running per-frame passage detection, and reset/dispose lifecycle.
 */
export class CheckpointManager {
  constructor(scene, track, shadows) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;
    this.checkpointMeshes = []; // array of Checkpoint instances
  }

  createCheckpoints() {
    // Find the highest checkpoint number — that gate is the finish line
    let maxCheckpointNumber = 0;
    for (const feature of this.track.features) {
      if (feature.type === "checkpoint" && feature.checkpointNumber !== null) {
        maxCheckpointNumber = Math.max(maxCheckpointNumber, feature.checkpointNumber);
      }
    }

    for (const feature of this.track.features) {
      if (feature.type === "checkpoint") {
        const isFinish = maxCheckpointNumber > 0 && feature.checkpointNumber === maxCheckpointNumber;
        this.createSingleCheckpoint(feature, isFinish);
      }
    }
  }

  /**
   * Check if truck has passed through any checkpoint
   * Returns: { passed: boolean, index: number } or null
   * truckId: unique identifier for the truck (to track individually)
   */
  update(truckPosition, truckVelocity, lastCheckpointPassed, truckId = 'default') {
    for (let i = 0; i < this.checkpointMeshes.length; i++) {
      const checkpoint = this.checkpointMeshes[i];
      const feature = checkpoint.feature;
      
      // Initialize passedBy tracking if not exists
      if (!feature.passedBy) {
        feature.passedBy = new Set();
      }
      
      // Skip if this truck already passed this checkpoint
      if (feature.passedBy.has(truckId)) continue;
      
      // Skip if not the next checkpoint in sequence (if numbered)
      if (feature.checkpointNumber !== null) {
        const expectedNext = lastCheckpointPassed + 1;
        if (feature.checkpointNumber !== expectedNext) {
          continue;
        }
      }
      
      // Check distance to checkpoint
      const dx = truckPosition.x - feature.centerX;
      const dz = truckPosition.z - feature.centerZ;
      
      // Check if truck is within checkpoint width (perpendicular distance)
      const perpX = Math.cos(feature.heading);
      const perpZ = -Math.sin(feature.heading);
      const perpDist = Math.abs(dx * perpX + dz * perpZ);
      
      // Check if truck is near the checkpoint line (along the heading direction)
      const forwardX = Math.sin(feature.heading);
      const forwardZ = Math.cos(feature.heading);
      const forwardDist = dx * forwardX + dz * forwardZ;
      
      // Check if truck is moving in the correct direction (forward through the checkpoint)
      const velocityDotForward = truckVelocity.x * forwardX + truckVelocity.z * forwardZ;
      
      // Trigger only if truck is within width, crosses the line, AND moving in correct direction
      if (perpDist < feature.width / 2 && Math.abs(forwardDist) < 2 && velocityDotForward > 0) {
        feature.passedBy.add(truckId);
        checkpoint.flashGreen();
        return { passed: true, index: feature.checkpointNumber };
      }
    }
    
    return null;
  }

  reset() {
    for (const cp of this.checkpointMeshes) {
      cp.feature.passedBy = new Set();
    }
  }

  dispose() {
    for (const cp of this.checkpointMeshes) cp.dispose();
    this.checkpointMeshes = [];
  }

  rebuild() {
    this.dispose();
    this.createCheckpoints();
  }

  resetForTruck(truckId) {
    for (const cp of this.checkpointMeshes) {
      if (cp.feature.passedBy) {
        cp.feature.passedBy.delete(truckId);
      }
    }
  }

  getTotalCheckpoints() {
    return this.checkpointMeshes.length;
  }
  
  /**
   * Create a single checkpoint visual
   */
  createSingleCheckpoint(feature, isFinish = false) {
    const checkpoint = new Checkpoint(feature, isFinish, this.track, this.scene, this.shadows);
    this.checkpointMeshes.push(checkpoint);
    return checkpoint;
  }
  
  /**
   * Renumber all checkpoints sequentially
   */
  renumberCheckpoints() {
    const checkpointFeatures = this.track.features.filter(f => f.type === 'checkpoint');
    checkpointFeatures.forEach((feature, index) => {
      feature.checkpointNumber = index + 1;
    });

    const maxNum = checkpointFeatures.length;
    for (const checkpoint of this.checkpointMeshes) {
      const isFinish = maxNum > 0 && checkpoint.feature.checkpointNumber === maxNum;
      checkpoint.updateDecal(checkpoint.feature.checkpointNumber, isFinish);
    }
  }
}
