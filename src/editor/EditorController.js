import { Vector3, PointerEventTypes } from "@babylonjs/core";
import { TerrainQuery } from "../managers/TerrainQuery.js";
import { MeshGridEditor } from "./MeshGridEditor.js";
import { PolyWallEditor } from "./PolyWallEditor.js";
import { PolyHillEditor } from "./PolyHillEditor.js";
import { BezierWallEditor } from "./BezierWallEditor.js";
import { HillEditor } from "./HillEditor.js";
import { CheckpointEditor } from "./CheckpointEditor.js";
import { SquareHillEditor } from "./SquareHillEditor.js";
import { TerrainShapeEditor } from "./TerrainShapeEditor.js";
import { NormalMapDecalEditor } from "./NormalMapDecalEditor.js";
import { TireStackEditor } from "./TireStackEditor.js";
import { FlagEditor } from "./FlagEditor.js";
import { TrackSignEditor } from "./TrackSignEditor.js";
import { BannerStringEditor } from "./BannerStringEditor.js";
import { ActionZoneEditor } from './ActionZoneEditor.js';
import { PolyCurbEditor } from './PolyCurbEditor.js';
import { BridgeEditor } from './BridgeEditor.js';
import { AiPathEditor } from './AiPathEditor.js';
import { useEditorStore } from '../vue/store.js';
import { TERRAIN_TYPES } from '../terrain.js';

/**
 * EditorController - Handles track editing mode
 */
export class EditorController {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.isActive = false;
    // Shared raycast-based terrain height service used by all sub-editors.
    this.terrainQuery = new TerrainQuery(scene);
    
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
    
    // Hill editing (delegated to HillEditor)
    this.hillEditor = new HillEditor(this);

    // Square hill editing (delegated to SquareHillEditor)
    this.squareHillEditor = new SquareHillEditor(this);

    // Terrain shape editing (rect + circle, delegated to TerrainShapeEditor)
    this.terrainShapeEditor = new TerrainShapeEditor(this);

    // Normal map decal editing (delegated to NormalMapDecalEditor)
    this.normalMapDecalEditor = new NormalMapDecalEditor(this);

    // Tire stack editing (delegated to TireStackEditor)
    this.tireStackEditor = new TireStackEditor(this);

    // Flag editing (delegated to FlagEditor)
    this.flagEditor = new FlagEditor(this);

    // Track sign editing (delegated to TrackSignEditor)
    this.trackSignEditor = new TrackSignEditor(this);

    // Banner string editing (delegated to BannerStringEditor)
    this.bannerStringEditor = new BannerStringEditor(this);

    // Action zone editing (delegated to ActionZoneEditor)
    this.actionZoneEditor = new ActionZoneEditor(this);

        // Mesh grid terrain editor
    this.meshGridEditor = new MeshGridEditor(this);

    // Poly wall editing editor
    this.polyWallEditor = new PolyWallEditor(this);

    // Poly hill editing editor
    this.polyHillEditor = new PolyHillEditor(this);

    // Bezier wall editing editor
    this.bezierWallEditor = new BezierWallEditor(this);

    // Poly curb editing editor
    this.polyCurbEditor = new PolyCurbEditor(this);

    // Bridge editing editor
    this.bridgeEditor = new BridgeEditor(this);

    // AI path waypoint editor
    this.aiPathEditor = new AiPathEditor(this);

    // AI path placement mode — when true, every terrain click drops a waypoint
    this._aiPathPlacementMode = false;

    this._rawDragPos = null;

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
    
    // Add event listeners
    window.addEventListener('keydown', this.boundKeyDown, true); // Use capture phase
    window.addEventListener('keyup', this.boundKeyUp);
    this.scene.onPointerObservable.add(this.boundPointerDown);

    // Create highlight material for selected checkpoint
    this.checkpointEditor.createMaterials();
    
    // Activate all gizmo editors (creates materials + initial visuals)
    this.hillEditor.activate(this.scene, track);
    this.squareHillEditor.activate(this.scene, track);
    this.terrainShapeEditor.activate(this.scene, track);
    this.normalMapDecalEditor.activate(this.scene, track);
    this.tireStackEditor.activate(this.scene, track);

    // Activate all object editors
    this.flagEditor.activate(this.scene, track);
    this.trackSignEditor.activate(this.scene, track);
    this.bannerStringEditor.activate(this.scene, track);
    this.actionZoneEditor.activate(this.scene, track);

    // Mesh grid terrain editing editor
    this.meshGridEditor.activate(this.scene, track);

    // Poly wall editing editor
    this.polyWallEditor.activate(this.scene, track);

    // Poly hill editing editor
    this.polyHillEditor.activate(this.scene, track);

    // Bezier wall editing editor
    this.bezierWallEditor.activate(this.scene, track);

    // Poly curb editing editor
    this.polyCurbEditor.activate(this.scene, track);

    // Bridge editing editor
    this.bridgeEditor.activate(this.scene, track);

    // AI path waypoint editor
    this.aiPathEditor.activate(this.scene, track);

