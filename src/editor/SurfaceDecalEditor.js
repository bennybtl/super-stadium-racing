import {
  MeshBuilder,
  StandardMaterial,
  Engine,
  Vector3,
  Color3,
  HighlightLayer,
} from "@babylonjs/core";
import { DECAL_SHAPES, COUNTED_SHAPES, OUTLINE_SHAPES, DECAL_COLORS, MIN_COUNT, MAX_COUNT, createDecalTexture } from "../managers/decalShapes.js";
import { GizmoHandle } from "./GizmoHandle.js";

const HANDLE_POS_Y = 2.0; // handle sphere floats this far above the ground-hugging decal

const HIGHLIGHT_COLOR = new Color3(1, 0.85, 0.2); // amber selection outline

// Babylon's CreateDecal (normal = +Y) bakes a −90° roll relative to a flat
// plane's yaw, so the ghost plane needs the same offset to visually match the
// stamped decal at every angle.
const GHOST_ROTATION_OFFSET_DEG = -90;

/**
 * SurfaceDecalEditor — stamp-mode editor for placing programmatic surface decals.
 *
 * Controls:
 *   - Mouse move   : ghost preview follows terrain cursor
 *   - Click        : stamp the current decal at cursor position
 *   - Q / E        : rotate by 15° increments
 *   - Mouse wheel  : scale up / down
 *   - Panel controls: select shape, adjust size, opacity, and rotation
 */
