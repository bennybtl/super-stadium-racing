import { Vector3, StandardMaterial, Color3, PointerEventTypes, MeshBuilder, TransformNode } from "@babylonjs/core";
import { TERRAIN_TYPES } from "../terrain.js";
import { MeshGridTool } from "../managers/MeshGridTool.js";
import { PolyWallTool } from "../managers/PolyWallTool.js";
import { PolyHillTool } from "../managers/PolyHillTool.js";
import { BezierWallTool } from "../managers/BezierWallTool.js";
import { FlagTool } from "../managers/FlagTool.js";
import { HillEditor } from "./HillEditor.js";
import { CheckpointEditor } from "./CheckpointEditor.js";
import { SquareHillEditor } from "./SquareHillEditor.js";
import { TerrainShapeEditor } from "./TerrainShapeEditor.js";
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
    this.checkpointEditor = new CheckpointEditor(this);
    this.checkpointManager = null;
    this.menuManager = null;
    
    // Add entity menu state
    this.showAddMenu = false;
    this.addMenuOverlay = null;
    
    // Hill editing (delegated to HillEditor)
    this.hillEditor = new HillEditor(this);

    // Square hill editing (delegated to SquareHillEditor)
    this.squareHillEditor = new SquareHillEditor(this);

    // Terrain shape editing (rect + circle, delegated to TerrainShapeEditor)
    this.terrainShapeEditor = new TerrainShapeEditor(this);

    // Normal map decal editing state
    this.normalMapDecalMeshes = [];
    this.selectedNormalMapDecal = null;
    this.normalMapDecalMaterial = null;
    this.normalMapDecalHighlightMaterial = null;

    // Tire stack editing state
    this.tireStackMeshes = [];
    this.selectedTireStack = null;
    this.tireStackMaterial = null;
    this.tireStackHighlightMaterial = null;

    // Flag editing state
    this.flagTool = null;

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

    // Poly hill editing tool
    this.polyHillTool = null;

    // Bezier wall editing tool
    this.bezierWallTool = null;

    // Flag editing tool
    this.flagTool = null;

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
    this.checkpointEditor.createMaterial();
    
    // Add event listeners
    window.addEventListener('keydown', this.boundKeyDown, true); // Use capture phase
    window.addEventListener('keyup', this.boundKeyUp);
    this.scene.onPointerObservable.add(this.boundPointerDown);
    
    // Create add entity menu
    this.createAddEntityMenu();

    // Create hill materials (delegated)
    this.hillEditor.createMaterials();

    // Create square hill materials (delegated)
    this.squareHillEditor.createMaterials();

    // Create terrain shape materials (rect + circle)
    this.terrainShapeEditor.createMaterials();

    // Create normal map decal materials (always recreate for the current scene)
    this.normalMapDecalMaterial = new StandardMaterial('normalMapDecalMat', this.scene);
    this.normalMapDecalMaterial.diffuseColor = new Color3(0.8, 0.4, 0.9);
    this.normalMapDecalMaterial.emissiveColor = new Color3(0.15, 0.08, 0.18);
    this.normalMapDecalMaterial.alpha = 0.30;
    this.normalMapDecalMaterial.backFaceCulling = false;

    this.normalMapDecalHighlightMaterial = new StandardMaterial('normalMapDecalHighlightMat', this.scene);
    this.normalMapDecalHighlightMaterial.diffuseColor = new Color3(1.0, 0.5, 1.0);
    this.normalMapDecalHighlightMaterial.emissiveColor = new Color3(0.4, 0.2, 0.4);
    this.normalMapDecalHighlightMaterial.alpha = 0.40;
    this.normalMapDecalHighlightMaterial.backFaceCulling = false;

    // Create tire stack materials (always recreate for the current scene)
    this.tireStackMaterial = new StandardMaterial('tireStackMat', this.scene);
    this.tireStackMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
    this.tireStackMaterial.emissiveColor = new Color3(0.05, 0.05, 0.05);
    this.tireStackMaterial.alpha = 0.50;
    this.tireStackMaterial.backFaceCulling = false;

    this.tireStackHighlightMaterial = new StandardMaterial('tireStackHighlightMat', this.scene);
    this.tireStackHighlightMaterial.diffuseColor = new Color3(0.4, 0.4, 0.4);
    this.tireStackHighlightMaterial.emissiveColor = new Color3(0.15, 0.15, 0.15);
    this.tireStackHighlightMaterial.alpha = 0.60;
    this.tireStackHighlightMaterial.backFaceCulling = false;

    // Initialize flag editing tool early so it's available for feature loop
    this.flagTool = new FlagTool(this.scene, track, this);

    // Build editor visuals for any hills already in the track
    this.hillEditor.createVisualsForTrack(track);
    this.squareHillEditor.createVisualsForTrack(track);
    this.terrainShapeEditor.createVisualsForTrack(track);
    for (const feature of track.features) {
      if (feature.type === 'normalMapDecal') {
        this.createNormalMapDecalVisual(feature);
      } else if (feature.type === 'tireStack') {
        this.createTireStackVisual(feature);
      } else if (feature.type === 'flag') {
        this.flagTool._createFlagMesh(feature);
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

    // Poly hill editing tool
    this.polyHillTool = new PolyHillTool(this);
    this.polyHillTool.activate(this.scene, track);

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
    this.checkpointEditor.deselect();
    
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

    // Dispose hill editor
    this.hillEditor.dispose();

    // Dispose all square hill editor visuals
    this.squareHillEditor.dispose();

    // Dispose all terrain shape editor visuals
    this.terrainShapeEditor.dispose();

    // Dispose all normal map decal editor visuals
    for (const d of this.normalMapDecalMeshes) {
      d.mesh.dispose();
      d.node.dispose();
    }
    this.normalMapDecalMeshes = [];
    this.selectedNormalMapDecal = null;

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

    // Poly hill tool
    if (this.polyHillTool) {
      this.polyHillTool.deactivate();
      this.polyHillTool = null;
    }

    // Bezier wall tool
    if (this.bezierWallTool) {
      this.bezierWallTool.deactivate();
      this.bezierWallTool = null;
    }

    // Flag tool
    if (this.flagTool) {
      this.flagTool.dispose();
      this.flagTool = null;
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
    this.hillEditor.deselect();
    this.squareHillEditor.deselect();
    this.terrainShapeEditor.deselect();
    this.deselectNormalMapDecal?.();
    this.deselectTireStack?.();
    this.deselectFlag?.();

    // Dispose all gizmo meshes
    this.hillEditor.dispose();
    this.squareHillEditor.dispose();
    this.terrainShapeEditor.dispose();
    for (const d of this.normalMapDecalMeshes) { d.mesh.dispose(); d.node.dispose(); }
    for (const d of this.tireStackMeshes) { d.mesh.dispose(); d.node.dispose(); }
    this.normalMapDecalMeshes = [];
    this.tireStackMeshes = [];

    // Dispose and rebuild flag meshes
    if (this.flagTool) {
      this.flagTool.dispose();
    }

    // Restore features
    this.currentTrack.features = JSON.parse(snap);

    // Recreate gizmos + rebuild visuals
    for (const feature of this.currentTrack.features) {
      if (feature.type === 'hill') this.hillEditor.createVisual(feature);
      else if (feature.type === 'squareHill') this.squareHillEditor.createVisual(feature);
      else if (feature.type === 'terrainRect' || feature.type === 'terrainCircle') this.terrainShapeEditor.createVisual(feature);
      else if (feature.type === 'normalMapDecal') this.createNormalMapDecalVisual(feature);
      else if (feature.type === 'tireStack') this.createTireStackVisual(feature);
      else if (feature.type === 'flag' && this.flagTool) this.flagTool._createFlagMesh(feature);
    }
    // Restore mesh grid gizmos
    this.meshGridTool?.onSnapshotRestored();
    // Restore poly wall gizmos
    this.polyWallTool?.onSnapshotRestored();
    window.rebuildPolyWall?.(null);
    // Restore poly hill gizmos
    this.polyHillTool?.onSnapshotRestored();
    window.rebuildPolyHill?.(null);
    // Restore bezier wall gizmos
    this.bezierWallTool?.onSnapshotRestored();
    window.rebuildBezierWall?.(null);
    // Checkpoints are managed by CheckpointManager — rebuild from features
    // Checkpoints are managed by CheckpointManager — rebuild from features
    this.checkpointEditor.rebuildFromFeatures();

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
      if (this.hillEditor.selected) {
        this.hillEditor.deselect();
      } else if (this.squareHillEditor.selected) {
        this.squareHillEditor.deselect();
      } else if (this.checkpointEditor.selected) {
        this.checkpointEditor.deselect();
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
      if (this.hillEditor.selected) this.hillEditor.duplicateSelected();
      else if (this.squareHillEditor.selected) this.squareHillEditor.duplicateSelected();
      else if (this.checkpointEditor.selected) this.checkpointEditor.duplicateSelected();
      else if (this.terrainShapeEditor.selected) this.terrainShapeEditor.duplicateSelected();
      else if (this.selectedNormalMapDecal) this.duplicateSelectedNormalMapDecal();
      else if (this.selectedTireStack) this.duplicateSelectedTireStack();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    
    // Handle Delete key
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.checkpointEditor.selected) {
        this.checkpointEditor.deleteSelected();
        event.preventDefault();
      } else if (this.hillEditor.selected) {
        this.hillEditor.deleteSelected();
        event.preventDefault();
      } else if (this.squareHillEditor.selected) {
        this.squareHillEditor.deleteSelected();
        event.preventDefault();
      } else if (this.terrainShapeEditor.selected) {
        this.terrainShapeEditor.deleteSelected();
        event.preventDefault();
      } else if (this.selectedNormalMapDecal) {
        this.deleteSelectedNormalMapDecal();
        event.preventDefault();
      } else if (this.selectedTireStack) {
        this.deleteSelectedTireStack();
        event.preventDefault();
      } else if (this.flagTool?.getSelectedFlag()) {
        this.flagTool.removeSelectedFlag();
        event.preventDefault();
      } else if (this.meshGridTool?.activeFeature) {
        this.meshGridTool.deleteMeshGrid();
        event.preventDefault();
      } else if (this.polyWallTool?.selectedPoint) {
        this.polyWallTool.deleteSelectedPoint();
        event.preventDefault();
      } else if (this.polyHillTool?.selectedPoint) {
        this.polyHillTool.deleteSelectedPoint();
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
      case '+':
        this.keys.down = true;
        event.preventDefault();
        break;
      case '-':
      case '_':
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
      case '+':
        this.keys.down = false;
        break;
      case '-':
      case '_':
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
    if (movKeys.includes(event.key.toLowerCase()) && this.polyHillTool?.selectedPoint) {
      this.polyHillTool.endDrag();
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
    if (this.checkpointEditor.selected) {
      // Handle rotation
      if (this.keys.rotateLeft) {
        this.saveSnapshot(true);
        this.checkpointEditor.rotate(this.rotationSpeed);
      }
      if (this.keys.rotateRight) {
        this.saveSnapshot(true);
        this.checkpointEditor.rotate(-this.rotationSpeed);
      }

      const delta = this.checkpointEditor.move(movement);
      delta.y = movement.y;
      this.camera.position.addInPlace(delta);
      const currentTarget = this.camera.getTarget();
      this.camera.setTarget(currentTarget.add(delta));
    } else if (this.hillEditor.selected) {
      const delta = this.hillEditor.move(movement);
      delta.y = movement.y;
      this.camera.position.addInPlace(delta);
      const currentTarget = this.camera.getTarget();
      this.camera.setTarget(currentTarget.add(delta));
    } else if (this.squareHillEditor.selected) {
      const rotStep = (this.keys.fast ? 5 : 1) * (Math.PI / 180);
      if (this.keys.rotateLeft) this.squareHillEditor.rotate(rotStep);
      if (this.keys.rotateRight) this.squareHillEditor.rotate(-rotStep);
      const delta2 = this.squareHillEditor.move(movement);
      delta2.y = movement.y;
      this.camera.position.addInPlace(delta2);
      const currentTarget2 = this.camera.getTarget();
      this.camera.setTarget(currentTarget2.add(delta2));
    } else if (this.terrainShapeEditor.selected) {
      const delta = this.terrainShapeEditor.move(movement);
      delta.y = movement.y;
      this.camera.position.addInPlace(delta);
      const currentTarget3 = this.camera.getTarget();
      this.camera.setTarget(currentTarget3.add(delta));
    } else if (this.selectedNormalMapDecal) {
      // Q/E rotates the normal map decal
      const rotStep = (this.keys.fast ? 5 : 1) * (Math.PI / 180);
      if (this.keys.rotateLeft || this.keys.rotateRight) {
        const f = this.selectedNormalMapDecal.feature;
        const delta = this.keys.rotateLeft ? rotStep : -rotStep;
        f.angle = ((f.angle ?? 0) + delta * 180 / Math.PI + 360) % 360;
        this.updateNormalMapDecalVisual(this.selectedNormalMapDecal);
        // Sync the angle in Vue store if needed
        if (this._editorStore?.selectedType === 'normalMapDecal') {
          this._editorStore.normalMapDecal.angle = f.angle;
        }
      }
      const deltaDecal = this.moveSelectedNormalMapDecal(movement);
      deltaDecal.y = movement.y;
      this.camera.position.addInPlace(deltaDecal);
      const currentTargetDecal = this.camera.getTarget();
      this.camera.setTarget(currentTargetDecal.add(deltaDecal));
    } else if (this.selectedTireStack) {
      const deltaStack = this.moveSelectedTireStack(movement);
      deltaStack.y = movement.y;
      this.camera.position.addInPlace(deltaStack);
      const currentTargetStack = this.camera.getTarget();
      this.camera.setTarget(currentTargetStack.add(deltaStack));
    } else if (this.flagTool?.getSelectedFlag()) {
      const deltaFlag = this.moveSelectedFlag(movement);
      deltaFlag.y = movement.y;
      this.camera.position.addInPlace(deltaFlag);
      const currentTargetFlag = this.camera.getTarget();
      this.camera.setTarget(currentTargetFlag.add(deltaFlag));
    } else if (this.polyWallTool?.selectedPoint) {
      const d = this.polyWallTool.moveSelectedPoint(movement.x, movement.z);
      const delta4 = new Vector3(d.x, movement.y, d.z);
      this.camera.position.addInPlace(delta4);
      const currentTarget4 = this.camera.getTarget();
      this.camera.setTarget(currentTarget4.add(delta4));
    } else if (this.polyHillTool?.selectedPoint) {
      const d = this.polyHillTool.moveSelectedPoint(movement.x, movement.z);
      const deltaHill = new Vector3(d.x, movement.y, d.z);
      this.camera.position.addInPlace(deltaHill);
      const currentTargetHill = this.camera.getTarget();
      this.camera.setTarget(currentTargetHill.add(deltaHill));
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

        // Poly hill control points
        if (this.polyHillTool?.onPointerDown(clickedMesh)) return;

        // Bezier wall control points
        if (this.bezierWallTool?.onPointerDown(clickedMesh)) return;
        
        // Check if clicked mesh is part of a checkpoint
        {
          const cpData = this.checkpointEditor.findByMesh(clickedMesh);
          if (cpData) {
            this.deselectHill();
            this.selectCheckpoint(cpData);
            return;
          }
        }

        // Check if clicked mesh is a hill gizmo
        {
          const hillData = this.hillEditor.findByMesh(clickedMesh);
          if (hillData) {
            if (this.hillEditor.selected === hillData) {
              this.hillEditor.deselect();
            } else {
              this.deselectCheckpoint();
              this.squareHillEditor.deselect();
              this.meshGridTool?.deselectPoint();
              this.polyWallTool?.deselectPoint();
              this.bezierWallTool?.deselectAll();
              this.hillEditor.select(hillData);
            }
            return;
          }
        }

        // Check if clicked mesh is a square hill gizmo
        {
          const hillData = this.squareHillEditor.findByMesh(clickedMesh);
          if (hillData) {
            if (this.squareHillEditor.selected === hillData) {
              this.squareHillEditor.deselect();
            } else {
              this.deselectCheckpoint();
              this.deselectHill();
              this.deselectTerrainRect();
              this.squareHillEditor.select(hillData);
            }
            return;
          }
        }

        // Check if clicked mesh is a terrain shape (rect or circle)
        {
          const shapeData = this.terrainShapeEditor.findByMesh(clickedMesh);
          if (shapeData) {
            if (this.terrainShapeEditor.selected === shapeData) {
              this.terrainShapeEditor.deselect();
            } else {
              this.deselectCheckpoint();
              this.deselectHill();
              this.squareHillEditor.deselect();
              this.deselectNormalMapDecal();
              this.terrainShapeEditor.select(shapeData);
            }
            return;
          }
        }

        // Check if clicked mesh is a normal map decal gizmo
        for (const decalData of this.normalMapDecalMeshes) {
          if (clickedMesh === decalData.mesh) {
            if (this.selectedNormalMapDecal === decalData) {
              this.deselectNormalMapDecal();
            } else {
              this.deselectCheckpoint();
              this.deselectHill();
              this.squareHillEditor.deselect();
              this.deselectTerrainRect();
              this.selectNormalMapDecal(decalData);
            }
            return;
          }
        }

        // Check if clicked mesh is a tire stack gizmo
        for (const stackData of this.tireStackMeshes) {
          if (clickedMesh === stackData.mesh) {
            if (this.selectedTireStack === stackData) {
              this.deselectTireStack();
            } else {
              this.deselectCheckpoint();
              this.deselectHill();
              this.squareHillEditor.deselect();
              this.deselectTerrainRect();
              this.deselectTerrainCircle();
              this.deselectNormalMapDecal();
              this.selectTireStack(stackData);
            }
            return;
          }
        }

        // Check if clicked mesh is a flag (pole or flag mesh)
        if (this.flagTool) {
          for (const flag of this.flagTool.flags) {
            if (clickedMesh === flag.pole || clickedMesh === flag.flag) {
              if (this.flagTool.getSelectedFlag() === flag) {
                this.deselectFlag();
              } else {
                this.deselectCheckpoint();
                this.deselectHill();
                this.squareHillEditor.deselect();
                this.deselectTerrainRect();
                this.deselectTerrainCircle();
                this.deselectNormalMapDecal();
                this.deselectTireStack();
                this.flagTool.selectFlag(clickedMesh);
              }
              return;
            }
          }
        }

        // Clicked on something else (terrain, etc.) — deselect all
        this.deselectCheckpoint();
        this.deselectHill();
        this.squareHillEditor.deselect();
        this.deselectTerrainRect();
        this.deselectTerrainCircle();
        this.deselectNormalMapDecal();
        this.deselectTireStack();
        this.deselectFlag();
        this.meshGridTool?.deselectPoint();
        this.polyWallTool?.deselectPoint();
        this.polyHillTool?.deselectPoint();
      } else {
        // Clicked on empty space (sky, etc.) — deselect all
        this.deselectCheckpoint();
        this.deselectHill();
        this.squareHillEditor.deselect();
        this.deselectTerrainRect();
        this.deselectTerrainCircle();
        this.deselectNormalMapDecal();
        this.deselectTireStack();
        this.deselectTerrainRect();
        this.deselectFlag();
        this.meshGridTool?.deselectPoint();
        this.polyWallTool?.deselectPoint();
        this.polyHillTool?.deselectPoint();
      }
    }
  }

  // ─── Checkpoint thin wrappers (delegated to CheckpointEditor) ──────────────

  selectCheckpoint(checkpointData) {
    this.deselectHill();
    this.checkpointEditor.select(checkpointData);
  }

  deselectCheckpoint() { this.checkpointEditor.deselect(); }
  deleteSelectedCheckpoint() { this.checkpointEditor.deleteSelected(); }
  duplicateSelectedCheckpoint() { this.checkpointEditor.duplicateSelected(); }

  // ─── Terrain Shape Editing (delegated to TerrainShapeEditor) ─────────────

  addTerrainRectEntity()           { this.terrainShapeEditor.addRectEntity(); }
  addTerrainCircleEntity()         { this.terrainShapeEditor.addCircleEntity(); }
  createTerrainRectVisual(f)       { return this.terrainShapeEditor.createRectVisual(f); }
  createTerrainCircleVisual(f)     { return this.terrainShapeEditor.createCircleVisual(f); }
  updateTerrainRectVisual(d)       { this.terrainShapeEditor.updateRectVisual(d); }
  updateTerrainCircleVisual(d)     { this.terrainShapeEditor.updateCircleVisual(d); }
  selectTerrainRect(d)             { this.terrainShapeEditor.select(d); }
  selectTerrainCircle(d)           { this.terrainShapeEditor.select(d); }
  deselectTerrainRect()            { this.terrainShapeEditor.deselect(); }
  deselectTerrainCircle()          { this.terrainShapeEditor.deselect(); }
  deleteSelectedTerrainRect()      { this.terrainShapeEditor.deleteSelected(); }
  deleteSelectedTerrainCircle()    { this.terrainShapeEditor.deleteSelected(); }
  duplicateSelectedTerrainRect()   { this.terrainShapeEditor.duplicateSelected(); }
  duplicateSelectedTerrainCircle() { this.terrainShapeEditor.duplicateSelected(); }
  deselectTerrainShape()           { this.terrainShapeEditor.deselect(); }
  duplicateSelectedTerrainShape()  { this.terrainShapeEditor.duplicateSelected(); }
  deleteSelectedTerrainShape()     { this.terrainShapeEditor.deleteSelected(); }

  get selectedTerrainRect()  { return this.terrainShapeEditor.selected?.feature.type === 'terrainRect'   ? this.terrainShapeEditor.selected : null; }
  get selectedTerrainCircle(){ return this.terrainShapeEditor.selected?.feature.type === 'terrainCircle' ? this.terrainShapeEditor.selected : null; }

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

    // Add Terrain Circle button
    const terrainCircleBtn = document.createElement('button');
    terrainCircleBtn.textContent = 'Add Terrain Circle';
    terrainCircleBtn.style.cssText = buttonStyle;
    terrainCircleBtn.onclick = () => this.addTerrainCircleEntity();
    this.addMenuOverlay.appendChild(terrainCircleBtn);

    // Add Normal Map Decal button
    const normalMapDecalBtn = document.createElement('button');
    normalMapDecalBtn.textContent = 'Add Normal Map Decal';
    normalMapDecalBtn.style.cssText = buttonStyle;
    normalMapDecalBtn.onclick = () => this.addNormalMapDecalEntity();
    this.addMenuOverlay.appendChild(normalMapDecalBtn);

    // Add Tire Stack button
    const tireStackBtn = document.createElement('button');
    tireStackBtn.textContent = 'Add Tire Stack';
    tireStackBtn.style.cssText = buttonStyle;
    tireStackBtn.onclick = () => this.addTireStackEntity();
    this.addMenuOverlay.appendChild(tireStackBtn);

    // Add Flag button
    const flagBtn = document.createElement('button');
    flagBtn.textContent = 'Add Flag';
    flagBtn.style.cssText = buttonStyle + 'background: #e74c3c; color: #fff;';
    flagBtn.onclick = () => this.addFlagEntity();
    this.addMenuOverlay.appendChild(flagBtn);

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

    // Poly Hill button
    const polyHillBtn = document.createElement('button');
    polyHillBtn.textContent = 'Add Poly Hill';
    polyHillBtn.style.cssText = buttonStyle + 'background: #88c440; color: #000;';
    polyHillBtn.onclick = () => { this.polyHillTool?.addPolyHillFeature(); this.hideAddMenu(); };
    this.addMenuOverlay.appendChild(polyHillBtn);

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
  addCheckpoint() { this.checkpointEditor.addEntity(); }

  // ─── Checkpoint Properties (delegated to CheckpointEditor) ─────────────────

  showCheckpointProperties(cpData) { this.checkpointEditor.showProperties(cpData); }
  hideCheckpointProperties()       { this.checkpointEditor.hideProperties(); }
  repositionCheckpointBarrels(cpData) { this.checkpointEditor.repositionBarrels(cpData); }
  shiftCheckpointOrder(direction)  { this.checkpointEditor.shiftOrder(direction); }

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

  // ─── Hill Editing (delegated to HillEditor) ──────────────────────────────

  addHillEntity() { this.hillEditor.addEntity(); }
  createHillVisual(feature) { return this.hillEditor.createVisual(feature); }
  selectHill(hillData) { this.hillEditor.select(hillData); }
  deselectHill() { this.hillEditor.deselect(); }
  duplicateSelectedHill() { this.hillEditor.duplicateSelected(); }
  deleteSelectedHill() { this.hillEditor.deleteSelected(); }

  // ─── Square Hill Editing (delegated to SquareHillEditor) ─────────────────

  addSquareHillEntity()          { this.squareHillEditor.addEntity(); }
  createSquareHillVisual(f)      { return this.squareHillEditor.createVisual(f); }
  updateSquareHillVisual(d)      { this.squareHillEditor.updateVisual(d); }
  selectSquareHill(d)            { this.squareHillEditor.select(d); }
  deselectSquareHill()           { this.squareHillEditor.deselect(); }
  deleteSelectedSquareHill()     { this.squareHillEditor.deleteSelected(); }
  duplicateSelectedSquareHill()  { this.squareHillEditor.duplicateSelected(); }
  showSquareHillProperties(d)    { this.squareHillEditor.showProperties(d); }
  hideSquareHillProperties()     { this.squareHillEditor.hideProperties(); }

  get selectedSquareHill()       { return this.squareHillEditor.selected; }

  // ─── Vue Bridge — change methods called by Pinia store actions ──────────────────

  changeCheckpointWidth(val) { this.checkpointEditor.changeWidth(val); }
  changeCheckpointHeading(degrees) { this.checkpointEditor.changeHeading(degrees); }

  changeHillRadius(val) { this.hillEditor.changeRadius(val); }
  changeHillHeight(val) { this.hillEditor.changeHeight(val); }
  changeHillTerrainType(name) { this.hillEditor.changeTerrainType(name); }

  changeSquareHillWidth(val)        { this.squareHillEditor.changeWidth(val); }
  changeSquareHillDepth(val)        { this.squareHillEditor.changeDepth(val); }
  changeSquareHillTransition(val)   { this.squareHillEditor.changeTransition(val); }
  changeSquareHillAngle(val)        { this.squareHillEditor.changeAngle(val); }
  changeSquareHillHeight(val)       { this.squareHillEditor.changeHeight(val); }
  changeSquareHillHeightMin(val)    { this.squareHillEditor.changeHeightMin(val); }
  changeSquareHillHeightMax(val)    { this.squareHillEditor.changeHeightMax(val); }
  changeSquareHillMode(sloped)      { this.squareHillEditor.changeMode(sloped); }
  changeSquareHillTerrainType(name) { this.squareHillEditor.changeTerrainType(name); }

  changeTerrainShapeShape(val)     { this.terrainShapeEditor.changeShape(val); }
  changeTerrainShapeWidth(val)     { this.terrainShapeEditor.changeWidth(val); }
  changeTerrainShapeDepth(val)     { this.terrainShapeEditor.changeDepth(val); }
  changeTerrainShapeRadius(val)    { this.terrainShapeEditor.changeRadius(val); }
  changeTerrainShapeTerrainType(n) { this.terrainShapeEditor.changeTerrainType(n); }

  // ─── Normal Map Decal Editing ───────────────────────────────────────────

  addNormalMapDecalEntity() {
    const camPos = this.camera.position;
    const camTarget = this.camera.target;
    const direction = camTarget.subtract(camPos).normalize();
    const newX = camPos.x + direction.x * 20;
    const newZ = camPos.z + direction.z * 50;
    const newFeature = {
      type: 'normalMapDecal',
      centerX: newX,
      centerZ: newZ,
      width: 10,
      depth: 10,
      angle: 0,
      normalMap: '6481-normal.jpg',
      repeatU: 1,
      repeatV: 1,
      intensity: 0.5,
    };
    this.saveSnapshot();
    this.currentTrack.features.push(newFeature);
    const decalData = this.createNormalMapDecalVisual(newFeature);
    this.deselectCheckpoint();
    this.deselectHill();
    this.deselectSquareHill();
    this.deselectTerrainRect();
    this.deselectTerrainCircle();
    this.selectNormalMapDecal(decalData);
    this.hideAddMenu();
  }

  createNormalMapDecalVisual(feature) {
    const terrainH = this.currentTrack ? this.currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;
    const node = new TransformNode('normalMapDecalNode', this.scene);
    node.position = new Vector3(feature.centerX, terrainH + 0.1, feature.centerZ);
    node.scaling  = new Vector3(feature.width, 0.1, feature.depth);
    node.rotation.y = -(feature.angle ?? 0) * Math.PI / 180;

    const mesh = MeshBuilder.CreateBox('normalMapDecalMesh', { size: 1 }, this.scene);
    mesh.parent = node;
    mesh.material = this.normalMapDecalMaterial;
    mesh.isPickable = true;

    const decalData = { feature, node, mesh };
    this.normalMapDecalMeshes.push(decalData);
    return decalData;
  }

  updateNormalMapDecalVisual(decalData) {
    const { feature, node } = decalData;
    const terrainH = this.currentTrack ? this.currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;
    node.position.x = feature.centerX;
    node.position.z = feature.centerZ;
    node.position.y = terrainH + 0.1;
    node.scaling.x  = feature.width;
    node.scaling.z  = feature.depth;
    node.rotation.y = -(feature.angle ?? 0) * Math.PI / 180;
  }

  selectNormalMapDecal(decalData) {
    this.deselectNormalMapDecal();
    this.selectedNormalMapDecal = decalData;
    this._rawDragPos = { x: decalData.feature.centerX, z: decalData.feature.centerZ };
    decalData.mesh.material = this.normalMapDecalHighlightMaterial;
    this.showNormalMapDecalProperties(decalData);
  }

  deselectNormalMapDecal() {
    if (!this.selectedNormalMapDecal) return;
    this.selectedNormalMapDecal.mesh.material = this.normalMapDecalMaterial;
    this.selectedNormalMapDecal = null;
    this._rawDragPos = null;
    this.hideNormalMapDecalProperties();
    window.rebuildNormalMap?.();
  }

  moveSelectedNormalMapDecal(movement) {
    if (!this.selectedNormalMapDecal || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    this.saveSnapshot(true);
    const { feature } = this.selectedNormalMapDecal;
    if (!this._rawDragPos) this._rawDragPos = { x: feature.centerX, z: feature.centerZ };
    this._rawDragPos.x += movement.x;
    this._rawDragPos.z += movement.z;
    const prevX = feature.centerX, prevZ = feature.centerZ;
    feature.centerX = this._snap(this._rawDragPos.x);
    feature.centerZ = this._snap(this._rawDragPos.z);
    this.updateNormalMapDecalVisual(this.selectedNormalMapDecal);
    return new Vector3(feature.centerX - prevX, 0, feature.centerZ - prevZ);
  }

  deleteSelectedNormalMapDecal() {
    if (!this.selectedNormalMapDecal) return;
    this.saveSnapshot();
    const decalData = this.selectedNormalMapDecal;
    const idx = this.currentTrack.features.indexOf(decalData.feature);
    if (idx > -1) this.currentTrack.features.splice(idx, 1);
    decalData.mesh.dispose();
    decalData.node.dispose();
    const meshIdx = this.normalMapDecalMeshes.indexOf(decalData);
    if (meshIdx > -1) this.normalMapDecalMeshes.splice(meshIdx, 1);
    this.hideNormalMapDecalProperties();
    this.selectedNormalMapDecal = null;
    window.rebuildNormalMap?.();
  }

  duplicateSelectedNormalMapDecal() {
    if (!this.selectedNormalMapDecal) return;
    this.saveSnapshot();
    const src = this.selectedNormalMapDecal.feature;
    const newFeature = { ...src, centerX: src.centerX + 3, centerZ: src.centerZ + 3 };
    this.currentTrack.features.push(newFeature);
    const decalData = this.createNormalMapDecalVisual(newFeature);
    this.deselectNormalMapDecal();
    this.selectNormalMapDecal(decalData);
  }

  showNormalMapDecalProperties(decalData) {
    const s = this._editorStore;
    if (!s) return;
    const { feature } = decalData;
    s.normalMapDecal.width       = feature.width;
    s.normalMapDecal.depth       = feature.depth;
    s.normalMapDecal.angle       = feature.angle ?? 0;
    s.normalMapDecal.normalMap   = feature.normalMap || '6481-normal.jpg';
    s.normalMapDecal.repeatU     = feature.repeatU ?? 1;
    s.normalMapDecal.repeatV     = feature.repeatV ?? 1;
    s.normalMapDecal.intensity   = feature.intensity ?? 0.5;
    s.selectedType               = 'normalMapDecal';
  }

  hideNormalMapDecalProperties() {
    if (this._editorStore?.selectedType === 'normalMapDecal')
      this._editorStore.selectedType = null;
  }

  // ── Normal Map Decal Vue bridge methods ──
  changeNormalMapDecalWidth(val) {
    if (!this.selectedNormalMapDecal) return;
    this.saveSnapshot(true);
    this.selectedNormalMapDecal.feature.width = val;
    this.updateNormalMapDecalVisual(this.selectedNormalMapDecal);
  }

  changeNormalMapDecalDepth(val) {
    if (!this.selectedNormalMapDecal) return;
    this.saveSnapshot(true);
    this.selectedNormalMapDecal.feature.depth = val;
    this.updateNormalMapDecalVisual(this.selectedNormalMapDecal);
  }

  changeNormalMapDecalAngle(val) {
    if (!this.selectedNormalMapDecal) return;
    this.saveSnapshot(true);
    this.selectedNormalMapDecal.feature.angle = val;
    this.updateNormalMapDecalVisual(this.selectedNormalMapDecal);
  }

  changeNormalMapDecalNormalMap(val) {
    if (!this.selectedNormalMapDecal) return;
    this.saveSnapshot();
    this.selectedNormalMapDecal.feature.normalMap = val;
    window.rebuildNormalMap?.();
  }

  changeNormalMapDecalRepeatU(val) {
    if (!this.selectedNormalMapDecal) return;
    this.saveSnapshot(true);
    this.selectedNormalMapDecal.feature.repeatU = val;
    window.rebuildNormalMap?.();
  }

  changeNormalMapDecalRepeatV(val) {
    if (!this.selectedNormalMapDecal) return;
    this.saveSnapshot(true);
    this.selectedNormalMapDecal.feature.repeatV = val;
    window.rebuildNormalMap?.();
  }

  changeNormalMapDecalIntensity(val) {
    if (!this.selectedNormalMapDecal) return;
    this.saveSnapshot(true);
    this.selectedNormalMapDecal.feature.intensity = val;
    window.rebuildNormalMap?.();
  }

  // ─── Tire Stack Editing ───────────────────────────────────────────────────

  addTireStackEntity() {
    const camPos = this.camera.position;
    const camTarget = this.camera.target;
    const direction = camTarget.subtract(camPos).normalize();
    const newX = camPos.x + direction.x * 20;
    const newZ = camPos.z + direction.z * 50;
    const newFeature = {
      type: 'tireStack',
      x: newX,
      z: newZ,
    };
    this.saveSnapshot();
    this.currentTrack.features.push(newFeature);
    const stackData = this.createTireStackVisual(newFeature);
    this.deselectCheckpoint();
    this.deselectHill();
    this.deselectSquareHill();
    this.deselectTerrainRect();
    this.deselectTerrainCircle();
    this.deselectNormalMapDecal();
    this.selectTireStack(stackData);
    this.hideAddMenu();
  }

  createTireStackVisual(feature) {
    const terrainH = this.currentTrack ? this.currentTrack.getHeightAt(feature.x, feature.z) : 0;
    const node = new TransformNode('tireStackNode', this.scene);
    node.position = new Vector3(feature.x, terrainH + 0.5, feature.z);

    const mesh = MeshBuilder.CreateCylinder('tireStackMesh', { 
      diameter: 0.84, 
      height: 1.12, 
      tessellation: 12 
    }, this.scene);
    mesh.parent = node;
    mesh.material = this.tireStackMaterial;
    mesh.isPickable = true;

    const stackData = { feature, node, mesh };
    this.tireStackMeshes.push(stackData);
    return stackData;
  }

  updateTireStackVisual(stackData) {
    const { feature, node } = stackData;
    const terrainH = this.currentTrack.getHeightAt(feature.x, feature.z);
    node.position.x = feature.x;
    node.position.y = terrainH + 0.5;
    node.position.z = feature.z;
  }

  selectTireStack(stackData) {
    this.deselectTireStack();
    this.selectedTireStack = stackData;
    this._rawDragPos = { x: stackData.feature.x, z: stackData.feature.z };
    stackData.mesh.material = this.tireStackHighlightMaterial;
  }

  deselectTireStack() {
    if (!this.selectedTireStack) return;
    this.selectedTireStack.mesh.material = this.tireStackMaterial;
    this.selectedTireStack = null;
    this._rawDragPos = null;
  }

  moveSelectedTireStack(movement) {
    if (!this.selectedTireStack || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    this.saveSnapshot(true);
    const { feature } = this.selectedTireStack;
    if (!this._rawDragPos) this._rawDragPos = { x: feature.x, z: feature.z };
    this._rawDragPos.x += movement.x;
    this._rawDragPos.z += movement.z;
    const prevX = feature.x, prevZ = feature.z;
    feature.x = this._snap(this._rawDragPos.x);
    feature.z = this._snap(this._rawDragPos.z);
    this.updateTireStackVisual(this.selectedTireStack);
    return new Vector3(feature.x - prevX, 0, feature.z - prevZ);
  }

  deleteSelectedTireStack() {
    if (!this.selectedTireStack) return;
    this.saveSnapshot();
    const stackData = this.selectedTireStack;
    const idx = this.currentTrack.features.indexOf(stackData.feature);
    if (idx > -1) this.currentTrack.features.splice(idx, 1);
    stackData.mesh.dispose();
    stackData.node.dispose();
    const meshIdx = this.tireStackMeshes.indexOf(stackData);
    if (meshIdx > -1) this.tireStackMeshes.splice(meshIdx, 1);
    this.selectedTireStack = null;
  }

  duplicateSelectedTireStack() {
    if (!this.selectedTireStack) return;
    this.saveSnapshot();
    const src = this.selectedTireStack.feature;
    const newFeature = { ...src, x: src.x + 3, z: src.z + 3 };
    this.currentTrack.features.push(newFeature);
    const stackData = this.createTireStackVisual(newFeature);
    this.deselectTireStack();
    this.selectTireStack(stackData);
  }

  // ─── Flag Editing ───────────────────────────────────────────────────────

  addFlagEntity() {
    const camPos = this.camera.position;
    const camTarget = this.camera.target;
    const direction = camTarget.subtract(camPos).normalize();
    const newX = camPos.x + direction.x * 20;
    const newZ = camPos.z + direction.z * 50;
    this.saveSnapshot();
    this.flagTool.addFlag(newX, newZ);
    this.deselectCheckpoint();
    this.deselectHill();
    this.deselectSquareHill();
    this.deselectTerrainRect();
    this.deselectTerrainCircle();
    this.deselectNormalMapDecal();
    this.deselectTireStack();
    this.hideAddMenu();
  }

  moveSelectedFlag(movement) {
    const selectedFlag = this.flagTool?.getSelectedFlag();
    if (!selectedFlag || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    this.saveSnapshot(true);
    const { feature } = selectedFlag;
    if (!this._rawDragPos) this._rawDragPos = { x: feature.x, z: feature.z };
    this._rawDragPos.x += movement.x;
    this._rawDragPos.z += movement.z;
    const prevX = feature.x, prevZ = feature.z;
    const newX = this._snap(this._rawDragPos.x);
    const newZ = this._snap(this._rawDragPos.z);
    this.flagTool.moveSelectedFlag(newX, newZ);
    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  showFlagProperties(flagData) {
    const s = this._editorStore;
    if (!s) return;
    s.flag.color = flagData.feature.color;
    s.selectedType = 'flag';
  }

  hideFlagProperties() {
    if (this._editorStore?.selectedType === 'flag')
      this._editorStore.selectedType = null;
  }

  deselectFlag() {
    this.flagTool?.deselectFlag();
    this._rawDragPos = null;
  }

  // ── Poly Wall Vue bridge methods ──
  changePolyWallRadius(val)     { this.polyWallTool.setPointRadius(val); }
  changePolyWallHeight(val)     { this.polyWallTool.setHeight(val); }
  changePolyWallThickness(val)  { this.polyWallTool.setThickness(val); }
  changePolyWallClosed(val)     { this.polyWallTool.setClosed(val); }
  insertPolyWallPoint()         { this.polyWallTool.insertPointAfter(); }
  deletePolyWallPoint()         { this.polyWallTool.deleteSelectedPoint(); }
  deletePolyWall()              { this.polyWallTool.deletePolyWall(); }
  deselectPolyWall()            { this.polyWallTool.deselectPoint(); }

  // ── Poly Hill Vue bridge methods ──
  changePolyHillRadius(val)     { this.polyHillTool.setPointRadius(val); }
  changePolyHillHeight(val)     { this.polyHillTool.setHeight(val); }
  changePolyHillWidth(val)      { this.polyHillTool.setWidth(val); }
  changePolyHillClosed(val)     { this.polyHillTool.setClosed(val); }
  insertPolyHillPoint()         { this.polyHillTool.insertPointAfter(); }
  deletePolyHillPoint()         { this.polyHillTool.deleteSelectedPoint(); }
  deletePolyHill()              { this.polyHillTool.deletePolyHill(); }
  deselectPolyHill()            { this.polyHillTool.deselectPoint(); }

  // ── Bezier Wall Vue bridge methods ──
  changeBezierWallHeight(val)   { this.bezierWallTool.changeBezierWallHeight(val); }
  changeBezierWallThickness(val){ this.bezierWallTool.changeBezierWallThickness(val); }
  changeBezierWallClosed(val)   { this.bezierWallTool.changeBezierWallClosed(val); }
  insertBezierWallPoint()       { this.bezierWallTool.insertBezierWallPoint(); }
  deleteBezierWallPoint()       { this.bezierWallTool.deleteBezierWallPoint(); }
  deleteBezierWall()            { this.bezierWallTool.deleteBezierWall(); }
  deselectBezierWall()          { this.bezierWallTool.deselectBezierWall(); }

  // ── Flag Vue bridge methods ──
  changeFlagColor(val)          { this.flagTool.updateSelectedFlagColor(val); }
  deleteFlag()                  { this.flagTool.removeSelectedFlag(); }

  /**
   * Dispose of the controller
   */
  dispose() {
    this.deactivate();
  }
}