    // Wire Vue editor panels
    this._editorStore.setBridge(this);
    this._editorStore.trackDefaultTerrain = track.defaultTerrainType?.name ?? 'packed_dirt';
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

    // Dispose hill editor
    this.hillEditor.dispose();

    // Dispose all square hill editor visuals
    this.squareHillEditor.dispose();

    // Dispose all terrain shape editor visuals
    this.terrainShapeEditor.dispose();

    // Dispose all normal map decal editor visuals
    this.normalMapDecalEditor.dispose();

    // Dispose all tire stack editor visuals
    this.tireStackEditor.dispose();

    // Hide all editor panels via Vue store
    if (this._editorStore) {
      this._editorStore.addMenuOpen = false;
      this._editorStore.selectedType = null;
      this._editorStore.setBridge(null);
    }

    // Mesh grid editor
    if (this.meshGridEditor) {
      this.meshGridEditor.deactivate();
      this.meshGridEditor = null;
    }

    // Poly wall editor
    if (this.polyWallEditor) {
      this.polyWallEditor.deactivate();
      this.polyWallEditor = null;
    }

    // Poly hill editor
    if (this.polyHillEditor) {
      this.polyHillEditor.deactivate();
      this.polyHillEditor = null;
    }

    // Bezier wall editor
    if (this.bezierWallEditor) {
      this.bezierWallEditor.deactivate();
      this.bezierWallEditor = null;
    }

    // Poly curb editor
    if (this.polyCurbEditor) {
      this.polyCurbEditor.deactivate();
      this.polyCurbEditor = null;
    }

    // Flag editor
    this.flagEditor.dispose();

    // Track sign editor
    this.trackSignEditor.dispose();

    // Banner string editor
    this.bannerStringEditor.dispose();

    // Action zone editor
    this.actionZoneEditor.dispose();

    // Bridge editor
    this.bridgeEditor.dispose();

    // AI path waypoint editor
    this.aiPathEditor.dispose();

    this._aiPathPlacementMode = false;
    if (this._editorStore) this._editorStore.aiPathPlacementMode = false;
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
    this.normalMapDecalEditor.deselect();
    this.tireStackEditor.deselect();
    this.flagEditor.deselect();
    this.trackSignEditor.deselect();
    this.bannerStringEditor.deselect();
    this.actionZoneEditor.deselect();
    this.bridgeEditor.deselect();
    this.aiPathEditor.deselect();

    // Clear all gizmo meshes (keeps materials alive for re-use)
    this.hillEditor.clearMeshes();
    this.squareHillEditor.clearMeshes();
    this.terrainShapeEditor.clearMeshes();
    this.normalMapDecalEditor.clearMeshes();
    this.tireStackEditor.clearMeshes();

    // Clear object editor meshes
    this.flagEditor.clearMeshes();
    this.trackSignEditor.clearMeshes();
    this.bannerStringEditor.clearMeshes();
    this.actionZoneEditor.clearMeshes();
    this.bridgeEditor.clearMeshes();

    // Restore features
    this.currentTrack.features = JSON.parse(snap);

    // Recreate gizmos + rebuild visuals
    for (const feature of this.currentTrack.features) {
      if (feature.type === 'hill') this.hillEditor.createVisual(feature);
      else if (feature.type === 'squareHill') this.squareHillEditor.createVisual(feature);
      else if (feature.type === 'terrain') this.terrainShapeEditor.createVisual(feature);
      else if (feature.type === 'normalMapDecal') this.normalMapDecalEditor.createVisual(feature);
      else if (feature.type === 'tireStack') this.tireStackEditor.createVisual(feature);
      else if (feature.type === 'flag') this.flagEditor.createVisual(feature);
      else if (feature.type === 'trackSign') this.trackSignEditor.createVisual(feature);
      else if (feature.type === 'bannerString') this.bannerStringEditor.createVisual(feature);
      else if (feature.type === 'actionZone') this.actionZoneEditor.createVisual(feature);
      else if (feature.type === 'bridge') this.bridgeEditor.createVisual(feature);
    }
    // Restore AI path waypoint gizmos
    this.aiPathEditor.onSnapshotRestored(this.currentTrack);

    // Restore mesh grid gizmos
    this.meshGridEditor?.onSnapshotRestored();
    // Restore poly wall gizmos
    this.polyWallEditor?.onSnapshotRestored();
    window.rebuildPolyWall?.(null);
    // Restore poly hill gizmos
    this.polyHillEditor?.onSnapshotRestored();
    window.rebuildPolyHill?.(null);
    // Restore bezier wall gizmos
    this.bezierWallEditor?.onSnapshotRestored();
    window.rebuildBezierWall?.(null);
    // Restore poly curb gizmos
    this.polyCurbEditor?.onSnapshotRestored();
    window.rebuildPolyCurb?.(null);
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

