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
import { ObstacleEditor } from "./ObstacleEditor.js";
import { DecorationsEditor } from "./DecorationsEditor.js";
import { TrackSignEditor } from "./TrackSignEditor.js";
import { ActionZoneEditor } from './ActionZoneEditor.js';
import { PolyCurbEditor } from './PolyCurbEditor.js';
import { BridgeEditor } from './BridgeEditor.js';
import { AiPathEditor } from './AiPathEditor.js';
import { TerrainPathEditor } from './TerrainPathEditor.js';
import { SurfaceDecalEditor } from './SurfaceDecalEditor.js';
import { useEditorStore } from '../vue/store.js';
import { TERRAIN_TYPES } from '../terrain.js';
import { DEFAULT_TERRAIN_WEAR_CONFIG } from '../terrain-utils.js';

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
    this.keyRepeatDelayMs = 220;
    this.keyRepeatIntervalMs = 80;
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
    this._repeatingKeyState = {
      forward: { pressed: false, hasFired: false, nextRepeatAt: 0 },
      back: { pressed: false, hasFired: false, nextRepeatAt: 0 },
      left: { pressed: false, hasFired: false, nextRepeatAt: 0 },
      right: { pressed: false, hasFired: false, nextRepeatAt: 0 },
      up: { pressed: false, hasFired: false, nextRepeatAt: 0 },
      down: { pressed: false, hasFired: false, nextRepeatAt: 0 },
      rotateLeft: { pressed: false, hasFired: false, nextRepeatAt: 0 },
      rotateRight: { pressed: false, hasFired: false, nextRepeatAt: 0 }
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

    // Tire stack editing (delegated to ObstacleEditor)
    this.obstacleEditor = new ObstacleEditor(this);

    // Decorations editing (flags + banner strings)
    this.decorationsEditor = new DecorationsEditor(this);

    // Track sign editing (delegated to TrackSignEditor)
    this.trackSignEditor = new TrackSignEditor(this);

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

    // Terrain path editor (terrain-painted polygon paths)
    this.terrainPathEditor = new TerrainPathEditor(this);

    // Surface decal stamp editor
    this.surfaceDecalEditor = new SurfaceDecalEditor(this);

    this._rawDragPos = null;
    this._aiPathMouseDownSelectedWaypoint = null;
    this._aiPathMouseDownMoved = false;

    // Undo / redo stacks (each entry is a JSON string of editable track state)
    this._undoStack = [];
    this._redoStack = [];
    this._snapshotDebounceTimer = null;

    // Bind event handlers
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundPointerEvent = this.handlePointerEvent.bind(this);
    this._mouseDrag = null;
    this._dragHoldTimer = null;
    this._dragHoldTarget = null;
    this._dragHoldDelayMs = 180;
    
    // Track being edited
    this.currentTrack = null;
    this.gizmosVisible = true;

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
    this.scene.onPointerObservable.add(this.boundPointerEvent);
    
    // Activate all gizmo editors (creates materials + initial visuals)
    this.hillEditor.activate(this.scene, track);
    this.squareHillEditor.activate(this.scene, track);
    this.terrainShapeEditor.activate(this.scene, track);
    this.normalMapDecalEditor.activate(this.scene, track);
    this.obstacleEditor.activate(this.scene, track);

    // Activate all object editors
    this.decorationsEditor.activate(this.scene, track);
    this.trackSignEditor.activate(this.scene, track);
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

    // Terrain path editor
    this.terrainPathEditor.activate(this.scene, track);

    // Surface decal stamp editor
    this.surfaceDecalEditor.activate(this.scene, track);

    // Wire Vue editor panels
    this._editorStore.setBridge(this);
    this.setGizmosVisible(true);
    this._editorStore.trackDefaultTerrain = track.defaultTerrainType?.name ?? 'packed_dirt';
    this._editorStore.trackBorderTerrain = track.borderTerrainType?.name ?? this._editorStore.trackDefaultTerrain;
    this._syncAiPathPanel();
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
    this.scene.onPointerObservable.removeCallback(this.boundPointerEvent);
    this._clearDragHoldTimer();
    this._mouseDrag = null;
    
    // Reset key states
    Object.keys(this.keys).forEach(key => this.keys[key] = false);
    Object.values(this._repeatingKeyState).forEach(state => {
      state.pressed = false;
      state.hasFired = false;
      state.nextRepeatAt = 0;
    });

    // Dispose hill editor
    this.hillEditor.dispose();

    // Dispose all square hill editor visuals
    this.squareHillEditor.dispose();

    // Dispose all terrain shape editor visuals
    this.terrainShapeEditor.dispose();

    // Dispose all normal map decal editor visuals
    this.normalMapDecalEditor.dispose();

    // Dispose all tire stack editor visuals
    this.obstacleEditor.dispose();

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

    // Decorations editor
    this.decorationsEditor.dispose();

    // Track sign editor
    this.trackSignEditor.dispose();

    // Action zone editor
    this.actionZoneEditor.dispose();

    // Bridge editor
    this.bridgeEditor.dispose();

    // AI path waypoint editor
    this.aiPathEditor.dispose();

    // Terrain path editor
    this.terrainPathEditor.dispose();

    // Surface decal stamp editor
    this.surfaceDecalEditor.dispose();
  }

  // ─── Undo / Redo ──────────────────────────────────────────────────────────

  /**
  * Save the current editable track state as an undo snapshot.
   * Pass debounce=true for continuous operations (slider drags, WASD movement)
   * so we don't flood the stack — a snapshot is only committed after 400ms of silence.
   */
  saveSnapshot(debounce = false) {
    const commit = () => {
    const snap = this._serializeSnapshot();
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

  _serializeSnapshot() {
    return JSON.stringify({
      features: this.currentTrack.features,
      wear: this.currentTrack.wear ?? null,
    });
  }

  _getWearConfig() {
    if (!this.currentTrack) return { ...DEFAULT_TERRAIN_WEAR_CONFIG };
    this.currentTrack.wear = {
      ...DEFAULT_TERRAIN_WEAR_CONFIG,
      ...(this.currentTrack.wear ?? {}),
    };
    return this.currentTrack.wear;
  }

  _syncAiPathPanel() {
    if (!this._editorStore) return;
    const wear = this._getWearConfig();
    this._editorStore.aiPathWear.enabled = !!wear.enabled;
    this._editorStore.aiPathWear.width = wear.width;
    this._editorStore.aiPathWear.intensity = wear.intensity;
    this._editorStore.aiPathWear.laneSpacing = wear.laneSpacing;
    this._editorStore.aiPathWear.alphaBreakup = wear.alphaBreakup;
    this._editorStore.aiPathWear.pathWander = wear.pathWander;
    this._editorStore.aiPathWear.edgeSoftness = wear.edgeSoftness;
    this._editorStore.aiPathWear.secondaryPathCount = wear.secondaryPathCount;
    this._editorStore.aiPathWear.secondaryPathStrength = wear.secondaryPathStrength;
    this._editorStore.aiPathWear.secondaryPathSpacing = wear.secondaryPathSpacing;
  }

  _updateAiPathWear(updates, debounce = true) {
    if (!this.currentTrack) return;
    this.saveSnapshot(debounce);
    Object.assign(this._getWearConfig(), updates);
    this._syncAiPathPanel();
    window.rebuildTerrainTexture?.();
  }

  _setRepeatingKeyPressed(key) {
    const state = this._repeatingKeyState[key];
    if (!state) return;
    if (state.pressed) return;
    state.pressed = true;
    state.hasFired = false;
    state.nextRepeatAt = 0;
  }

  _clearRepeatingKeyPressed(key) {
    const state = this._repeatingKeyState[key];
    if (!state) return;
    state.pressed = false;
    state.hasFired = false;
    state.nextRepeatAt = 0;
  }

  _shouldConsumeRepeatingKey(key, now) {
    const state = this._repeatingKeyState[key];
    if (!state || !state.pressed || now < state.nextRepeatAt) return false;

    const delay = state.hasFired ? this.keyRepeatIntervalMs : this.keyRepeatDelayMs;
    state.hasFired = true;
    state.nextRepeatAt = now + delay;
    return true;
  }

  _setMovementKeyState(key, pressed) {
    const keyMap = {
      w: 'forward',
      s: 'back',
      d: 'left',
      a: 'right',
      q: 'rotateLeft',
      e: 'rotateRight',
      '=': 'down',
      '+': 'down',
      '-': 'up',
      '_': 'up',
    };

    const stateKey = keyMap[key];
    if (!stateKey) return false;

    this.keys[stateKey] = pressed;
    if (pressed) this._setRepeatingKeyPressed(stateKey);
    else this._clearRepeatingKeyPressed(stateKey);
    return true;
  }

  _createVectorSelectionInteraction(editor, rotateStepFn = null) {
    const interaction = {
      move: (movement) => editor.move(movement),
      moveByPointerDelta: (dx, dz) => editor.move(new Vector3(dx, 0, dz)),
    };

    if (rotateStepFn) {
      interaction.rotateLeft = (fast) => editor.rotate(rotateStepFn(fast));
      interaction.rotateRight = (fast) => editor.rotate(-rotateStepFn(fast));
    }

    return interaction;
  }

  _createPointSelectionInteraction(editor, moveMethodName) {
    const movePoint = (movement) => {
      const delta = editor[moveMethodName](movement.x, movement.z);
      return new Vector3(delta.x, movement.y, delta.z);
    };

    return {
      move: movePoint,
      moveByPointerDelta: (dx, dz) => editor[moveMethodName](dx, dz),
    };
  }

  _getActiveSelectionInteraction() {
    if (this.checkpointEditor.selected) {
      return this._createVectorSelectionInteraction(this.checkpointEditor, () => this.rotationSpeed);
    }

    if (this.hillEditor.selected) {
      return this._createVectorSelectionInteraction(this.hillEditor, (fast) => (fast ? 5 : 1) * (Math.PI / 180));
    }

    if (this.squareHillEditor.selected) {
      return this._createVectorSelectionInteraction(this.squareHillEditor, (fast) => (fast ? 5 : 1) * (Math.PI / 180));
    }

    if (this.terrainShapeEditor.selected) {
      return this._createVectorSelectionInteraction(this.terrainShapeEditor, (fast) => (fast ? 5 : 1) * (Math.PI / 180));
    }

    if (this.normalMapDecalEditor.selected) {
      return this._createVectorSelectionInteraction(this.normalMapDecalEditor, (fast) => (fast ? 5 : 1) * (Math.PI / 180));
    }

    if (this.obstacleEditor.selected) {
      return this._createVectorSelectionInteraction(this.obstacleEditor, (fast) => (fast ? 5 : 1) * (Math.PI / 180));
    }

    if (this.decorationsEditor.selected) {
      return this._createVectorSelectionInteraction(this.decorationsEditor);
    }

    if (this.trackSignEditor.selected) {
      return this._createVectorSelectionInteraction(this.trackSignEditor, (fast) => (fast ? 5 : 1) * (Math.PI / 180));
    }

    if (this.actionZoneEditor.selected) {
      return this._createVectorSelectionInteraction(this.actionZoneEditor);
    }

    if (this.bridgeEditor?.selected) {
      return this._createVectorSelectionInteraction(this.bridgeEditor, (fast) => (fast ? 5 : 1) * (Math.PI / 180));
    }

    if (this.aiPathEditor?.selected) {
      return this._createVectorSelectionInteraction(this.aiPathEditor);
    }

    if (this.terrainPathEditor?.selected) {
      return this._createVectorSelectionInteraction(this.terrainPathEditor);
    }

    if (this.polyWallEditor?.selectedPoint) {
      return this._createPointSelectionInteraction(this.polyWallEditor, 'moveSelectedPoint');
    }

    if (this.polyHillEditor?.selectedPoint) {
      return this._createPointSelectionInteraction(this.polyHillEditor, 'moveSelectedPoint');
    }

    if (this.bezierWallEditor?.selectedAnchor) {
      return this._createPointSelectionInteraction(this.bezierWallEditor, 'moveSelectedAnchor');
    }

    if (this.bezierWallEditor?.selectedHandle) {
      return this._createPointSelectionInteraction(this.bezierWallEditor, 'moveSelectedHandle');
    }

    if (this.polyCurbEditor?.selectedPoint) {
      return this._createPointSelectionInteraction(this.polyCurbEditor, 'moveSelectedPoint');
    }

    return null;
  }

  _getSelectedFeatureActions() {
    const featureActions = [
      { selected: () => this.checkpointEditor.selected, duplicate: () => this.checkpointEditor.duplicateSelected(), delete: () => this.checkpointEditor.deleteSelected() },
      { selected: () => this.hillEditor.selected, duplicate: () => this.hillEditor.duplicateSelected(), delete: () => this.hillEditor.deleteSelected() },
      { selected: () => this.squareHillEditor.selected, duplicate: () => this.squareHillEditor.duplicateSelected(), delete: () => this.squareHillEditor.deleteSelected() },
      { selected: () => this.terrainShapeEditor.selected, duplicate: () => this.terrainShapeEditor.duplicateSelected(), delete: () => this.terrainShapeEditor.deleteSelected() },
      { selected: () => this.normalMapDecalEditor.selected, duplicate: () => this.normalMapDecalEditor.duplicateSelected(), delete: () => this.normalMapDecalEditor.deleteSelected() },
      { selected: () => this.obstacleEditor.selected, duplicate: () => this.obstacleEditor.duplicateSelected(), delete: () => this.obstacleEditor.deleteSelected() },
      { selected: () => this.decorationsEditor.selected, duplicate: () => this.decorationsEditor.duplicateSelected(), delete: () => this.decorationsEditor.deleteSelected() },
      { selected: () => this.trackSignEditor.selected, duplicate: () => this.trackSignEditor.duplicateSelected(), delete: () => this.trackSignEditor.deleteSelected() },
      { selected: () => this.actionZoneEditor.selected, duplicate: () => this.actionZoneEditor.duplicateSelected(), delete: () => this.actionZoneEditor.deleteSelected() },
      { selected: () => this.bridgeEditor?.selected, duplicate: () => this.bridgeEditor?.duplicateSelected?.(), delete: () => this.bridgeEditor?.deleteSelected?.() },
      { selected: () => this.aiPathEditor?.selected, delete: () => this.aiPathEditor?.deleteSelected?.() },
      { selected: () => this.terrainPathEditor?.selected, delete: () => this.terrainPathEditor?.deleteSelected?.() },
      { selected: () => this.meshGridEditor?.activeFeature, delete: () => this.meshGridEditor?.deleteMeshGrid?.() },
      { selected: () => this.polyWallEditor?.selectedPoint, delete: () => this.polyWallEditor?.deleteSelectedPoint?.() },
      { selected: () => this.polyHillEditor?.selectedPoint, delete: () => this.polyHillEditor?.deleteSelectedPoint?.() },
      { selected: () => this.polyCurbEditor?.selectedPoint, delete: () => this.polyCurbEditor?.deletePolyCurbPoint?.() },
      { selected: () => this.bezierWallEditor?.selectedAnchor, delete: () => this.bezierWallEditor?.deleteSelectedPoint?.() },
      { selected: () => this.bezierWallEditor?.selectedHandle },
    ];

    return featureActions.find(action => action.selected()) ?? null;
  }

  _applySnapshot(snap) {
    // Deselect everything
    this.deselectCheckpoint();
    this.hillEditor.deselect();
    this.squareHillEditor.deselect();
    this.terrainShapeEditor.deselect();
    this.normalMapDecalEditor.deselect();
    this.obstacleEditor.deselect();
    this.decorationsEditor.deselect();
    this.trackSignEditor.deselect();
    this.actionZoneEditor.deselect();
    this.bridgeEditor.deselect();
    this.aiPathEditor.deselect();
    this.terrainPathEditor.deselect();

    // Clear all gizmo meshes (keeps materials alive for re-use)
    this.hillEditor.clearMeshes();
    this.squareHillEditor.clearMeshes();
    this.terrainShapeEditor.clearMeshes();
    this.normalMapDecalEditor.clearMeshes();
    this.obstacleEditor.clearMeshes();

    // Clear object editor meshes
    this.decorationsEditor.clearMeshes();
    this.trackSignEditor.clearMeshes();
    this.actionZoneEditor.clearMeshes();
    this.bridgeEditor.clearMeshes();

    // Restore editable track state
    const parsed = JSON.parse(snap);
    if (Array.isArray(parsed)) {
      this.currentTrack.features = parsed;
      this.currentTrack.wear = { ...DEFAULT_TERRAIN_WEAR_CONFIG };
    } else {
      this.currentTrack.features = parsed.features ?? [];
      this.currentTrack.wear = {
        ...DEFAULT_TERRAIN_WEAR_CONFIG,
        ...(parsed.wear ?? {}),
      };
    }

      // Rebuild terrain first so terrain-sampled visuals land at correct heights.
      window.rebuildTerrain?.();
      window.rebuildTerrainGrid?.();
      window.rebuildTerrainTexture?.();

      // Recreate gizmos + rebuild visuals.
      for (const feature of this.currentTrack.features) {
        if (feature.type === 'hill') this.hillEditor.createVisual(feature);
        else if (feature.type === 'squareHill') this.squareHillEditor.createVisual(feature);
        else if (feature.type === 'terrain') this.terrainShapeEditor.createVisual(feature);
        else if (feature.type === 'normalMapDecal') this.normalMapDecalEditor.createVisual(feature);
        else if (feature.type === 'obstacle') this.obstacleEditor.createVisual(feature);
        else if (feature.type === 'flag' || feature.type === 'bannerString') this.decorationsEditor.createVisual(feature);
        else if (feature.type === 'trackSign') this.trackSignEditor.createVisual(feature);
        else if (feature.type === 'actionZone') this.actionZoneEditor.createVisual(feature);
        else if (feature.type === 'bridge') this.bridgeEditor.createVisual(feature);
      }
      // Restore AI path waypoint gizmos
      this.aiPathEditor.onSnapshotRestored(this.currentTrack);
      // Restore terrain path gizmos
      this.terrainPathEditor.onSnapshotRestored(this.currentTrack);
      this._syncAiPathPanel();

      // Restore mesh grid gizmos
      this.meshGridEditor?.onSnapshotRestored();
      // Restore poly wall gizmos
      this.polyWallEditor?.onSnapshotRestored();
      // Restore poly hill gizmos
      this.polyHillEditor?.onSnapshotRestored();
      window.rebuildPolyHill?.(null);
      // Restore bezier wall gizmos
      this.bezierWallEditor?.onSnapshotRestored();
      window.rebuildBezierWall?.(null);
      // Restore poly curb gizmos
      this.polyCurbEditor?.onSnapshotRestored();
      window.rebuildPolyCurb?.(null);
      window.rebuildBridge?.(null);
      // Checkpoints are managed by CheckpointManager — rebuild from features
      this.checkpointEditor.rebuildFromFeatures();

    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
    window.rebuildTerrainTexture?.();
    window.rebuildPolyWall?.(null);
  }

  undo() {
    if (this._undoStack.length === 0) return;
    this._redoStack.push(this._serializeSnapshot());
    this._applySnapshot(this._undoStack.pop());
    console.log('[Undo] stack remaining:', this._undoStack.length);
  }

  redo() {
    if (this._redoStack.length === 0) return;
    this._undoStack.push(this._serializeSnapshot());
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
      if (this._editorStore?.selectedType === 'surfaceDecal') {
        this.closeSurfaceDecalStamp();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (this._editorStore?.selectedType === 'aiPath') {
        this.closeAiPath();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (this._editorStore?.selectedType === 'terrainPath') {
        this.closeTerrainPath();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (this._editorStore?.selectedType === 'obstacle') {
        this.closeObstacle();
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
      this._getSelectedFeatureActions()?.duplicate?.();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    
    // Handle Delete key
    if (event.key === 'Delete' || event.key === 'Backspace') {
      this._getSelectedFeatureActions()?.delete?.();
      event.preventDefault();
      return;
    }
    
    // Handle Space key for add menu
    if (event.key === ' ') {
      this.toggleAddMenu();
      event.preventDefault();
      return;
    }

    // Handle P key — open AI path editor
    if (event.key.toLowerCase() === 'p' && !event.ctrlKey && !event.metaKey) {
      this.openAiPath();
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

    // Intercept Q/E for surface decal rotation before camera rotation
    if (this.surfaceDecalEditor?.onKeyDown(event)) {
      event.preventDefault();
      return;
    }

    // Delegate [ / ] to mesh grid editor for height adjustment
    if (this.meshGridEditor?.onKeyDown(event)) {
      event.preventDefault();
      return;
    }

    const key = event.key.toLowerCase();
    if (this._setMovementKeyState(key, true)) {
      event.preventDefault();
      return;
    }

    if (key === 'shift') {
      this.keys.fast = true;
      event.preventDefault();
      return;
    }
  }

  handleKeyUp(event) {
    if (!this.isActive) return;
    
    const key = event.key.toLowerCase();
    if (this._setMovementKeyState(key, false)) {
      return;
    }

    if (key === 'shift') {
      this.keys.fast = false;
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
    const now = performance.now();
    const selection = this._getActiveSelectionInteraction();
    const hasSelection = !!selection;

    const speed = this.keys.fast ? this.fastSpeed : this.moveSpeed;
    const movement = new Vector3(0, 0, 0);
    
    // Calculate forward and right vectors from camera
    const forward = this.camera.getTarget().subtract(this.camera.position);
    forward.y = 0;
    forward.normalize();
    
    const right = Vector3.Cross(forward, Vector3.Up());
    right.normalize();

    const moveKeyActive = (key) => hasSelection ? this._shouldConsumeRepeatingKey(key, now) : this.keys[key];
    
    // Apply movement
    if (moveKeyActive('forward')) {
      movement.addInPlace(forward.scale(speed));
    }
    if (moveKeyActive('back')) {
      movement.addInPlace(forward.scale(-speed));
    }
    if (moveKeyActive('left')) {
      movement.addInPlace(right.scale(-speed));
    }
    if (moveKeyActive('right')) {
      movement.addInPlace(right.scale(speed));
    }
    if (moveKeyActive('up')) {
      movement.y += speed;
    }
    if (moveKeyActive('down')) {
      movement.y -= speed;
    }

    const currentTarget = this.camera.getTarget();
    let delta
    if (selection) {
      if (selection.rotateLeft && moveKeyActive('rotateLeft')) {
        this.saveSnapshot(true);
        selection.rotateLeft(this.keys.fast);
      }
      if (selection.rotateRight && moveKeyActive('rotateRight')) {
        this.saveSnapshot(true);
        selection.rotateRight(this.keys.fast);
      }

      delta = selection.move(movement);
    } else {
      // Move camera and target together
      delta = movement;
    }
    delta.y = movement.y;
    this.camera.position.addInPlace(delta);
    this.camera.setTarget(currentTarget.add(delta));
  }

  handlePointerEvent(pointerInfo) {
    if (!this.isActive) return;

    if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
      const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
      const clickedMesh = pickResult?.pickedMesh ?? null;
      const wasSelectedTarget = this._isSelectedGizmoTarget(clickedMesh);

      this._clearDragHoldTimer();
      this.handlePointerDown(pointerInfo);

      if (pickResult?.pickedMesh && this._hasDraggableSelection() && this._isSelectedGizmoTarget(pickResult.pickedMesh)) {
        this._dragHoldTarget = clickedMesh;
        this._dragHoldTimer = setTimeout(() => {
          if (!this.isActive || this._dragHoldTarget !== clickedMesh) return;
          if (!this._beginSelectedGizmoDrag()) {
            this._clearDragHoldTimer();
            return;
          }
          this._clearDragHoldTimer();
        }, this._dragHoldDelayMs);
      }
      return;
    }

    if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
      if (!this._mouseDrag || !this._hasDraggableSelection()) return;
      const world = this._pointerWorldXZ();
      if (!world) return;

      const dx = world.x - this._mouseDrag.x;
      const dz = world.z - this._mouseDrag.z;
      this._mouseDrag = world;

      if (this._aiPathMouseDownSelectedWaypoint) {
        this._aiPathMouseDownMoved = true;
      }

      if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return;
      this._moveSelectedByPointerDelta(dx, dz);
      return;
    }

    if (pointerInfo.type === PointerEventTypes.POINTERUP) {
      this._clearDragHoldTimer();
      if (this._aiPathMouseDownSelectedWaypoint && !this._aiPathMouseDownMoved) {
        if (this._aiPathMouseDownType === 'terrainPath') {
          this.closeTerrainPath();
        } else {
          this.closeAiPath();
        }
      }
      this._aiPathMouseDownSelectedWaypoint = null;
      this._aiPathMouseDownMoved = false;
      this._aiPathMouseDownType = null;
      this._mouseDrag = null;
      this.polyWallEditor?.endDrag?.();
      this.polyHillEditor?.endDrag?.();
      this.polyCurbEditor?.endDrag?.();
      this.bezierWallEditor?.endDrag?.();
    }
  }

  _pointerWorldXZ() {
    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
    if (pick?.hit && pick.pickedPoint) {
      return { x: pick.pickedPoint.x, z: pick.pickedPoint.z };
    }

    const ray = this.scene.createPickingRay(
      this.scene.pointerX,
      this.scene.pointerY,
      undefined,
      this.camera
    );
    const dirY = ray.direction.y;
    if (Math.abs(dirY) < 1e-6) return null;
    const t = -ray.origin.y / dirY;
    if (t < 0) return null;
    return {
      x: ray.origin.x + ray.direction.x * t,
      z: ray.origin.z + ray.direction.z * t,
    };
  }

  _hasDraggableSelection() {
    return !!this._getActiveSelectionInteraction();
  }

  _clearDragHoldTimer() {
    if (this._dragHoldTimer) {
      clearTimeout(this._dragHoldTimer);
      this._dragHoldTimer = null;
    }
    this._dragHoldTarget = null;
  }

  _beginSelectedGizmoDrag() {
    const world = this._pointerWorldXZ();
    if (!world || !this._hasDraggableSelection()) return false;

    this._mouseDrag = { x: world.x, z: world.z };
    this.polyWallEditor?.beginDrag?.();
    this.polyHillEditor?.beginDrag?.();
    this.polyCurbEditor?.beginDrag?.();
    this.bezierWallEditor?.beginDrag?.();
    return true;
  }

  _isSelectedGizmoTarget(clickedMesh) {
    if (!clickedMesh) return false;

    const meshMatches = (mesh) => {
      if (!mesh) return false;
      if (mesh === clickedMesh) return true;
      if (typeof clickedMesh.isDescendantOf === 'function' && clickedMesh.isDescendantOf(mesh)) return true;
      if (typeof mesh.isDescendantOf === 'function' && mesh.isDescendantOf(clickedMesh)) return true;
      return false;
    };

    const selectedObjectMatches = (selected) => {
      if (!selected) return false;
      if (typeof selected.containsMesh === 'function' && selected.containsMesh(clickedMesh)) return true;
      return meshMatches(selected.mesh)
        || meshMatches(selected.node)
        || meshMatches(selected.sphere)
        || meshMatches(selected.handle)
        || meshMatches(selected.flag);
    };

    const selectedEditors = [
      [this.checkpointEditor, 'selected'],
      [this.hillEditor, 'selected'],
      [this.squareHillEditor, 'selected'],
      [this.terrainShapeEditor, 'selected'],
      [this.normalMapDecalEditor, 'selected'],
      [this.obstacleEditor, 'selected'],
      [this.trackSignEditor, 'selected'],
      [this.actionZoneEditor, '_selected'],
      [this.bridgeEditor, 'selected'],
      [this.decorationsEditor, '_selected'],
      [this.aiPathEditor, 'selected'],
      [this.terrainPathEditor, 'selected'],
    ];

    for (const [editor, selectedKey] of selectedEditors) {
      const selected = editor?.[selectedKey];
      if (selected && (editor?.findByMesh?.(clickedMesh) === selected || selectedObjectMatches(selected))) {
        return true;
      }
    }

    if (selectedObjectMatches(this.meshGridEditor?.selectedPoint)) return true;
    if (selectedObjectMatches(this.polyWallEditor?.selectedPoint)) return true;
    if (selectedObjectMatches(this.polyHillEditor?.selectedPoint)) return true;
    if (selectedObjectMatches(this.polyCurbEditor?.selectedPoint)) return true;
    if (selectedObjectMatches(this.bezierWallEditor?.selectedAnchor)) return true;
    if (selectedObjectMatches(this.bezierWallEditor?.selectedHandle)) return true;

    const zoneData = this.actionZoneEditor?._selected;
    if (zoneData) {
      if (meshMatches(zoneData.handle)) return true;
      if (zoneData.feature.shape === 'polygon' && this.actionZoneEditor._selectedPointIndex >= 0) {
        if (meshMatches(zoneData.pointHandles?.[this.actionZoneEditor._selectedPointIndex])) return true;
      }
    }

    return false;
  }

  _moveSelectedByPointerDelta(dx, dz) {
    this._getActiveSelectionInteraction()?.moveByPointerDelta?.(dx, dz);
  }

  _handleMeshSelection(clickedMesh, editor, selectFn = null) {
    const featureData = editor.findByMesh(clickedMesh);
    if (!featureData) return false;
    const wasSelected = editor.selected === featureData;
    if (!wasSelected) {
      this.deselectAll();
      (selectFn ?? ((data) => editor.select(data)))(featureData);
    }
    return true;
  }

  _handleWaypointSelection(clickedMesh, pickedPoint, editor, selectedType) {
    if (clickedMesh) {
      const waypoint = editor.findByMesh(clickedMesh);
      if (waypoint) {
        if (editor.selected === waypoint) {
          this._aiPathMouseDownSelectedWaypoint = clickedMesh;
          this._aiPathMouseDownMoved = false;
          this._aiPathMouseDownType = selectedType;
          if (this._editorStore) this._editorStore.selectedType = selectedType;
          return true;
        }

        this.deselectAll();
        editor.select(waypoint);
        if (this._editorStore) this._editorStore.selectedType = selectedType;
        return true;
      }
    }

    if (pickedPoint) {
      editor.addPoint(pickedPoint.x, pickedPoint.z);
      return true;
    }

    return false;
  }

  handlePointerDown(pointerInfo) {
    if (!this.isActive) return;
    
    if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
      const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
      const wasSelectedTarget = this._isSelectedGizmoTarget(pickResult?.pickedMesh ?? null);

      if (wasSelectedTarget) {
        return;
      }

      // Surface decal stamp mode: click to stamp.
      if (this._editorStore?.selectedType === 'surfaceDecal') {
        if (pickResult.hit && pickResult.pickedPoint) {
          this.surfaceDecalEditor.stamp(pickResult.pickedPoint.x, pickResult.pickedPoint.z);
        }
        return;
      }

      // AI path panel open: click terrain to add waypoints, click existing point to select it.
      if (this._editorStore?.selectedType === 'aiPath') {
        if (this._handleWaypointSelection(pickResult.pickedMesh, pickResult.pickedPoint, this.aiPathEditor, 'aiPath')) return;
        return;
      }

      // Terrain path panel open: click terrain to add waypoints, click existing point to select it.
      if (this._editorStore?.selectedType === 'terrainPath') {
        if (this._handleWaypointSelection(pickResult.pickedMesh, pickResult.pickedPoint, this.terrainPathEditor, 'terrainPath')) return;
        return;
      }

      if (pickResult.hit && pickResult.pickedMesh) {
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

        const clickHandlers = [
          { editor: this.checkpointEditor },
          { editor: this.hillEditor },
          { editor: this.squareHillEditor },
          { editor: this.terrainShapeEditor },
          { editor: this.normalMapDecalEditor },
          { editor: this.obstacleEditor },
          { editor: this.decorationsEditor },
          { editor: this.trackSignEditor },
          { editor: this.actionZoneEditor },
          { editor: this.bridgeEditor },
        ];

        for (const handler of clickHandlers) {
          if (this._handleMeshSelection(clickedMesh, handler.editor, handler.selectFn)) return;
        }

        // Check if clicked mesh is an AI path waypoint
        {
          const wpData = this.aiPathEditor.findByMesh(clickedMesh);
          if (wpData) {
            if (this.aiPathEditor.selected === wpData) {
              this._aiPathMouseDownSelectedWaypoint = clickedMesh;
              this._aiPathMouseDownMoved = false;
              this._aiPathMouseDownType = 'aiPath';
              if (this._editorStore) this._editorStore.selectedType = 'aiPath';
              return;
            }
            this.deselectAll();
            this.aiPathEditor.select(wpData);
            if (this._editorStore) this._editorStore.selectedType = 'aiPath';
            return;
          }
        }

        // Check if clicked mesh is a terrain path waypoint
        {
          const wpData = this.terrainPathEditor.findByMesh(clickedMesh);
          if (wpData) {
            if (this.terrainPathEditor.selected === wpData) {
              this._aiPathMouseDownSelectedWaypoint = clickedMesh;
              this._aiPathMouseDownMoved = false;
              this._aiPathMouseDownType = 'terrainPath';
              if (this._editorStore) this._editorStore.selectedType = 'terrainPath';
              return;
            }
            this.deselectAll();
            this.terrainPathEditor.select(wpData);
            if (this._editorStore) this._editorStore.selectedType = 'terrainPath';
            return;
          }
        }

        if (this._editorStore?.obstacle?.placementActive) {
          if (pickResult.pickedPoint) {
            this.addObstacleAt(pickResult.pickedPoint.x, pickResult.pickedPoint.z);
          }
          return;
        }

        // Clicked on something else (terrain, etc.) — deselect all
        this.deselectAll();
      } else {
        if (this._editorStore?.obstacle?.placementActive) {
          if (pickResult.hit && pickResult.pickedPoint) {
            this.addObstacleAt(pickResult.pickedPoint.x, pickResult.pickedPoint.z);
          }
          return;
        }

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
  changeHillRadiusX(val) { this.hillEditor.changeRadiusX(val); }
  changeHillRadiusZ(val) { this.hillEditor.changeRadiusZ(val); }
  changeHillRotation(val) { this.hillEditor.changeAngle(val); }
  changeHillHeight(val) { this.hillEditor.changeHeight(val); }
  changeHillWaterLevelOffset(val) { this.hillEditor.changeWaterLevelOffset(val); }
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

  changeTrackBorderTerrain(name) {
    const key = Object.keys(TERRAIN_TYPES).find(k => TERRAIN_TYPES[k].name === name);
    if (!key) return;
    this.saveSnapshot();
    this.currentTrack.borderTerrainType = TERRAIN_TYPES[key];
    window.rebuildTerrainGrid?.();
    window.rebuildTerrainTexture?.();
    window.rebuildNormalMap?.();
  }

  changeSquareHillWidth(val)        { this.squareHillEditor.changeWidth(val); }
  changeSquareHillDepth(val)        { this.squareHillEditor.changeDepth(val); }
  changeSquareHillTransition(val)   { this.squareHillEditor.changeTransition(val); }
  changeSquareHillAngle(val)        { this.squareHillEditor.changeAngle(val); }
  changeSquareHillHeight(val)       { this.squareHillEditor.changeHeight(val); }
  changeSquareHillWaterLevelOffset(val) { this.squareHillEditor.changeWaterLevelOffset(val); }
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

  // ─── Obstacle Editing (delegated to ObstacleEditor) ─────────────────────

  addObstacleEntity() {
    this.deselectAll();
    if (this._editorStore) {
      this._editorStore.selectedType = 'obstacle';
      this._editorStore.obstacle.placementActive = true;
    }
    this.hideAddMenu();
  }
  addObstacleAt(x, z) {
    this.obstacleEditor.addEntityAt(x, z);
  }
  changeObstacleType(val) {
    this.obstacleEditor.changeType(val);
  }
  changeObstacleScale(val) {
    this.obstacleEditor.changeScale(val);
  }
  changeObstacleRotation(val) {
    this.obstacleEditor.changeRotation(val);
  }
  changeObstacleWeight(val) {
    this.obstacleEditor.changeWeight(val);
  }
  changeObstacleColor(val) {
    this.obstacleEditor.changeColor(val);
  }
  resetObstacleDefaults() {
    this.obstacleEditor.resetToDefaults();
  }
  setObstaclePlacementActive(active) {
    this.obstacleEditor.setPlacementActive(active);
  }
  closeObstacle() {
    if (this._editorStore) {
      this._editorStore.obstacle.placementActive = false;
      if (this._editorStore.selectedType === 'obstacle') this._editorStore.selectedType = null;
    }
    this.obstacleEditor.deselect();
  }
  createObstacleVisual(f)          { return this.obstacleEditor.createVisual(f); }
  updateObstacleVisual(d)          { this.obstacleEditor.updateVisual(d); }
  selectObstacle(d)                { this.obstacleEditor.select(d); }
  deselectObstacle()               { this.obstacleEditor.deselect(); }
  moveSelectedObstacle(movement)   { return this.obstacleEditor.move(movement); }
  deleteSelectedObstacle()         { this.obstacleEditor.deleteSelectedObstacle(); }
  duplicateSelectedObstacle()      { this.obstacleEditor.duplicateSelected(); }

  get selectedObstacle()           { return this.obstacleEditor.selected; }

  // ─── Decorations Editing (flags + banner strings) ────────────────────────

  addDecorationEntity()            { this.decorationsEditor.addEntity(); }
  duplicateSelectedDecoration()    { return this.decorationsEditor.duplicateSelected(); }
  deleteSelectedDecoration()       { return this.decorationsEditor.deleteSelected(); }
  deselectDecoration()             { this.decorationsEditor.deselect(); }
  changeDecorationType(val)        { if (this._editorStore) this._editorStore.decoration.type = val; this.decorationsEditor.changeType(val); }
  changeDecorationColor(val)       { this.decorationsEditor.changeColor(val); }
  changeDecorationWidth(val)       { this.decorationsEditor.changeWidth(val); }
  changeDecorationPoleHeight(val)  { this.decorationsEditor.changePoleHeight(val); }
  changeDecorationHeading(val)     { this.decorationsEditor.changeHeading(val); }

  deselectAll() {
    this._clearDragHoldTimer();
    this.checkpointEditor.deselect();
    this.hillEditor.deselect();
    this.squareHillEditor.deselect();
    this.terrainShapeEditor.deselect();
    this.normalMapDecalEditor.deselect();
    this.obstacleEditor.deselect();
    this.decorationsEditor.deselect();
    this.trackSignEditor.deselect();
    this.actionZoneEditor.deselect();
    this.bridgeEditor?.deselect();
    this.aiPathEditor?.deselect();
    this.terrainPathEditor?.deselect();
    this.meshGridEditor?.deselectPoint();
    this.polyWallEditor?.deselectPoint();
    this.polyHillEditor?.deselectPoint();
    this.bezierWallEditor?.deselectAll();
    this.polyCurbEditor?.deselectPolyCurb();
  }

  // ── Poly Wall Vue bridge methods ──
  changePolyWallRadius(val)          { this.polyWallEditor.changePolyWallRadius(val); }
  changePolyWallHeight(val)          { this.polyWallEditor.changePolyWallHeight(val); }
  changePolyWallCollisionHeight(val) { this.polyWallEditor.changePolyWallCollisionHeight(val); }
  changePolyWallThickness(val)       { this.polyWallEditor.changePolyWallThickness(val); }
  changePolyWallClosed(val)          { this.polyWallEditor.changePolyWallClosed(val); }
  changePolyWallStyle(val)           { this.polyWallEditor.changePolyWallStyle(val); }
  insertPolyWallPoint()         { this.polyWallEditor.insertPolyWallPoint(); }
  deletePolyWallPoint()         { this.polyWallEditor.deleteSelectedPoint(); }
  deletePolyWall()              { this.polyWallEditor.deletePolyWall(); }
  duplicatePolyWall()           { this.polyWallEditor.duplicatePolyWall(); }
  deselectPolyWall()            { this.polyWallEditor.deselectPoint(); }

  // ── Poly Hill Vue bridge methods ──
  changePolyHillRadius(val)     { this.polyHillEditor.setPointRadius(val); }
  changePolyHillHeight(val)     { this.polyHillEditor.setHeight(val); }
  changePolyHillWidth(val)      { this.polyHillEditor.setWidth(val); }
  changePolyHillTerrainType(val){ this.polyHillEditor.setTerrainType(val); }
  changePolyHillClosed(val)     { this.polyHillEditor.setClosed(val); }
  changePolyHillFilled(val)     { this.polyHillEditor.setFilled(val); }
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
  changeFlagColor(val) { this.decorationsEditor.changeColor(val); }
  deleteFlag()         { this.decorationsEditor.deleteSelected(); }
  duplicateFlag()      { this.decorationsEditor.duplicateSelected(); }

  // ── Track Sign Vue bridge methods ──
  addTrackSignEntity()         { this.trackSignEditor.addEntity(); }
  deselectTrackSign()          { this.trackSignEditor.deselect(); }
  changeTrackSignName(val)     { this.trackSignEditor.changeName(val); }
  changeTrackSignRotation(val) { this.trackSignEditor.changeRotation(val); }
  changeTrackSignContentType(val) { this.trackSignEditor.changeContentType(val); }
  changeTrackSignBrandImage(val) { this.trackSignEditor.changeBrandImage(val); }
  changeTrackSignBackground(val) { this.trackSignEditor.changeBackground(val); }
  changeTrackSignScale(val) { this.trackSignEditor.changeScale(val); }
  changeTrackSignHeightOffset(val) { this.trackSignEditor.changeHeightOffset(val); }
  changeTrackSignWidth(val) { this.trackSignEditor.changeWidth(val); }
  deleteTrackSign()            { this.trackSignEditor.deleteSelected(); }
  duplicateTrackSign()         { this.trackSignEditor.duplicateSelected(); }

  // ── Banner String Vue bridge methods ──
  addBannerStringEntity()         { this.decorationsEditor.addEntity(); }
  deselectBannerString()          { this.decorationsEditor.deselect(); }
  changeBannerStringWidth(val)    { this.decorationsEditor.changeWidth(val); }
  changeBannerStringPoleHeight(val) { this.decorationsEditor.changePoleHeight(val); }
  changeBannerStringHeading(val)  { this.decorationsEditor.changeHeading(val); }
  deleteBannerString()            { this.decorationsEditor.deleteSelected(); }
  duplicateBannerString()         { this.decorationsEditor.duplicateSelected(); }

  // ── Action Zone Vue bridge methods ──
  addActionZoneEntity()           { this.actionZoneEditor.addEntity(); }
  addBridgeEntity()               { this.bridgeEditor.addEntity(); }
  deselectActionZone()            { this.actionZoneEditor.deselect(); }
  changeActionZoneRadius(val)     { this.actionZoneEditor.changeRadius(val); }
  changeActionZoneType(val)       { this.actionZoneEditor.changeZoneType(val); }
  changeActionZoneShape(val)      { this.actionZoneEditor.changeShape(val); }
  insertActionZonePoint()         { this.actionZoneEditor.insertPoint(); }
  deleteActionZonePoint()         { this.actionZoneEditor.deletePoint(); }
  deleteActionZone()              { this.actionZoneEditor.deleteSelected(); }
  duplicateActionZone()           { this.actionZoneEditor.duplicateSelected(); }

  // ── Poly Curb Vue bridge methods ──
  changePolyCurbRadius(val)  { this.polyCurbEditor?.changePolyCurbRadius(val); }
  changePolyCurbHeight(val)  { this.polyCurbEditor?.changePolyCurbHeight(val); }
  changePolyCurbWidth(val)   { this.polyCurbEditor?.changePolyCurbWidth(val); }
  changePolyCurbClosed(val)  { this.polyCurbEditor?.changePolyCurbClosed(val); }
  changePolyCurbStyle(val)   { this.polyCurbEditor?.changePolyCurbStyle(val); }
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
  changeBridgeMaterialType(val) { this.bridgeEditor?.changeMaterialType(val); }
  changeBridgeTransitionEnabled(val) { this.bridgeEditor?.changeTransitionEnabled(val); }
  changeBridgeTransitionDepth(val)   { this.bridgeEditor?.changeTransitionDepth(val); }
  changeBridgeCollisionEndCaps(val)         { this.bridgeEditor?.changeCollisionEndCaps(val); }
  changeBridgeCollisionEndCapsOnDepth(val)  { this.bridgeEditor?.changeCollisionEndCapsOnDepth(val); }
  changeBridgeCollisionEndCapsOnWidth(val)  { this.bridgeEditor?.changeCollisionEndCapsOnWidth(val); }
  changeBridgeCollisionEndCapThickness(val) { this.bridgeEditor?.changeCollisionEndCapThickness(val); }
  changeBridgeCollisionEndCapDrop(val)      { this.bridgeEditor?.changeCollisionEndCapDrop(val); }
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

  // ── Surface Decal helper methods ──────────────────────────────────────────
  setSurfaceDecalManager(manager) {
    this.surfaceDecalEditor.setDecalManager(manager);
  }

  openSurfaceDecalStamp() {
    this.surfaceDecalEditor.open();
  }

  closeSurfaceDecalStamp() {
    this.surfaceDecalEditor.close();
  }

  setSurfaceDecalType(val) { this.surfaceDecalEditor.setType(val); }
  setSurfaceDecalRandomRotation(val) { this.surfaceDecalEditor.setRandomRotation(val); }
  setSurfaceDecalAngle(val) { this.surfaceDecalEditor.setAngle(val); }
  setSurfaceDecalOpacity(val) { this.surfaceDecalEditor.setOpacity(val); }
  setSurfaceDecalWidth(val) { this.surfaceDecalEditor.setWidth(val); }
  setSurfaceDecalDepth(val) { this.surfaceDecalEditor.setDepth(val); }

  // ── AI Path helper methods ───────────────────────────────────────────────
  openAiPath() {
    if (this._editorStore) {
      this._editorStore.selectedType = 'aiPath';
      this.aiPathEditor.deselect();
      this._syncAiPathPanel();
    }
  }

  closeAiPath() {
    this.aiPathEditor.deselect();
    if (this._editorStore) this._editorStore.selectedType = null;
  }

  // ── AI Path Vue bridge methods ────────────────────────────────────────────
  addAiWaypointEntity() {
    // Place new waypoint at the camera's look-at target
    const target = this.camera.getTarget();
    this.aiPathEditor.addPoint(target.x, target.z);
    this.hideAddMenu();
    this._syncAiPathPanel();
  }
  deleteAiWaypoint()   { this.aiPathEditor.deleteSelected(); }
  clearAiPath()        { this.aiPathEditor.clearAll(); }
  deselectAiWaypoint() { this.aiPathEditor.deselect(); }
  changeAiPathWearEnabled(val)      { this._updateAiPathWear({ enabled: !!val }, false); }
  changeAiPathWearWidth(val)        { this._updateAiPathWear({ width: val }, true); }
  changeAiPathWearIntensity(val)    { this._updateAiPathWear({ intensity: val }, true); }
  changeAiPathWearLaneSpacing(val)  { this._updateAiPathWear({ laneSpacing: val }, true); }
  changeAiPathWearAlphaBreakup(val)    { this._updateAiPathWear({ alphaBreakup: val }, true); }
  changeAiPathWearPathWander(val)      { this._updateAiPathWear({ pathWander: val }, true); }
  changeAiPathWearEdgeSoftness(val) { this._updateAiPathWear({ edgeSoftness: val }, true); }
  changeAiPathWearSecondaryPathCount(val) { this._updateAiPathWear({ secondaryPathCount: Math.max(0, Math.round(val)) }, true); }
  changeAiPathWearSecondaryPathStrength(val) { this._updateAiPathWear({ secondaryPathStrength: val }, true); }
  changeAiPathWearSecondaryPathSpacing(val) { this._updateAiPathWear({ secondaryPathSpacing: val }, true); }

  // ── Terrain Path helper methods ──────────────────────────────────────────
  openTerrainPath() {
    if (this._editorStore) {
      this._editorStore.selectedType = 'terrainPath';
      this.terrainPathEditor.deselect();
    }
  }

  closeTerrainPath() {
    this.terrainPathEditor.deselect();
    if (this._editorStore) this._editorStore.selectedType = null;
  }

  // ── Terrain Path Vue bridge methods ──────────────────────────────────────
  addTerrainPathEntity() {
    this.terrainPathEditor.createNewPath();
    if (this._editorStore) this._editorStore.selectedType = 'terrainPath';
    this.hideAddMenu();
    this._syncTerrainPathPanel();
  }
  deleteTerrainPathWaypoint()   { this.terrainPathEditor.deleteSelected(); }
  clearTerrainPath()            { this.terrainPathEditor.clearActivePath(); }
  changeTerrainPathWidth(val)          { this.terrainPathEditor.changeWidth(val); }
  changeTerrainPathCornerRadius(val)   { this.terrainPathEditor.changeCornerRadius(val); }
  changeTerrainPathTerrainType(name)   { this.terrainPathEditor.changeTerrainType(name); }

  _syncTerrainPathPanel() {
    const s = this._editorStore;
    if (!s || !this.terrainPathEditor.activeFeature) return;
    const f = this.terrainPathEditor.activeFeature;
    s.terrainPath.width        = f.width ?? 8;
    s.terrainPath.cornerRadius = f.cornerRadius ?? 0;
    s.terrainPath.terrainType  = f.terrainType?.name ?? 'mud';
  }

  /**
   * Dispose of the controller
   */
  dispose() {
    this.deactivate();
  }

  toggleGizmosVisible() {
    this.setGizmosVisible(!this.gizmosVisible);
  }

  setGizmosVisible(visible) {
    this.gizmosVisible = visible;
    if (this._editorStore) this._editorStore.gizmosVisible = visible;

    const setMeshVisibility = (item, props) => {
      for (const prop of props) {
        const mesh = item?.[prop];
        if (mesh && typeof mesh.isVisible === 'boolean') mesh.isVisible = visible;
      }
    };

    const setListVisibility = (items, props) => {
      for (const item of items || []) setMeshVisibility(item, props);
    };

    // The highlight mesh for hills and square hills is selected-only,
    // so do not force all of those meshes visible on a global gizmo toggle.
    setListVisibility(this.hillEditor?.meshes, ['node', 'sphere']);
    setListVisibility(this.squareHillEditor?.meshes, ['node', 'sphere']);
    setListVisibility(this.terrainShapeEditor?.meshes, ['node', 'mesh']);
    setListVisibility(this.normalMapDecalEditor?.meshes, ['node', 'mesh']);
    setListVisibility(this.obstacleEditor?.meshes, ['node', 'mesh']);
    setListVisibility(this.bridgeEditor?.meshes, ['node', 'sphere']);

    if (this.checkpointManager) {
      for (const cp of this.checkpointManager.checkpointMeshes || []) {
        if (cp.handle) cp.handle.isVisible = visible;
      }
    }

    if (this.meshGridEditor) {
      for (const p of this.meshGridEditor.pointMeshes || []) {
        if (p.mesh) p.mesh.isVisible = visible;
      }
      if (this.meshGridEditor.lineSystem) this.meshGridEditor.lineSystem.isVisible = visible;
    }

    if (this.actionZoneEditor) {
      for (const z of this.actionZoneEditor.zones || []) {
        if (z.cyl) z.cyl.isVisible = visible;
        if (z.handle) z.handle.isVisible = visible;
        for (const p of z.pointHandles || []) {
          if (p) p.isVisible = visible;
        }
        if (z.lineSystem) z.lineSystem.isVisible = visible;
      }
    }

    if (this.polyWallEditor) {
      for (const wg of this.polyWallEditor._wallGizmos || []) {
        for (const m of wg.pointMeshes || []) {
          if (m) m.isVisible = visible;
        }
        if (wg.lineSystem) wg.lineSystem.isVisible = visible;
      }
    }

    if (this.polyHillEditor) {
      for (const hg of this.polyHillEditor._hillGizmos || []) {
        for (const m of hg.pointMeshes || []) {
          if (m) m.isVisible = visible;
        }
        if (hg.lineSystem) hg.lineSystem.isVisible = visible;
      }
    }

    if (this.polyCurbEditor) {
      for (const cg of this.polyCurbEditor._curbGizmos || []) {
        for (const m of cg.pointMeshes || []) {
          if (m) m.isVisible = visible;
        }
        if (cg.lineSystem) cg.lineSystem.isVisible = visible;
      }
    }

    if (this.bezierWallEditor) {
      for (const wg of this.bezierWallEditor._wallGizmos || []) {
        for (const m of wg.anchorMeshes || []) {
          if (m) m.isVisible = visible;
        }
        for (const hm of wg.handleMeshes || []) {
          if (hm?.mesh) hm.mesh.isVisible = visible;
        }
        if (wg.lineSystem) wg.lineSystem.isVisible = visible;
      }
    }

    if (this.aiPathEditor) {
      for (const h of this.aiPathEditor.handles || []) {
        if (h.mesh) h.mesh.isVisible = visible;
      }
      if (this.aiPathEditor.lineMesh) this.aiPathEditor.lineMesh.isVisible = visible;
    }

    if (this.terrainPathEditor) {
      for (const h of this.terrainPathEditor.handles || []) {
        if (h.mesh) h.mesh.isVisible = visible;
      }
      for (const lm of this.terrainPathEditor.lineMeshes?.values() ?? []) {
        lm.isVisible = visible;
      }
    }

    if (this.hillEditor?.selected?.mesh) {
      this.hillEditor.selected.mesh.isVisible = visible;
    }
    if (this.squareHillEditor?.selected?.mesh) {
      this.squareHillEditor.selected.mesh.isVisible = visible;
    }
  }
}