export class SurfaceDecalEditor {
  constructor(editor) {
    this.editor = editor;
    this._scene = null;
    this._track = null;

    // Ghost preview mesh
    this._ghost = null;
    this._ghostMat = null;
    this._ghostTexCache = new Map(); // "shape:count:outline:color:WxD" → DynamicTexture

    // Current stamp state
    this._shape = DECAL_SHAPES[0];
    this._color = 'white';
    this._count = 3;
    this._outline = false;
    this._angle = 0;
    this._width = 4;
    this._depth = 4;
    this._opacity = 1;

    // Reference to the live SurfaceDecalManager set by EditorMode
    this._decalManager = null;

    // Selection/edit state — a { feature, mesh } entry owned by the manager.
    this.selected = null;
    this._highlight = null;   // HighlightLayer (lazy)
    this._handles = new Map(); // manager entry -> GizmoHandle

    this._boundPointerMove = this._onPointerMove.bind(this);
    this._boundWheel       = this._onWheel.bind(this);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  activate(scene, track) {
    this._scene = scene;
    this._track = track;
    this._syncHandles();
  }

  /** Called by EditorMode after SceneBuilder creates SurfaceDecalManager. */
  setDecalManager(manager) {
    this._decalManager = manager;
    this._syncHandles();
  }

  /**
   * Reconcile one handle sphere per manager entry. The manager owns the decal
   * meshes and recreates its entries wholesale on snapshot restore, so handles
   * are reconciled (create missing / drop orphaned / reposition) rather than
   * created once alongside a visual.
   */
  _syncHandles() {
    const entries = this._decalManager?.entries;
    if (!entries || !this._scene || !this._track) return;

    for (const [entry, handle] of this._handles) {
      if (!entries.includes(entry)) {
        handle.dispose();
        this._handles.delete(entry);
      }
    }

    for (const entry of entries) {
      let handle = this._handles.get(entry);
      if (!handle) {
        handle = new GizmoHandle(this._scene, 'decal');
        this._handles.set(entry, handle);
      }
      const { centerX, centerZ } = entry.feature;
      handle.setPosition(centerX, this._track.getHeightAt(centerX, centerZ) + HANDLE_POS_Y, centerZ);
      handle.setSelected(entry === this.selected);
    }
  }

  /** Open the stamp panel — called from EditorController.openSurfaceDecalStamp(). */
  open() {
    this._createGhost();
    this._scene.getEngine().getRenderingCanvas()?.addEventListener('wheel', this._boundWheel, { passive: false });
    if (this.editor._editorStore) {
      this.editor._editorStore.selectedType = 'surfaceDecal';
      this._syncStore();
    }
  }

  /** Close / deactivate the stamp panel. */
  close() {
    this._destroyGhost();
    this._scene.getEngine().getRenderingCanvas()?.removeEventListener('wheel', this._boundWheel);
    if (this.editor._editorStore) {
      this.editor._editorStore.selectedType = null;
    }
  }

  get isOpen() {
    return this.editor._editorStore?.selectedType === 'surfaceDecal';
  }

  dispose() {
    this.close();
    this.deselect();
    for (const h of this._handles.values()) h.dispose();
    this._handles.clear();
    for (const tex of this._ghostTexCache.values()) tex.dispose();
    this._ghostTexCache.clear();
    this._ghostMat?.dispose();
    this._ghostMat = null;
    this._highlight?.dispose();
    this._highlight = null;
  }

  // ── Selection & editing of placed decals ──────────────────────────────────
  //
  // Independent of stamp mode: you close the stamp panel, then click a placed
  // arrow to select it. Edits mutate the feature and rebuild the baked decal
  // mesh (CreateDecal geometry can't just be transformed).

  /** Map a picked mesh to its manager entry — used by EditorController's selection loop. */
  /** Global gizmo-visibility toggle (EditorController.setGizmosVisible). */
  setHandlesVisible(visible) {
    for (const h of this._handles.values()) h.setVisible(visible);
  }

  findByMesh(mesh) {
    // Self-heal if the manager rebuilt its entries behind our back.
    if (this._handles.size !== (this._decalManager?.entries?.length ?? 0)) this._syncHandles();
    for (const [entry, handle] of this._handles) {
      if (handle.mesh === mesh) return entry;
    }
    return this._decalManager?.findByMesh(mesh) ?? null;
  }

  /** Clear selection state on snapshot restore (the manager rebuilds the meshes). */
  clearMeshes() {
    this.deselect();
    this._syncHandles();
  }

  select(entry) {
    if (!entry) return;
    this.deselect();
    this.selected = entry;
    this.editor._rawDragPos = { x: entry.feature.centerX, z: entry.feature.centerZ };
    this._handles.get(entry)?.setSelected(true);
    this._applyHighlight();
    this._showProperties();
  }

  deselect() {
    if (!this.selected) return;
    this._clearHighlight();
    this._handles.get(this.selected)?.setSelected(false);
    this.selected = null;
    this.editor._rawDragPos = null;
    this._hideProperties();
  }

  _applyHighlight() {
    if (!this.selected?.mesh) return;
    if (!this._highlight) {
      this._highlight = new HighlightLayer('_surfaceDecalHL', this._scene);
      this._highlight.innerGlow = false;
    }
    this._highlight.addMesh(this.selected.mesh, HIGHLIGHT_COLOR);
  }

  _clearHighlight() {
    if (this._highlight && this.selected?.mesh) {
      this._highlight.removeMesh(this.selected.mesh);
    }
  }

  /** Rebuild the selected decal's baked mesh after a feature edit and re-highlight it. */
  _rebuildSelected() {
    if (!this.selected) return;
    this._clearHighlight();
    this._decalManager.rebuild(this.selected);
    this._syncHandles();
    this._applyHighlight();
  }

  // ── Move / rotate (drag + Q/E, via EditorController selection interaction) ──

  move(movement) {
    if (!this.selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    this.editor.saveSnapshot(true);
    const { feature } = this.selected;
    if (!this.editor._rawDragPos)
      this.editor._rawDragPos = { x: feature.centerX, z: feature.centerZ };
    this.editor._rawDragPos.x += movement.x;
    this.editor._rawDragPos.z += movement.z;
    const prevX = feature.centerX, prevZ = feature.centerZ;
    feature.centerX = this.editor._snap(this.editor._rawDragPos.x);
    feature.centerZ = this.editor._snap(this.editor._rawDragPos.z);
    this._rebuildSelected();
    return new Vector3(feature.centerX - prevX, 0, feature.centerZ - prevZ);
  }

  rotate(deltaRad) {
    if (!this.selected) return;
    const f = this.selected.feature;
    f.angle = ((f.angle ?? 0) + deltaRad * 180 / Math.PI + 360) % 360;
    this._rebuildSelected();
    this._syncEditPanel();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  duplicateSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const src = this.selected.feature;
    const newFeature = { ...src, centerX: src.centerX + 3, centerZ: src.centerZ + 3 };
    this.editor.currentTrack.features.push(newFeature);
    const mesh = this._decalManager.createDecal(newFeature);
    if (!mesh) return;
    this.select(this._decalManager.findByMesh(mesh));
  }

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const { feature } = this.selected;
    const idx = this.editor.currentTrack.features.indexOf(feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    this._clearHighlight();
    this._decalManager.removeByFeature(feature);
    this.selected = null;
    this._syncHandles();
    this.editor._rawDragPos = null;
    this._hideProperties();
  }

  // ── Property edits (from the edit panel) ──────────────────────────────────

  changeWidth(val)   { this._changeProp('width', val); }
  changeDepth(val)   { this._changeProp('depth', val); }
  changeAngle(val)   { this._changeProp('angle', ((val % 360) + 360) % 360); }
  changeOpacity(val) { this._changeProp('opacity', val); }
  changeCount(val)   { this._changeProp('count', Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(val)))); }
  changeOutline(val) { this._changeProp('outline', !!val); }
  changeColor(val)   { if (DECAL_COLORS.includes(val)) this._changeProp('color', val); }