    // Don't intercept keypresses while the user is typing in a text field
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    // Handle ESC key — deselect first, open menu if nothing selected
    if (event.key === 'Escape') {
      if (this._aiPathPlacementMode) {
        this._aiPathPlacementMode = false;
        this._editorStore.aiPathPlacementMode = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
      else if (this.normalMapDecalEditor.selected) this.normalMapDecalEditor.duplicateSelected();
      else if (this.tireStackEditor.selected) this.tireStackEditor.duplicateSelected();
      else if (this.bridgeEditor.selected) this.bridgeEditor.duplicateSelected();
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
      } else if (this.normalMapDecalEditor.selected) {
        this.normalMapDecalEditor.deleteSelected();
        event.preventDefault();
      } else if (this.tireStackEditor.selected) {
        this.tireStackEditor.deleteSelected();
        event.preventDefault();
      } else if (this.flagEditor.selected) {
        this.flagEditor.deleteSelected();
        event.preventDefault();
      } else if (this.trackSignEditor?.selected) {
        this.trackSignEditor.deleteSelected();
        event.preventDefault();
      } else if (this.bannerStringEditor?.selected) {
        this.bannerStringEditor.deleteSelected();
        event.preventDefault();
      } else if (this.actionZoneEditor?.selected) {
        this.actionZoneEditor.deleteSelected();
        event.preventDefault();
      } else if (this.bridgeEditor?.selected) {
        this.bridgeEditor.deleteSelected();
        event.preventDefault();
      } else if (this.aiPathEditor?.selected) {
        this.aiPathEditor.deleteSelected();
        event.preventDefault();
      } else if (this.meshGridEditor?.activeFeature) {
        this.meshGridEditor.deleteMeshGrid();
        event.preventDefault();
      } else if (this.polyWallEditor?.selectedPoint) {
        this.polyWallEditor.deleteSelectedPoint();
        event.preventDefault();
      } else if (this.polyHillEditor?.selectedPoint) {
        this.polyHillEditor.deleteSelectedPoint();
        event.preventDefault();
      } else if (this.polyCurbEditor?.selectedPoint) {
        this.polyCurbEditor.deletePolyCurbPoint();
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

    // Handle P key — toggle AI path placement mode
    if (event.key.toLowerCase() === 'p' && !event.ctrlKey && !event.metaKey) {
      this._aiPathPlacementMode = !this._aiPathPlacementMode;
      this._editorStore.aiPathPlacementMode = this._aiPathPlacementMode;
      if (this._aiPathPlacementMode) this.deselectAll();
      event.preventDefault();
      return;
    }

    // Handle G / Shift+G for grid snap
    if (event.key.toLowerCase() === 'g' && !event.ctrlKey && !event.metaKey) {
      if (event.shiftKey) {
        this._editorStore.cycleSnapSize();
      } else {
        this._editorStore.toggleSnap();
      }
      event.preventDefault();
      return;
    }

    // Delegate [ / ] to mesh grid editor for height adjustment
    if (this.meshGridEditor?.onKeyDown(event)) {
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
    if (movKeys.includes(event.key.toLowerCase()) && this.polyWallEditor?.selectedPoint) {
      this.polyWallEditor.endDrag();
    }
    if (movKeys.includes(event.key.toLowerCase()) && this.polyHillEditor?.selectedPoint) {
      this.polyHillEditor.endDrag();
    }
    if (movKeys.includes(event.key.toLowerCase()) && this.polyCurbEditor?.selectedPoint) {
      this.polyCurbEditor.endDrag();
    }
  }

  /**
   * Update camera position or selected checkpoint based on input
   */
  update() {
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
    
    const currentTarget = this.camera.getTarget();
    let delta
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

      delta = this.checkpointEditor.move(movement);
    } else if (this.hillEditor.selected) {
      delta = this.hillEditor.move(movement);
    } else if (this.squareHillEditor.selected) {
      const rotStep = (this.keys.fast ? 5 : 1) * (Math.PI / 180);
      if (this.keys.rotateLeft) this.squareHillEditor.rotate(rotStep);
      if (this.keys.rotateRight) this.squareHillEditor.rotate(-rotStep);
      delta = this.squareHillEditor.move(movement);
    } else if (this.terrainShapeEditor.selected) {
      const rotStep = (this.keys.fast ? 5 : 1) * (Math.PI / 180);
      if (this.keys.rotateLeft)  this.terrainShapeEditor.rotate( rotStep);
      if (this.keys.rotateRight) this.terrainShapeEditor.rotate(-rotStep);
      delta = this.terrainShapeEditor.move(movement);
    } else if (this.normalMapDecalEditor.selected) {
      // Q/E rotates the normal map decal
      const rotStep = (this.keys.fast ? 5 : 1) * (Math.PI / 180);
      if (this.keys.rotateLeft)  this.normalMapDecalEditor.rotate( rotStep);
      if (this.keys.rotateRight) this.normalMapDecalEditor.rotate(-rotStep);
      delta = this.normalMapDecalEditor.move(movement);
    } else if (this.tireStackEditor.selected) {
      delta = this.tireStackEditor.move(movement);
    } else if (this.flagEditor.selected) {
      delta = this.flagEditor.move(movement);
    } else if (this.trackSignEditor.selected) {
      const rotStep = (this.keys.fast ? 5 : 1) * (Math.PI / 180);
      if (this.keys.rotateLeft)  this.trackSignEditor.rotate( rotStep);
      if (this.keys.rotateRight) this.trackSignEditor.rotate(-rotStep);
      delta = this.trackSignEditor.move(movement);
    } else if (this.bannerStringEditor.selected) {
      if (this.keys.rotateLeft)  this.bannerStringEditor.rotate( this.rotationSpeed);
      if (this.keys.rotateRight) this.bannerStringEditor.rotate(-this.rotationSpeed);
      delta = this.bannerStringEditor.move(movement);
    } else if (this.actionZoneEditor.selected) {
      delta = this.actionZoneEditor.move(movement);
    } else if (this.bridgeEditor.selected) {
      const rotStep = (this.keys.fast ? 5 : 1) * (Math.PI / 180);
      if (this.keys.rotateLeft)  this.bridgeEditor.rotate( rotStep);
      if (this.keys.rotateRight) this.bridgeEditor.rotate(-rotStep);
      delta = this.bridgeEditor.move(movement);
    } else if (this.aiPathEditor?.selected) {
      delta = this.aiPathEditor.move(movement);
    } else if (this.polyWallEditor?.selectedPoint) {
      const d = this.polyWallEditor.moveSelectedPoint(movement.x, movement.z);
      delta = new Vector3(d.x, movement.y, d.z);
    } else if (this.polyHillEditor?.selectedPoint) {
      const d = this.polyHillEditor.moveSelectedPoint(movement.x, movement.z);
      delta = new Vector3(d.x, movement.y, d.z);
    } else if (this.bezierWallEditor?.selectedAnchor) {
      const d = this.bezierWallEditor.moveSelectedAnchor(movement.x, movement.z);
      delta = new Vector3(d.x, movement.y, d.z);
    } else if (this.bezierWallEditor?.selectedHandle) {
      const d = this.bezierWallEditor.moveSelectedHandle(movement.x, movement.z);
      delta = new Vector3(d.x, movement.y, d.z);
    } else if (this.polyCurbEditor?.selectedPoint) {
      const d = this.polyCurbEditor.moveSelectedPoint(movement.x, movement.z);
      delta = new Vector3(d.x, movement.y, d.z);
    } else {
      // Move camera and target together
      delta = movement;
    }
    delta.y = movement.y;
    this.camera.position.addInPlace(delta);
    this.camera.setTarget(currentTarget.add(delta));
  }

  handlePointerDown(pointerInfo) {
    if (!this.isActive) return;
    
    if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
      const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);

      // AI path placement mode: every click drops a waypoint at the terrain hit point
      if (this._aiPathPlacementMode) {
        if (pickResult.hit && pickResult.pickedPoint) {
          this.aiPathEditor.addPoint(pickResult.pickedPoint.x, pickResult.pickedPoint.z);
        }
        return;
      }
      
      if (pickResult.hit && pickResult.pickedMesh) {
        // Check if clicked mesh is part of a checkpoint
        const clickedMesh = pickResult.pickedMesh;

        // Mesh grid control points take priority
        if (this.meshGridEditor?.onPointerDown(clickedMesh)) return;

        // Poly wall control points
        if (this.polyWallEditor?.onPointerDown(clickedMesh)) return;

        // Poly hill control points
        if (this.polyHillEditor?.onPointerDown(clickedMesh)) return;

        // Bezier wall control points
        if (this.bezierWallEditor?.onPointerDown(clickedMesh)) return;

        // Poly curb control points
        if (this.polyCurbEditor?.onPointerDown(clickedMesh)) return;
        
        // Check if clicked mesh is part of a checkpoint
        {
          const cpData = this.checkpointEditor.findByMesh(clickedMesh);
          if (cpData) {
            const wasSelected = this.checkpointEditor.selected === cpData;
            this.deselectAll();
            if (!wasSelected) this.checkpointEditor.select(cpData);
            return;
          }
        }

        // Check if clicked mesh is a hill gizmo
        {
          const hillData = this.hillEditor.findByMesh(clickedMesh);
          if (hillData) {
            const wasSelected = this.hillEditor.selected === hillData;
            this.deselectAll();
            if (!wasSelected) this.hillEditor.select(hillData);
            return;
          }
        }

        // Check if clicked mesh is a square hill gizmo
        {
          const hillData = this.squareHillEditor.findByMesh(clickedMesh);
          if (hillData) {
            const wasSelected = this.squareHillEditor.selected === hillData;
            this.deselectAll();
            if (!wasSelected) this.squareHillEditor.select(hillData);
            return;
          }
        }

        // Check if clicked mesh is a terrain shape (rect or circle)
        {
          const shapeData = this.terrainShapeEditor.findByMesh(clickedMesh);
          if (shapeData) {
            const wasSelected = this.terrainShapeEditor.selected === shapeData;
            this.deselectAll();
            if (!wasSelected) this.terrainShapeEditor.select(shapeData);
            return;
          }
        }

        // Check if clicked mesh is a normal map decal gizmo
        {
          const decalData = this.normalMapDecalEditor.findByMesh(clickedMesh);
          if (decalData) {
            const wasSelected = this.normalMapDecalEditor.selected === decalData;
            this.deselectAll();
            if (!wasSelected) this.normalMapDecalEditor.select(decalData);
            return;
          }
        }

        // Check if clicked mesh is a tire stack gizmo
        {
          const stackData = this.tireStackEditor.findByMesh(clickedMesh);
          if (stackData) {
            const wasSelected = this.tireStackEditor.selected === stackData;
            this.deselectAll();
            if (!wasSelected) this.tireStackEditor.select(stackData);
            return;
          }
        }

        // Check if clicked mesh is a flag (pole or flag mesh)
        {
          const flagData = this.flagEditor.findByMesh(clickedMesh);
          if (flagData) {
            const wasSelected = this.flagEditor.selected === flagData;
            this.deselectAll();
            if (!wasSelected) this.flagEditor.select(clickedMesh);
            return;
          }
        }

        // Check if clicked mesh is a track sign (board or post)
        {
          const signData = this.trackSignEditor.findByMesh(clickedMesh);
          if (signData) {
            const wasSelected = this.trackSignEditor.selected === signData;
            this.deselectAll();
            if (!wasSelected) this.trackSignEditor.select(signData);
            return;
          }
        }

        // Check if clicked mesh is a banner string
        {
          const bannerData = this.bannerStringEditor.findByMesh(clickedMesh);
          if (bannerData) {
            const wasSelected = this.bannerStringEditor.selected === bannerData;
            this.deselectAll();
            if (!wasSelected) this.bannerStringEditor.select(bannerData);
            return;
          }
        }

        // Check if clicked mesh is an action zone handle
        {
          const zoneData = this.actionZoneEditor.findByMesh(clickedMesh);
          if (zoneData) {
            const wasSelected = this.actionZoneEditor.selected === zoneData;
            this.deselectAll();
            if (!wasSelected) this.actionZoneEditor.select(zoneData);
            return;
          }
        }

        // Check if clicked mesh is a bridge gizmo
        {
          const bridgeData = this.bridgeEditor.findByMesh(clickedMesh);
          if (bridgeData) {
            const wasSelected = this.bridgeEditor.selected === bridgeData;
            this.deselectAll();
            if (!wasSelected) this.bridgeEditor.select(bridgeData);
            return;
          }
        }

        // Check if clicked mesh is an AI path waypoint
        {
          const wpData = this.aiPathEditor.findByMesh(clickedMesh);
          if (wpData) {
            const wasSelected = this.aiPathEditor.selected === wpData;
            this.deselectAll();
            if (!wasSelected) this.aiPathEditor.select(wpData);
            return;
          }
        }

        // Clicked on something else (terrain, etc.) — deselect all
        this.deselectAll();
      } else {
        // Clicked on empty space (sky, etc.) — deselect all
        this.deselectAll();
      }
    }
  }

  // ─── Checkpoint thin wrappers (delegated to CheckpointEditor) ──────────────

  selectCheckpoint(checkpointData) {
    this.deselectAll();
    this.checkpointEditor.select(checkpointData);
  }

  deselectCheckpoint() { this.checkpointEditor.deselect(); }
  deleteSelectedCheckpoint() { this.checkpointEditor.deleteSelected(); }
  duplicateSelectedCheckpoint() { this.checkpointEditor.duplicateSelected(); }

  // ─── Terrain Shape Editing (delegated to TerrainShapeEditor) ─────────────

  addTerrainEntity()                     { this.terrainShapeEditor.addEntity(); }
  deselectTerrainShape()           { this.terrainShapeEditor.deselect(); }
  duplicateSelectedTerrainShape()  { this.terrainShapeEditor.duplicateSelected(); }
  deleteSelectedTerrainShape()     { this.terrainShapeEditor.deleteSelected(); }

  get selectedTerrainRect()  { return this.terrainShapeEditor.selected?.feature.shape === 'rect'   ? this.terrainShapeEditor.selected : null; }
  get selectedTerrainCircle(){ return this.terrainShapeEditor.selected?.feature.shape === 'circle' ? this.terrainShapeEditor.selected : null; }

  toggleAddMenu()     { this._editorStore.toggleAddMenu(); }
  hideAddMenu()       { this._editorStore.closeAddMenu(); }

  addMeshGridEntity()   { this.meshGridEditor?.addMeshGridFeature(); this.hideAddMenu(); }
  addPolyWallEntity()   { this.polyWallEditor?.addPolyWallFeature(); this.hideAddMenu(); }
  addPolyHillEntity()   { this.polyHillEditor?.addPolyHillFeature(); this.hideAddMenu(); }
  addBezierWallEntity() { this.bezierWallEditor?.addBezierWallFeature(); this.hideAddMenu(); }
  addPolyCurbEntity()   { this.polyCurbEditor?.addPolyCurbFeature(); this.hideAddMenu(); }
  
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
  _snap(v, axis = null) {
    const { snapEnabled, snapSize } = this._editorStore;
    
    // Determine dynamic boundaries from current track
    let clampMax = 80;
    if (this.currentTrack) {
      if (axis === 'x') clampMax = (this.currentTrack.width ?? 160) / 2;
      else if (axis === 'z') clampMax = (this.currentTrack.depth ?? 160) / 2;
      else clampMax = Math.max(this.currentTrack.width ?? 160, this.currentTrack.depth ?? 160) / 2;
    }
    
    const clamped = Math.max(-clampMax, Math.min(clampMax, v));
    return snapEnabled ? Math.round(clamped / snapSize) * snapSize : clamped;
  }

  // ─── Quick Test ───────────────────────────────────────────────────────────

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

  changeTrackDefaultTerrain(name) {
    const key = Object.keys(TERRAIN_TYPES).find(k => TERRAIN_TYPES[k].name === name);
    if (!key) return;
    this.saveSnapshot();
    this.currentTrack.defaultTerrainType = TERRAIN_TYPES[key];
    window.rebuildTerrainGrid?.();
    window.rebuildTerrainTexture?.();
    window.rebuildNormalMap?.();
  }

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
  changeTerrainShapeWidth(val)    { this.terrainShapeEditor.changeWidth(val); }
  changeTerrainShapeDepth(val)    { this.terrainShapeEditor.changeDepth(val); }
  changeTerrainShapeRotation(val) { this.terrainShapeEditor.changeRotation(val); }
  changeTerrainShapeTerrainType(n) { this.terrainShapeEditor.changeTerrainType(n); }

  // ─── Normal Map Decal Editing (delegated to NormalMapDecalEditor) ──────────

  addNormalMapDecalEntity()          { this.normalMapDecalEditor.addEntity(); }
  createNormalMapDecalVisual(f)      { return this.normalMapDecalEditor.createVisual(f); }
  updateNormalMapDecalVisual(d)      { this.normalMapDecalEditor.updateVisual(d); }
  selectNormalMapDecal(d)            { this.normalMapDecalEditor.select(d); }
  deselectNormalMapDecal()           { this.normalMapDecalEditor.deselect(); }
  deleteSelectedNormalMapDecal()     { this.normalMapDecalEditor.deleteSelected(); }
  duplicateSelectedNormalMapDecal()  { this.normalMapDecalEditor.duplicateSelected(); }
  showNormalMapDecalProperties(d)    { this.normalMapDecalEditor.showProperties(d); }
  hideNormalMapDecalProperties()     { this.normalMapDecalEditor.hideProperties(); }

  get selectedNormalMapDecal()       { return this.normalMapDecalEditor.selected; }

  changeNormalMapDecalWidth(val)     { this.normalMapDecalEditor.changeWidth(val); }
  changeNormalMapDecalDepth(val)     { this.normalMapDecalEditor.changeDepth(val); }
  changeNormalMapDecalAngle(val)     { this.normalMapDecalEditor.changeAngle(val); }
  changeNormalMapDecalNormalMap(val) { this.normalMapDecalEditor.changeNormalMap(val); }
  changeNormalMapDecalRepeatU(val)   { this.normalMapDecalEditor.changeRepeatU(val); }
  changeNormalMapDecalRepeatV(val)   { this.normalMapDecalEditor.changeRepeatV(val); }
  changeNormalMapDecalIntensity(val) { this.normalMapDecalEditor.changeIntensity(val); }

  // ─── Tire Stack Editing (delegated to TireStackEditor) ───────────────────

  addTireStackEntity()             { this.tireStackEditor.addEntity(); }
  createTireStackVisual(f)         { return this.tireStackEditor.createVisual(f); }
  updateTireStackVisual(d)         { this.tireStackEditor.updateVisual(d); }
  selectTireStack(d)               { this.tireStackEditor.select(d); }
  deselectTireStack()              { this.tireStackEditor.deselect(); }
  moveSelectedTireStack(movement)  { return this.tireStackEditor.move(movement); }
  deleteSelectedTireStack()        { this.tireStackEditor.deleteSelected(); }
  duplicateSelectedTireStack()     { this.tireStackEditor.duplicateSelected(); }

  get selectedTireStack()          { return this.tireStackEditor.selected; }

  // ─── Flag Editing (delegated to FlagEditor) ─────────────────────────────

  addFlagEntity()              { this.flagEditor.addEntity(); }
  deselectFlag()               { this.flagEditor.deselect(); }
  moveSelectedFlag(movement)   { return this.flagEditor.move(movement); }

  deselectAll() {
    this.checkpointEditor.deselect();
    this.hillEditor.deselect();
    this.squareHillEditor.deselect();
    this.terrainShapeEditor.deselect();
    this.normalMapDecalEditor.deselect();
    this.tireStackEditor.deselect();
    this.flagEditor.deselect();
    this.trackSignEditor.deselect();
    this.bannerStringEditor.deselect();
    this.actionZoneEditor.deselect();
    this.bridgeEditor?.deselect();
    this.aiPathEditor?.deselect();
    this.meshGridEditor?.deselectPoint();
    this.polyWallEditor?.deselectPoint();
    this.polyHillEditor?.deselectPoint();
    this.bezierWallEditor?.deselectAll();
    this.polyCurbEditor?.deselectPolyCurb();
  }

  // ── Poly Wall Vue bridge methods ──
  changePolyWallRadius(val)     { this.polyWallEditor.changePolyWallRadius(val); }
  changePolyWallHeight(val)     { this.polyWallEditor.changePolyWallHeight(val); }
  changePolyWallThickness(val)  { this.polyWallEditor.changePolyWallThickness(val); }
  changePolyWallClosed(val)     { this.polyWallEditor.changePolyWallClosed(val); }
  insertPolyWallPoint()         { this.polyWallEditor.insertPolyWallPoint(); }
  deletePolyWallPoint()         { this.polyWallEditor.deleteSelectedPoint(); }
  deletePolyWall()              { this.polyWallEditor.deletePolyWall(); }
  duplicatePolyWall()           { this.polyWallEditor.duplicatePolyWall(); }
  deselectPolyWall()            { this.polyWallEditor.deselectPoint(); }

  // ── Poly Hill Vue bridge methods ──
  changePolyHillRadius(val)     { this.polyHillEditor.setPointRadius(val); }
  changePolyHillHeight(val)     { this.polyHillEditor.setHeight(val); }
  changePolyHillWidth(val)      { this.polyHillEditor.setWidth(val); }
  changePolyHillClosed(val)     { this.polyHillEditor.setClosed(val); }
  insertPolyHillPoint()         { this.polyHillEditor.insertPointAfter(); }
  deletePolyHillPoint()         { this.polyHillEditor.deleteSelectedPoint(); }
  deletePolyHill()              { this.polyHillEditor.deletePolyHill(); }
  duplicatePolyHill()           { this.polyHillEditor.duplicatePolyHill(); }
  deselectPolyHill()            { this.polyHillEditor.deselectPoint(); }

  // ── Bezier Wall Vue bridge methods ──
  changeBezierWallHeight(val)   { this.bezierWallEditor.changeBezierWallHeight(val); }
  changeBezierWallThickness(val){ this.bezierWallEditor.changeBezierWallThickness(val); }
  changeBezierWallClosed(val)   { this.bezierWallEditor.changeBezierWallClosed(val); }
  insertBezierWallPoint()       { this.bezierWallEditor.insertBezierWallPoint(); }
  deleteBezierWallPoint()       { this.bezierWallEditor.deleteBezierWallPoint(); }
  deleteBezierWall()            { this.bezierWallEditor.deleteBezierWall(); }
  duplicateBezierWall()         { this.bezierWallEditor.duplicateBezierWall(); }
  deselectBezierWall()          { this.bezierWallEditor.deselectBezierWall(); }

  // ── Flag Vue bridge methods ──
  changeFlagColor(val) { this.flagEditor.changeColor(val); }
  deleteFlag()         { this.flagEditor.deleteSelected(); }
  duplicateFlag()      { this.flagEditor.duplicateSelected(); }

  // ── Track Sign Vue bridge methods ──
  addTrackSignEntity()         { this.trackSignEditor.addEntity(); }
  deselectTrackSign()          { this.trackSignEditor.deselect(); }
  changeTrackSignName(val)     { this.trackSignEditor.changeName(val); }
  changeTrackSignRotation(val) { this.trackSignEditor.changeRotation(val); }
  deleteTrackSign()            { this.trackSignEditor.deleteSelected(); }
  duplicateTrackSign()         { this.trackSignEditor.duplicateSelected(); }

  // ── Banner String Vue bridge methods ──
  addBannerStringEntity()         { this.bannerStringEditor.addEntity(); }
  deselectBannerString()          { this.bannerStringEditor.deselect(); }
  changeBannerStringWidth(val)    { this.bannerStringEditor.changeWidth(val); }
  changeBannerStringPoleHeight(val) { this.bannerStringEditor.changePoleHeight(val); }
  changeBannerStringHeading(val)  { this.bannerStringEditor.changeHeading(val); }
  deleteBannerString()            { this.bannerStringEditor.deleteSelected(); }
  duplicateBannerString()         { this.bannerStringEditor.duplicateSelected(); }

  // ── Action Zone Vue bridge methods ──
  addActionZoneEntity()           { this.actionZoneEditor.addEntity(); }
  addBridgeEntity()               { this.bridgeEditor.addEntity(); }
  deselectActionZone()            { this.actionZoneEditor.deselect(); }
  changeActionZoneRadius(val)     { this.actionZoneEditor.changeRadius(val); }
  changeActionZoneType(val)       { this.actionZoneEditor.changeZoneType(val); }
  deleteActionZone()              { this.actionZoneEditor.deleteSelected(); }
  duplicateActionZone()           { this.actionZoneEditor.duplicateSelected(); }

  // ── Poly Curb Vue bridge methods ──
  changePolyCurbRadius(val)  { this.polyCurbEditor?.changePolyCurbRadius(val); }
  changePolyCurbHeight(val)  { this.polyCurbEditor?.changePolyCurbHeight(val); }
  changePolyCurbWidth(val)   { this.polyCurbEditor?.changePolyCurbWidth(val); }
  changePolyCurbClosed(val)  { this.polyCurbEditor?.changePolyCurbClosed(val); }
  insertPolyCurbPoint()      { this.polyCurbEditor?.insertPolyCurbPoint(); }
  deletePolyCurbPoint()      { this.polyCurbEditor?.deletePolyCurbPoint(); }
  deletePolyCurb()           { this.polyCurbEditor?.deletePolyCurb(); }
  duplicatePolyCurb()        { this.polyCurbEditor?.duplicatePolyCurb(); }
  deselectPolyCurb()         { this.polyCurbEditor?.deselectPolyCurb(); }

  // ── Bridge Vue bridge methods ──────────────────────────────────────────────
  changeBridgeWidth(val)     { this.bridgeEditor?.changeWidth(val); }
  changeBridgeDepth(val)     { this.bridgeEditor?.changeDepth(val); }
  changeBridgeHeight(val)    { this.bridgeEditor?.changeHeight(val); }
  changeBridgeThickness(val) { this.bridgeEditor?.changeThickness(val); }
  changeBridgeAngle(val)     { this.bridgeEditor?.changeAngle(val); }
  changeBridgeCollisionWidth(val)     { this.bridgeEditor?.changeCollisionWidth(val); }
  changeBridgeCollisionDepth(val)     { this.bridgeEditor?.changeCollisionDepth(val); }
  changeBridgeCollisionThickness(val) { this.bridgeEditor?.changeCollisionThickness(val); }
  changeBridgeCollisionYOffset(val)   { this.bridgeEditor?.changeCollisionYOffset(val); }
  changeBridgeCollisionEndCaps(val)         { this.bridgeEditor?.changeCollisionEndCaps(val); }
  changeBridgeCollisionEndCapsOnDepth(val)  { this.bridgeEditor?.changeCollisionEndCapsOnDepth(val); }
  changeBridgeCollisionEndCapsOnWidth(val)  { this.bridgeEditor?.changeCollisionEndCapsOnWidth(val); }
  changeBridgeCollisionEndCapThickness(val) { this.bridgeEditor?.changeCollisionEndCapThickness(val); }
  changeBridgeCollisionEndCapDrop(val)      { this.bridgeEditor?.changeCollisionEndCapDrop(val); }
  changeBridgeCollisionEndCapSpanDepth(val) { this.bridgeEditor?.changeCollisionEndCapSpanDepth(val); }
  changeBridgeCollisionEndCapSpanWidth(val) { this.bridgeEditor?.changeCollisionEndCapSpanWidth(val); }
  duplicateSelectedBridge()  { this.bridgeEditor?.duplicateSelected(); }
  deleteBridge()             { this.bridgeEditor?.deleteSelected(); }
  deselectBridge()           { this.bridgeEditor?.deselect(); }

  // ── Mesh grid bridge ─────────────────────────────────────────────────────
  changeMeshGridSmoothing(v) {
    if (this.meshGridEditor?.activeFeature) {
      this.meshGridEditor.activeFeature.smoothing = v;
      window.rebuildTerrain?.();
    }
  }
  changeMeshGridStepSize(v)     { if (this.meshGridEditor) this.meshGridEditor.stepSize = v; }
  setMeshGridPointHeight(v)     { this.meshGridEditor?.setPointHeightFromStore(v); }
  meshGridAdjustUp()            { if (this.meshGridEditor) this.meshGridEditor.adjustHeight(this.meshGridEditor.stepSize); }
  meshGridAdjustDown()          { if (this.meshGridEditor) this.meshGridEditor.adjustHeight(-this.meshGridEditor.stepSize); }
  applyMeshGridChanges(c, r, w, d) { this.meshGridEditor?.applyGridChanges(c, r, w, d); }
  flattenMeshGrid()             { this.meshGridEditor?.flattenGrid(); }
  deleteMeshGrid()              { this.meshGridEditor?.deleteMeshGrid(); }
  duplicateMeshGrid()           { this.meshGridEditor?.duplicateMeshGrid(); }
  closeMeshGrid() {
    this.meshGridEditor?.deselectPoint();
    if (this._editorStore) this._editorStore.selectedType = null;
  }

  // ── AI Path Vue bridge methods ────────────────────────────────────────────
  addAiWaypointEntity() {
    // Place new waypoint at the camera's look-at target
    const target = this.camera.getTarget();
    this.aiPathEditor.addPoint(target.x, target.z);
    this.hideAddMenu();
  }
  deleteAiWaypoint()   { this.aiPathEditor.deleteSelected(); }
  clearAiPath()        { this.aiPathEditor.clearAll(); }
  deselectAiWaypoint() { this.aiPathEditor.deselect(); }

  /**
   * Dispose of the controller
   */
  dispose() {
    this.deactivate();
  }
}
