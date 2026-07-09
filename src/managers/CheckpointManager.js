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
    this._maxCheckpointNumber = 0;
    this._activeCheckpointNumber = null;
  }

  createCheckpoints(reverse = false) {
    // Collect checkpoints in track order and group them into sequential steps.
    // Consecutive checkpoints flagged `alternative` share the previous step —
    // passing any gate of a step advances the lap ("one or the other").
    const cpFeatures = this.track.features.filter(f => f.type === "checkpoint");
    const groups = CheckpointManager.groupIntoSteps(cpFeatures);

    // Build the step order for this run. Reverse keeps each group intact and
    // keeps the finish group last: (last-1 … first, last).
    let orderedGroups;
    if (reverse && groups.length > 0) {
      orderedGroups = [...groups.slice(0, -1).reverse(), groups[groups.length - 1]];
    } else {
      orderedGroups = groups;
    }

    const maxCheckpointNumber = orderedGroups.length;
    this._maxCheckpointNumber = maxCheckpointNumber;

    orderedGroups.forEach((group, gi) => {
      const step = gi + 1;
      const isFinish = step === maxCheckpointNumber;
      group.forEach((f, ai) => {
        // Reverse runs on clones so the source features keep their forward
        // heading; forward runs number the features in place.
        const feature = reverse
          ? { ...f, heading: f.heading + Math.PI, passedBy: new Set() }
          : f;
        feature.checkpointNumber = step;
        feature._altIndex = ai;         // position within the step (0 => 'a')
        feature._altCount = group.length; // >1 means alternatives share this step
        this.createSingleCheckpoint(feature, isFinish);
      });
    });

    this._applyActiveCheckpointHighlight();
  }

  /**
   * Group ordered checkpoint features into steps. Each checkpoint starts a new
   * step unless it is flagged `alternative` (then it joins the previous step).
   * The first checkpoint always starts step 1. Returns an array of feature groups.
   */
  static groupIntoSteps(orderedCheckpointFeatures) {
    const groups = [];
    orderedCheckpointFeatures.forEach((f, i) => {
      if (i === 0 || !f.alternative || groups.length === 0) groups.push([f]);
      else groups[groups.length - 1].push(f);
    });
    return groups;
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
      
      // Initialize passedBy tracking if not exists or was deserialized from JSON as a plain object
      if (!(feature.passedBy instanceof Set)) {
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
        return { passed: true, index: feature.checkpointNumber };
      }
    }
    
    return null;
  }

  reset() {
    for (const cp of this.checkpointMeshes) {
      cp.feature.passedBy = new Set();
    }
    this.clearPlayerCheckpointHighlight();
  }

  dispose() {
    for (const cp of this.checkpointMeshes) cp.dispose();
    this.checkpointMeshes = [];
    this._maxCheckpointNumber = 0;
    this._activeCheckpointNumber = null;
  }

  rebuild() {
    this.dispose();
    this.createCheckpoints(this._reverse ?? false);
  }

  resetForTruck(truckId) {
    for (const cp of this.checkpointMeshes) {
      if (cp.feature.passedBy instanceof Set) {
        cp.feature.passedBy.delete(truckId);
      }
    }
  }

  /** Number of sequential steps to complete a lap (alternatives share a step). */
  getTotalCheckpoints() {
    return this._maxCheckpointNumber;
  }

  updatePlayerCheckpointHighlight(lastCheckpointPassed) {
    if (this._maxCheckpointNumber <= 0) {
      this.clearPlayerCheckpointHighlight();
      return;
    }

    this._activeCheckpointNumber = lastCheckpointPassed >= this._maxCheckpointNumber
      ? 1
      : lastCheckpointPassed + 1;
    this._applyActiveCheckpointHighlight();
  }

  clearPlayerCheckpointHighlight() {
    this._activeCheckpointNumber = null;
    this._applyActiveCheckpointHighlight();
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
   * Renumber all checkpoints into steps (alternatives share the previous step).
   */
  renumberCheckpoints() {
    const checkpointFeatures = this.track.features.filter(f => f.type === 'checkpoint');
    const checkpointByFeature = new Map(
      this.checkpointMeshes.map(checkpoint => [checkpoint.feature, checkpoint])
    );

    const groups = CheckpointManager.groupIntoSteps(checkpointFeatures);
    groups.forEach((group, gi) => {
      group.forEach((f, ai) => {
        f.checkpointNumber = gi + 1;
        f._altIndex = ai;
        f._altCount = group.length;
      });
    });

    const maxNum = groups.length;
    this.checkpointMeshes = checkpointFeatures
      .map(feature => checkpointByFeature.get(feature))
      .filter(Boolean);

    this._maxCheckpointNumber = maxNum;
    for (const checkpoint of this.checkpointMeshes) {
      const isFinish = maxNum > 0 && checkpoint.feature.checkpointNumber === maxNum;
      checkpoint.updateDecal(checkpoint.feature.checkpointNumber, isFinish);
    }

    this._applyActiveCheckpointHighlight();
  }

  _applyActiveCheckpointHighlight() {
    for (const checkpoint of this.checkpointMeshes) {
      checkpoint.setActive(
        this._activeCheckpointNumber !== null &&
        checkpoint.feature.checkpointNumber === this._activeCheckpointNumber
      );
    }
  }
}
