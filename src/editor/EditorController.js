import { Vector3, PointerEventTypes, Tools } from "@babylonjs/core";
import rebuild from './editor-rebuild.js';
import { TerrainQuery } from "../managers/TerrainQuery.js";
import { MeshGridEditor } from "./MeshGridEditor.js";
import { PolyWallEditor } from "./PolyWallEditor.js";
import { PolyHillEditor } from "./PolyHillEditor.js";
import { HillEditor } from "./HillEditor.js";
import { CheckpointEditor } from "./CheckpointEditor.js";
import { SquareHillEditor } from "./SquareHillEditor.js";
import { TerrainShapeEditor } from "./TerrainShapeEditor.js";
import { ObstacleEditor } from "./ObstacleEditor.js";
import { DecorationsEditor } from "./DecorationsEditor.js";
import { TrackSignEditor } from "./TrackSignEditor.js";
import { ActionZoneEditor } from './ActionZoneEditor.js';
import { PolyCurbEditor } from './PolyCurbEditor.js';
import { BridgeMeshEditor } from './BridgeMeshEditor.js';
import { AiPathEditor } from './AiPathEditor.js';
import { TerrainPathEditor } from './TerrainPathEditor.js';
import { SurfaceDecalEditor } from './SurfaceDecalEditor.js';
import { scatterDirtChunks } from '../objects/DirtChunks.js';
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
    // Shadow generator from the built scene; set via setShadows so sub-editors
    // (e.g. tents) can register their meshes as shadow casters in the editor.
    this._shadows = null;
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

    // Feature sub-editors. Each is also listed in subEditors below, which
    // drives the shared lifecycle (activate / deselect / dispose-or-deactivate)
    // — adding a new editor means constructing it here and appending it there.
    this.hillEditor = new HillEditor(this);
    this.squareHillEditor = new SquareHillEditor(this);
    this.terrainShapeEditor = new TerrainShapeEditor(this);      // terrain rect + circle
    this.obstacleEditor = new ObstacleEditor(this);              // tire stacks
    this.decorationsEditor = new DecorationsEditor(this);        // flags + banner strings
    this.trackSignEditor = new TrackSignEditor(this);
    this.actionZoneEditor = new ActionZoneEditor(this);
    this.meshGridEditor = new MeshGridEditor(this);
    this.polyWallEditor = new PolyWallEditor(this);
    this.polyHillEditor = new PolyHillEditor(this);
    this.polyCurbEditor = new PolyCurbEditor(this);
    this.bridgeMeshEditor = new BridgeMeshEditor(this);          // elevated mesh grid
    this.aiPathEditor = new AiPathEditor(this);
    this.terrainPathEditor = new TerrainPathEditor(this);        // terrain-painted paths
    this.surfaceDecalEditor = new SurfaceDecalEditor(this);

    // Uniform-lifecycle list (activation order). checkpointEditor stays
    // outside: its gizmos belong to CheckpointManager, so it has no activate.
    this.subEditors = [
      this.hillEditor,
      this.squareHillEditor,
      this.terrainShapeEditor,
      this.obstacleEditor,
      this.decorationsEditor,
      this.trackSignEditor,
      this.actionZoneEditor,
      this.meshGridEditor,
      this.polyWallEditor,
      this.polyHillEditor,
      this.polyCurbEditor,
      this.bridgeMeshEditor,
      this.aiPathEditor,
      this.terrainPathEditor,
      this.surfaceDecalEditor,
    ];

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
    this._dragHoldStart = null;
    this._dragHoldDelayMs = 180;
    // Begin a gizmo drag once the pointer moves this many px from the press
    // point, so a quick click-and-drag engages without waiting out the hold
    // delay. Squared to compare against squared pixel distance.
    this._dragStartThresholdSq = 16;

    // Empty-terrain click defers its deselect to pointer-up so a click-drag can
    // pan the camera without dropping the current selection. Set by
    // handlePointerDown when a click hits nothing selectable; also the signal
    // that a drag from here should pan (never over a gizmo).
    this._pendingEmptyDeselect = false;
    // Mouse-drag camera pan (empty terrain) + wheel zoom.
    this._panState = null;        // { anchor:{x,z}, startX, startY, active }
    this._panPlaneY = 0;          // ground plane the grab point is projected onto
    this._wheelZoomStep = 0.12;   // fraction of view distance per wheel notch
    this._minCamHeight = 8;
    this._maxCamHeight = 400;

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
    
    // Activate every sub-editor (creates materials + initial gizmo visuals)
    for (const editor of this.subEditors) {
      editor.activate(this.scene, track);
    }

    // Wire Vue editor panels
    this._editorStore.setBridge(this);
    this.setGizmosVisible(true);
    this._syncTrackSettingsPanel();
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

    // Tear down every sub-editor. Some expose dispose() (destroys materials),
    // the rest deactivate() (releases scene refs); both fully release visuals.
    // References intentionally stay set — the controller itself is discarded
    // right after deactivation (EditorMode.teardown), so nulling them only
    // hid the uniform lifecycle behind optional-chaining noise.
    for (const editor of this.subEditors) {
      if (editor.dispose) editor.dispose();
      else editor.deactivate();
    }

    // Hide all editor panels via Vue store
    if (this._editorStore) {
      this._editorStore.addMenuOpen = false;
      this._editorStore.selectedType = null;
      this._editorStore.trackSettingsOpen = false;
      this._editorStore.setBridge(null);
    }
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
      name: this.currentTrack.name,
      id: this.currentTrack.id,
      width: this.currentTrack.width,
      depth: this.currentTrack.depth,
      defaultTerrainType: this.currentTrack.defaultTerrainType?.name ?? 'packed_dirt',
      borderTerrainType: this.currentTrack.borderTerrainType?.name ?? this.currentTrack.defaultTerrainType?.name ?? 'packed_dirt',
      features: this.currentTrack.features,
      wear: this.currentTrack.wear ?? null,
    });
  }

  _syncTrackSettingsPanel() {
    if (!this._editorStore || !this.currentTrack) return;
    this._editorStore.trackSettings.name = this.currentTrack.name ?? 'Untitled Track';
    this._editorStore.trackSettings.id = this.currentTrack.id ?? 'untitled-track';
    this._editorStore.trackSettings.width = this.currentTrack.width ?? 160;
    this._editorStore.trackSettings.depth = this.currentTrack.depth ?? 160;
    this._editorStore.trackSettings.hidden = this.currentTrack.hidden ?? true;
    this._editorStore.trackSettings.packId = this.currentTrack.packId ?? '';
    this._editorStore.trackSettings.dirtChunks = this.currentTrack.dirtChunks ?? true;
    this._editorStore.trackDefaultTerrain = this.currentTrack.defaultTerrainType?.name ?? 'packed_dirt';
    this._editorStore.trackBorderTerrain = this.currentTrack.borderTerrainType?.name ?? this._editorStore.trackDefaultTerrain;
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
    this._editorStore.aiPathWear.pathWander = wear.pathWander;
    this._editorStore.aiPathWear.edgeSoftness = wear.edgeSoftness;
    this._editorStore.aiPathWear.secondaryPathCount = wear.secondaryPathCount;
    this._editorStore.aiPathWear.secondaryPathStrength = wear.secondaryPathStrength;
    this._editorStore.aiPathWear.secondaryPathSpacing = wear.secondaryPathSpacing;

    const branchState = this.aiPathEditor?.getPanelState?.() ?? {
      editingMainPath: true,
      activeBranchId: null,
      activeBranchWeight: 1,
      branches: [],
    };
    this._editorStore.aiPathBranch.editingMainPath = !!branchState.editingMainPath;
    this._editorStore.aiPathBranch.activeBranchId = branchState.activeBranchId;
    this._editorStore.aiPathBranch.activeBranchWeight = branchState.activeBranchWeight ?? 1;
    this._editorStore.aiPathBranch.activeBranchFromMainIndex = branchState.activeBranchFromMainIndex ?? null;
    this._editorStore.aiPathBranch.activeBranchToMainIndex = branchState.activeBranchToMainIndex ?? null;
    this._editorStore.aiPathBranch.mainWaypointCount = branchState.mainWaypointCount ?? 0;
    this._editorStore.aiPathBranches = branchState.branches;
  }

  _updateAiPathWear(updates, debounce = true) {
    if (!this.currentTrack) return;
    this.saveSnapshot(debounce);
    Object.assign(this._getWearConfig(), updates);
    this._syncAiPathPanel();
    rebuild.terrainTexture?.(false, { grid: false, overlays: false });
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

    if (this.obstacleEditor.selected) {
      return this._createVectorSelectionInteraction(this.obstacleEditor, (fast) => (fast ? 5 : 1) * (Math.PI / 180));
    }

    if (this.decorationsEditor.selected) {
      return this._createVectorSelectionInteraction(this.decorationsEditor);
    }

    if (this.trackSignEditor.selected) {
      return this._createVectorSelectionInteraction(this.trackSignEditor, (fast) => (fast ? 5 : 1) * (Math.PI / 180));
    }

    if (this.surfaceDecalEditor.selected) {
      return this._createVectorSelectionInteraction(this.surfaceDecalEditor, (fast) => (fast ? 5 : 1) * (Math.PI / 180));
    }

    if (this.actionZoneEditor.selected) {
      return this._createVectorSelectionInteraction(this.actionZoneEditor);
    }

    if (this.bridgeMeshEditor?.selected) {
      return this._createVectorSelectionInteraction(this.bridgeMeshEditor);
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
      { selected: () => this.obstacleEditor.selected, duplicate: () => this.obstacleEditor.duplicateSelected(), delete: () => this.obstacleEditor.deleteSelected() },
      { selected: () => this.decorationsEditor.selected, duplicate: () => this.decorationsEditor.duplicateSelected(), delete: () => this.decorationsEditor.deleteSelected() },
      { selected: () => this.trackSignEditor.selected, duplicate: () => this.trackSignEditor.duplicateSelected(), delete: () => this.trackSignEditor.deleteSelected() },
      { selected: () => this.surfaceDecalEditor.selected, delete: () => this.surfaceDecalEditor.deleteSelected() },
      { selected: () => this.actionZoneEditor.selected, duplicate: () => this.actionZoneEditor.duplicateSelected(), delete: () => this.actionZoneEditor.deleteSelected() },
      { selected: () => this.aiPathEditor?.selected, delete: () => this.aiPathEditor?.deleteSelected?.() },
      { selected: () => this.terrainPathEditor?.selected, delete: () => this.terrainPathEditor?.deleteSelected?.() },
      { selected: () => this.meshGridEditor?.activeFeature, delete: () => this.meshGridEditor?.deleteMeshGrid?.() },
      { selected: () => this.bridgeMeshEditor?.activeFeature, delete: () => this.bridgeMeshEditor?.deleteBridgeMesh?.() },
      { selected: () => this.polyWallEditor?.selectedPoint, delete: () => this.polyWallEditor?.deleteSelectedPoint?.() },
      { selected: () => this.polyHillEditor?.selectedPoint, delete: () => this.polyHillEditor?.deleteSelectedPoint?.() },
      { selected: () => this.polyCurbEditor?.selectedPoint, delete: () => this.polyCurbEditor?.deletePolyCurbPoint?.() },
    ];

    return featureActions.find(action => action.selected()) ?? null;
  }

  /**
   * Replace each feature's `terrainType` (a plain object after JSON round-trip,
   * or a legacy name string) with the canonical TERRAIN_TYPES reference by name,
   * so identity-keyed lookups (e.g. TERRAIN_TYPE_INDEX in the terrain bake) match.
   */
  _canonicalizeFeatureTerrainTypes(features) {
    if (!Array.isArray(features)) return;
    for (const f of features) {
      const tt = f?.terrainType;
      if (!tt) continue;
      const name = typeof tt === 'string' ? tt : tt.name;
      const key = Object.keys(TERRAIN_TYPES).find(k => TERRAIN_TYPES[k].name === name);
      if (key) f.terrainType = TERRAIN_TYPES[key];
    }
  }

  _applySnapshot(snap) {
    // Deselect everything, then clear gizmo meshes (materials stay alive for
    // re-use). Editors without clearMeshes rebuild via onSnapshotRestored
    // below; aiPath/terrainPath have both and clear again there — harmless.
    this.deselectAll();
    for (const editor of this.subEditors) {
      editor.clearMeshes?.();
    }
    // Surface decal meshes are owned by the manager, not a sub-editor.
    this.surfaceDecalManager?.clearAll();

    // Restore editable track state
    const parsed = JSON.parse(snap);
    if (Array.isArray(parsed)) {
      this.currentTrack.features = parsed;
      this.currentTrack.wear = { ...DEFAULT_TERRAIN_WEAR_CONFIG };
    } else {
      this.currentTrack.name = parsed.name ?? this.currentTrack.name ?? 'Untitled Track';
      this.currentTrack.id = parsed.id ?? this.currentTrack.id ?? 'untitled-track';
      this.currentTrack.width = parsed.width ?? this.currentTrack.width ?? 160;
      this.currentTrack.depth = parsed.depth ?? this.currentTrack.depth ?? 160;
      if (parsed.defaultTerrainType) {
        const defaultKey = Object.keys(TERRAIN_TYPES).find(k => TERRAIN_TYPES[k].name === parsed.defaultTerrainType);
        if (defaultKey) this.currentTrack.defaultTerrainType = TERRAIN_TYPES[defaultKey];
      }
      if (parsed.borderTerrainType) {
        const borderKey = Object.keys(TERRAIN_TYPES).find(k => TERRAIN_TYPES[k].name === parsed.borderTerrainType);
        if (borderKey) this.currentTrack.borderTerrainType = TERRAIN_TYPES[borderKey];
      }
      this.currentTrack.features = parsed.features ?? [];
      this.currentTrack.wear = {
        ...DEFAULT_TERRAIN_WEAR_CONFIG,
        ...(parsed.wear ?? {}),
      };
    }
      // JSON.parse gives each feature a fresh terrainType object copy. The terrain
      // bake keys TERRAIN_TYPE_INDEX by object identity, so a copy misses the map
      // and falls back to index 0 (asphalt/grey) — features paint grey until a
      // reload re-canonicalizes them. Re-map each back to the shared TERRAIN_TYPES
      // reference by name, mirroring Track.fromJSON.
      this._canonicalizeFeatureTerrainTypes(this.currentTrack.features);
      this._syncTrackSettingsPanel();

      // Rebuild terrain first so terrain-sampled visuals land at correct heights.
      rebuild.terrain?.();
      rebuild.terrainGrid?.();
      rebuild.terrainTexture?.();

      // Recreate gizmos + rebuild visuals.
      for (const feature of this.currentTrack.features) {
        if (feature.type === 'hill') this.hillEditor.createVisual(feature);
        else if (feature.type === 'squareHill') this.squareHillEditor.createVisual(feature);
        else if (feature.type === 'terrain') this.terrainShapeEditor.createVisual(feature);
        else if (feature.type === 'obstacle') this.obstacleEditor.createVisual(feature);
        else if (feature.type === 'flag' || feature.type === 'bannerString' || feature.type === 'tent') this.decorationsEditor.createVisual(feature);
        else if (feature.type === 'trackSign') this.trackSignEditor.createVisual(feature);
        else if (feature.type === 'actionZone') this.actionZoneEditor.createVisual(feature);
        else if (feature.type === 'surfaceDecal') this.surfaceDecalManager?.createDecal(feature);
      }
      // Restore AI path waypoint gizmos
      this.aiPathEditor.onSnapshotRestored(this.currentTrack);
      // Restore terrain path gizmos
      this.terrainPathEditor.onSnapshotRestored(this.currentTrack);
      this._syncAiPathPanel();

      // Restore mesh grid gizmos
      this.meshGridEditor?.onSnapshotRestored();
      // Restore bridge mesh gizmos
      this.bridgeMeshEditor?.onSnapshotRestored();
      rebuild.bridgeMesh?.(null);
      // Restore poly wall gizmos
      this.polyWallEditor?.onSnapshotRestored();
      // Restore poly hill gizmos
      this.polyHillEditor?.onSnapshotRestored();
      rebuild.polyHill?.(null);
      // Restore poly curb gizmos
      this.polyCurbEditor?.onSnapshotRestored();
      rebuild.polyCurb?.(null);
      // Checkpoints are managed by CheckpointManager — rebuild from features
      this.checkpointEditor.rebuildFromFeatures();

    rebuild.terrain?.();
    rebuild.terrainGrid?.();
    rebuild.terrainTexture?.();
    rebuild.polyWall?.(null);
  }

  undo() {
    if (this._undoStack.length === 0) return;
    this._redoStack.push(this._serializeSnapshot());
    this._applySnapshot(this._undoStack.pop());
    console.debug('[Undo] stack remaining:', this._undoStack.length);
  }

  redo() {
    if (this._redoStack.length === 0) return;
    this._undoStack.push(this._serializeSnapshot());
    this._applySnapshot(this._redoStack.pop());
    console.debug('[Redo] stack remaining:', this._redoStack.length);
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
      if (this._editorStore?.selectedType === 'polyWall') {
        this.closePolyWall();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (this._editorStore?.selectedType === 'polyCurb') {
        this.closePolyCurb();
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
      // Any actually-selected feature (of any type) → deselect it; only open
      // the pause menu when nothing is selected. Previously only hills, square
      // hills, and checkpoints were handled here, so pressing Esc with e.g. a
      // poly-wall point, obstacle, or decoration selected left it selected — and
      // its gizmo could then no longer be re-clicked, since handlePointerDown
      // treats an already-selected gizmo target as a no-op.
      //
      // NB: test live selections only (_getActiveSelectionInteraction +
      // meshGrid.selectedPoint), NOT _getSelectedFeatureActions — that counts
      // the sticky meshGrid/bridgeMesh `activeFeature`, which is set on load and
      // never cleared, so it would swallow Esc on any track containing one.
      if (this._getActiveSelectionInteraction() || this.meshGridEditor?.selectedPoint) {
        this.deselectAll();
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

    // Delegate [ / ] to bridge mesh editor for height adjustment
    if (this.bridgeMeshEditor?.onKeyDown(event)) {
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

      // Only forward real movement to the tool: move(0,0,0) is not a no-op —
      // point editors re-snap gizmos and reset their debounced rebuild timer on
      // every call, so invoking it each frame starves the deferred rebuild
      // (slider changes never rebuilt terrain while a point was selected).
      delta = (movement.x !== 0 || movement.y !== 0 || movement.z !== 0)
        ? selection.move(movement)
        : movement;
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
      this._pendingEmptyDeselect = false;
      this._panState = null;
      this.handlePointerDown(pointerInfo);

      if (pickResult?.pickedMesh && this._hasDraggableSelection() && this._isSelectedGizmoTarget(pickResult.pickedMesh)) {
        this._dragHoldTarget = clickedMesh;
        this._dragHoldStart = { x: this.scene.pointerX, y: this.scene.pointerY };
        this._dragHoldTimer = setTimeout(() => {
          if (!this.isActive || this._dragHoldTarget !== clickedMesh) return;
          if (!this._beginSelectedGizmoDrag()) {
            this._clearDragHoldTimer();
            return;
          }
          this._clearDragHoldTimer();
        }, this._dragHoldDelayMs);
      }

      // Empty terrain + left button → arm a camera-pan candidate.
      // _pendingEmptyDeselect (set by handlePointerDown) means the click hit
      // nothing selectable, so gizmo presses never start a pan.
      if (this._pendingEmptyDeselect && pointerInfo.event.button === 0) {
        const anchor = this._groundXZUnderPointer();
        if (anchor) {
          this._panState = { anchor, startX: this.scene.pointerX, startY: this.scene.pointerY, active: false };
        }
      }
      return;
    }

    if (pointerInfo.type === PointerEventTypes.POINTERWHEEL) {
      this._handleWheelZoom(pointerInfo.event);
      return;
    }

    if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
      // Camera pan: dragging empty terrain scrolls the view, keeping the grabbed
      // ground point locked under the cursor. Suppressed while a gizmo drag is
      // active so the two never fight.
      if (this._panState && !this._mouseDrag) {
        if (!this._panState.active) {
          const pdx = this.scene.pointerX - this._panState.startX;
          const pdy = this.scene.pointerY - this._panState.startY;
          if (pdx * pdx + pdy * pdy >= this._dragStartThresholdSq) this._panState.active = true;
        }
        if (this._panState.active) {
          this._lockGroundPointUnderCursor(this._panState.anchor);
          return;
        }
      }

      // A drag hold is pending but not yet active: engage it as soon as the
      // pointer moves past the threshold, so click-and-drag works without
      // holding still for the full delay.
      if (!this._mouseDrag && this._dragHoldTarget && this._dragHoldStart) {
        const mdx = this.scene.pointerX - this._dragHoldStart.x;
        const mdy = this.scene.pointerY - this._dragHoldStart.y;
        if (mdx * mdx + mdy * mdy >= this._dragStartThresholdSq && this._beginSelectedGizmoDrag()) {
          this._clearDragHoldTimer();
        }
      }
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

      // Resolve a pan gesture / deferred empty-terrain deselect. A pan keeps the
      // selection; a plain click on empty terrain deselects (now on up).
      const panned = !!this._panState?.active;
      this._panState = null;
      if (this._pendingEmptyDeselect) {
        this._pendingEmptyDeselect = false;
        if (!panned) this.deselectAll();
      }

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

  /** Ground point under the cursor, projected onto the y=planeY plane. */
  _groundXZUnderPointer(planeY = this._panPlaneY) {
    const ray = this.scene.createPickingRay(
      this.scene.pointerX,
      this.scene.pointerY,
      undefined,
      this.camera
    );
    const dirY = ray.direction.y;
    if (Math.abs(dirY) < 1e-6) return null;
    const t = (planeY - ray.origin.y) / dirY;
    if (t < 0) return null;
    return {
      x: ray.origin.x + ray.direction.x * t,
      z: ray.origin.z + ray.direction.z * t,
    };
  }

  /**
   * Shift the camera (position + target together, XZ only) so the given world
   * point sits back under the cursor. Shared by drag-pan and wheel-zoom so both
   * feel like grabbing/zooming toward the point under the mouse.
   */
  _lockGroundPointUnderCursor(anchor) {
    const current = this._groundXZUnderPointer();
    if (!current) return;
    const dx = anchor.x - current.x;
    const dz = anchor.z - current.z;
    if (dx === 0 && dz === 0) return;
    const shift = new Vector3(dx, 0, dz);
    const target = this.camera.getTarget();
    this.camera.position.addInPlace(shift);
    this.camera.setTarget(target.add(shift));
  }

  /** Mouse-wheel zoom: dolly along the view axis toward the cursor's ground point. */
  _handleWheelZoom(event) {
    const delta = event?.deltaY ?? 0;
    if (!delta) return;
    event.preventDefault?.();

    const anchor = this._groundXZUnderPointer();
    const target = this.camera.getTarget();
    const toTarget = target.subtract(this.camera.position);
    const dist = toTarget.length();
    if (dist < 1e-3) return;
    const forward = toTarget.scaleInPlace(1 / dist);

    // deltaY < 0 = wheel up = zoom in (move toward target).
    const step = -Math.sign(delta) * this._wheelZoomStep * dist;
    const newPos = this.camera.position.add(forward.scale(step));
    if (newPos.y >= this._minCamHeight && newPos.y <= this._maxCamHeight) {
      this.camera.position.copyFrom(newPos);
    }
    // Re-lock the grabbed point so zoom homes in on the cursor, not screen center.
    if (anchor) this._lockGroundPointUnderCursor(anchor);
  }

  _clearDragHoldTimer() {
    if (this._dragHoldTimer) {
      clearTimeout(this._dragHoldTimer);
      this._dragHoldTimer = null;
    }
    this._dragHoldTarget = null;
    this._dragHoldStart = null;
  }

  _beginSelectedGizmoDrag() {
    const world = this._pointerWorldXZ();
    if (!world || !this._hasDraggableSelection()) return false;

    this._mouseDrag = { x: world.x, z: world.z };
    this.polyWallEditor?.beginDrag?.();
    this.polyHillEditor?.beginDrag?.();
    this.polyCurbEditor?.beginDrag?.();
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
      [this.obstacleEditor, 'selected'],
      [this.trackSignEditor, 'selected'],
      [this.surfaceDecalEditor, 'selected'],
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

  /**
   * Diagnostic snapshot of everything that could stop a gizmo click from
   * selecting: which editors still hold a selection, the active panel mode,
   * and leftover pointer-drag state. Used by _logGizmoDiag.
   */
  _selectionStateSnapshot() {
    const held = [];
    const note = (label, val) => { if (val) held.push(label); };
    note('checkpoint',   this.checkpointEditor?.selected);
    note('hill',         this.hillEditor?.selected);
    note('squareHill',   this.squareHillEditor?.selected);
    note('terrainShape', this.terrainShapeEditor?.selected);
    note('obstacle',     this.obstacleEditor?.selected);
    note('surfaceDecal', this.surfaceDecalEditor?.selected);
    note('decoration',   this.decorationsEditor?._selected);
    note('trackSign',    this.trackSignEditor?.selected);
    note('actionZone',   this.actionZoneEditor?._selected);
    note('aiPath',       this.aiPathEditor?.selected);
    note('terrainPath',  this.terrainPathEditor?.selected);
    note('meshGridPoint',   this.meshGridEditor?.selectedPoint);
    note('meshGridActive',  this.meshGridEditor?.activeFeature);
    note('bridgeMeshActive', this.bridgeMeshEditor?.activeFeature);
    note('polyWallPoint',   this.polyWallEditor?.selectedPoint);
    note('polyHillPoint',   this.polyHillEditor?.selectedPoint);
    note('polyCurbPoint',   this.polyCurbEditor?.selectedPoint);
    return {
      selectedType:  this._editorStore?.selectedType ?? null,
      heldSelections: held,
      mouseDragActive: !!this._mouseDrag,
      dragHoldTarget: this._dragHoldTarget?.name ?? null,
    };
  }

  /**
   * Log why a pointer-down did not (re)select a gizmo. Filter the browser
   * console for "[gizmo-diag]" to see these. Set `window.__gizmoDiag = false`
   * to silence.
   */
  _logGizmoDiag(reason, pickedMesh) {
    if (typeof window !== 'undefined' && window.__gizmoDiag === false) return;
    console.debug('[gizmo-diag]', reason, {
      picked: pickedMesh?.name ?? null,
      ...this._selectionStateSnapshot(),
    });
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

  _handleWaypointSelection(clickedMesh, pickedPoint, editor, selectedType, addPointButton = null, pointerButton = null) {
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

    if (pickedPoint && (addPointButton == null || pointerButton === addPointButton)) {
      editor.addPoint(pickedPoint.x, pickedPoint.z);
      return true;
    }

    return false;
  }

  /**
   * Poly wall / poly curb placement-mode click handling. Right-click drops a new
   * control point at the terrain location; left-click selects an existing point.
   * Returns true if the click was consumed. Mirrors _handleWaypointSelection but
   * uses the poly editors' point-selection interface (onPointerDown / addPoint).
   */
  _handlePolyPlacement(pickResult, button, editor) {
    if (button === 2) {
      const p = pickResult.pickedPoint ?? this._pointerWorldXZ();
      if (p) {
        editor.addPoint(p.x, p.z);
        return true;
      }
      return false;
    }
    return editor.onPointerDown(pickResult.pickedMesh ?? null);
  }

  handlePointerDown(pointerInfo) {
    if (!this.isActive) return;
    
    if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
      const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
      const wasSelectedTarget = this._isSelectedGizmoTarget(pickResult?.pickedMesh ?? null);

      if (wasSelectedTarget) {
        // Click landed on the already-selected gizmo → kept for dragging. If
        // this fires when you believe nothing is selected, an editor is holding
        // a stale selection (see heldSelections in the log).
        this._logGizmoDiag('click on already-selected gizmo → kept selection (no-op)', pickResult?.pickedMesh);
        return;
      }

      // Surface decal stamp mode: click to stamp.
      if (this._editorStore?.selectedType === 'surfaceDecal') {
        if (pickResult.hit && pickResult.pickedPoint) {
          this.surfaceDecalEditor.stamp(pickResult.pickedPoint.x, pickResult.pickedPoint.z);
        }
        return;
      }

      // AI path panel open: right-click terrain to add waypoints, click waypoint to select.
      if (this._editorStore?.selectedType === 'aiPath') {
        if (this._handleWaypointSelection(pickResult.pickedMesh, pickResult.pickedPoint, this.aiPathEditor, 'aiPath', 2, pointerInfo.event.button)) return;
        // Stuck in aiPath mode: no other feature gizmo is selectable until this
        // mode is closed (Esc / panel X). If the AI-path panel is not visible,
        // selectedType leaked out of sync.
        this._logGizmoDiag('click blocked by aiPath mode', pickResult?.pickedMesh);
        this.deselectAll();
        return;
      }

      // Terrain path panel open: right-click terrain to add waypoints, click waypoint to select.
      if (this._editorStore?.selectedType === 'terrainPath') {
        if (this._handleWaypointSelection(pickResult.pickedMesh, pickResult.pickedPoint, this.terrainPathEditor, 'terrainPath', 2, pointerInfo.event.button)) return;
        // Stuck in terrainPath mode: no other feature gizmo is selectable until
        // this mode is closed (Esc / panel X).
        this._logGizmoDiag('click blocked by terrainPath mode', pickResult?.pickedMesh);
        this.deselectAll();
        return;
      }

      // Poly wall panel open: right-click terrain to add points, click a point to select.
      if (this._editorStore?.selectedType === 'polyWall') {
        if (this._handlePolyPlacement(pickResult, pointerInfo.event.button, this.polyWallEditor)) return;
        this.polyWallEditor.deselectPoint();
        return;
      }

      // Poly curb panel open: right-click terrain to add points, click a point to select.
      if (this._editorStore?.selectedType === 'polyCurb') {
        if (this._handlePolyPlacement(pickResult, pointerInfo.event.button, this.polyCurbEditor)) return;
        this.polyCurbEditor.deselectPoint();
        return;
      }

      if (pickResult.hit && pickResult.pickedMesh) {
        const clickedMesh = pickResult.pickedMesh;

        // Mesh grid control points take priority. Use a dedicated pick limited
        // to the grid's own spheres so the pickable ground mesh can't occlude
        // the handles; fall back to the generic pick (which also deselects when
        // clicking away from any sphere).
        if (this.meshGridEditor) {
          const mgSphere = this.meshGridEditor.pickControlPoint();
          if (this.meshGridEditor.onPointerDown(mgSphere ?? clickedMesh)) return;
        }

        // Bridge mesh control points
        if (this.bridgeMeshEditor) {
          const bmSphere = this.bridgeMeshEditor.pickControlPoint();
          if (this.bridgeMeshEditor.onPointerDown(bmSphere ?? clickedMesh)) return;
        }

        // Poly wall control points
        if (this.polyWallEditor?.onPointerDown(clickedMesh)) return;

        // Poly hill control points. Dedicated pick limited to the hill's own
        // spheres so the pickable ground mesh can't occlude the handles.
        if (this.polyHillEditor) {
          const phSphere = this.polyHillEditor.pickControlPoint();
          if (this.polyHillEditor.onPointerDown(phSphere ?? clickedMesh)) return;
        }

        // Poly curb control points
        if (this.polyCurbEditor?.onPointerDown(clickedMesh)) return;

        // Action zone center/point handles
        if (this.actionZoneEditor?.onPointerDown(clickedMesh)) return;

        const clickHandlers = [
          { editor: this.checkpointEditor },
          { editor: this.hillEditor },
          { editor: this.squareHillEditor },
          { editor: this.terrainShapeEditor },
          { editor: this.obstacleEditor },
          { editor: this.decorationsEditor },
          { editor: this.trackSignEditor },
          { editor: this.surfaceDecalEditor },
        ];

        for (const handler of clickHandlers) {
          if (this._handleMeshSelection(clickedMesh, handler.editor, handler.selectFn)) return;
        }

        // Check if clicked mesh is an AI / terrain path waypoint.
        if (this._handleWaypointSelection(clickedMesh, null, this.aiPathEditor, 'aiPath', null, pointerInfo.event.button)) return;
        if (this._handleWaypointSelection(clickedMesh, null, this.terrainPathEditor, 'terrainPath', null, pointerInfo.event.button)) return;

        const isObstaclePlacementActive = !!this._editorStore?.obstacle?.placementActive;
        if (pointerInfo.event.button === 2 && isObstaclePlacementActive) {
          const placementPoint = pickResult.pickedPoint ?? this._pointerWorldXZ();
          if (placementPoint) {
            this.addObstacleAt(placementPoint.x, placementPoint.z);
          }
          return;
        }
        // Clicked on something else (terrain, etc.) — deselect all. Deferred to
        // pointer-up (see _pendingEmptyDeselect) so a click-drag pans instead of
        // dropping the selection. If you clicked a gizmo and expected it to
        // select, the picked mesh below is what the ray actually hit (e.g.
        // "ground" occluding a buried gizmo).
        this._logGizmoDiag('click hit a mesh but no editor claimed it → deselectAll', clickedMesh);
        this._pendingEmptyDeselect = true;
      } else {
        this._pendingEmptyDeselect = true;
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
    rebuild.quickTestTrack?.();
  }

  rebuildScene() {
    rebuild.editorScene?.();
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

  /**
   * Generic panel-property route: (panelKey, prop) dispatches to the matching
   * change<Panel><Prop> method — e.g. ('hill', 'radiusX') → changeHillRadiusX.
   * The store's setFeatureProp calls this after mirroring the value into panel
   * state; scripts/check-panel-bindings.mjs statically verifies every panel
   * binding resolves to a real method.
   */
  setFeatureProp(panelKey, prop, val) {
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    this[`change${cap(panelKey)}${cap(prop)}`]?.(val);
  }

  changeCheckpointWidth(val) { this.checkpointEditor.changeWidth(val); }
  changeCheckpointHeading(degrees) { this.checkpointEditor.changeHeading(degrees); }
  changeCheckpointAlternative(val) { this.checkpointEditor.changeAlternative(val); }

  changeHillRadius(val) { this.hillEditor.changeRadius(val); }
  changeHillRadiusX(val) { this.hillEditor.changeRadiusX(val); }
  changeHillRadiusZ(val) { this.hillEditor.changeRadiusZ(val); }
  changeHillRotation(val) { this.hillEditor.changeAngle(val); }
  changeHillHeight(val) { this.hillEditor.changeHeight(val); }
  changeHillWaterLevelOffset(val) { this.hillEditor.changeWaterLevelOffset(val); }
  changeHillTerrainType(name) { this.hillEditor.changeTerrainType(name); }
  changeHillBlendWidth(val) { this.hillEditor.changeBlendWidth(val); }

  changeTrackDefaultTerrain(name) {
    const key = Object.keys(TERRAIN_TYPES).find(k => TERRAIN_TYPES[k].name === name);
    if (!key) return;
    this.saveSnapshot();
    this.currentTrack.defaultTerrainType = TERRAIN_TYPES[key];
    rebuild.terrainGrid?.();
    rebuild.terrainTexture?.(false, { wear: false, normals: false });
    rebuild.normalMap?.();
    this._syncTrackSettingsPanel();
  }

  changeTrackBorderTerrain(name) {
    const key = Object.keys(TERRAIN_TYPES).find(k => TERRAIN_TYPES[k].name === name);
    if (!key) return;
    this.saveSnapshot();
    this.currentTrack.borderTerrainType = TERRAIN_TYPES[key];
    rebuild.terrainGrid?.();
    rebuild.terrainTexture?.(false, { wear: false, normals: false });
    rebuild.normalMap?.();
    this._syncTrackSettingsPanel();
  }

  // Track id slug: lowercase, spaces → underscores, drop any other non-slug
  // characters. Underscores are preserved and no trailing/leading trim is done
  // so the field stays editable mid-word (otherwise the controlled input would
  // strip a just-typed separator on every keystroke).
  _slugifyTrackId(str) {
    return (str ?? '')
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]+/g, '');
  }

  changeTrackName(name) {
    if (!this.currentTrack) return;
    this.saveSnapshot(true);
    // Keep the raw value (including spaces) so names like "Desert Run" are
    // typable; only the export path applies the "Untitled Track" fallback.
    this.currentTrack.name = name ?? '';
    // Track id automatically follows the name.
    this.currentTrack.id = this._slugifyTrackId(name);
    this._syncTrackSettingsPanel();
  }

  changeTrackId(id) {
    if (!this.currentTrack) return;
    this.saveSnapshot(true);
    this.currentTrack.id = this._slugifyTrackId(id);
    this._syncTrackSettingsPanel();
  }

  changeTrackHidden(hidden) {
    if (!this.currentTrack) return;
    this.saveSnapshot(true);
    this.currentTrack.hidden = !!hidden;
    this._syncTrackSettingsPanel();
  }

  changeTrackDirtChunks(enabled) {
    if (!this.currentTrack) return;
    this.saveSnapshot(true);
    this.currentTrack.dirtChunks = !!enabled;
    this._syncTrackSettingsPanel();
    this._refreshDirtChunks();
  }

  /** Dispose any existing dirt-chunk meshes/materials and regenerate if enabled.
   *  Done in place so the toggle is instant (a full scene rebuild reloads the
   *  track from storage and would drop the unsaved setting change). */
  _refreshDirtChunks() {
    if (!this.scene) return;
    for (const mesh of this.scene.meshes.slice()) {
      if (typeof mesh?.name === 'string' && mesh.name.startsWith('dirtChunk_')) mesh.dispose();
    }
    for (const mat of this.scene.materials.slice()) {
      if (typeof mat?.name === 'string' && mat.name.startsWith('dirtChunkMat_')) mat.dispose();
    }
    if (this.currentTrack.dirtChunks !== false) {
      scatterDirtChunks(this.scene, this.currentTrack);
    }
  }

  changeTrackPackId(packId) {
    if (!this.currentTrack) return;
    this.saveSnapshot(true);
    // Pack ids are slugs like track ids; empty means "no pack".
    const slug = this._slugifyTrackId(packId);
    this.currentTrack.packId = slug || null;
    this._syncTrackSettingsPanel();
  }

  _normalizeTrackDimension(value, fallback = 160) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(80, Math.min(320, Math.round(numeric)));
  }

  changeTrackWidth(val) {
    if (!this.currentTrack) return;
    this.saveSnapshot(true);
    this.currentTrack.width = this._normalizeTrackDimension(val, this.currentTrack.width ?? 160);
    rebuild.terrainGrid?.();
    rebuild.terrainTexture?.();
    this._syncTrackSettingsPanel();
  }

  changeTrackDepth(val) {
    if (!this.currentTrack) return;
    this.saveSnapshot(true);
    this.currentTrack.depth = this._normalizeTrackDimension(val, this.currentTrack.depth ?? 160);
    rebuild.terrainGrid?.();
    rebuild.terrainTexture?.();
    this._syncTrackSettingsPanel();
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
  changeSquareHillBlendWidth(val)   { this.squareHillEditor.changeBlendWidth(val); }

  changeTerrainShapeShape(val)     { this.terrainShapeEditor.changeShape(val); }
  changeTerrainShapeWidth(val)    { this.terrainShapeEditor.changeWidth(val); }
  changeTerrainShapeDepth(val)    { this.terrainShapeEditor.changeDepth(val); }
  changeTerrainShapeRotation(val) { this.terrainShapeEditor.changeRotation(val); }
  changeTerrainShapeBlendWidth(val) { this.terrainShapeEditor.changeBlendWidth(val); }
  changeTerrainShapeTerrainType(n) { this.terrainShapeEditor.changeTerrainType(n); }

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
  changeDecorationScale(val)       { this.decorationsEditor.changeScale(val); }

  deselectAll() {
    this._clearDragHoldTimer();
    this.checkpointEditor.deselect();
    // surfaceDecalEditor.deselect() only clears a selected placed decal; its
    // stamp mode is a separate state closed explicitly (Esc / X), not here.
    for (const editor of this.subEditors) {
      editor.deselect?.();
    }
  }

  // ── Poly Wall Vue bridge methods ──
  changePolyWallRadius(val)          { this.polyWallEditor.changePolyWallRadius(val); }
  changePolyWallSmoothing(val)       { this.polyWallEditor.changePolyWallSmoothing(val); }
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
  closePolyWall() {
    this.polyWallEditor.deselectPoint();
    this.polyWallEditor.discardActiveIfEmpty();
    if (this._editorStore) this._editorStore.selectedType = null;
  }

  // ── Poly Hill Vue bridge methods ──
  changePolyHillRadius(val)     { this.polyHillEditor.setPointRadius(val); }
  changePolyHillHeight(val)     { this.polyHillEditor.setHeight(val); }
  changePolyHillWidth(val)      { this.polyHillEditor.setWidth(val); }
  changePolyHillTerrainType(val){ this.polyHillEditor.setTerrainType(val); }
  changePolyHillBlendWidth(val) { this.polyHillEditor.setBlendWidth(val); }
  changePolyHillWaterLevelOffset(val) { this.polyHillEditor.setWaterLevelOffset(val); }
  changePolyHillClosed(val)     { this.polyHillEditor.setClosed(val); }
  changePolyHillFilled(val)     { this.polyHillEditor.setFilled(val); }
  insertPolyHillPoint()         { this.polyHillEditor.insertPointAfter(); }
  deletePolyHillPoint()         { this.polyHillEditor.deleteSelectedPoint(); }
  deletePolyHill()              { this.polyHillEditor.deletePolyHill(); }
  duplicatePolyHill()           { this.polyHillEditor.duplicatePolyHill(); }
  deselectPolyHill()            { this.polyHillEditor.deselectPoint(); }

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
  changeTrackSignPrimaryColor(val) { this.trackSignEditor.changePrimaryColor(val); }
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
  deselectActionZone()            { this.actionZoneEditor.deselect(); }
  changeActionZoneRadius(val)     { this.actionZoneEditor.changeRadius(val); }
  changeActionZoneType(val)       { this.actionZoneEditor.changeZoneType(val); }
  changeActionZoneShape(val)      { this.actionZoneEditor.changeShape(val); }
  changeActionZoneBoostStrength(val) { this.actionZoneEditor.changeBoostStrength(val); }
  changeActionZoneBoostDuration(val) { this.actionZoneEditor.changeBoostDuration(val); }
  changeActionZoneSlowStrength(val) { this.actionZoneEditor.changeSlowStrength(val); }
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
  closePolyCurb() {
    this.polyCurbEditor?.deselectPoint();
    this.polyCurbEditor?.discardActiveIfEmpty();
    if (this._editorStore) this._editorStore.selectedType = null;
  }

  // ── Mesh grid bridge ─────────────────────────────────────────────────────
  changeMeshGridSmoothing(v) {
    if (this.meshGridEditor?.activeFeature) {
      this.meshGridEditor.activeFeature.smoothing = v;
      rebuild.terrain?.(this.meshGridEditor.activeFeature);
    }
  }
  changeMeshGridAngle(v)        { this.meshGridEditor?.setAngle(v); }
  changeMeshGridFalloff(v)      { this.meshGridEditor?.setFalloff(v); }
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

  // ── Bridge Mesh bridge methods ────────────────────────────────────────────
  addBridgeMeshEntity()              { this.bridgeMeshEditor?.addBridgeMeshFeature(); this.hideAddMenu(); }
  changeBridgeMeshStepSize(v)        { if (this.bridgeMeshEditor) this.bridgeMeshEditor.stepSize = v; }
  setBridgeMeshPointHeight(v)        { this.bridgeMeshEditor?.setPointHeight(v); }
  changeBridgeMeshRotation(v) {
    if (!this.bridgeMeshEditor?.activeFeature) return;
    this.saveSnapshot();
    this.bridgeMeshEditor.activeFeature.rotation = v;
    this.bridgeMeshEditor._updateGizmoPositions?.();
    rebuild.bridgeMesh?.(this.bridgeMeshEditor.activeFeature);
  }
  bridgeMeshAdjustUp()               { if (this.bridgeMeshEditor) this.bridgeMeshEditor.adjustHeight(this.bridgeMeshEditor.stepSize); }
  bridgeMeshAdjustDown()             { if (this.bridgeMeshEditor) this.bridgeMeshEditor.adjustHeight(-this.bridgeMeshEditor.stepSize); }
  applyBridgeMeshChanges(c, r, w, d) { this.bridgeMeshEditor?.applyGridChanges(c, r, w, d); }
  changeBridgeMeshThickness(v) {
    if (!this.bridgeMeshEditor?.activeFeature) return;
    this.saveSnapshot();
    this.bridgeMeshEditor.activeFeature.thickness = Math.max(0.1, v);
    rebuild.bridgeMesh?.(this.bridgeMeshEditor.activeFeature);
  }
  changeBridgeMeshLayerId(v) {
    if (!this.bridgeMeshEditor?.activeFeature) return;
    this.saveSnapshot();
    const nextLayerId = Math.max(0, Math.round(v));
    // Keep legacy `level` mirrored for backward-compatible consumers.
    this.bridgeMeshEditor.activeFeature.layerId = nextLayerId;
    this.bridgeMeshEditor.activeFeature.level = nextLayerId;
    rebuild.bridgeMesh?.(this.bridgeMeshEditor.activeFeature);
  }
  flattenBridgeMesh()                { this.bridgeMeshEditor?.flattenBridgeMesh(); }
  deleteBridgeMesh()                 { this.bridgeMeshEditor?.deleteBridgeMesh(); }
  duplicateBridgeMesh()              { this.bridgeMeshEditor?.duplicateBridgeMesh(); }
  closeBridgeMesh() {
    this.bridgeMeshEditor?.deselect?.();
    if (this._editorStore) this._editorStore.selectedType = null;
  }

  // ── Surface Decal helper methods ──────────────────────────────────────────
  setSurfaceDecalManager(manager) {
    this.surfaceDecalManager = manager;
    this.surfaceDecalEditor.setDecalManager(manager);
  }

  /** Provide the scene's shadow generator so editor decorations can cast shadows. */
  setShadows(shadows) {
    this._shadows = shadows ?? null;
  }

  openSurfaceDecalStamp() {
    this.surfaceDecalEditor.open();
  }

  closeSurfaceDecalStamp() {
    this.surfaceDecalEditor.close();
  }

  setSurfaceDecalShape(val) { this.surfaceDecalEditor.setShape(val); }
  setSurfaceDecalAngle(val) { this.surfaceDecalEditor.setAngle(val); }
  setSurfaceDecalOpacity(val) { this.surfaceDecalEditor.setOpacity(val); }
  setSurfaceDecalWidth(val) { this.surfaceDecalEditor.setWidth(val); }
  setSurfaceDecalDepth(val) { this.surfaceDecalEditor.setDepth(val); }

  // Editing a placed decal (selected via click). Panel key: 'surfaceDecalEdit'.
  deselectSurfaceDecalEdit()       { this.surfaceDecalEditor.deselect(); }
  deleteSelectedSurfaceDecal()     { this.surfaceDecalEditor.deleteSelected(); }
  changeSurfaceDecalEditWidth(v)   { this.surfaceDecalEditor.changeWidth(v); }
  changeSurfaceDecalEditDepth(v)   { this.surfaceDecalEditor.changeDepth(v); }
  changeSurfaceDecalEditAngle(v)   { this.surfaceDecalEditor.changeAngle(v); }
  changeSurfaceDecalEditOpacity(v) { this.surfaceDecalEditor.changeOpacity(v); }

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
  insertAiWaypointEntity() {
    this.aiPathEditor.insertAfterSelected();
    this.hideAddMenu();
    this._syncAiPathPanel();
  }
  deleteAiWaypoint()   { this.aiPathEditor.deleteSelected(); }
  clearAiPath()        { this.aiPathEditor.clearAll(); }
  deselectAiWaypoint() { this.aiPathEditor.deselect(); }
  editMainAiPath()             { this.aiPathEditor.editMainPath(); }
  createAiPathBranchFromSelected() { this.aiPathEditor.createBranchFromSelected(); }
  selectAiPathBranch(branchId) { this.aiPathEditor.selectBranch(branchId); }
  setActiveAiPathBranchWeight(weight) { this.aiPathEditor.setActiveBranchWeight(weight); }
  setActiveAiPathBranchRejoinIndex(index) { this.aiPathEditor.setActiveBranchRejoinIndex(index); }
  deleteActiveAiPathBranch()   { this.aiPathEditor.deleteActiveBranch(); }
  clearAiPathBranches()        { this.aiPathEditor.clearBranches(); }
  changeAiPathWearEnabled(val)      { this._updateAiPathWear({ enabled: !!val }, false); }
  changeAiPathWearWidth(val)        { this._updateAiPathWear({ width: val }, true); }
  changeAiPathWearIntensity(val)    { this._updateAiPathWear({ intensity: val }, true); }
  changeAiPathWearLaneSpacing(val)  { this._updateAiPathWear({ laneSpacing: val }, true); }
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
    this.terrainPathEditor.discardActiveIfEmpty();
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
  insertTerrainPathWaypoint()   { this.terrainPathEditor.insertAfterSelected(); }
  duplicateTerrainPath()        { this.terrainPathEditor.duplicateActivePath(); }
  deleteTerrainPath()           { this.terrainPathEditor.clearActivePath(); }
  clearTerrainPath()            { this.terrainPathEditor.clearActivePath(); }
  changeTerrainPathWidth(val)          { this.terrainPathEditor.changeWidth(val); }
  changeTerrainPathBlendWidth(val)     { this.terrainPathEditor.changeBlendWidth(val); }
  changeTerrainPathCornerRadius(val)   { this.terrainPathEditor.changeCornerRadius(val); }
  changeTerrainPathClosed(val)         { this.terrainPathEditor.setClosed(val); }
  changeTerrainPathTerrainType(name)   { this.terrainPathEditor.changeTerrainType(name); }

  _syncTerrainPathPanel() {
    const s = this._editorStore;
    if (!s || !this.terrainPathEditor.activeFeature) return;
    const f = this.terrainPathEditor.activeFeature;
    s.terrainPath.width        = f.width ?? 8;
    s.terrainPath.blendWidth   = f.blendWidth ?? 0;
    s.terrainPath.cornerRadius = f.cornerRadius ?? 0;
    s.terrainPath.closed       = f.closed ?? false;
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

  /**
   * Frame the whole track from an overhead tilt (matching the in-game
   * "screenshot" camera, scaled to the track's size), hide the editor gizmos,
   * and download a PNG of the clean track. Restores the camera + gizmos after.
   */
  async captureTrackScreenshot() {
    const engine = this.scene.getEngine();
    const camera = this.camera;

    const savedPos = camera.position.clone();
    const savedTarget = camera.getTarget().clone();
    const savedGizmos = this.gizmosVisible;

    this.setGizmosVisible(false);

    // Overhead tilt sized to the track (same framing ratio as the in-game
    // screenshot camera: ~0.78× up, ~0.6× back relative to the largest span).
    const maxDim = Math.max(this.currentTrack?.width ?? 160, this.currentTrack?.depth ?? 160);
    camera.position.set(0, maxDim * 0.78, -maxDim * 0.80);
    camera.setTarget(new Vector3(0, 0.5, -13));

    const name = this.currentTrack?.id || this.currentTrack?.name || 'track';
    try {
      await Tools.CreateScreenshotUsingRenderTargetAsync(
        engine, camera, { width: 1920, height: 1200 },
        'image/png', 4, true, `${name}.png`,
      );
    } catch (e) {
      console.warn('[Editor] Screenshot failed:', e);
    } finally {
      camera.position.copyFrom(savedPos);
      camera.setTarget(savedTarget);
      this.setGizmosVisible(savedGizmos);
    }
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
    setListVisibility(this.obstacleEditor?.meshes, ['node', 'mesh']);

    if (this.checkpointManager) {
      for (const cp of this.checkpointManager.checkpointMeshes || []) {
        if (cp.handle) cp.handle.isVisible = visible;
      }
    }

    if (this.meshGridEditor) {
      if (visible) {
        this.meshGridEditor._updatePointVisibility?.();
      } else {
        for (const p of this.meshGridEditor.pointMeshes || []) {
          if (p.mesh) p.mesh.isVisible = false;
        }
      }
      for (const ls of this.meshGridEditor.lineSystems || []) ls.isVisible = visible;
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

    if (this.aiPathEditor) {
      for (const h of this.aiPathEditor.handles || []) {
        if (h.mesh) h.mesh.isVisible = visible;
      }
      if (this.aiPathEditor.lineMesh) this.aiPathEditor.lineMesh.isVisible = visible;
      // Alternate/branch path lines (teal) live in a separate list.
      for (const lm of this.aiPathEditor.lineMeshes || []) lm.isVisible = visible;
    }

    if (this.bridgeMeshEditor) {
      if (visible) {
        // Restore selection-aware visibility (corners + selected points show).
        for (const l of this.bridgeMeshEditor.lineSystems || []) {
          if (l.mesh) l.mesh.isVisible = true;
        }
        for (const c of this.bridgeMeshEditor.centerGizmos || []) {
          this.bridgeMeshEditor._updateVisibilityForFeature?.(c.featureRef);
        }
      } else {
        for (const p of this.bridgeMeshEditor.pointMeshes || []) {
          if (p.mesh) p.mesh.isVisible = false;
        }
        for (const c of this.bridgeMeshEditor.centerGizmos || []) {
          if (c.mesh) c.mesh.isVisible = false;
        }
        for (const l of this.bridgeMeshEditor.lineSystems || []) {
          if (l.mesh) l.mesh.isVisible = false;
        }
      }
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
    if (this.squareHillEditor?.selected?.sphere) {
      this.squareHillEditor.selected.sphere.isVisible = visible;
    }
  }
}
