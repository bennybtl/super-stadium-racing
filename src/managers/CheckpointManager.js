import { 
  MeshBuilder, 
  StandardMaterial, 
  Color3, 
  Vector3,
  DynamicTexture,
  TransformNode
} from "@babylonjs/core";

/**
 * Simple seeded PRNG (mulberry32) — returns a function that yields [0, 1) floats.
 * Using the checkpoint number as the seed gives each gate a consistent wear pattern.
 */
function _seededRng(seed) {
  let s = seed * 2654435761 >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

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
    // Find the highest checkpoint number — that gate is the finish line
    let maxCheckpointNumber = 0;
    for (const feature of this.track.features) {
      if (feature.type === "checkpoint" && feature.checkpointNumber !== null) {
        maxCheckpointNumber = Math.max(maxCheckpointNumber, feature.checkpointNumber);
      }
    }

    // Create visual representation for each checkpoint
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
        
        // Visual feedback - flash barrels green briefly
        checkpoint.barrel1.material.diffuseColor = new Color3(0, 1, 0);
        checkpoint.barrel2.material.diffuseColor = new Color3(0, 1, 0);
        
        setTimeout(() => {
          checkpoint.barrel1.material.diffuseColor = new Color3(0.8, 0.5, 0.1);
          checkpoint.barrel2.material.diffuseColor = new Color3(0.8, 0.5, 0.1);
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
  createSingleCheckpoint(feature, isFinish = false) {
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
        
    // Create ground stencil decal between the barrels:
    // a square border with a direction triangle at the top and the checkpoint number centred.
    let decal = null;
    if (feature.checkpointNumber !== null) {
      const texSize = 512;
      const decalTexture = new DynamicTexture("cpDecalTex", { width: texSize, height: texSize }, this.scene);
      const ctx = decalTexture.getContext();

      ctx.clearRect(0, 0, texSize, texSize);

      if (isFinish) {
        const decalSize = feature.width * 0.82;

        decal = MeshBuilder.CreatePlane("cpDecal", { width: decalSize, height: decalSize }, this.scene);
        decal.rotation.x = Math.PI / 2; // Lay flat on the ground
        decal.position = new Vector3(0, 0.06, 0); // Just above ground to avoid z-fighting
        decal.parent = container;

        // Finish line: checkerboard whose column count scales with gate width
        const cols = Math.max(2, Math.round(feature.width / 2.5));
        const rows = 4;
        const rectH = Math.round(texSize * 0.38);
        const rectY = Math.round((texSize - rectH) / 2);
        const cellW = texSize / cols;
        const cellH = cellW;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            ctx.fillStyle = (r + c) % 2 === 0 ? "white" : "transparent";
            ctx.fillRect(c * cellW, rectY + r * cellH, cellW, cellH);
          }
        }
        // Worn stencil effect on the finish line too
        ctx.globalCompositeOperation = "destination-out";
        const rng = _seededRng(feature.checkpointNumber);
        for (let i = 0; i < 2500; i++) {
          const r = rng() * 4.5 + 0.5;
          ctx.beginPath();
          ctx.arc(rng() * texSize, rng() * texSize, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      } else {
        const decalSize = 8; // Fixed world-unit size — does not scale with gate width

        decal = MeshBuilder.CreatePlane("cpDecal", { width: decalSize, height: decalSize }, this.scene);
        decal.rotation.x = Math.PI / 2; // Lay flat on the ground
        decal.position = new Vector3(0, 0.06, 0); // Just above ground to avoid z-fighting
        decal.parent = container;

        // Direction triangle — sits ABOVE the square, outside it
        const triCX = texSize / 2;
        const triTop = 20;
        const triBase = 120;
        const triHalfW = 70;
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.moveTo(triCX, triTop);
        ctx.lineTo(triCX - triHalfW, triBase);
        ctx.lineTo(triCX + triHalfW, triBase);
        ctx.closePath();
        ctx.fill();

        // Square border — occupies the lower portion, below the triangle
        const sqTop = 148;
        const sqPad = 136;
        const sqLeft = sqPad;
        const sqRight = texSize - sqPad;
        const sqBottom = texSize - sqPad;
        ctx.strokeStyle = "white";
        ctx.lineWidth = 18;
        ctx.strokeRect(sqLeft, sqTop, sqRight - sqLeft, sqBottom - sqTop);

        // Checkpoint number centred inside the square
        ctx.fillStyle = "white";
        ctx.font = "bold 210px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(feature.checkpointNumber.toString(), texSize / 2, (sqTop + sqBottom + 20) / 2);

        // Worn stencil effect: punch random holes through the white paint.
        // Uses a seeded RNG so the same checkpoint always looks identical.
        ctx.globalCompositeOperation = "destination-out";
        const rng = _seededRng(feature.checkpointNumber);
        // Fine speckle dropout
        for (let i = 0; i < 2500; i++) {
          const r = rng() * 4.5 + 0.5;
          ctx.beginPath();
          ctx.arc(rng() * texSize, rng() * texSize, r, 0, Math.PI * 2);
          ctx.fill();
        }
        // Larger worn scratches / patches
        for (let i = 0; i < 60; i++) {
          ctx.save();
          ctx.translate(rng() * texSize, rng() * texSize);
          ctx.rotate(rng() * Math.PI);
          ctx.fillRect(0, 0, rng() * 40 + 8, rng() * 8 + 2);
          ctx.restore();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      decalTexture.update();

      const decalMat = new StandardMaterial("cpDecalMat", this.scene);
      decalMat.diffuseTexture  = decalTexture;
      decalMat.emissiveTexture = decalTexture;
      decalMat.opacityTexture  = decalTexture;
      decalMat.backFaceCulling = false;
      decal.material = decalMat;
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
      decal,
      isFinish,
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
    
    const maxNum = checkpointFeatures.length;

    // Update visual numbers on ground decals
    this.checkpointMeshes.forEach(checkpoint => {
      checkpoint.isFinish = maxNum > 0 && checkpoint.feature.checkpointNumber === maxNum;

      if (checkpoint.decal) {
        const texSize = 512;
        const decalTexture = checkpoint.decal.material.diffuseTexture;
        const ctx = decalTexture.getContext();
        ctx.clearRect(0, 0, texSize, texSize);

        if (checkpoint.isFinish) {
          const cols = Math.max(2, Math.round(checkpoint.feature.width / 2.5));
          const rows = 4;
          const rectH = Math.round(texSize * 0.38);
          const rectY = Math.round((texSize - rectH) / 2);
          const cellW = texSize / cols;
          const cellH = rectH / rows;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              ctx.fillStyle = (r + c) % 2 === 0 ? "white" : "black";
              ctx.fillRect(c * cellW, rectY + r * cellH, cellW, cellH);
            }
          }
          ctx.globalCompositeOperation = "destination-out";
          const rng = _seededRng(checkpoint.feature.checkpointNumber);
          for (let i = 0; i < 2500; i++) {
            const r = rng() * 4.5 + 0.5;
            ctx.beginPath();
            ctx.arc(rng() * texSize, rng() * texSize, r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalCompositeOperation = "source-over";
        } else {
          const triCX = texSize / 2;
          const triTop = 20, triBase = 120, triHalfW = 70;
          ctx.fillStyle = "white";
          ctx.beginPath();
          ctx.moveTo(triCX, triTop);
          ctx.lineTo(triCX - triHalfW, triBase);
          ctx.lineTo(triCX + triHalfW, triBase);
          ctx.closePath();
          ctx.fill();

          const sqTop = 148, sqPad = 26;
          const sqLeft = sqPad, sqRight = texSize - sqPad, sqBottom = texSize - sqPad;
          ctx.strokeStyle = "white";
          ctx.lineWidth = 18;
          ctx.strokeRect(sqLeft, sqTop, sqRight - sqLeft, sqBottom - sqTop);

          ctx.fillStyle = "white";
          ctx.font = "bold 210px Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(checkpoint.feature.checkpointNumber.toString(), texSize / 2, (sqTop + sqBottom) / 2);

          ctx.globalCompositeOperation = "destination-out";
          const rng = _seededRng(checkpoint.feature.checkpointNumber);
          for (let i = 0; i < 2500; i++) {
            const r = rng() * 3.5 + 0.5;
            ctx.beginPath();
            ctx.arc(rng() * texSize, rng() * texSize, r, 0, Math.PI * 2);
            ctx.fill();
          }
          for (let i = 0; i < 60; i++) {
            ctx.save();
            ctx.translate(rng() * texSize, rng() * texSize);
            ctx.rotate(rng() * Math.PI);
            ctx.fillRect(0, 0, rng() * 40 + 8, rng() * 8 + 2);
            ctx.restore();
          }
          ctx.globalCompositeOperation = "source-over";
        }

        decalTexture.update();
      }
    });
  }
}

// https://assets.babylonjs.com/textures/distortion.png