  _changeProp(prop, val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature[prop] = val;
    this._rebuildSelected();
  }

  // ── Edit-panel store sync ─────────────────────────────────────────────────

  _showProperties() {
    const s = this.editor._editorStore;
    if (!s || !this.selected) return;
    s.selectedType = 'surfaceDecalEdit';
    this._syncEditPanel();
  }

  _hideProperties() {
    if (this.editor._editorStore?.selectedType === 'surfaceDecalEdit')
      this.editor._editorStore.selectedType = null;
  }

  _syncEditPanel() {
    const s = this.editor._editorStore?.surfaceDecal;
    if (!s || !this.selected) return;
    const f = this.selected.feature;
    s.shape    = f.shape ?? 'arrow';
    s.shapes   = DECAL_SHAPES;
    s.hasCount = COUNTED_SHAPES.includes(s.shape);
    s.count    = f.count ?? 1;
    s.outline    = !!f.outline;
    s.hasOutline = OUTLINE_SHAPES.includes(s.shape);
    s.color      = f.color ?? 'white';
    s.colors     = DECAL_COLORS;
    s.angle   = Math.round(f.angle ?? 0);
    s.width   = +(f.width ?? 4).toFixed(1);
    s.depth   = +(f.depth ?? 4).toFixed(1);
    s.opacity = +(f.opacity ?? 1).toFixed(2);
  }

  // ── Ghost preview ─────────────────────────────────────────────────────────

  _createGhost() {
    if (this._ghost) return;

    this._ghostMat = new StandardMaterial('_surfaceDecalGhostMat', this._scene);
    this._ghostMat.alphaMode  = Engine.ALPHA_COMBINE;
    this._ghostMat.backFaceCulling = false;
    this._ghostMat.disableLighting = true;
    this._ghostMat.useAlphaFromDiffuseTexture = true;
    this._ghostMat.zOffset    = -2;
    this._ghostMat.alpha      = this._opacity;
    this._updateGhostTexture();

    // Flat plane — 1×1, scaled to width×depth
    this._ghost = MeshBuilder.CreatePlane('_surfaceDecalGhost', { size: 1 }, this._scene);
    this._ghost.rotation.x = Math.PI / 2;
    this._ghost.isPickable  = false;
    this._ghost.material    = this._ghostMat;
    this._updateGhostTransform();
    this._ghost.setEnabled(false);

    this._scene.onPointerObservable.add(this._boundPointerMove);
  }

  _destroyGhost() {
    this._scene?.onPointerObservable.removeCallback(this._boundPointerMove);
    this._ghost?.dispose();
    this._ghost = null;
    this._ghostMat?.dispose();
    this._ghostMat = null;
  }

  _updateGhostTexture() {
    if (!this._ghostMat) return;
    // Wear is baked per world size, so the footprint is part of the key
    // (rounded, matching SurfaceDecalManager._getMaterial).
    const worldWidth = Math.max(1, Math.round(this._width));
    const worldDepth = Math.max(1, Math.round(this._depth));
    const key = `${this._shape}:${this._count}:${this._outline}:${this._color}:${worldWidth}x${worldDepth}`;
    if (!this._ghostTexCache.has(key)) {
      this._ghostTexCache.set(key, createDecalTexture(this._scene, this._shape, {
        color: this._color,
        count: this._count,
        outline: this._outline,
        worldWidth,
        worldDepth,
      }));
    }
    const tex = this._ghostTexCache.get(key);
    this._ghostMat.diffuseTexture  = tex;
    this._ghostMat.emissiveTexture = tex;
  }

