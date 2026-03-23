import { 
  MeshBuilder, 
  StandardMaterial, 
  Color3, 
  Vector3,
  DynamicTexture 
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
        const terrainHeight = this.track.getHeightAt(feature.centerX, feature.centerZ);
        
        // Calculate positions for the two barrels
        const halfWidth = feature.width / 2;
        const perpX = Math.cos(feature.heading); // Perpendicular to heading
        const perpZ = -Math.sin(feature.heading);
        
        const pos1 = new Vector3(
          feature.centerX + perpX * halfWidth,
          terrainHeight + 1,
          feature.centerZ + perpZ * halfWidth
        );
        const pos2 = new Vector3(
          feature.centerX - perpX * halfWidth,
          terrainHeight + 1,
          feature.centerZ - perpZ * halfWidth
        );
        
        // Create barrels (cylinders)
        const barrel1 = MeshBuilder.CreateCylinder("barrel1", { height: 2, diameter: 1 }, this.scene);
        barrel1.position = pos1;
        const barrel2 = MeshBuilder.CreateCylinder("barrel2", { height: 2, diameter: 1 }, this.scene);
        barrel2.position = pos2;
        
        const barrelMat = new StandardMaterial("barrelMat", this.scene);
        barrelMat.diffuseColor = new Color3(0.8, 0.5, 0.1);
        barrel1.material = barrelMat;
        barrel2.material = barrelMat;
        
        // Create arrow mesh between barrels
        const arrowLength = feature.width - 2;
        const arrow = MeshBuilder.CreateBox("arrow", { width: arrowLength, height: 0.2, depth: 1.5 }, this.scene);
        arrow.position = new Vector3(feature.centerX, terrainHeight + 2.5, feature.centerZ);
        arrow.rotation.y = feature.heading;
        
        const arrowMat = new StandardMaterial("arrowMat", this.scene);
        arrowMat.diffuseColor = new Color3(1, 1, 0);
        arrowMat.emissiveColor = new Color3(0.3, 0.3, 0);
        arrow.material = arrowMat;
        
        // Create arrow head (triangle)
        const arrowHead = MeshBuilder.CreateCylinder("arrowHead", { 
          diameterTop: 0, 
          diameterBottom: 2, 
          height: 2 
        }, this.scene);
        arrowHead.rotation.x = Math.PI / 2;
        arrowHead.rotation.y = feature.heading;
        const forwardX = Math.sin(feature.heading);
        const forwardZ = Math.cos(feature.heading);
        arrowHead.position = new Vector3(
          feature.centerX + forwardX * (arrowLength / 2 + 1),
          terrainHeight + 2.5,
          feature.centerZ + forwardZ * (arrowLength / 2 + 1)
        );
        arrowHead.material = arrowMat;
        
        // Create checkpoint number display if numbered
        let numberPlane = null;
        if (feature.checkpointNumber !== null) {
          const planeSize = 3;
          numberPlane = MeshBuilder.CreatePlane("numberPlane", { size: planeSize }, this.scene);
          numberPlane.position = new Vector3(
            feature.centerX,
            terrainHeight + 4,
            feature.centerZ
          );
          numberPlane.billboardMode = 7; // Always face camera
          
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
        
        this.checkpointMeshes.push({ feature, barrel1, barrel2, arrow, arrowHead, numberPlane });
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
}
