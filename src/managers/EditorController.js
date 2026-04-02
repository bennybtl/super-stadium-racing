import { Vector3, StandardMaterial, Color3, PointerEventTypes, MeshBuilder, TransformNode } from "@babylonjs/core";
import { TERRAIN_TYPES } from "../terrain.js";
import { MeshGridTool } from "./MeshGridTool.js";
import { PolyWallTool } from "./PolyWallTool.js";
import { BezierWallTool } from "./BezierWallTool.js";
import { useEditorStore } from '../vue/store.js';

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

    // Square hill editing state
    this.squareHillMeshes = [];
    this.selectedSquareHill = null;
    this.squareHillMaterial = null;
    this.squareHillHighlightMaterial = null;
    this.squareHillPropertiesPanel = null;

    // Terrain rect editing state
    this.terrainRectMeshes = [];
    this.selectedTerrainRect = null;
    this.terrainRectMaterial = null;
    this.terrainRectHighlightMaterial = null;
    this.terrainRectPropertiesPanel = null;

    // Checkpoint properties panel
    this.checkpointPropertiesPanel = null;

    // Grid snapping
    this.snapEnabled = false;
    this.snapSize = 1;
    this.snapSizes = [0.5, 1, 2, 5];
    this.snapIndicator = null;
    // Accumulated raw (pre-snap) position of whatever is being dragged
    this._rawDragPos = null;

    // Test Track button
    this.testTrackBtn = null;

    // Undo / redo stacks (each entry is a JSON string of the features array)
    this._undoStack = [];
    this._redoStack = [];
    this._snapshotDebounceTimer = null;

    // Bind event handlers
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);
    
    // Track being edited
    this.currentTrack = null;

    // Mesh grid terrain tool
    this.meshGridTool = null;

    // Poly wall editing tool
    this.polyWallTool = null;

    // Bezier wall editing tool
    this.bezierWallTool = null;

    // Vue editor store bridge
    this._editorStore = useEditorStore();
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

    // Create square hill materials (always recreate for the current scene)
    this.squareHillMaterial = new StandardMaterial('squareHillMat', this.scene);
    this.squareHillMaterial.diffuseColor = new Color3(0.75, 0.55, 0.1);
    this.squareHillMaterial.emissiveColor = new Color3(0.12, 0.08, 0.01);
    this.squareHillMaterial.alpha = 0.20;
    this.squareHillMaterial.backFaceCulling = false;

    this.squareHillHighlightMaterial = new StandardMaterial('squareHillHighlightMat', this.scene);
    this.squareHillHighlightMaterial.diffuseColor = new Color3(1.0, 0.8, 0.0);
    this.squareHillHighlightMaterial.emissiveColor = new Color3(0.35, 0.25, 0.0);
    this.squareHillHighlightMaterial.alpha = 0.20;
    this.squareHillHighlightMaterial.backFaceCulling = false;

    // Create terrainRect materials (always recreate for the current scene)
    this.terrainRectMaterial = new StandardMaterial('terrainRectMat', this.scene);
    this.terrainRectMaterial.diffuseColor = new Color3(0.2, 0.5, 0.9);
    this.terrainRectMaterial.emissiveColor = new Color3(0.04, 0.1, 0.2);
    this.terrainRectMaterial.alpha = 0.25;
    this.terrainRectMaterial.backFaceCulling = false;

    this.terrainRectHighlightMaterial = new StandardMaterial('terrainRectHighlightMat', this.scene);
    this.terrainRectHighlightMaterial.diffuseColor = new Color3(0.0, 0.9, 1.0);
    this.terrainRectHighlightMaterial.emissiveColor = new Color3(0.0, 0.3, 0.4);
    this.terrainRectHighlightMaterial.alpha = 0.35;
    this.terrainRectHighlightMaterial.backFaceCulling = false;

    // Build editor visuals for any hills already in the track
    for (const feature of track.features) {
      if (feature.type === 'hill') {
        this.createHillVisual(feature);
      } else if (feature.type === 'squareHill') {
        this.createSquareHillVisual(feature);
      } else if (feature.type === 'terrainRect') {
        this.createTerrainRectVisual(feature);
      }
    }

    // Wire Vue editor panels
    this._editorStore.setBridge(this);

    // Snap indicator (bottom-right)
    this._createSnapIndicator();

    // Test Track button (bottom-left)
    this._createTestTrackButton();

    // Mesh grid terrain editing tool
    this.meshGridTool = new MeshGridTool(this);
    this.meshGridTool.activate(this.scene, track);

    // Poly wall editing tool
    this.polyWallTool = new PolyWallTool(this);
    this.polyWallTool.activate(this.scene, track);

    // Bezier wall editing tool
    this.bezierWallTool = new BezierWallTool(this);
    this.bezierWallTool.activate(this.scene, track);
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

    // Dispose all square hill editor visuals
    for (const hillData of this.squareHillMeshes) {
      hillData.mesh.dispose();
      hillData.node.dispose();
    }
    this.squareHillMeshes = [];
    this.selectedSquareHill = null;

    // Dispose all terrain rect editor visuals
    for (const d of this.terrainRectMeshes) {
      d.mesh.dispose();
      d.node.dispose();
    }
    this.terrainRectMeshes = [];
    this.selectedTerrainRect = null;

    // Hide all editor panels via Vue store
    if (this._editorStore) {
      this._editorStore.selectedType = null;
      this._editorStore.setBridge(null);
    }

    // Remove snap indicator
    if (this.snapIndicator) {
      document.body.removeChild(this.snapIndicator);
      this.snapIndicator = null;
    }

    // Remove test track button
    if (this.testTrackBtn) {
      document.body.removeChild(this.testTrackBtn);
      this.testTrackBtn = null;
    }

    // Mesh grid tool
    if (this.meshGridTool) {
      this.meshGridTool.deactivate();
      this.meshGridTool = null;
    }

    // Poly wall tool
    if (this.polyWallTool) {
      this.polyWallTool.deactivate();
      this.polyWallTool = null;
    }

    // Bezier wall tool
    if (this.bezierWallTool) {
      this.bezierWallTool.deactivate();
      this.bezierWallTool = null;
    }

    console.log('[EditorController] Editor mode deactivated');
  }

  // ─── Undo / Redo ──────────────────────────────────────────────────────────

  /**
   * Save the current features array as an undo snapshot.
   * Pass debounce=true for continuous operations (slider drags, WASD movement)
   * so we don't flood the stack — a snapshot is only committed after 400ms of silence.
   */
  saveSnapshot(debounce = false) {
    const commit = () => {
      const snap = JSON.stringify(this.currentTrack.features);
      // Don't push a duplicate of the current top
      if (this._undoStack.length && this._undoStack[this._undoStack.length - 1] === snap) return;
      this._undoStack.push(snap);
      if (this._undoStack.length > 50) this._undoStack.shift();
      this._redoStack = [];
    };

    if (!debounce) {
      clearTimeout(this._snapshotDebounceTimer);
      commit();
    } else {
      clearTimeout(this._snapshotDebounceTimer);
      this._snapshotDebounceTimer = setTimeout(commit, 400);
    }
  }

  _applySnapshot(snap) {
    // Deselect everything
    this.deselectCheckpoint();
    this.deselectHill();
    this.deselectSquareHill();
    this.deselectTerrainRect?.();

    // Dispose all gizmo meshes
    for (const d of this.hillMeshes)       { d.mesh.dispose(); d.node.dispose(); }
    for (const d of this.squareHillMeshes) { d.mesh.dispose(); d.node.dispose(); }
    for (const d of this.terrainRectMeshes) { d.mesh.dispose(); d.node.dispose(); }
    this.hillMeshes = [];
    this.squareHillMeshes = [];
    this.terrainRectMeshes = [];

    // Restore features
    this.currentTrack.features = JSON.parse(snap);

    // Recreate gizmos + rebuild visuals
    for (const feature of this.currentTrack.features) {
      if (feature.type === 'hill') this.createHillVisual(feature);
      else if (feature.type === 'squareHill') this.createSquareHillVisual(feature);
      else if (feature.type === 'terrainRect') this.createTerrainRectVisual(feature);
    }
    // Restore mesh grid gizmos
    this.meshGridTool?.onSnapshotRestored();
    // Restore poly wall gizmos
    this.polyWallTool?.onSnapshotRestored();
    window.rebuildPolyWall?.(null);
    // Restore bezier wall gizmos
    this.bezierWallTool?.onSnapshotRestored();
    window.rebuildBezierWall?.(null);
    // Checkpoints are managed by CheckpointManager — rebuild from features
    if (this.checkpointManager) {
      this.checkpointManager.dispose?.();
      for (const feature of this.currentTrack.features) {
        if (feature.type === 'checkpoint') {
          this.checkpointManager.createSingleCheckpoint(feature);
        }
      }
    }

    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
    window.rebuildTerrainTexture?.();
  }

  undo() {
    if (this._undoStack.length === 0) return;
    this._redoStack.push(JSON.stringify(this.currentTrack.features));
    this._applySnapshot(this._undoStack.pop());
    console.log('[Undo] stack remaining:', this._undoStack.length);
  }

  redo() {
    if (this._redoStack.length === 0) return;
    this._undoStack.push(JSON.stringify(this.currentTrack.features));
    this._applySnapshot(this._redoStack.pop());
    console.log('[Redo] stack remaining:', this._redoStack.length);
  }

  handleKeyDown(event) {
    if (!this.isActive) return;
    
    // Handle ESC key — deselect first, open menu if nothing selected
    if (event.key === 'Escape') {
      if (this.selectedHill) {
        this.deselectHill();
      } else if (this.selectedSquareHill) {
        this.deselectSquareHill();
      } else if (this.selectedCheckpoint) {
        this.deselectCheckpoint();
      } else if (this.menuManager) {
        this.menuManager.togglePause();
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    // Handle Undo / Redo (Ctrl+Z / Ctrl+Shift+Z, also Cmd on Mac)
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      if (event.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Handle Duplicate (Ctrl+D / Cmd+D)
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      if (this.selectedHill) this.duplicateSelectedHill();
      else if (this.selectedSquareHill) this.duplicateSelectedSquareHill();
      else if (this.selectedCheckpoint) this.duplicateSelectedCheckpoint();
      else if (this.selectedTerrainRect) this.duplicateSelectedTerrainRect();
      event.preventDefault();
      event.stopPropagation();
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
      } else if (this.selectedSquareHill) {
        this.deleteSelectedSquareHill();
        event.preventDefault();
      } else if (this.selectedTerrainRect) {
        this.deleteSelectedTerrainRect();
        event.preventDefault();
      } else if (this.meshGridTool?.activeFeature) {
        this.meshGridTool.deleteMeshGrid();
        event.preventDefault();
      } else if (this.polyWallTool?.selectedPoint) {
        this.polyWallTool.deleteSelectedPoint();
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

    // Handle G / Shift+G for grid snap
    if (event.key.toLowerCase() === 'g' && !event.ctrlKey && !event.metaKey) {
      if (event.shiftKey) {
        // Cycle snap size
        const idx = this.snapSizes.indexOf(this.snapSize);
        this.snapSize = this.snapSizes[(idx + 1) % this.snapSizes.length];
        this.snapEnabled = true;
      } else {
        this.snapEnabled = !this.snapEnabled;
      }
      this._updateSnapIndicator();
      event.preventDefault();
      return;
    }

    // Delegate [ / ] to mesh grid tool for height adjustment
    if (this.meshGridTool?.onKeyDown(event)) {
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
      case '=':
        this.keys.down = true;
        event.preventDefault();
        break;
      case '-':
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
      case '=':
        this.keys.down = false;
        break;
      case '-':
        this.keys.up = false;
        break;
      case 'shift':
        this.keys.fast = false;
        break;
    }

    // Flush any deferred poly wall rebuild when a movement key is released
    const movKeys = ['w','s','a','d'];
    if (movKeys.includes(event.key.toLowerCase()) && this.polyWallTool?.selectedPoint) {
      this.polyWallTool.endDrag();
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
        this.saveSnapshot(true);
        this.rotateSelectedCheckpoint(this.rotationSpeed);
      }
      if (this.keys.rotateRight) {
        this.saveSnapshot(true);
        this.rotateSelectedCheckpoint(-this.rotationSpeed);
      }

      const delta = this.moveSelectedCheckpoint(movement);
      delta.y = movement.y;
      this.camera.position.addInPlace(delta);
      const currentTarget = this.camera.getTarget();
      this.camera.setTarget(currentTarget.add(delta));
    } else if (this.selectedHill) {
      const delta = this.moveSelectedHill(movement);
      delta.y = movement.y;
      this.camera.position.addInPlace(delta);
      const currentTarget = this.camera.getTarget();
      this.camera.setTarget(currentTarget.add(delta));
    } else if (this.selectedSquareHill) {
      // Q/E rotates the square hill
      const rotStep = (this.keys.fast ? 5 : 1) * (Math.PI / 180);
      if (this.keys.rotateLeft || this.keys.rotateRight) {
        const f = this.selectedSquareHill.feature;
        const delta = this.keys.rotateLeft ? rotStep : -rotStep;
        f.angle = ((f.angle ?? 0) + delta * 180 / Math.PI + 360) % 360;
        this.updateSquareHillVisual(this.selectedSquareHill);
        // Sync the angle slider
        const as = document.getElementById('sq-angle-slider');
        const av = document.getElementById('sq-angle-val');
        if (as) { as.value = f.angle; av.textContent = f.angle.toFixed(0) + '°'; }
        window.rebuildTerrain?.();
        window.rebuildTerrainGrid?.();
      }
      const delta2 = this.moveSelectedSquareHill(movement);
      delta2.y = movement.y;
      this.camera.position.addInPlace(delta2);
      const currentTarget2 = this.camera.getTarget();
      this.camera.setTarget(currentTarget2.add(delta2));
    } else if (this.selectedTerrainRect) {
      const delta = this.moveSelectedTerrainRect(movement);
      delta.y = movement.y;
      this.camera.position.addInPlace(delta);
      const currentTarget3 = this.camera.getTarget();
      this.camera.setTarget(currentTarget3.add(delta));
    } else if (this.polyWallTool?.selectedPoint) {
      const d = this.polyWallTool.moveSelectedPoint(movement.x, movement.z);
      const delta4 = new Vector3(d.x, movement.y, d.z);
      this.camera.position.addInPlace(delta4);
      const currentTarget4 = this.camera.getTarget();
      this.camera.setTarget(currentTarget4.add(delta4));
    } else if (this.bezierWallTool?.selectedAnchor) {
      const d = this.bezierWallTool.moveSelectedAnchor(movement.x, movement.z);
      const delta5 = new Vector3(d.x, movement.y, d.z);
      this.camera.position.addInPlace(delta5);
      const currentTarget5 = this.camera.getTarget();
      this.camera.setTarget(currentTarget5.add(delta5));
    } else if (this.bezierWallTool?.selectedHandle) {
      const d = this.bezierWallTool.moveSelectedHandle(movement.x, movement.z);
      const delta6 = new Vector3(d.x, movement.y, d.z);
      this.camera.position.addInPlace(delta6);
      const currentTarget6 = this.camera.getTarget();
      this.camera.setTarget(currentTarget6.add(delta6));
    } else {
      // Move camera and target together
      this.camera.position.addInPlace(movement);
      const currentTarget = this.camera.getTarget();
      this.camera.setTarget(currentTarget.add(movement));
    }
  }

  handlePointerDown(pointerInfo) {
    if (!this.isActive) return;
    
    if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
      const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
      
      if (pickResult.hit && pickResult.pickedMesh) {
        // Check if clicked mesh is part of a checkpoint
        const clickedMesh = pickResult.pickedMesh;

        // Mesh grid control points take priority
        if (this.meshGridTool?.onPointerDown(clickedMesh)) return;

        // Poly wall control points
        if (this.polyWallTool?.onPointerDown(clickedMesh)) return;

        // Bezier wall control points
        if (this.bezierWallTool?.onPointerDown(clickedMesh)) return;
        
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
              this.deselectHill();
            } else {
              this.deselectCheckpoint();
              this.deselectSquareHill();
              this.meshGridTool?.deselectPoint();
              this.polyWallTool?.deselectPoint();
              this.bezierWallTool?.deselectAll();
              this.selectHill(hillData);
            }
            return;
          }
        }

        // Check if clicked mesh is a square hill gizmo
        for (const hillData of this.squareHillMeshes) {
          if (clickedMesh === hillData.mesh) {
            if (this.selectedSquareHill === hillData) {
              this.deselectSquareHill();
            } else {
              this.deselectCheckpoint();
              this.deselectHill();
              this.deselectTerrainRect();
              this.selectSquareHill(hillData);
            }
            return;
          }
        }

        // Check if clicked mesh is a terrain rect gizmo
        for (const rectData of this.terrainRectMeshes) {
          if (clickedMesh === rectData.mesh) {
            if (this.selectedTerrainRect === rectData) {
              this.deselectTerrainRect();
            } else {
              this.deselectCheckpoint();
              this.deselectHill();
              this.deselectSquareHill();
              this.selectTerrainRect(rectData);
            }
            return;
          }
        }

        // Clicked on something else (terrain, etc.) — deselect all
        this.deselectCheckpoint();
        this.deselectHill();
        this.deselectSquareHill();
        this.deselectTerrainRect();
      } else {
        // Clicked on empty space (sky, etc.) — deselect all
        this.deselectCheckpoint();
        this.deselectHill();
        this.deselectSquareHill();
        this.deselectTerrainRect();
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
    this._rawDragPos = { x: checkpointData.feature.centerX, z: checkpointData.feature.centerZ };
    
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
      this._rawDragPos = null;
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
    this.saveSnapshot();
    
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
  // ─── Duplicate ────────────────────────────────────────────────────────────

  duplicateSelectedHill() {
    if (!this.selectedHill) return;
    this.saveSnapshot();
    const src = this.selectedHill.feature;
    const newFeature = { ...src, centerX: src.centerX + 3, centerZ: src.centerZ + 3 };
    this.currentTrack.features.push(newFeature);
    const hillData = this.createHillVisual(newFeature);
    this.deselectHill();
    this.selectHill(hillData);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
  }

  duplicateSelectedSquareHill() {
    if (!this.selectedSquareHill) return;
    this.saveSnapshot();
    const src = this.selectedSquareHill.feature;
    const newFeature = { ...src, centerX: src.centerX + 3, centerZ: src.centerZ + 3 };
    this.currentTrack.features.push(newFeature);
    const hillData = this.createSquareHillVisual(newFeature);
    this.deselectSquareHill();
    this.selectSquareHill(hillData);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
  }

  duplicateSelectedCheckpoint() {
    if (!this.selectedCheckpoint) return;
    this.saveSnapshot();
    const src = this.selectedCheckpoint.feature;
    // Assign next checkpoint number
    const maxNum = this.currentTrack.features
      .filter(f => f.type === 'checkpoint' && f.checkpointNumber != null)
      .reduce((m, f) => Math.max(m, f.checkpointNumber), 0);
    const newFeature = { ...src, centerX: src.centerX + 5, centerZ: src.centerZ + 5, checkpointNumber: maxNum + 1 };
    this.currentTrack.features.push(newFeature);
    const cpMesh = this.checkpointManager.createSingleCheckpoint(newFeature);
    this.deselectCheckpoint();
    this.selectCheckpoint(cpMesh);
  }

  // ─── Terrain Rect Editing ───────────────────────────────────────────────────────────

  addTerrainRectEntity() {
    const camPos = this.camera.position;
    const camTarget = this.camera.target;
    const direction = camTarget.subtract(camPos).normalize();
    const newX = camPos.x + direction.x * 20;
    const newZ = camPos.z + direction.z * 50;
    const newFeature = {
      type: 'terrainRect',
      centerX: newX,
      centerZ: newZ,
      width: 10,
      depth: 10,
      terrainType: TERRAIN_TYPES.MUD,
    };
    this.saveSnapshot();
    this.currentTrack.features.push(newFeature);
    const rectData = this.createTerrainRectVisual(newFeature);
    this.deselectCheckpoint();
    this.deselectHill();
    this.deselectSquareHill();
    this.selectTerrainRect(rectData);
    window.rebuildTerrainGrid?.();
    window.rebuildTerrainTexture?.();
    this.hideAddMenu();
  }

  _terrainColorForType(terrainType) {
    if (!terrainType) return new Color3(0.5, 0.5, 0.5);
    const c = terrainType.color;
    return c instanceof Color3 ? c : new Color3(c.r, c.g, c.b);
  }

  createTerrainRectVisual(feature) {
    const terrainH = this.currentTrack ? this.currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;
    const node = new TransformNode('terrainRectNode', this.scene);
    node.position = new Vector3(feature.centerX, terrainH + 0.05, feature.centerZ);
    node.scaling  = new Vector3(feature.width, 0.1, feature.depth);

    const mesh = MeshBuilder.CreateBox('terrainRectMesh', { size: 1 }, this.scene);
    mesh.parent = node;
    // Clone base material tinted to the terrain type's color
    const mat = this.terrainRectMaterial.clone('trMat_' + Date.now());
    const col = this._terrainColorForType(feature.terrainType);
    mat.diffuseColor = col;
    mat.emissiveColor = col.scale(0.3);
    mesh.material = mat;
    mesh.isPickable = true;

    const rectData = { feature, node, mesh, mat };
    this.terrainRectMeshes.push(rectData);
    return rectData;
  }

  updateTerrainRectVisual(rectData) {
    const { feature, node, mat } = rectData;
    const terrainH = this.currentTrack ? this.currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;
    node.position.x = feature.centerX;
    node.position.z = feature.centerZ;
    node.position.y = terrainH + 0.05;
    node.scaling.x  = feature.width;
    node.scaling.z  = feature.depth;
    const col = this._terrainColorForType(feature.terrainType);
    mat.diffuseColor = col;
    mat.emissiveColor = col.scale(0.3);
  }

  selectTerrainRect(rectData) {
    this.deselectTerrainRect();
    this.selectedTerrainRect = rectData;
    this._rawDragPos = { x: rectData.feature.centerX, z: rectData.feature.centerZ };
    rectData.mesh.material = this.terrainRectHighlightMaterial;
    this.showTerrainRectProperties(rectData);
  }

  deselectTerrainRect() {
    if (!this.selectedTerrainRect) return;
    this.selectedTerrainRect.mesh.material = this.selectedTerrainRect.mat;
    this.selectedTerrainRect = null;
    this._rawDragPos = null;
    this.hideTerrainRectProperties();
  }

  moveSelectedTerrainRect(movement) {
    if (!this.selectedTerrainRect || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    this.saveSnapshot(true);
    const { feature } = this.selectedTerrainRect;
    if (!this._rawDragPos) this._rawDragPos = { x: feature.centerX, z: feature.centerZ };
    this._rawDragPos.x += movement.x;
    this._rawDragPos.z += movement.z;
    const prevX = feature.centerX, prevZ = feature.centerZ;
    feature.centerX = this._snap(this._rawDragPos.x);
    feature.centerZ = this._snap(this._rawDragPos.z);
    this.updateTerrainRectVisual(this.selectedTerrainRect);
    window.rebuildTerrainGrid?.();
    return new Vector3(feature.centerX - prevX, 0, feature.centerZ - prevZ);
  }

  deleteSelectedTerrainRect() {
    if (!this.selectedTerrainRect) return;
    this.saveSnapshot();
    const rectData = this.selectedTerrainRect;
    const idx = this.currentTrack.features.indexOf(rectData.feature);
    if (idx > -1) this.currentTrack.features.splice(idx, 1);
    rectData.mesh.dispose();
    rectData.node.dispose();
    const meshIdx = this.terrainRectMeshes.indexOf(rectData);
    if (meshIdx > -1) this.terrainRectMeshes.splice(meshIdx, 1);
    this.hideTerrainRectProperties();
    this.selectedTerrainRect = null;
    window.rebuildTerrainGrid?.();
    window.rebuildTerrainTexture?.();
  }

  duplicateSelectedTerrainRect() {
    if (!this.selectedTerrainRect) return;
    this.saveSnapshot();
    const src = this.selectedTerrainRect.feature;
    const newFeature = { ...src, centerX: src.centerX + 3, centerZ: src.centerZ + 3 };
    this.currentTrack.features.push(newFeature);
    const rectData = this.createTerrainRectVisual(newFeature);
    this.deselectTerrainRect();
    this.selectTerrainRect(rectData);
    window.rebuildTerrainGrid?.();
    window.rebuildTerrainTexture?.();
  }

  createTerrainRectPropertiesPanel() {
    const panel = document.createElement('div');
    panel.id = 'terrain-rect-properties-panel';
    panel.style.cssText = `
      position: fixed; top: 80px; right: 20px;
      background: rgba(0,0,0,0.88); padding: 18px 20px 16px;
      border-radius: 10px; border: 2px solid #4a9eff;
      display: none; z-index: 1000; min-width: 230px;
      font-family: Arial, sans-serif; color: white;
      user-select: none; pointer-events: auto;
    `;

    const title = document.createElement('div');
    title.textContent = 'Terrain Rect';
    title.style.cssText = 'font-size:13px; font-weight:bold; margin-bottom:16px; color:#4a9eff; text-transform:uppercase; letter-spacing:1px;';
    panel.appendChild(title);

    const mkRow = () => { const r = document.createElement('div'); r.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;'; return r; };
    const sliderCss = 'width:100%; accent-color:#4a9eff; margin-bottom:14px; cursor:pointer;';

    // Width
    const widthRow = mkRow();
    widthRow.appendChild(Object.assign(document.createElement('span'), { textContent: 'Width' }));
    widthRow.appendChild(Object.assign(document.createElement('span'), { id: 'tr-width-val', textContent: '10.0' }));
    panel.appendChild(widthRow);
    const widthSlider = Object.assign(document.createElement('input'), { type: 'range', id: 'tr-width-slider', min: '1', max: '80', step: '0.5', value: '10' });
    widthSlider.style.cssText = sliderCss;
    panel.appendChild(widthSlider);

    // Depth
    const depthRow = mkRow();
    depthRow.appendChild(Object.assign(document.createElement('span'), { textContent: 'Depth' }));
    depthRow.appendChild(Object.assign(document.createElement('span'), { id: 'tr-depth-val', textContent: '10.0' }));
    panel.appendChild(depthRow);
    const depthSlider = Object.assign(document.createElement('input'), { type: 'range', id: 'tr-depth-slider', min: '1', max: '80', step: '0.5', value: '10' });
    depthSlider.style.cssText = sliderCss;
    panel.appendChild(depthSlider);

    // Surface
    const surfLbl = document.createElement('div');
    surfLbl.textContent = 'Surface';
    surfLbl.style.cssText = 'font-size:12px; margin-bottom:6px;';
    panel.appendChild(surfLbl);
    const terrainSelect = document.createElement('select');
    terrainSelect.id = 'tr-terrain-select';
    terrainSelect.style.cssText = 'width:100%; padding:6px 8px; background:#2a2a2a; color:white; border:1px solid #4a9eff; border-radius:4px; font-size:12px; margin-bottom:16px; cursor:pointer;';
    [
      { value: 'packed_dirt', label: 'Packed Dirt' },
      { value: 'loose_dirt',  label: 'Loose Dirt'  },
      { value: 'asphalt',     label: 'Asphalt'     },
      { value: 'mud',         label: 'Mud'         },
      { value: 'water',       label: 'Water'       },
      { value: 'rocky',       label: 'Rocky'       },
    ].forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label;
      terrainSelect.appendChild(opt);
    });
    panel.appendChild(terrainSelect);

    // Hint
    const hint = document.createElement('div');
    hint.textContent = 'WASD to move  ·  Del to delete';
    hint.style.cssText = 'font-size:10px; color:#888; margin-bottom:14px;';
    panel.appendChild(hint);

    // Duplicate
    const dupBtn = document.createElement('button');
    dupBtn.textContent = 'Duplicate Terrain Rect';
    dupBtn.style.cssText = 'display:block; width:100%; padding:8px; background:#2980b9; color:white; border:none; border-radius:5px; cursor:pointer; font-size:13px; font-family:Arial; margin-bottom:8px;';
    panel.appendChild(dupBtn);

    // Delete
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete Terrain Rect';
    deleteBtn.style.cssText = 'display:block; width:100%; padding:8px; background:#c0392b; color:white; border:none; border-radius:5px; cursor:pointer; font-size:13px; font-family:Arial;';
    panel.appendChild(deleteBtn);

    // Event wiring
    widthSlider.addEventListener('input', () => {
      if (!this.selectedTerrainRect) return;
      this.saveSnapshot(true);
      const val = parseFloat(widthSlider.value);
      document.getElementById('tr-width-val').textContent = val.toFixed(1);
      this.selectedTerrainRect.feature.width = val;
      this.updateTerrainRectVisual(this.selectedTerrainRect);
      window.rebuildTerrainGrid?.();
    });

    depthSlider.addEventListener('input', () => {
      if (!this.selectedTerrainRect) return;
      this.saveSnapshot(true);
      const val = parseFloat(depthSlider.value);
      document.getElementById('tr-depth-val').textContent = val.toFixed(1);
      this.selectedTerrainRect.feature.depth = val;
      this.updateTerrainRectVisual(this.selectedTerrainRect);
      window.rebuildTerrainGrid?.();
    });

    terrainSelect.addEventListener('change', () => {
      if (!this.selectedTerrainRect) return;
      this.saveSnapshot();
      const val = terrainSelect.value;
      const key = Object.keys(TERRAIN_TYPES).find(k => TERRAIN_TYPES[k].name === val);
      this.selectedTerrainRect.feature.terrainType = key ? TERRAIN_TYPES[key] : null;
      this.updateTerrainRectVisual(this.selectedTerrainRect);
      window.rebuildTerrainGrid?.();
      window.rebuildTerrainTexture?.();
    });

    dupBtn.addEventListener('click', () => this.duplicateSelectedTerrainRect());
    deleteBtn.addEventListener('click', () => this.deleteSelectedTerrainRect());
    panel.addEventListener('mousedown', e => e.stopPropagation());

    document.body.appendChild(panel);
    this.terrainRectPropertiesPanel = panel;
  }

  showTerrainRectProperties(rectData) {
    const s = this._editorStore;
    if (!s) return;
    const { feature } = rectData;
    s.terrainRect.width       = feature.width;
    s.terrainRect.depth       = feature.depth;
    s.terrainRect.terrainType = feature.terrainType?.name || 'mud';
    s.selectedType            = 'terrainRect';
  }

  hideTerrainRectProperties() {
    if (this._editorStore?.selectedType === 'terrainRect')
      this._editorStore.selectedType = null;
  }

  moveSelectedCheckpoint(movement) {
    if (!this.selectedCheckpoint) return new Vector3(0, 0, 0);
    if (movement.x === 0 && movement.z === 0) return new Vector3(0, movement.y, 0);
    this.saveSnapshot(true);

    const checkpoint = this.selectedCheckpoint;
    const feature = checkpoint.feature;

    if (!this._rawDragPos) this._rawDragPos = { x: feature.centerX, z: feature.centerZ };
    this._rawDragPos.x += movement.x;
    this._rawDragPos.z += movement.z;

    const prevX = feature.centerX;
    const prevZ = feature.centerZ;
    feature.centerX = this._snap(this._rawDragPos.x);
    feature.centerZ = this._snap(this._rawDragPos.z);

    const terrainHeight = this.currentTrack.getHeightAt(feature.centerX, feature.centerZ);
    checkpoint.container.position.x = feature.centerX;
    checkpoint.container.position.z = feature.centerZ;
    checkpoint.container.position.y = terrainHeight;

    return new Vector3(feature.centerX - prevX, 0, feature.centerZ - prevZ);
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

    // Add Square Hill button
    const squareHillBtn = document.createElement('button');
    squareHillBtn.textContent = 'Add Square Hill';
    squareHillBtn.style.cssText = buttonStyle;
    squareHillBtn.onclick = () => this.addSquareHillEntity();
    this.addMenuOverlay.appendChild(squareHillBtn);

    // Add Terrain Rect button
    const terrainRectBtn = document.createElement('button');
    terrainRectBtn.textContent = 'Add Terrain Rect';
    terrainRectBtn.style.cssText = buttonStyle;
    terrainRectBtn.onclick = () => this.addTerrainRectEntity();
    this.addMenuOverlay.appendChild(terrainRectBtn);

    // Mesh Grid button
    const meshGridBtn = document.createElement('button');
    meshGridBtn.textContent = 'Mesh Grid';
    meshGridBtn.style.cssText = buttonStyle + 'background: #1ec8c8; color: #000;';
    meshGridBtn.onclick = () => { this.meshGridTool?.addMeshGridFeature(); this.hideAddMenu(); };
    this.addMenuOverlay.appendChild(meshGridBtn);

    // Poly Wall button
    const polyWallBtn = document.createElement('button');
    polyWallBtn.textContent = 'Add Poly Wall';
    polyWallBtn.style.cssText = buttonStyle + 'background: #f5a623; color: #000;';
    polyWallBtn.onclick = () => { this.polyWallTool?.addPolyWallFeature(); this.hideAddMenu(); };
    this.addMenuOverlay.appendChild(polyWallBtn);

    // Bezier Wall button
    const bezierWallBtn = document.createElement('button');
    bezierWallBtn.textContent = 'Add Bezier Wall';
    bezierWallBtn.style.cssText = buttonStyle + 'background: #4a9eff; color: #fff;';
    bezierWallBtn.onclick = () => { this.bezierWallTool?.addBezierWallFeature(); this.hideAddMenu(); };
    this.addMenuOverlay.appendChild(bezierWallBtn);

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
    this.saveSnapshot();
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

    // ── Order display + reorder buttons ──
    const orderRow = mkRow();
    orderRow.appendChild(Object.assign(document.createElement('span'), { textContent: 'Order' }));
    const orderNum = Object.assign(document.createElement('span'), { id: 'cp-order-num', textContent: '#1' });
    orderNum.style.cssText = 'font-weight:bold; color:#ff9f43;';
    orderRow.appendChild(orderNum);
    panel.appendChild(orderRow);

    const orderBtnRow = document.createElement('div');
    orderBtnRow.style.cssText = 'display:flex; gap:6px; margin-bottom:14px;';
    const earlierBtn = Object.assign(document.createElement('button'), { textContent: '← Earlier' });
    earlierBtn.style.cssText = 'flex:1; padding:6px; background:#555; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px; font-family:Arial;';
    const laterBtn = Object.assign(document.createElement('button'), { textContent: 'Later →' });
    laterBtn.style.cssText = 'flex:1; padding:6px; background:#555; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px; font-family:Arial;';
    orderBtnRow.appendChild(earlierBtn);
    orderBtnRow.appendChild(laterBtn);
    panel.appendChild(orderBtnRow);

    // ── Hint ──
    const hint = document.createElement('div');
    hint.textContent = 'WASD to move  ·  QE to rotate  ·  Del to delete';
    hint.style.cssText = 'font-size: 10px; color: #888; margin-bottom: 14px;';
    panel.appendChild(hint);

    // ── Delete button ──
    const dupBtn = document.createElement('button');
    dupBtn.textContent = 'Duplicate Checkpoint';
    dupBtn.style.cssText = 'display:block; width:100%; padding:8px; background:#2980b9; color:white; border:none; border-radius:5px; cursor:pointer; font-size:13px; font-family:Arial; margin-bottom:8px;';
    panel.appendChild(dupBtn);

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
      this.saveSnapshot(true);
      const val = parseFloat(widthSlider.value);
      document.getElementById('cp-width-val').textContent = val.toFixed(1);
      this.selectedCheckpoint.updateWidth(val);
    });

    dupBtn.addEventListener('click', () => this.duplicateSelectedCheckpoint());
    deleteBtn.addEventListener('click', () => this.deleteSelectedCheckpoint());
    earlierBtn.addEventListener('click', () => this.shiftCheckpointOrder(-1));
    laterBtn.addEventListener('click', () => this.shiftCheckpointOrder(1));

    panel.addEventListener('mousedown', e => e.stopPropagation());

    document.body.appendChild(panel);
    this.checkpointPropertiesPanel = panel;
  }

  showCheckpointProperties(checkpointData) {
    const s = this._editorStore;
    if (!s) return;
    s.checkpoint.width    = checkpointData.feature.width;
    s.checkpoint.orderNum = checkpointData.feature.checkpointNumber ?? 1;
    s.selectedType        = 'checkpoint';
  }

  hideCheckpointProperties() {
    if (this._editorStore?.selectedType === 'checkpoint')
      this._editorStore.selectedType = null;
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

  // ─── Checkpoint Reordering ─────────────────────────────────────────────────

  /**
   * Swap the selected checkpoint's order number with its neighbour.
   * direction: -1 = move earlier (lower number), +1 = move later (higher number)
   */
  shiftCheckpointOrder(direction) {
    if (!this.selectedCheckpoint) return;
    const myNum = this.selectedCheckpoint.feature.checkpointNumber;
    if (myNum == null) return;
    const targetNum = myNum + direction;
    const other = this.currentTrack.features.find(
      f => f.type === 'checkpoint' && f.checkpointNumber === targetNum
    );
    if (!other) return;
    this.saveSnapshot();
    this.selectedCheckpoint.feature.checkpointNumber = targetNum;
    other.checkpointNumber = myNum;
    this._refreshAllCheckpointDecals();
    if (this._editorStore) this._editorStore.checkpoint.orderNum = targetNum;
  }

  /** Re-render the number/finish decal on every checkpoint gate. */
  _refreshAllCheckpointDecals() {
    const maxNum = this.currentTrack.features
      .filter(f => f.type === 'checkpoint' && f.checkpointNumber != null)
      .reduce((m, f) => Math.max(m, f.checkpointNumber), 0);
    for (const cp of this.checkpointManager.checkpointMeshes) {
      const isFinish = maxNum > 0 && cp.feature.checkpointNumber === maxNum;
      cp.updateDecal(cp.feature.checkpointNumber, isFinish);
    }
  }

  // ─── Grid Snapping ────────────────────────────────────────────────────────

  /** Round a world-space coordinate to the current snap grid, if snap is on. */
  _snap(v) {
    return this.snapEnabled ? Math.round(v / this.snapSize) * this.snapSize : v;
  }

  _createSnapIndicator() {
    const el = document.createElement('div');
    el.id = 'editor-snap-indicator';
    el.style.cssText = `
      position: fixed; bottom: 20px; right: 20px;
      background: rgba(0,0,0,0.75); color: #aaa;
      padding: 6px 14px; border-radius: 20px;
      font-family: Arial, sans-serif; font-size: 12px;
      border: 1px solid #444; pointer-events: none;
      z-index: 999; user-select: none;
    `;
    el.textContent = 'GRID: OFF  [G]';
    document.body.appendChild(el);
    this.snapIndicator = el;
  }

  _updateSnapIndicator() {
    if (!this.snapIndicator) return;
    if (this.snapEnabled) {
      this.snapIndicator.style.color = '#2ecc71';
      this.snapIndicator.style.borderColor = '#2ecc71';
      this.snapIndicator.textContent = `GRID: ${this.snapSize}u  [G / Shift+G]`;
    } else {
      this.snapIndicator.style.color = '#aaa';
      this.snapIndicator.style.borderColor = '#444';
      this.snapIndicator.textContent = 'GRID: OFF  [G]';
    }
  }

  // ─── Quick Test ───────────────────────────────────────────────────────────

  _createTestTrackButton() {
    const btn = document.createElement('button');
    btn.textContent = '🏁 Test Track';
    btn.style.cssText = `
      position: fixed; bottom: 20px; left: 20px;
      background: #27ae60; color: white;
      border: none; border-radius: 8px;
      padding: 10px 18px; font-size: 14px; font-family: Arial;
      cursor: pointer; z-index: 999;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    `;
    btn.addEventListener('click', () => this.quickTestTrack());
    btn.addEventListener('mouseover', () => btn.style.background = '#2ecc71');
    btn.addEventListener('mouseout',  () => btn.style.background = '#27ae60');
    document.body.appendChild(btn);
    this.testTrackBtn = btn;
  }

  quickTestTrack() {
    window.quickTestTrack?.();
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

    this.saveSnapshot();
    this.currentTrack.features.push(newFeature);
    const hillData = this.createHillVisual(newFeature);

    this.deselectCheckpoint();
    this.selectHill(hillData);

    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();

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
    this._rawDragPos = { x: hillData.feature.centerX, z: hillData.feature.centerZ };
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
      window.rebuildTerrainTexture?.();
      console.log('[EditorController] Deselected hill');
      this.selectedHill = null;
      this._rawDragPos = null;
    }
  }

  /**
   * Translate the selected hill by the given movement vector and rebuild terrain.
   */
  moveSelectedHill(movement) {
    if (!this.selectedHill || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    this.saveSnapshot(true);
    const { feature } = this.selectedHill;
    if (!this._rawDragPos) this._rawDragPos = { x: feature.centerX, z: feature.centerZ };
    this._rawDragPos.x += movement.x;
    this._rawDragPos.z += movement.z;
    const prevX = feature.centerX, prevZ = feature.centerZ;
    feature.centerX = this._snap(this._rawDragPos.x);
    feature.centerZ = this._snap(this._rawDragPos.z);
    this.updateHillVisual(this.selectedHill);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
    return new Vector3(feature.centerX - prevX, 0, feature.centerZ - prevZ);
  }

  /**
   * Remove the selected hill from the track and dispose its gizmo.
   */
  deleteSelectedHill() {
    if (!this.selectedHill) return;
    this.saveSnapshot();

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

  // ─── Square Hill Editing ──────────────────────────────────────────────────

  addSquareHillEntity() {
    const camPos = this.camera.position;
    const camTarget = this.camera.target;
    const direction = camTarget.subtract(camPos).normalize();
    const newX = camPos.x + direction.x * 20;
    const newZ = camPos.z + direction.z * 50;

    const newFeature = {
      type: 'squareHill',
      centerX: newX,
      centerZ: newZ,
      width: 10,
      depth: 10,
      height: 3,
      transition: 4,
      terrainType: null,
    };

    this.saveSnapshot();
    this.currentTrack.features.push(newFeature);
    const hillData = this.createSquareHillVisual(newFeature);

    this.deselectCheckpoint();
    this.deselectHill();
    this.selectSquareHill(hillData);

    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();

    this.hideAddMenu();
    console.log('[EditorController] Added square hill at', newX.toFixed(1), newZ.toFixed(1));
  }

  createSquareHillVisual(feature) {
    const transition = feature.transition ?? 8;
    const terrainH = this.currentTrack ? this.currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;
    const absH = feature.heightAtMin !== undefined
      ? Math.max(0.5, Math.abs(feature.heightAtMin ?? 0), Math.abs(feature.heightAtMax ?? 0))
      : Math.max(0.5, Math.abs(feature.height ?? 5));

    const node = new TransformNode('squareHillNode', this.scene);
    node.position = new Vector3(feature.centerX, terrainH + absH / 2, feature.centerZ);
    node.scaling  = new Vector3(feature.width + transition * 2, absH, (feature.depth ?? feature.width) + transition * 2);
    node.rotation.y = -(feature.angle ?? 0) * Math.PI / 180;

    const mesh = MeshBuilder.CreateBox('squareHillMesh', { size: 1 }, this.scene);
    mesh.parent = node;
    mesh.material = this.squareHillMaterial;
    mesh.isPickable = true;

    const hillData = { feature, node, mesh };
    this.squareHillMeshes.push(hillData);
    return hillData;
  }

  updateSquareHillVisual(hillData) {
    const { feature, node } = hillData;
    const transition = feature.transition ?? 8;
    const terrainH = this.currentTrack ? this.currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;
    // For sloped mode use the larger absolute endpoint so the box has meaningful height
    const absH = feature.heightAtMin !== undefined
      ? Math.max(0.5, Math.abs(feature.heightAtMin ?? 0), Math.abs(feature.heightAtMax ?? 0))
      : Math.max(0.5, Math.abs(feature.height ?? 5));
    node.position.x = feature.centerX;
    node.position.z = feature.centerZ;
    node.position.y = terrainH + absH / 2;
    node.scaling.x  = feature.width + transition * 2;
    node.scaling.y  = absH;
    node.scaling.z  = (feature.depth ?? feature.width) + transition * 2;
    node.rotation.y = -(feature.angle ?? 0) * Math.PI / 180;
  }

  selectSquareHill(hillData) {
    this.deselectSquareHill();
    this.selectedSquareHill = hillData;
    this._rawDragPos = { x: hillData.feature.centerX, z: hillData.feature.centerZ };
    hillData.mesh.material = this.squareHillHighlightMaterial;
    this.showSquareHillProperties(hillData);
    console.log('[EditorController] Selected square hill at',
      hillData.feature.centerX.toFixed(1), hillData.feature.centerZ.toFixed(1));
  }

  deselectSquareHill() {
    if (this.selectedSquareHill) {
      this.selectedSquareHill.mesh.material = this.squareHillMaterial;
      this.hideSquareHillProperties();
      window.rebuildTerrainTexture?.();
      console.log('[EditorController] Deselected square hill');
      this.selectedSquareHill = null;
      this._rawDragPos = null;
    }
  }

  moveSelectedSquareHill(movement) {
    if (!this.selectedSquareHill || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    this.saveSnapshot(true);
    const { feature } = this.selectedSquareHill;
    if (!this._rawDragPos) this._rawDragPos = { x: feature.centerX, z: feature.centerZ };
    this._rawDragPos.x += movement.x;
    this._rawDragPos.z += movement.z;
    const prevX = feature.centerX, prevZ = feature.centerZ;
    feature.centerX = this._snap(this._rawDragPos.x);
    feature.centerZ = this._snap(this._rawDragPos.z);
    this.updateSquareHillVisual(this.selectedSquareHill);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
    return new Vector3(feature.centerX - prevX, 0, feature.centerZ - prevZ);
  }

  deleteSelectedSquareHill() {
    if (!this.selectedSquareHill) return;
    this.saveSnapshot();
    const hillData = this.selectedSquareHill;

    const idx = this.currentTrack.features.indexOf(hillData.feature);
    if (idx > -1) this.currentTrack.features.splice(idx, 1);

    hillData.mesh.dispose();
    hillData.node.dispose();

    const meshIdx = this.squareHillMeshes.indexOf(hillData);
    if (meshIdx > -1) this.squareHillMeshes.splice(meshIdx, 1);

    this.hideSquareHillProperties();
    this.selectedSquareHill = null;

    window.rebuildTerrain?.();
    window.rebuildTerrainTexture?.();
    console.log('[EditorController] Deleted square hill');
  }

  // ─── Square Hill Properties Panel ─────────────────────────────────────────

  createSquareHillPropertiesPanel() {
    const panel = document.createElement('div');
    panel.id = 'square-hill-properties-panel';
    panel.style.cssText = `
      position: fixed;
      top: 80px;
      right: 270px;
      background: rgba(0, 0, 0, 0.88);
      padding: 18px 20px 16px;
      border-radius: 10px;
      border: 2px solid #f0a020;
      display: none;
      z-index: 1000;
      min-width: 230px;
      font-family: Arial, sans-serif;
      color: white;
      user-select: none;
      pointer-events: auto;
    `;

    const title = document.createElement('div');
    title.textContent = 'Square Hill';
    title.style.cssText = 'font-size:13px; font-weight:bold; margin-bottom:16px; color:#f0a020; text-transform:uppercase; letter-spacing:1px;';
    panel.appendChild(title);

    const mkRow = () => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;';
      return row;
    };
    const sliderCss = 'width:100%; accent-color:#f0a020; margin-bottom:14px; cursor:pointer;';
    const btnBase = 'flex:1; padding:5px 0; border:1px solid #f0a020; border-radius:4px; cursor:pointer; font-size:12px; font-family:Arial; transition:background 0.15s;';

    // ── Width ──
    const widthRow = mkRow();
    const widthLbl = document.createElement('span'); widthLbl.textContent = 'Width';
    const widthVal = document.createElement('span'); widthVal.id = 'sq-width-val'; widthVal.textContent = '20.0';
    widthRow.appendChild(widthLbl); widthRow.appendChild(widthVal);
    panel.appendChild(widthRow);
    const widthSlider = document.createElement('input');
    widthSlider.type = 'range'; widthSlider.id = 'sq-width-slider';
    widthSlider.min = '4'; widthSlider.max = '60'; widthSlider.step = '1'; widthSlider.value = '20';
    widthSlider.style.cssText = sliderCss;
    panel.appendChild(widthSlider);

    // ── Depth ──
    const depthRow = mkRow();
    const depthLbl = document.createElement('span'); depthLbl.textContent = 'Depth';
    const depthVal = document.createElement('span'); depthVal.id = 'sq-depth-val'; depthVal.textContent = '20.0';
    depthRow.appendChild(depthLbl); depthRow.appendChild(depthVal);
    panel.appendChild(depthRow);
    const depthSlider = document.createElement('input');
    depthSlider.type = 'range'; depthSlider.id = 'sq-depth-slider';
    depthSlider.min = '4'; depthSlider.max = '60'; depthSlider.step = '1'; depthSlider.value = '20';
    depthSlider.style.cssText = sliderCss;
    panel.appendChild(depthSlider);

    // ── Transition ──
    const transRow = mkRow();
    const transLbl = document.createElement('span'); transLbl.textContent = 'Transition';
    const transVal = document.createElement('span'); transVal.id = 'sq-trans-val'; transVal.textContent = '8.0';
    transRow.appendChild(transLbl); transRow.appendChild(transVal);
    panel.appendChild(transRow);
    const transSlider = document.createElement('input');
    transSlider.type = 'range'; transSlider.id = 'sq-trans-slider';
    transSlider.min = '0'; transSlider.max = '20'; transSlider.step = '0.5'; transSlider.value = '8';
    transSlider.style.cssText = sliderCss;
    panel.appendChild(transSlider);

    // ── Angle (common to flat and sloped) ──
    const angleRow = mkRow();
    const angleLblTxt = document.createElement('span'); angleLblTxt.textContent = 'Angle';
    const angleVal = document.createElement('span'); angleVal.id = 'sq-angle-val'; angleVal.textContent = '0°';
    angleRow.appendChild(angleLblTxt); angleRow.appendChild(angleVal);
    panel.appendChild(angleRow);
    const angleSlider = document.createElement('input');
    angleSlider.type = 'range'; angleSlider.id = 'sq-angle-slider';
    angleSlider.min = '0'; angleSlider.max = '359'; angleSlider.step = '1'; angleSlider.value = '0';
    angleSlider.style.cssText = sliderCss;
    panel.appendChild(angleSlider);

    // ── Mode toggle: Flat | Sloped ──
    const modeLbl = document.createElement('div');
    modeLbl.textContent = 'Mode';
    modeLbl.style.cssText = 'font-size:12px; margin-bottom:6px;';
    panel.appendChild(modeLbl);
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex; gap:6px; margin-bottom:14px;';
    const flatBtn  = document.createElement('button'); flatBtn.id  = 'sq-mode-flat';   flatBtn.textContent = 'Flat';
    const slopeBtn = document.createElement('button'); slopeBtn.id = 'sq-mode-sloped'; slopeBtn.textContent = 'Sloped';
    flatBtn.style.cssText  = btnBase + 'background:#f0a020; color:#000;';
    slopeBtn.style.cssText = btnBase + 'background:transparent; color:#f0a020;';
    modeRow.appendChild(flatBtn); modeRow.appendChild(slopeBtn);
    panel.appendChild(modeRow);

    // ── Flat section ──
    const flatSection = document.createElement('div');
    flatSection.id = 'sq-flat-section';
    const heightRow = mkRow();
    const heightLbl = document.createElement('span'); heightLbl.textContent = 'Height';
    const heightVal = document.createElement('span'); heightVal.id = 'sq-height-val'; heightVal.textContent = '5.0';
    heightRow.appendChild(heightLbl); heightRow.appendChild(heightVal);
    flatSection.appendChild(heightRow);
    const heightSlider = document.createElement('input');
    heightSlider.type = 'range'; heightSlider.id = 'sq-height-slider';
    heightSlider.min = '-15'; heightSlider.max = '20'; heightSlider.step = '0.5'; heightSlider.value = '5';
    heightSlider.style.cssText = sliderCss;
    flatSection.appendChild(heightSlider);
    panel.appendChild(flatSection);

    // ── Sloped section ──
    const slopedSection = document.createElement('div');
    slopedSection.id = 'sq-sloped-section';
    slopedSection.style.display = 'none';

    // Height Min
    const hMinRow = mkRow();
    const hMinLbl = document.createElement('span'); hMinLbl.textContent = 'Height (\u2212 edge)';
    const hMinVal = document.createElement('span'); hMinVal.id = 'sq-hmin-val'; hMinVal.textContent = '0.0';
    hMinRow.appendChild(hMinLbl); hMinRow.appendChild(hMinVal);
    slopedSection.appendChild(hMinRow);
    const hMinSlider = document.createElement('input');
    hMinSlider.type = 'range'; hMinSlider.id = 'sq-hmin-slider';
    hMinSlider.min = '-15'; hMinSlider.max = '20'; hMinSlider.step = '0.5'; hMinSlider.value = '0';
    hMinSlider.style.cssText = sliderCss;
    slopedSection.appendChild(hMinSlider);

    // Height Max
    const hMaxRow = mkRow();
    const hMaxLbl = document.createElement('span'); hMaxLbl.textContent = 'Height (+ edge)';
    const hMaxVal = document.createElement('span'); hMaxVal.id = 'sq-hmax-val'; hMaxVal.textContent = '5.0';
    hMaxRow.appendChild(hMaxLbl); hMaxRow.appendChild(hMaxVal);
    slopedSection.appendChild(hMaxRow);
    const hMaxSlider = document.createElement('input');
    hMaxSlider.type = 'range'; hMaxSlider.id = 'sq-hmax-slider';
    hMaxSlider.min = '-15'; hMaxSlider.max = '20'; hMaxSlider.step = '0.5'; hMaxSlider.value = '5';
    hMaxSlider.style.cssText = sliderCss;
    slopedSection.appendChild(hMaxSlider);

    panel.appendChild(slopedSection);

    // ── Terrain Type ──
    const terrainLbl = document.createElement('div');
    terrainLbl.textContent = 'Surface';
    terrainLbl.style.cssText = 'font-size:12px; margin-bottom:6px;';
    panel.appendChild(terrainLbl);
    const terrainSelect = document.createElement('select');
    terrainSelect.id = 'sq-terrain-select';
    terrainSelect.style.cssText = 'width:100%; padding:6px 8px; background:#2a2a2a; color:white; border:1px solid #f0a020; border-radius:4px; font-size:12px; margin-bottom:16px; cursor:pointer;';
    [
      { value: 'none',        label: 'None (Default)' },
      { value: 'packed_dirt', label: 'Packed Dirt'    },
      { value: 'loose_dirt',  label: 'Loose Dirt'     },
      { value: 'asphalt',     label: 'Asphalt'        },
      { value: 'mud',         label: 'Mud'            },
      { value: 'water',       label: 'Water'          },
      { value: 'rocky',       label: 'Rocky'          },
    ].forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label;
      terrainSelect.appendChild(opt);
    });
    panel.appendChild(terrainSelect);

    // ── Hint ──
    const hint = document.createElement('div');
    hint.textContent = 'WASD to move  ·  Q/E to rotate  ·  Del to delete';
    hint.style.cssText = 'font-size:10px; color:#888; margin-bottom:14px;';
    panel.appendChild(hint);

    const dupBtn = document.createElement('button');
    dupBtn.textContent = 'Duplicate Square Hill';
    dupBtn.style.cssText = 'display:block; width:100%; padding:8px; background:#2980b9; color:white; border:none; border-radius:5px; cursor:pointer; font-size:13px; font-family:Arial; margin-bottom:8px;';
    panel.appendChild(dupBtn);

    // ── Delete button ──
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete Square Hill';
    deleteBtn.style.cssText = 'display:block; width:100%; padding:8px; background:#c0392b; color:white; border:none; border-radius:5px; cursor:pointer; font-size:13px; font-family:Arial;';
    panel.appendChild(deleteBtn);

    // ── Helpers ──
    const setModeUI = (sloped) => {
      flatSection.style.display  = sloped ? 'none'  : 'block';
      slopedSection.style.display = sloped ? 'block' : 'none';
      flatBtn.style.background   = sloped ? 'transparent' : '#f0a020';
      flatBtn.style.color        = sloped ? '#f0a020' : '#000';
      slopeBtn.style.background  = sloped ? '#f0a020' : 'transparent';
      slopeBtn.style.color       = sloped ? '#000' : '#f0a020';
    };

    const rebuild = () => { window.rebuildTerrain?.(); window.rebuildTerrainGrid?.(); };

    // ── Event wiring ──
    widthSlider.addEventListener('input', () => {
      if (!this.selectedSquareHill) return;
      this.saveSnapshot(true);
      const val = parseFloat(widthSlider.value);
      document.getElementById('sq-width-val').textContent = val.toFixed(1);
      this.selectedSquareHill.feature.width = val;
      this.updateSquareHillVisual(this.selectedSquareHill);
      rebuild();
    });

    depthSlider.addEventListener('input', () => {
      if (!this.selectedSquareHill) return;
      this.saveSnapshot(true);
      const val = parseFloat(depthSlider.value);
      document.getElementById('sq-depth-val').textContent = val.toFixed(1);
      this.selectedSquareHill.feature.depth = val;
      this.updateSquareHillVisual(this.selectedSquareHill);
      rebuild();
    });

    transSlider.addEventListener('input', () => {
      if (!this.selectedSquareHill) return;
      this.saveSnapshot(true);
      const val = parseFloat(transSlider.value);
      document.getElementById('sq-trans-val').textContent = val.toFixed(1);
      this.selectedSquareHill.feature.transition = val;
      this.updateSquareHillVisual(this.selectedSquareHill);
      rebuild();
    });

    flatBtn.addEventListener('click', () => {
      if (!this.selectedSquareHill) return;
      const f = this.selectedSquareHill.feature;
      if (f.heightAtMin === undefined) return; // already flat
      this.saveSnapshot();
      // Carry a representative height over from the sloped values
      f.height = parseFloat(hMaxSlider.value) || 5;
      delete f.heightAtMin; delete f.heightAtMax;
      document.getElementById('sq-height-slider').value = f.height;
      document.getElementById('sq-height-val').textContent = f.height.toFixed(1);
      setModeUI(false);
      this.updateSquareHillVisual(this.selectedSquareHill);
      rebuild();
    });

    slopeBtn.addEventListener('click', () => {
      if (!this.selectedSquareHill) return;
      const f = this.selectedSquareHill.feature;
      if (f.heightAtMin !== undefined) return; // already sloped
      this.saveSnapshot();
      const prevH = f.height ?? 5;
      f.heightAtMin = 0;
      f.heightAtMax = prevH;
      delete f.height;
      document.getElementById('sq-hmin-slider').value = 0;
      document.getElementById('sq-hmin-val').textContent = '0.0';
      document.getElementById('sq-hmax-slider').value = prevH;
      document.getElementById('sq-hmax-val').textContent = prevH.toFixed(1);
      setModeUI(true);
      this.updateSquareHillVisual(this.selectedSquareHill);
      rebuild();
    });

    heightSlider.addEventListener('input', () => {
      if (!this.selectedSquareHill) return;
      this.saveSnapshot(true);
      const val = parseFloat(heightSlider.value);
      document.getElementById('sq-height-val').textContent = val.toFixed(1);
      this.selectedSquareHill.feature.height = val;
      this.updateSquareHillVisual(this.selectedSquareHill);
      rebuild();
    });

    angleSlider.addEventListener('input', () => {
      if (!this.selectedSquareHill) return;
      this.saveSnapshot(true);
      const val = parseFloat(angleSlider.value);
      document.getElementById('sq-angle-val').textContent = val.toFixed(0) + '°';
      this.selectedSquareHill.feature.angle = val;
      this.updateSquareHillVisual(this.selectedSquareHill);
      rebuild();
    });

    hMinSlider.addEventListener('input', () => {
      if (!this.selectedSquareHill) return;
      this.saveSnapshot(true);
      const val = parseFloat(hMinSlider.value);
      document.getElementById('sq-hmin-val').textContent = val.toFixed(1);
      this.selectedSquareHill.feature.heightAtMin = val;
      this.updateSquareHillVisual(this.selectedSquareHill);
      rebuild();
    });

    hMaxSlider.addEventListener('input', () => {
      if (!this.selectedSquareHill) return;
      this.saveSnapshot(true);
      const val = parseFloat(hMaxSlider.value);
      document.getElementById('sq-hmax-val').textContent = val.toFixed(1);
      this.selectedSquareHill.feature.heightAtMax = val;
      this.updateSquareHillVisual(this.selectedSquareHill);
      rebuild();
    });

    terrainSelect.addEventListener('change', () => {
      if (!this.selectedSquareHill) return;
      this.saveSnapshot();
      const val = terrainSelect.value;
      if (val === 'none') {
        this.selectedSquareHill.feature.terrainType = null;
      } else {
        const key = Object.keys(TERRAIN_TYPES).find(k => TERRAIN_TYPES[k].name === val);
        this.selectedSquareHill.feature.terrainType = key ? TERRAIN_TYPES[key] : null;
      }
      window.rebuildTerrainGrid?.();
    });

    dupBtn.addEventListener('click', () => this.duplicateSelectedSquareHill());
    deleteBtn.addEventListener('click', () => this.deleteSelectedSquareHill());
    panel.addEventListener('mousedown', e => e.stopPropagation());

    document.body.appendChild(panel);
    this.squareHillPropertiesPanel = panel;
  }

  showSquareHillProperties(hillData) {
    const s = this._editorStore;
    if (!s) return;
    const { feature } = hillData;
    const sloped = feature.heightAtMin !== undefined;
    s.squareHill.width       = feature.width;
    s.squareHill.depth       = feature.depth ?? feature.width;
    s.squareHill.transition  = feature.transition ?? 8;
    s.squareHill.angle       = feature.angle ?? 0;
    s.squareHill.slopeMode   = sloped;
    s.squareHill.terrainType = feature.terrainType?.name || 'none';
    if (sloped) {
      s.squareHill.heightAtMin = feature.heightAtMin ?? 0;
      s.squareHill.heightAtMax = feature.heightAtMax ?? 5;
    } else {
      s.squareHill.height = feature.height ?? 5;
    }
    s.selectedType = 'squareHill';
  }

  hideSquareHillProperties() {
    if (this._editorStore?.selectedType === 'squareHill')
      this._editorStore.selectedType = null;
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
      { value: 'water',       label: 'Water'          },
      { value: 'rocky',       label: 'Rocky'          },
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

    // ── Duplicate button ──
    const dupBtn = document.createElement('button');
    dupBtn.textContent = 'Duplicate Hill';
    dupBtn.style.cssText = 'display:block; width:100%; padding:8px; background:#2980b9; color:white; border:none; border-radius:5px; cursor:pointer; font-size:13px; font-family:Arial; margin-bottom:8px;';
    panel.appendChild(dupBtn);

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
      this.saveSnapshot(true);
      const val = parseFloat(radiusSlider.value);
      document.getElementById('hill-radius-val').textContent = val.toFixed(1);
      this.selectedHill.feature.radius = val;
      this.updateHillVisual(this.selectedHill);
      window.rebuildTerrain?.();
      window.rebuildTerrainGrid?.();
    });

    heightSlider.addEventListener('input', () => {
      if (!this.selectedHill) return;
      this.saveSnapshot(true);
      const val = parseFloat(heightSlider.value);
      document.getElementById('hill-height-val').textContent = val.toFixed(1);
      this.selectedHill.feature.height = val;
      this.updateHillVisual(this.selectedHill);
      window.rebuildTerrain?.();
      window.rebuildTerrainGrid?.();
    });

    terrainSelect.addEventListener('change', () => {
      if (!this.selectedHill) return;
      this.saveSnapshot();
      const val = terrainSelect.value;
      if (val === 'none') {
        this.selectedHill.feature.terrainType = null;
      } else {
        const key = Object.keys(TERRAIN_TYPES).find(k => TERRAIN_TYPES[k].name === val);
        this.selectedHill.feature.terrainType = key ? TERRAIN_TYPES[key] : null;
      }
      window.rebuildTerrainGrid?.();
    });

    dupBtn.addEventListener('click', () => this.duplicateSelectedHill());
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
    const s = this._editorStore;
    if (!s) return;
    const { feature } = hillData;
    s.hill.radius      = feature.radius;
    s.hill.height      = feature.height;
    s.hill.terrainType = feature.terrainType?.name || 'none';
    s.selectedType     = 'hill';
  }

  /**
   * Hide the hill properties panel.
   */
  hideHillProperties() {
    if (this._editorStore?.selectedType === 'hill')
      this._editorStore.selectedType = null;
  }

  // ───────────────────────────────────────────────────────────────────────────

  // ─── Vue Bridge — change methods called by Pinia store actions ──────────────────

  changeCheckpointWidth(val) {
    if (!this.selectedCheckpoint) return;
    this.saveSnapshot(true);
    this.selectedCheckpoint.updateWidth(val);
  }

  changeHillRadius(val) {
    if (!this.selectedHill) return;
    this.saveSnapshot(true);
    this.selectedHill.feature.radius = val;
    this.updateHillVisual(this.selectedHill);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
  }

  changeHillHeight(val) {
    if (!this.selectedHill) return;
    this.saveSnapshot(true);
    this.selectedHill.feature.height = val;
    this.updateHillVisual(this.selectedHill);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
  }

  changeHillTerrainType(name) {
    if (!this.selectedHill) return;
    this.saveSnapshot();
    this.selectedHill.feature.terrainType = name === 'none' ? null
      : (Object.values(TERRAIN_TYPES).find(t => t.name === name) || null);
    window.rebuildTerrainGrid?.();
  }

  changeSquareHillWidth(val) {
    if (!this.selectedSquareHill) return;
    this.saveSnapshot(true);
    this.selectedSquareHill.feature.width = val;
    this.updateSquareHillVisual(this.selectedSquareHill);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
  }

  changeSquareHillDepth(val) {
    if (!this.selectedSquareHill) return;
    this.saveSnapshot(true);
    this.selectedSquareHill.feature.depth = val;
    this.updateSquareHillVisual(this.selectedSquareHill);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
  }

  changeSquareHillTransition(val) {
    if (!this.selectedSquareHill) return;
    this.saveSnapshot(true);
    this.selectedSquareHill.feature.transition = val;
    this.updateSquareHillVisual(this.selectedSquareHill);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
  }

  changeSquareHillAngle(val) {
    if (!this.selectedSquareHill) return;
    this.saveSnapshot(true);
    this.selectedSquareHill.feature.angle = val;
    this.updateSquareHillVisual(this.selectedSquareHill);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
  }

  changeSquareHillHeight(val) {
    if (!this.selectedSquareHill) return;
    this.saveSnapshot(true);
    this.selectedSquareHill.feature.height = val;
    this.updateSquareHillVisual(this.selectedSquareHill);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
  }

  changeSquareHillHeightMin(val) {
    if (!this.selectedSquareHill) return;
    this.saveSnapshot(true);
    this.selectedSquareHill.feature.heightAtMin = val;
    this.updateSquareHillVisual(this.selectedSquareHill);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
  }

  changeSquareHillHeightMax(val) {
    if (!this.selectedSquareHill) return;
    this.saveSnapshot(true);
    this.selectedSquareHill.feature.heightAtMax = val;
    this.updateSquareHillVisual(this.selectedSquareHill);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
  }

  changeSquareHillMode(sloped) {
    if (!this.selectedSquareHill) return;
    const f = this.selectedSquareHill.feature;
    const s = this._editorStore;
    if (sloped) {
      if (f.heightAtMin !== undefined) return; // already sloped
      this.saveSnapshot();
      const prevH = f.height ?? 5;
      f.heightAtMin = 0;
      f.heightAtMax = prevH;
      delete f.height;
      if (s) { s.squareHill.heightAtMin = 0; s.squareHill.heightAtMax = prevH; }
    } else {
      if (f.heightAtMin === undefined) return; // already flat
      this.saveSnapshot();
      const prevH = f.heightAtMax ?? 5;
      f.height = prevH;
      delete f.heightAtMin; delete f.heightAtMax;
      if (s) s.squareHill.height = prevH;
    }
    this.updateSquareHillVisual(this.selectedSquareHill);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
  }

  changeSquareHillTerrainType(name) {
    if (!this.selectedSquareHill) return;
    this.saveSnapshot();
    this.selectedSquareHill.feature.terrainType = name === 'none' ? null
      : (Object.values(TERRAIN_TYPES).find(t => t.name === name) || null);
    window.rebuildTerrainGrid?.();
  }

  changeTerrainRectWidth(val) {
    if (!this.selectedTerrainRect) return;
    this.saveSnapshot(true);
    this.selectedTerrainRect.feature.width = val;
    this.updateTerrainRectVisual(this.selectedTerrainRect);
    window.rebuildTerrainGrid?.();
  }

  changeTerrainRectDepth(val) {
    if (!this.selectedTerrainRect) return;
    this.saveSnapshot(true);
    this.selectedTerrainRect.feature.depth = val;
    this.updateTerrainRectVisual(this.selectedTerrainRect);
    window.rebuildTerrainGrid?.();
  }

  changeTerrainRectTerrainType(name) {
    if (!this.selectedTerrainRect) return;
    this.saveSnapshot();
    const entry = Object.values(TERRAIN_TYPES).find(t => t.name === name);
    this.selectedTerrainRect.feature.terrainType = entry || null;
    this.updateTerrainRectVisual(this.selectedTerrainRect);
    window.rebuildTerrainGrid?.();
    window.rebuildTerrainTexture?.();
  }

  // ── Poly Wall Vue bridge methods ──
  changePolyWallHeight(val)     { this.polyWallTool.changePolyWallHeight(val); }
  changePolyWallThickness(val)  { this.polyWallTool.changePolyWallThickness(val); }
  changePolyWallClosed(val)     { this.polyWallTool.changePolyWallClosed(val); }
  insertPolyWallPoint()         { this.polyWallTool.insertPolyWallPoint(); }
  deletePolyWallPoint()         { this.polyWallTool.deletePolyWallPoint(); }
  deletePolyWall()              { this.polyWallTool.deletePolyWall(); }
  deselectPolyWall()            { this.polyWallTool.deselectPolyWall(); }

  // ── Bezier Wall Vue bridge methods ──
  changeBezierWallHeight(val)   { this.bezierWallTool.changeBezierWallHeight(val); }
  changeBezierWallThickness(val){ this.bezierWallTool.changeBezierWallThickness(val); }
  changeBezierWallClosed(val)   { this.bezierWallTool.changeBezierWallClosed(val); }
  insertBezierWallPoint()       { this.bezierWallTool.insertBezierWallPoint(); }
  deleteBezierWallPoint()       { this.bezierWallTool.deleteBezierWallPoint(); }
  deleteBezierWall()            { this.bezierWallTool.deleteBezierWall(); }
  deselectBezierWall()          { this.bezierWallTool.deselectBezierWall(); }

  /**
   * Dispose of the controller
   */
  dispose() {
    this.deactivate();
  }
}
