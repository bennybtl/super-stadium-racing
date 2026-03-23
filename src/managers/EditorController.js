import { Vector3, StandardMaterial, Color3, PointerEventTypes } from "@babylonjs/core";

/**
 * EditorController - Handles track editing mode
 */
export class EditorController {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.isActive = false;
    
    // Camera movement state
    this.moveSpeed = 0.5;
    this.fastSpeed = 1.5;
    this.rotationSpeed = 0.05; // Radians per frame
    this.keys = {
      forward: false,
      back: false,
      left: false,
      right: false,
      up: false,
      down: false,
      fast: false,
      rotateLeft: false,
      rotateRight: false
    };
    
    // Selection state
    this.selectedCheckpoint = null;
    this.checkpointManager = null;
    this.highlightMaterial = null;
    this.menuManager = null;
    
    // Add entity menu state
    this.showAddMenu = false;
    this.addMenuOverlay = null;
    
    // Bind event handlers
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);
    
    // Track being edited
    this.currentTrack = null;
  }

  /**
   * Activate editor mode
   */
  activate(track, checkpointManager, menuManager) {
    this.isActive = true;
    this.currentTrack = track;
    this.checkpointManager = checkpointManager;
    this.menuManager = menuManager;
    
    // Position camera for top-down editing view
    this.camera.position = new Vector3(0, 50, -30);
    this.camera.setTarget(new Vector3(0, 0, 0));
    
    // Create highlight material for selected checkpoint
    if (!this.highlightMaterial) {
      this.highlightMaterial = new StandardMaterial('highlightMat', this.scene);
      this.highlightMaterial.diffuseColor = new Color3(0, 1, 1);
      this.highlightMaterial.emissiveColor = new Color3(0, 0.5, 0.5);
    }
    
    // Add event listeners
    window.addEventListener('keydown', this.boundKeyDown, true); // Use capture phase
    window.addEventListener('keyup', this.boundKeyUp);
    this.scene.onPointerObservable.add(this.boundPointerDown);
    
    // Create add entity menu
    this.createAddEntityMenu();
    
    console.log('[EditorController] Editor mode activated');
  }

  /**
   * Deactivate editor mode
   */
  deactivate() {
    this.isActive = false;
    this.currentTrack = null;
    this.deselectCheckpoint();
    
    // Remove event listeners
    window.removeEventListener('keydown', this.boundKeyDown, true);
    window.removeEventListener('keyup', this.boundKeyUp);
    this.scene.onPointerObservable.removeCallback(this.boundPointerDown);
    
    // Reset key states
    Object.keys(this.keys).forEach(key => this.keys[key] = false);
    
    // Remove add entity menu
    if (this.addMenuOverlay) {
      document.body.removeChild(this.addMenuOverlay);
      this.addMenuOverlay = null;
    }
    
    console.log('[EditorController] Editor mode deactivated');
  }

  handleKeyDown(event) {
    if (!this.isActive) return;
    
    // Handle ESC key for menu
    if (event.key === 'Escape') {
      console.log('[EditorController] ESC pressed, menuManager:', this.menuManager);
      if (this.menuManager) {
        console.log('[EditorController] Calling togglePause()');
        this.menuManager.togglePause();
      }
      event.preventDefault();
      event.stopPropagation(); // Stop event from reaching other handlers
      event.stopImmediatePropagation(); // Stop event from reaching other handlers on same element
      return;
    }
    
    // Handle Delete key
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selectedCheckpoint) {
        this.deleteSelectedCheckpoint();
        event.preventDefault();
      }
      return;
    }
    
    // Handle Space key for add menu
    if (event.key === ' ') {
      this.toggleAddMenu();
      event.preventDefault();
      return;
    }
    
    switch(event.key.toLowerCase()) {
      case 'w':
        this.keys.forward = true;
        event.preventDefault();
        break;
      case 's':
        this.keys.back = true;
        event.preventDefault();
        break;
      case 'd':
        this.keys.left = true;
        event.preventDefault();
        break;
      case 'a':
        this.keys.right = true;
        event.preventDefault();
        break;
      case 'q':
        this.keys.rotateLeft = true;
        event.preventDefault();
        break;
      case 'e':
        this.keys.rotateRight = true;
        event.preventDefault();
        break;
      case '-':``
        this.keys.down = true;
        event.preventDefault();
        break;
      case '=':
        this.keys.up = true;
        event.preventDefault();
        break;
      case 'shift':
        this.keys.fast = true;
        event.preventDefault();
        break;
    }
  }

  handleKeyUp(event) {
    if (!this.isActive) return;
    
    switch(event.key.toLowerCase()) {
      case 'w':
        this.keys.forward = false;
        break;
      case 's':
        this.keys.back = false;
        break;
      case 'd':
        this.keys.left = false;
        break;
      case 'a':
        this.keys.right = false;
        break;
      case 'q':
        this.keys.rotateLeft = false;
        break;
      case 'e':
        this.keys.rotateRight = false;
        break;
      case '-':
        this.keys.down = false;
        break;
      case '=':
        this.keys.up = false;
        break;
      case 'shift':
        this.keys.fast = false;
        break;
    }
  }

  /**
   * Update camera position or selected checkpoint based on input
   */
  update(deltaTime) {
    if (!this.isActive) return;
    
    const speed = this.keys.fast ? this.fastSpeed : this.moveSpeed;
    const movement = new Vector3(0, 0, 0);
    
    // Calculate forward and right vectors from camera
    const forward = this.camera.getTarget().subtract(this.camera.position);
    forward.y = 0;
    forward.normalize();
    
    const right = Vector3.Cross(forward, Vector3.Up());
    right.normalize();
    
    // Apply movement
    if (this.keys.forward) {
      movement.addInPlace(forward.scale(speed));
    }
    if (this.keys.back) {
      movement.addInPlace(forward.scale(-speed));
    }
    if (this.keys.left) {
      movement.addInPlace(right.scale(-speed));
    }
    if (this.keys.right) {
      movement.addInPlace(right.scale(speed));
    }
    if (this.keys.up) {
      movement.y += speed;
    }
    if (this.keys.down) {
      movement.y -= speed;
    }
    
    // If checkpoint is selected, move it instead of camera
    if (this.selectedCheckpoint) {
      // Handle rotation
      if (this.keys.rotateLeft) {
        this.rotateSelectedCheckpoint(this.rotationSpeed);
      }
      if (this.keys.rotateRight) {
        this.rotateSelectedCheckpoint(-this.rotationSpeed);
      }
      
      // Handle movement
      this.moveSelectedCheckpoint(movement);
      // Camera follows the checkpoint
      this.camera.position.addInPlace(movement);
      const currentTarget = this.camera.getTarget();
      this.camera.setTarget(currentTarget.add(movement));
    } else {
      // Move camera and target together
      this.camera.position.addInPlace(movement);
      const currentTarget = this.camera.getTarget();
      this.camera.setTarget(currentTarget.add(movement));
    }
  }

  /**
   * Handle pointer down for selecting checkpoints
   */
  handlePointerDown(pointerInfo) {
    if (!this.isActive) return;
    
    if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
      const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
      
      if (pickResult.hit && pickResult.pickedMesh) {
        // Check if clicked mesh is part of a checkpoint
        const clickedMesh = pickResult.pickedMesh;
        
        if (this.checkpointManager) {
          for (const checkpointData of this.checkpointManager.checkpointMeshes) {
            if (clickedMesh === checkpointData.barrel1 || 
                clickedMesh === checkpointData.barrel2 || 
                clickedMesh === checkpointData.arrow || 
                clickedMesh === checkpointData.arrowHead ||
                clickedMesh === checkpointData.numberPlane) {
              this.selectCheckpoint(checkpointData);
              return;
            }
          }
        }
        
        // Clicked on something else, deselect
        this.deselectCheckpoint();
      }
    }
  }

  /**
   * Select a checkpoint for editing
   */
  selectCheckpoint(checkpointData) {
    // Deselect previous if any
    this.deselectCheckpoint();
    
    this.selectedCheckpoint = checkpointData;
    
    // Highlight selected checkpoint
    const originalMat1 = checkpointData.barrel1.material;
    const originalMat2 = checkpointData.barrel2.material;
    checkpointData.barrel1.material = this.highlightMaterial;
    checkpointData.barrel2.material = this.highlightMaterial;
    
    // Store original materials for restoration
    checkpointData.originalMat1 = originalMat1;
    checkpointData.originalMat2 = originalMat2;
    
    console.log('[EditorController] Selected checkpoint', checkpointData.feature.checkpointNumber);
  }

  /**
   * Deselect currently selected checkpoint
   */
  deselectCheckpoint() {
    if (this.selectedCheckpoint) {
      // Restore original materials
      if (this.selectedCheckpoint.originalMat1) {
        this.selectedCheckpoint.barrel1.material = this.selectedCheckpoint.originalMat1;
      }
      if (this.selectedCheckpoint.originalMat2) {
        this.selectedCheckpoint.barrel2.material = this.selectedCheckpoint.originalMat2;
      }
      
      console.log('[EditorController] Deselected checkpoint');
      this.selectedCheckpoint = null;
    }
  }

  /**
   * Rotate the selected checkpoint
   */
  rotateSelectedCheckpoint(angle) {
    if (!this.selectedCheckpoint) return;
    
    const checkpoint = this.selectedCheckpoint;
    const feature = checkpoint.feature;
    
    // Update feature heading
    feature.heading += angle;
    
    // Simply rotate the container - all children rotate automatically!
    checkpoint.container.rotation.y = feature.heading;
  }

  /**
   * Delete the selected checkpoint
   */
  deleteSelectedCheckpoint() {
    if (!this.selectedCheckpoint) return;
    
    const checkpoint = this.selectedCheckpoint;
    const feature = checkpoint.feature;
    
    // Find and remove from track features
    const featureIndex = this.currentTrack.features.indexOf(feature);
    if (featureIndex > -1) {
      this.currentTrack.features.splice(featureIndex, 1);
    }
    
    // Dispose the container and all its children
    checkpoint.container.dispose();
    
    // Remove from checkpoint manager
    const meshIndex = this.checkpointManager.checkpointMeshes.indexOf(checkpoint);
    if (meshIndex > -1) {
      this.checkpointManager.checkpointMeshes.splice(meshIndex, 1);
    }
    
    // Deselect
    this.deselectCheckpoint();
    
    // Renumber remaining checkpoints
    this.checkpointManager.renumberCheckpoints();
    
    console.log('[EditorController] Deleted checkpoint');
  }

  /**
   * Move the selected checkpoint
   */
  moveSelectedCheckpoint(movement) {
    if (!this.selectedCheckpoint) return;
    
    const checkpoint = this.selectedCheckpoint;
    const feature = checkpoint.feature;
    
    // Update feature position
    feature.centerX += movement.x;
    feature.centerZ += movement.z;
    
    // Get terrain height at new position
    const terrainHeight = this.currentTrack.getHeightAt(feature.centerX, feature.centerZ);
    
    // Simply move the container - all children move automatically!
    checkpoint.container.position.x = feature.centerX;
    checkpoint.container.position.z = feature.centerZ;
    checkpoint.container.position.y = terrainHeight;
  }

  /**
   * Create the add entity menu overlay
   */
  createAddEntityMenu() {
    this.addMenuOverlay = document.createElement('div');
    this.addMenuOverlay.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.9);
      padding: 20px;
      border-radius: 10px;
      border: 2px solid #4a9eff;
      display: none;
      z-index: 1000;
    `;
    
    const title = document.createElement('h2');
    title.textContent = 'Add Entity';
    title.style.cssText = 'color: white; margin: 0 0 15px 0; font-family: Arial;';
    this.addMenuOverlay.appendChild(title);
    
    const buttonStyle = `
      display: block;
      width: 200px;
      padding: 10px;
      margin: 10px 0;
      background: #4a9eff;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
      font-family: Arial;
    `;
    
    // Add Checkpoint button
    const checkpointBtn = document.createElement('button');
    checkpointBtn.textContent = 'Add Checkpoint';
    checkpointBtn.style.cssText = buttonStyle;
    checkpointBtn.onclick = () => this.addCheckpoint();
    this.addMenuOverlay.appendChild(checkpointBtn);
    
    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Cancel';
    closeBtn.style.cssText = buttonStyle + 'background: #666;';
    closeBtn.onclick = () => this.hideAddMenu();
    this.addMenuOverlay.appendChild(closeBtn);
    
    document.body.appendChild(this.addMenuOverlay);
  }
  
  /**
   * Toggle the add entity menu
   */
  toggleAddMenu() {
    if (this.showAddMenu) {
      this.hideAddMenu();
    } else {
      this.showAddMenu = true;
      this.addMenuOverlay.style.display = 'block';
    }
  }
  
  /**
   * Hide the add entity menu
   */
  hideAddMenu() {
    this.showAddMenu = false;
    if (this.addMenuOverlay) {
      this.addMenuOverlay.style.display = 'none';
    }
  }
  
  /**
   * Add a new checkpoint at camera target position
   */
  addCheckpoint() {
    // Get camera target position (where camera is looking)
    const camPos = this.camera.position;
    const camTarget = this.camera.target;
    const direction = camTarget.subtract(camPos).normalize();
    const distance = 20; // Place 20 units in front of camera
    
    const newX = camPos.x + direction.x * distance;
    const newZ = camPos.z + direction.z * distance;
    
    // Get terrain height
    const terrainHeight = this.currentTrack.getHeightAt(newX, newZ);
    
    // Find next checkpoint number
    const checkpointFeatures = this.currentTrack.features.filter(f => f.type === 'checkpoint');
    const nextNumber = checkpointFeatures.length + 1;
    
    // Create new checkpoint feature
    const newFeature = {
      type: 'checkpoint',
      centerX: newX,
      centerZ: newZ,
      heading: 0,
      width: 10,
      checkpointNumber: nextNumber
    };
    
    // Add to track
    this.currentTrack.features.push(newFeature);
    
    // Create visual representation
    const checkpointMesh = this.checkpointManager.createSingleCheckpoint(newFeature);
    
    // Hide menu
    this.hideAddMenu();
    
    console.log('[EditorController] Added checkpoint at', newX, newZ);
  }

  /**
   * Dispose of the controller
   */
  dispose() {
    this.deactivate();
  }
}
