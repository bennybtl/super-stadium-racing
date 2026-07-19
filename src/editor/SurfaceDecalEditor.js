import {
  MeshBuilder,
  StandardMaterial,
  Engine,
  Vector3,
  Color3,
  HighlightLayer,
} from "@babylonjs/core";
import { DECAL_SHAPES, createDecalTexture } from "../managers/decalShapes.js";

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
    this._ghostTexCache = new Map(); // shape → DynamicTexture

    // Current stamp state
    this._shape = DECAL_SHAPES[0];
    this._color = 'white';
    this._angle = 0;
    this._width = 4;
    this._depth = 4;
    this._opacity = 1;

    // Reference to the live SurfaceDecalManager set by EditorMode
    this._decalManager = null;

    // Selection/edit state — a { feature, mesh } entry owned by the manager.
    this.selected = null;
    this._highlight = null;   // HighlightLayer (lazy)

    this._boundPointerMove = this._onPointerMove.bind(this);
    this._boundWheel       = this._onWheel.bind(this);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  activate(scene, track) {
    this._scene = scene;
    this._track = track;
  }

  /** Called by EditorMode after SceneBuilder creates SurfaceDecalManager. */
  setDecalManager(manager) {
    this._decalManager = manager;
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
  findByMesh(mesh) {
    return this._decalManager?.findByMesh(mesh) ?? null;
  }

  /** Clear selection state on snapshot restore (the manager rebuilds the meshes). */
  clearMeshes() {
    this.deselect();
  }

  select(entry) {
    if (!entry) return;
    this.deselect();
    this.selected = entry;
    this.editor._rawDragPos = { x: entry.feature.centerX, z: entry.feature.centerZ };
    this._applyHighlight();
    this._showProperties();
  }

  deselect() {
    if (!this.selected) return;
    this._clearHighlight();
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

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const { feature } = this.selected;
    const idx = this.editor.currentTrack.features.indexOf(feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    this._clearHighlight();
    this._decalManager.removeByFeature(feature);
    this.selected = null;
    this.editor._rawDragPos = null;
    this._hideProperties();
  }

  // ── Property edits (from the edit panel) ──────────────────────────────────

  changeWidth(val)   { this._changeProp('width', val); }
  changeDepth(val)   { this._changeProp('depth', val); }
  changeAngle(val)   { this._changeProp('angle', ((val % 360) + 360) % 360); }
  changeOpacity(val) { this._changeProp('opacity', val); }

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
    const s = this.editor._editorStore?.surfaceDecalEdit;
    if (!s || !this.selected) return;
    const f = this.selected.feature;
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
    if (!this._ghostTexCache.has(this._shape)) {
      this._ghostTexCache.set(this._shape, createDecalTexture(this._scene, this._shape, this._color));
    }
    const tex = this._ghostTexCache.get(this._shape);
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
      width:   this._width,
      depth:   this._depth,
      angle:   this._angle,
      opacity: this._opacity,
    };

    this.editor.saveSnapshot();
    this._track.features.push(feature);
    this._decalManager.createDecal(feature);
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
    this._updateGhostTransform();
    this._syncStore();
  }

  setDepth(val) {
    this._depth = val;
    this._updateGhostTransform();
    this._syncStore();
  }

  setSize(width, depth) {
    this._width = width;
    this._depth = depth;
    this._updateGhostTransform();
    this._syncStore();
  }

  // ── Store sync ────────────────────────────────────────────────────────────

  _syncStore() {
    const s = this.editor._editorStore?.surfaceDecal;
    if (!s) return;
    s.shape  = this._shape;
    s.shapes = DECAL_SHAPES;
    s.angle = Math.round(this._angle);
    s.width = +this._width.toFixed(1);
    s.depth = +this._depth.toFixed(1);
    s.opacity = +this._opacity.toFixed(2);
  }
}
