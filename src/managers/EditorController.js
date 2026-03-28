import { Vector3, StandardMaterial, Color3, PointerEventTypes, MeshBuilder, TransformNode } from "@babylonjs/core";
import { TERRAIN_TYPES } from "../terrain.js";

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
    
    // Hill editing state
    this.hillMeshes = [];
    this.selectedHill = null;
    this.hillMaterial = null;
    this.hillHighlightMaterial = null;
    this.hillPropertiesPanel = null;

    // Checkpoint properties panel
    this.checkpointPropertiesPanel = null;
    
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

    // Create hill materials
    if (!this.hillMaterial) {
      this.hillMaterial = new StandardMaterial('hillMat', this.scene);
      this.hillMaterial.diffuseColor = new Color3(0.25, 0.75, 0.3);
      this.hillMaterial.emissiveColor = new Color3(0.04, 0.12, 0.05);
      this.hillMaterial.alpha = 0.20;
      this.hillMaterial.backFaceCulling = false;
    }
    if (!this.hillHighlightMaterial) {
      this.hillHighlightMaterial = new StandardMaterial('hillHighlightMat', this.scene);
      this.hillHighlightMaterial.diffuseColor = new Color3(0.0, 0.9, 0.8);
      this.hillHighlightMaterial.emissiveColor = new Color3(0.0, 0.35, 0.3);
      this.hillHighlightMaterial.alpha = 0.20;
      this.hillHighlightMaterial.backFaceCulling = false;
    }

    // Build editor visuals for any hills already in the track
    for (const feature of track.features) {
      if (feature.type === 'hill') {
        this.createHillVisual(feature);
      }
    }

    // Create floating hill properties panel
    this.createHillPropertiesPanel();

    // Create checkpoint properties panel
    this.createCheckpointPropertiesPanel();
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

    // Dispose all hill editor visuals
    for (const hillData of this.hillMeshes) {
      hillData.mesh.dispose();
      hillData.node.dispose();
    }
    this.hillMeshes = [];
    this.selectedHill = null;

    // Remove hill properties panel
    if (this.hillPropertiesPanel) {
      document.body.removeChild(this.hillPropertiesPanel);
      this.hillPropertiesPanel = null;
    }

    // Remove checkpoint properties panel
    if (this.checkpointPropertiesPanel) {
      document.body.removeChild(this.checkpointPropertiesPanel);
      this.checkpointPropertiesPanel = null;
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
      } else if (this.selectedHill) {
        this.deleteSelectedHill();
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
    } else if (this.selectedHill) {
      // WASD moves the hill; camera follows
      this.moveSelectedHill(movement);
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
              this.deselectHill();
              this.selectCheckpoint(checkpointData);
              return;
            }
          }
        }

        // Check if clicked mesh is a hill gizmo
        for (const hillData of this.hillMeshes) {
          if (clickedMesh === hillData.mesh) {
            if (this.selectedHill === hillData) {
              // Click selected hill again → deselect
              this.deselectHill();
            } else {
              this.deselectCheckpoint();
              this.selectHill(hillData);
            }
            return;
          }
        }
        
        // Clicked on something else — deselect both
        this.deselectCheckpoint();
        this.deselectHill();
      }
    }
  }

  /**
   * Select a checkpoint for editing
   */
  selectCheckpoint(checkpointData) {
    // Deselect previous if any
    this.deselectCheckpoint();
    this.deselectHill();
    
    this.selectedCheckpoint = checkpointData;
    
    // Highlight selected checkpoint
    const originalMat1 = checkpointData.barrel1.material;
    const originalMat2 = checkpointData.barrel2.material;
    checkpointData.barrel1.material = this.highlightMaterial;
    checkpointData.barrel2.material = this.highlightMaterial;
    
    // Store original materials for restoration
    checkpointData.originalMat1 = originalMat1;
    checkpointData.originalMat2 = originalMat2;

    this.showCheckpointProperties(checkpointData);

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
      this.hideCheckpointProperties();
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

    // Add Hill button
    const hillBtn = document.createElement('button');
    hillBtn.textContent = 'Add Hill';
    hillBtn.style.cssText = buttonStyle;
    hillBtn.onclick = () => this.addHillEntity();
    this.addMenuOverlay.appendChild(hillBtn);
    
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

  // ─── Checkpoint Properties Panel ──────────────────────────────────────────

  createCheckpointPropertiesPanel() {
    const panel = document.createElement('div');
    panel.id = 'checkpoint-properties-panel';
    panel.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      background: rgba(0, 0, 0, 0.88);
      padding: 18px 20px 16px;
      border-radius: 10px;
      border: 2px solid #ff9f43;
      display: none;
      z-index: 1000;
      min-width: 230px;
      font-family: Arial, sans-serif;
      color: white;
      user-select: none;
      pointer-events: auto;
    `;

    const title = document.createElement('div');
    title.textContent = 'Checkpoint Properties';
    title.style.cssText = `
      font-size: 13px;
      font-weight: bold;
      margin-bottom: 16px;
      color: #ff9f43;
      text-transform: uppercase;
      letter-spacing: 1px;
    `;
    panel.appendChild(title);

    const mkRow = () => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;';
      return row;
    };
    const sliderCss = 'width:100%; accent-color:#ff9f43; margin-bottom:14px; cursor:pointer;';

    // ── Width ──
    const widthRow = mkRow();
    const widthLbl = document.createElement('span'); widthLbl.textContent = 'Width (barrel spacing)';
    const widthVal = document.createElement('span'); widthVal.id = 'cp-width-val'; widthVal.textContent = '10.0';
    widthRow.appendChild(widthLbl); widthRow.appendChild(widthVal);
    panel.appendChild(widthRow);

    const widthSlider = document.createElement('input');
    widthSlider.type = 'range'; widthSlider.id = 'cp-width-slider';
    widthSlider.min = '4'; widthSlider.max = '30'; widthSlider.step = '0.5'; widthSlider.value = '10';
    widthSlider.style.cssText = sliderCss;
    panel.appendChild(widthSlider);

    // ── Hint ──
    const hint = document.createElement('div');
    hint.textContent = 'WASD to move  ·  QE to rotate  ·  Del to delete';
    hint.style.cssText = 'font-size: 10px; color: #888; margin-bottom: 14px;';
    panel.appendChild(hint);

    // ── Delete button ──
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete Checkpoint';
    deleteBtn.style.cssText = `
      display: block;
      width: 100%;
      padding: 8px;
      background: #c0392b;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 13px;
      font-family: Arial;
    `;
    panel.appendChild(deleteBtn);

    // ── Event wiring ──
    widthSlider.addEventListener('input', () => {
      if (!this.selectedCheckpoint) return;
      const val = parseFloat(widthSlider.value);
      document.getElementById('cp-width-val').textContent = val.toFixed(1);
      this.selectedCheckpoint.feature.width = val;
      this.repositionCheckpointBarrels(this.selectedCheckpoint);
    });

    deleteBtn.addEventListener('click', () => this.deleteSelectedCheckpoint());

    panel.addEventListener('mousedown', e => e.stopPropagation());

    document.body.appendChild(panel);
    this.checkpointPropertiesPanel = panel;
  }

  showCheckpointProperties(checkpointData) {
    if (!this.checkpointPropertiesPanel) return;
    const ws = document.getElementById('cp-width-slider');
    const wv = document.getElementById('cp-width-val');
    if (ws) { ws.value = checkpointData.feature.width; wv.textContent = checkpointData.feature.width.toFixed(1); }
    this.checkpointPropertiesPanel.style.display = 'block';
  }

  hideCheckpointProperties() {
    if (this.checkpointPropertiesPanel) {
      this.checkpointPropertiesPanel.style.display = 'none';
    }
  }

  /**
   * Move barrel1 and barrel2 to match the current feature.width.
   * The barrels sit at ±halfWidth along local X (perpendicular to heading).
   */
  repositionCheckpointBarrels(checkpointData) {
    const halfWidth = checkpointData.feature.width / 2;
    checkpointData.barrel1.position.x =  halfWidth;
    checkpointData.barrel2.position.x = -halfWidth;
  }

  // ─── Hill Editing ──────────────────────────────────────────────────────────

  /**
   * Place a new hill at the camera look-at point and select it immediately.
   */
  addHillEntity() {
    const camPos = this.camera.position;
    const camTarget = this.camera.target;
    const direction = camTarget.subtract(camPos).normalize();
    const distance = 20;

    const newX = camPos.x + direction.x * distance;
    const newZ = camPos.z + direction.z * distance;

    const newFeature = {
      type: 'hill',
      centerX: newX,
      centerZ: newZ,
      radius: 10,
      height: 5,
      terrainType: null,
    };

    this.currentTrack.features.push(newFeature);
    const hillData = this.createHillVisual(newFeature);

    this.deselectCheckpoint();
    this.selectHill(hillData);

    window.rebuildTerrain?.();

    this.hideAddMenu();
    console.log('[EditorController] Added hill at', newX.toFixed(1), newZ.toFixed(1));
  }

  /**
   * Build a cone-shaped editor gizmo for a hill feature.
   * The parent TransformNode handles position & scale; the cone mesh is unit-sized.
   */
  createHillVisual(feature) {
    const absH = Math.max(0.5, Math.abs(feature.height));
    const terrainH = this.currentTrack ? this.currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;

    // Parent node handles world position and scale
    const node = new TransformNode('hillNode', this.scene);
    node.position = new Vector3(feature.centerX, terrainH + absH / 2, feature.centerZ);
    node.scaling  = new Vector3(feature.radius, absH, feature.radius);

    // Unit cone: height=1, base diameter=2, centered at origin → bottom at y=-0.5, top at y=+0.5
    const mesh = MeshBuilder.CreateCylinder('hillMesh', {
      height: 1,
      diameterTop: 0,
      diameterBottom: 2,
      tessellation: 24,
    }, this.scene);
    mesh.parent = node;
    mesh.material = this.hillMaterial;
    mesh.isPickable = true;

    const hillData = { feature, node, mesh };
    this.hillMeshes.push(hillData);
    return hillData;
  }

  /**
   * Sync the cone gizmo transform to the feature's current values.
   */
  updateHillVisual(hillData) {
    const { feature, node } = hillData;
    const absH = Math.max(0.5, Math.abs(feature.height));
    const terrainH = this.currentTrack ? this.currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;
    node.position.x = feature.centerX;
    node.position.z = feature.centerZ;
    node.position.y = terrainH + absH / 2;
    node.scaling.x  = feature.radius;
    node.scaling.y  = absH;
    node.scaling.z  = feature.radius;
  }

  /**
   * Select a hill gizmo for editing.
   */
  selectHill(hillData) {
    this.deselectHill();
    this.selectedHill = hillData;
    hillData.mesh.material = this.hillHighlightMaterial;
    this.showHillProperties(hillData);
    console.log('[EditorController] Selected hill at',
      hillData.feature.centerX.toFixed(1), hillData.feature.centerZ.toFixed(1));
  }

  /**
   * Deselect the current hill (restore material, hide panel).
   */
  deselectHill() {
    if (this.selectedHill) {
      this.selectedHill.mesh.material = this.hillMaterial;
      this.hideHillProperties();
      console.log('[EditorController] Deselected hill');
      this.selectedHill = null;
    }
  }

  /**
   * Translate the selected hill by the given movement vector and rebuild terrain.
   */
  moveSelectedHill(movement) {
    if (!this.selectedHill || (movement.x === 0 && movement.z === 0)) return;

    const { feature } = this.selectedHill;
    feature.centerX += movement.x;
    feature.centerZ += movement.z;
    this.updateHillVisual(this.selectedHill);
    window.rebuildTerrain?.();
  }

  /**
   * Remove the selected hill from the track and dispose its gizmo.
   */
  deleteSelectedHill() {
    if (!this.selectedHill) return;

    const hillData = this.selectedHill;

    // Remove from track features
    const idx = this.currentTrack.features.indexOf(hillData.feature);
    if (idx > -1) this.currentTrack.features.splice(idx, 1);

    // Dispose gizmo
    hillData.mesh.dispose();
    hillData.node.dispose();

    // Remove from hillMeshes list
    const meshIdx = this.hillMeshes.indexOf(hillData);
    if (meshIdx > -1) this.hillMeshes.splice(meshIdx, 1);

    // Clear selection & panel
    this.hideHillProperties();
    this.selectedHill = null;

    // Rebuild terrain
    window.rebuildTerrain?.();
    window.rebuildTerrainTexture?.();

    console.log('[EditorController] Deleted hill');
  }

  // ─── Hill Properties Panel ─────────────────────────────────────────────────

  /**
   * Create the floating hill properties panel (upper-right).
   * Hidden by default; shown when a hill is selected.
   */
  createHillPropertiesPanel() {
    const panel = document.createElement('div');
    panel.id = 'hill-properties-panel';
    panel.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      background: rgba(0, 0, 0, 0.88);
      padding: 18px 20px 16px;
      border-radius: 10px;
      border: 2px solid #4a9eff;
      display: none;
      z-index: 1000;
      min-width: 230px;
      font-family: Arial, sans-serif;
      color: white;
      user-select: none;
      pointer-events: auto;
    `;

    // ── Title ──
    const title = document.createElement('div');
    title.textContent = 'Hill Properties';
    title.style.cssText = `
      font-size: 13px;
      font-weight: bold;
      margin-bottom: 16px;
      color: #4a9eff;
      text-transform: uppercase;
      letter-spacing: 1px;
    `;
    panel.appendChild(title);

    const mkRow = () => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;';
      return row;
    };
    const sliderCss = 'width:100%; accent-color:#4a9eff; margin-bottom:14px; cursor:pointer;';

    // ── Radius ──
    const radiusRow = mkRow();
    const radiusLbl = document.createElement('span'); radiusLbl.textContent = 'Radius';
    const radiusVal = document.createElement('span'); radiusVal.id = 'hill-radius-val'; radiusVal.textContent = '10.0';
    radiusRow.appendChild(radiusLbl); radiusRow.appendChild(radiusVal);
    panel.appendChild(radiusRow);

    const radiusSlider = document.createElement('input');
    radiusSlider.type = 'range'; radiusSlider.id = 'hill-radius-slider';
    radiusSlider.min = '3'; radiusSlider.max = '40'; radiusSlider.step = '0.5'; radiusSlider.value = '10';
    radiusSlider.style.cssText = sliderCss;
    panel.appendChild(radiusSlider);

    // ── Height ──
    const heightRow = mkRow();
    const heightLbl = document.createElement('span'); heightLbl.textContent = 'Height';
    const heightVal = document.createElement('span'); heightVal.id = 'hill-height-val'; heightVal.textContent = '5.0';
    heightRow.appendChild(heightLbl); heightRow.appendChild(heightVal);
    panel.appendChild(heightRow);

    const heightSlider = document.createElement('input');
    heightSlider.type = 'range'; heightSlider.id = 'hill-height-slider';
    heightSlider.min = '-15'; heightSlider.max = '20'; heightSlider.step = '0.5'; heightSlider.value = '5';
    heightSlider.style.cssText = sliderCss;
    panel.appendChild(heightSlider);

    // ── Terrain Type ──
    const terrainLbl = document.createElement('div');
    terrainLbl.textContent = 'Surface';
    terrainLbl.style.cssText = 'font-size:12px; margin-bottom:6px;';
    panel.appendChild(terrainLbl);

    const terrainSelect = document.createElement('select');
    terrainSelect.id = 'hill-terrain-select';
    terrainSelect.style.cssText = `
      width: 100%;
      padding: 6px 8px;
      background: #2a2a2a;
      color: white;
      border: 1px solid #4a9eff;
      border-radius: 4px;
      font-size: 12px;
      margin-bottom: 16px;
      cursor: pointer;
    `;
    [
      { value: 'none',        label: 'None (Default)' },
      { value: 'packed_dirt', label: 'Packed Dirt'    },
      { value: 'loose_dirt',  label: 'Loose Dirt'     },
      { value: 'asphalt',     label: 'Asphalt'        },
      { value: 'mud',         label: 'Mud'            },
      { value: 'WATER',       label: 'Water'          },
    ].forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label;
      terrainSelect.appendChild(opt);
    });
    panel.appendChild(terrainSelect);

    // ── Hint ──
    const hint = document.createElement('div');
    hint.textContent = 'WASD to move  ·  Del to delete';
    hint.style.cssText = 'font-size: 10px; color: #888; margin-bottom: 14px;';
    panel.appendChild(hint);

    // ── Delete button ──
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete Hill';
    deleteBtn.style.cssText = `
      display: block;
      width: 100%;
      padding: 8px;
      background: #c0392b;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 13px;
      font-family: Arial;
    `;
    panel.appendChild(deleteBtn);

    // ── Event wiring ──
    radiusSlider.addEventListener('input', () => {
      if (!this.selectedHill) return;
      const val = parseFloat(radiusSlider.value);
      document.getElementById('hill-radius-val').textContent = val.toFixed(1);
      this.selectedHill.feature.radius = val;
      this.updateHillVisual(this.selectedHill);
      window.rebuildTerrain?.();
    });

    heightSlider.addEventListener('input', () => {
      if (!this.selectedHill) return;
      const val = parseFloat(heightSlider.value);
      document.getElementById('hill-height-val').textContent = val.toFixed(1);
      this.selectedHill.feature.height = val;
      this.updateHillVisual(this.selectedHill);
      window.rebuildTerrain?.();
    });

    terrainSelect.addEventListener('change', () => {
      if (!this.selectedHill) return;
      const val = terrainSelect.value;
      if (val === 'none') {
        this.selectedHill.feature.terrainType = null;
      } else {
        const key = Object.keys(TERRAIN_TYPES).find(k => TERRAIN_TYPES[k].name === val);
        this.selectedHill.feature.terrainType = key ? TERRAIN_TYPES[key] : null;
      }
      window.rebuildTerrainTexture?.();
    });

    deleteBtn.addEventListener('click', () => this.deleteSelectedHill());

    // Stop pointer events from bleeding through to the 3D scene
    panel.addEventListener('mousedown', e => e.stopPropagation());

    document.body.appendChild(panel);
    this.hillPropertiesPanel = panel;
  }

  /**
   * Populate and show the properties panel for the given hill.
   */
  showHillProperties(hillData) {
    if (!this.hillPropertiesPanel) return;
    const { feature } = hillData;

    const rs = document.getElementById('hill-radius-slider');
    const rv = document.getElementById('hill-radius-val');
    const hs = document.getElementById('hill-height-slider');
    const hv = document.getElementById('hill-height-val');
    const ts = document.getElementById('hill-terrain-select');

    if (rs) { rs.value = feature.radius; rv.textContent = feature.radius.toFixed(1); }
    if (hs) { hs.value = feature.height; hv.textContent = feature.height.toFixed(1); }
    if (ts) { ts.value = feature.terrainType?.name || 'none'; }

    this.hillPropertiesPanel.style.display = 'block';
  }

  /**
   * Hide the hill properties panel.
   */
  hideHillProperties() {
    if (this.hillPropertiesPanel) {
      this.hillPropertiesPanel.style.display = 'none';
    }
  }

  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Dispose of the controller
   */
  dispose() {
    this.deactivate();
  }
}