  _updateGhostTransform() {
    if (!this._ghost) return;
    this._ghost.scaling.x  = this._width;
    this._ghost.scaling.y  = this._depth;
    this._ghost.rotation.y = ((this._angle + GHOST_ROTATION_OFFSET_DEG) * Math.PI) / 180;
  }

  // ── Pointer move — move ghost to cursor ───────────────────────────────────

  _onPointerMove(pointerInfo) {
    if (!this._ghost || !this.isOpen) return;
    const pick = this._scene.pick(this._scene.pointerX, this._scene.pointerY);
    if (pick?.hit && pick.pickedPoint) {
      const p = pick.pickedPoint;
      this._ghost.position.set(p.x, p.y + 0.05, p.z);
      this._ghost.setEnabled(true);
    } else {
      this._ghost.setEnabled(false);
    }
  }

  // ── Stamp on click ────────────────────────────────────────────────────────

  /**
   * Called by EditorController.handlePointerDown when selectedType === 'surfaceDecal'.
   */
  stamp(x, z) {
    if (!this._decalManager || !this._track) return;

    const feature = {
      type:    'surfaceDecal',
      centerX: x,
      centerZ: z,
      shape:   this._shape,
      color:   this._color,
      count:   this._count,
      outline: this._outline,
      width:   this._width,
      depth:   this._depth,
      angle:   this._angle,
      opacity: this._opacity,
    };

    this.editor.saveSnapshot();
    this._track.features.push(feature);
    this._decalManager.createDecal(feature);
    this._syncHandles();
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  onKeyDown(event) {
    if (!this.isOpen) return false;
    const key = event.key.toLowerCase();
    if (key === 'q') {
      this.setAngle((this._angle - 15 + 360) % 360);
      return true;
    }
    if (key === 'e') {
      this.setAngle((this._angle + 15) % 360);
      return true;
    }
    return false;
  }

  // ── Mouse wheel (scale) ───────────────────────────────────────────────────

  _onWheel(event) {
    if (!this.isOpen) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.5 : 0.5;
    this._width  = Math.max(0.5, this._width  + delta);
    this._depth  = Math.max(0.5, this._depth  + delta);
    this._updateGhostTexture();
    this._updateGhostTransform();
    this._syncStore();
  }

  // ── Panel actions (called from store / Vue) ───────────────────────────────

  setShape(shape) {
    if (!DECAL_SHAPES.includes(shape) || shape === this._shape) return;
    this._shape = shape;
    this._updateGhostTexture();
    this._syncStore();
  }

  setCount(val) {
    const next = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(val)));
    if (next === this._count) return;
    this._count = next;
    this._updateGhostTexture();
    this._syncStore();
  }

  setColor(val) {
    if (!DECAL_COLORS.includes(val) || val === this._color) return;
    this._color = val;
    this._updateGhostTexture();
    this._syncStore();
  }

  setOutline(val) {
    const next = !!val;
    if (next === this._outline) return;
    this._outline = next;
    this._updateGhostTexture();
    this._syncStore();
  }

  setAngle(val) {
    this._angle = ((val % 360) + 360) % 360;
    this._updateGhostTransform();
    this._syncStore();
  }

  setOpacity(val) {
    this._opacity = val;
    if (this._ghostMat) this._ghostMat.alpha = val;
    this._syncStore();
  }

  setWidth(val) {
    this._width = val;
    this._updateGhostTexture();
    this._updateGhostTransform();
    this._syncStore();
  }

  setDepth(val) {
    this._depth = val;
    this._updateGhostTexture();
    this._updateGhostTransform();
    this._syncStore();
  }

  setSize(width, depth) {
    this._width = width;
    this._depth = depth;
    this._updateGhostTexture();
    this._updateGhostTransform();
    this._syncStore();
  }

  // ── Store sync ────────────────────────────────────────────────────────────

  _syncStore() {
    const s = this.editor._editorStore?.surfaceDecal;
    if (!s) return;
    s.shape  = this._shape;
    s.shapes = DECAL_SHAPES;
    s.count = this._count;
    s.hasCount = COUNTED_SHAPES.includes(this._shape);
    s.outline = this._outline;
    s.hasOutline = OUTLINE_SHAPES.includes(this._shape);
    s.color = this._color;
    s.colors = DECAL_COLORS;
    s.angle = Math.round(this._angle);
    s.width = +this._width.toFixed(1);
    s.depth = +this._depth.toFixed(1);
    s.opacity = +this._opacity.toFixed(2);
  }
}
