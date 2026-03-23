import { 
  MeshBuilder, 
  StandardMaterial, 
  Color3, 
  Vector3,
  DynamicTexture,
  TransformNode
} from "@babylonjs/core";

/**
 * CheckpointManager - Creates and manages racing checkpoints
 */
export class CheckpointManager {
  constructor(scene, track, shadows) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;
    this.checkpointMeshes = [];
  }

  createCheckpoints() {
    // Create visual representation for each checkpoint
    for (const feature of this.track.features) {
      if (feature.type === "checkpoint") {
        this.createSingleCheckpoint(feature);
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
        
        // Visual feedback - change arrow color temporarily
        checkpoint.arrow.material.diffuseColor = new Color3(0, 1, 0);
        checkpoint.arrowHead.material.diffuseColor = new Color3(0, 1, 0);
        
        setTimeout(() => {
          checkpoint.arrow.material.diffuseColor = new Color3(1, 1, 0);
          checkpoint.arrowHead.material.diffuseColor = new Color3(1, 1, 0);
        }, 1000);
        
        return { passed: true, index: feature.checkpointNumber }; // Return checkpoint number, not array index
      }
    }
    
    return null;
  }

  reset() {
    for (const cp of this.checkpointMeshes) {
      cp.feature.passedBy = new Set();
    }
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
  createSingleCheckpoint(feature) {
    const terrainHeight = this.track.getHeightAt(feature.centerX, feature.centerZ);
    
    // Create parent container for the entire checkpoint
    const container = new TransformNode("checkpointContainer", this.scene);
    container.position = new Vector3(feature.centerX, terrainHeight, feature.centerZ);
    container.rotation.y = feature.heading;
    
    // Calculate positions for the two barrels (relative to container)
    const halfWidth = feature.width / 2;
    const perpX = Math.cos(0); // Relative to container's local space
    const perpZ = -Math.sin(0);
    
    // Create barrels (cylinders) - positioned relative to container
    const barrel1 = MeshBuilder.CreateCylinder("barrel1", { height: 2, diameter: 1 }, this.scene);
    barrel1.position = new Vector3(perpX * halfWidth, 1, perpZ * halfWidth);
    barrel1.parent = container;
    
    const barrel2 = MeshBuilder.CreateCylinder("barrel2", { height: 2, diameter: 1 }, this.scene);
    barrel2.position = new Vector3(-perpX * halfWidth, 1, -perpZ * halfWidth);
    barrel2.parent = container;
    
    const barrelMat = new StandardMaterial("barrelMat", this.scene);
    barrelMat.diffuseColor = new Color3(0.8, 0.5, 0.1);
    barrel1.material = barrelMat;
    barrel2.material = barrelMat;
    
    // Create arrow mesh between barrels - positioned relative to container
    const arrowLength = feature.width - 2;
    const arrow = MeshBuilder.CreateBox("arrow", { width: arrowLength, height: 0.2, depth: 1.5 }, this.scene);
    arrow.position = new Vector3(0, 2.5, 0);
    arrow.parent = container;
    
    const arrowMat = new StandardMaterial("arrowMat", this.scene);
    arrowMat.diffuseColor = new Color3(1, 1, 0);
    arrowMat.emissiveColor = new Color3(0.3, 0.3, 0);
    arrow.material = arrowMat;
    
    // Create arrow head (triangle) - positioned relative to container
    const arrowHead = MeshBuilder.CreateCylinder("arrowHead", { 
      diameterTop: 0, 
      diameterBottom: 2, 
      height: 2 
    }, this.scene);
    arrowHead.rotation.x = Math.PI / 2;
    arrowHead.position = new Vector3(0, 2.5, arrowLength / 2 + 1);
    arrowHead.parent = container;
    arrowHead.material = arrowMat;
    
    // Create checkpoint number display if numbered
    let numberPlane = null;
    if (feature.checkpointNumber !== null) {
      const planeSize = 3;
      numberPlane = MeshBuilder.CreatePlane("numberPlane", { size: planeSize }, this.scene);
      numberPlane.position = new Vector3(0, 4, 0);
      numberPlane.billboardMode = 7; // Always face camera
      numberPlane.parent = container;
      
      // Create dynamic texture for the number
      const numberTexture = new DynamicTexture("numberTexture", { width: 256, height: 256 }, this.scene);
      const ctx = numberTexture.getContext();
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, 256, 256);
      ctx.font = "bold 180px Arial";
      ctx.fillStyle = "yellow";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(feature.checkpointNumber.toString(), 128, 128);
      numberTexture.update();
      
      const numberMat = new StandardMaterial("numberMat", this.scene);
      numberMat.diffuseTexture = numberTexture;
      numberMat.emissiveTexture = numberTexture;
      numberMat.opacityTexture = numberTexture;
      numberPlane.material = numberMat;
    }
    
    // Add shadows
    if (this.shadows) {
      this.shadows.addShadowCaster(barrel1);
      this.shadows.addShadowCaster(barrel2);
    }
    
    // Store checkpoint data
    const checkpointData = {
      feature,
      container,
      barrel1,
      barrel2,
      arrow,
      arrowHead,
      numberPlane
    };
    
    this.checkpointMeshes.push(checkpointData);
    
    return checkpointData;
  }
  
  /**
   * Renumber all checkpoints sequentially
   */
  renumberCheckpoints() {
    // Update feature checkpoint numbers
    const checkpointFeatures = this.track.features.filter(f => f.type === 'checkpoint');
    checkpointFeatures.forEach((feature, index) => {
      feature.checkpointNumber = index + 1;
    });
    
    // Update visual numbers
    this.checkpointMeshes.forEach(checkpoint => {
      if (checkpoint.numberPlane) {
        // Update texture with new number
        const numberTexture = checkpoint.numberPlane.material.diffuseTexture;
        const ctx = numberTexture.getContext();
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, 256, 256);
        ctx.font = "bold 180px Arial";
        ctx.fillStyle = "yellow";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(checkpoint.feature.checkpointNumber.toString(), 128, 128);
        numberTexture.update();
      }
    });
  }
}
