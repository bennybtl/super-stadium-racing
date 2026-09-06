import {
  MeshBuilder,
  StandardMaterial,
  Engine,
  Vector3,
  Quaternion,
} from "@babylonjs/core";
import { DECAL_SHAPES, COUNTED_SHAPES, OUTLINE_SHAPES, TEXT_SHAPES, DECAL_COLORS, DECAL_BRANDS, DEFAULT_BRAND, MIN_COUNT, MAX_COUNT, createDecalTexture, decalPolylineLocalOutline } from "../managers/decalShapes.js";
import { decalStableU } from "../managers/groundDecal.js";
import { DEFAULT_CORNER_RADIUS, expandPolyline } from "../utils/polyline-utils.js";
import { GizmoHandle } from "./GizmoHandle.js";
import { EditorMaterials, LINE_COLOR_SURFACE_DECAL } from "./EditorMaterials.js";
import { gizmoY, gizmoLineY, deckTopY } from './gizmo-height.js';

const POLY_POINT_MIN = 2; // open polyline — a bare segment is valid

// A surface with normal.y above this is "flat" (ground / bridge deck): the
// polyline shape and the XZ-plane drag only apply there.
const FLAT_NORMAL_Y = 0.7;

// Normalize degrees into [-180, 180) — decal rotation is signed.
const norm180 = (deg) => ((deg % 360) + 540) % 360 - 180;

const SIZE_MIN = 0.5;
const SIZE_MAX = 30;
const clampSize = (v) => Math.max(SIZE_MIN, Math.min(SIZE_MAX, v));
const DEG = Math.PI / 180;

/**
 * DecalEditor — stamp-mode editor for programmatic decals on any surface
 * (ground, bridge deck, wall, ramp). Feature shape:
 *   { type:"decal", position:[x,y,z], normal:[x,y,z], rotation:<deg>, shape, … }
 * `rotation` is about the surface normal in groundDecal's stable frame.
 *
 * Controls:
 *   - Mouse move   : ghost preview follows the cursor, orienting to the surface
 *   - Click        : stamp the current decal where the ghost sits
 *   - Q / E        : rotate by 15° increments
 *   - Mouse wheel  : scale up / down
 *   - Drag a placed decal : flat → slide on the XZ plane; wall → re-pick the
 *                           surface (slides around corners)
 */
export class DecalEditor {
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
    this._text = 'TEXT';
    this._brand = DEFAULT_BRAND;
    this._rotation = 0;
    this._width = 4;
    this._height = 4;
    // When true, width/depth resize together (aspect preserved); the panel
    // collapses to one "Scale" slider. Not applied to the polyline shape.
    this._linkScale = true;
    this._opacity = 1;
    this._thickness = 1; // polyline shape only — stroke width in world units

    // Reference to the live DecalManager, set by EditorController.setDecalManager
    this._decalManager = null;

    // Selection/edit state — a { feature, mesh } entry owned by the manager.
    this.selected = null;
    this._selectedPointIndex = -1; // polyline: index into feature.points, -1 = whole-decal handle
    this._handles = new Map(); // manager entry -> { handle: GizmoHandle, pointHandles: Mesh[], lineSystem: Mesh|null }

    this._boundPointerMove = this._onPointerMove.bind(this);
    this._boundWheel       = this._onWheel.bind(this);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  activate(scene, track) {
    this._scene = scene;
    this._track = track;
    this._syncHandles();
  }

  /** Wired by EditorController.setDecalManager. */
  setDecalManager(manager) {
    this._decalManager = manager;
    this._syncHandles();
  }

  /**
   * Reconcile one handle sphere (+ point handles/path for polyline decals)
   * per manager entry. The manager owns the decal meshes and recreates its
   * entries wholesale on snapshot restore, so handles are reconciled (create
   * missing / drop orphaned / reposition) rather than created once alongside
   * a visual.
   */
  /** Handle Y at (x, z), riding a bridge deck when a decal sits on one. */
  _handleY(x, z, lineClearance = false) {
    const top = deckTopY(this.editor?.terrainQuery, x, z);
    return lineClearance
      ? gizmoLineY(this._track, x, z, top)
      : gizmoY(this._track, x, z, top);
  }

  // ── Feature shape helpers ({ position:[x,y,z], normal:[x,y,z], rotation }) ──
  _fx(f) { return f.position?.[0] ?? 0; }
  _fy(f) { return f.position?.[1] ?? 0; }
  _fz(f) { return f.position?.[2] ?? 0; }
  _isFlat(f) { const n = f.normal; return !Array.isArray(n) || Math.abs(n[1] ?? 1) > FLAT_NORMAL_Y; }
  _setXZ(f, x, z) { f.position = [x, f.position?.[1] ?? 0, z]; }

  /** Where the gizmo handle sits: flat decals ride the surface, walls sit at the point. */
  _handlePos(f) {
    if (this._isFlat(f)) {
      return { x: this._fx(f), y: this._handleY(this._fx(f), this._fz(f)), z: this._fz(f) };
    }
    return { x: this._fx(f), y: this._fy(f), z: this._fz(f) };
  }

  _syncHandles() {
    const entries = this._decalManager?.entries;
    if (!entries || !this._scene || !this._track) return;

    for (const [entry, h] of this._handles) {
      if (!entries.includes(entry)) {
        h.handle.dispose();
        for (const p of h.pointHandles) p.dispose();
        h.lineSystem?.dispose();
        this._handles.delete(entry);
      }
    }

    for (const entry of entries) {
      let h = this._handles.get(entry);
      if (!h) {
        h = { handle: new GizmoHandle(this._scene, 'decal'), pointHandles: [], lineSystem: null };
        this._handles.set(entry, h);
      }
      const hp = this._handlePos(entry.feature);
      h.handle.setPosition(hp.x, hp.y, hp.z);
      h.handle.setSelected(entry === this.selected);

      if (entry.feature.shape === 'polyline') {
        this._syncPolylineHandles(entry, h);
      } else if (h.pointHandles.length || h.lineSystem) {
        for (const p of h.pointHandles) p.dispose();
        h.pointHandles = [];
        h.lineSystem?.dispose();
        h.lineSystem = null;
      }
    }
  }

  /** Reconcile a polyline decal's per-vertex handles + path against its point count. */
  _syncPolylineHandles(entry, h) {
    const points = entry.feature.points || [];
    const mats = EditorMaterials.for(this._scene).handleMaterials('decal');

    while (h.pointHandles.length < points.length) {
      const idx = h.pointHandles.length;
      const mesh = MeshBuilder.CreateSphere(`sdPolyPt_${idx}`, { diameter: 1.2, segments: 8 }, this._scene);
      mesh.material = mats.handle;
      mesh.isPickable = true;
      h.pointHandles.push(mesh);
    }
    while (h.pointHandles.length > points.length) {
      h.pointHandles.pop().dispose();
    }

    const isSelectedEntry = entry === this.selected;
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      h.pointHandles[i].position.set(pt.x, this._handleY(pt.x, pt.z), pt.z);
      const isActive = isSelectedEntry && i === this._selectedPointIndex;
      h.pointHandles[i].material = isActive ? mats.selected : mats.handle;
    }

    h.lineSystem?.dispose();
    h.lineSystem = this._buildPolylineLine(points);
  }

  _buildPolylineLine(points) {
    if (!points || points.length < POLY_POINT_MIN) return null;
    const expanded = expandPolyline(points, false);
    const linePoints = expanded.map(p => new Vector3(p.x, this._handleY(p.x, p.z, true), p.z));
    const ls = MeshBuilder.CreateLineSystem('sdPolyLine', { lines: [linePoints] }, this._scene);
    ls.color = LINE_COLOR_SURFACE_DECAL;
    ls.isPickable = false;
    return ls;
  }

  _polylineCenter(points) {
    if (!points?.length) return { x: 0, z: 0 };
    let sx = 0, sz = 0;
    for (const p of points) { sx += p.x; sz += p.z; }
    return { x: sx / points.length, z: sz / points.length };
  }

  /** Open the stamp panel — called from EditorController.openDecalStamp(). */
  open() {
    this._createGhost();
    this._scene.getEngine().getRenderingCanvas()?.addEventListener('wheel', this._boundWheel, { passive: false });
    if (this.editor._editorStore) {
      this.editor._editorStore.selectedType = 'decal';
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
    return this.editor._editorStore?.selectedType === 'decal';
  }

  dispose() {
    this.close();
    this.deselect();
    for (const h of this._handles.values()) {
      h.handle.dispose();
      for (const p of h.pointHandles) p.dispose();
      h.lineSystem?.dispose();
    }
    this._handles.clear();
    for (const tex of this._ghostTexCache.values()) tex.dispose();
    this._ghostTexCache.clear();
    this._ghostMat?.dispose();
    this._ghostMat = null;
  }

  // ── Selection & editing of placed decals ──────────────────────────────────
  //
  // Independent of stamp mode: you close the stamp panel, then click a placed
  // arrow to select it. Edits mutate the feature and rebuild the baked decal
  // mesh (CreateDecal geometry can't just be transformed).

  /** Map a picked mesh to its manager entry — used by EditorController's selection loop. */
  /** Global gizmo-visibility toggle (EditorController.setGizmosVisible). */
  setHandlesVisible(visible) {
    for (const h of this._handles.values()) {
      h.handle.setVisible(visible);
      for (const p of h.pointHandles) {
        p.isVisible = visible;
        p.isPickable = visible;
      }
      if (h.lineSystem) h.lineSystem.isVisible = visible;
    }
  }

  findByMesh(mesh) {
    // Self-heal if the manager rebuilt its entries behind our back.
    if (this._handles.size !== (this._decalManager?.entries?.length ?? 0)) this._syncHandles();
    for (const [entry, h] of this._handles) {
      if (h.handle.mesh === mesh) { entry._pendingPointIndex = -1; return entry; }
      const idx = h.pointHandles.indexOf(mesh);
      if (idx !== -1) { entry._pendingPointIndex = idx; return entry; }
    }
    return this._decalManager?.findByMesh(mesh) ?? null;
  }

  /**
   * Handle pointer selection for the center/point handles. Returns true when
   * the click was consumed by this editor (mirrors TerrainShapeEditor / ActionZoneEditor).
   */
  onPointerDown(mesh) {
    const entry = this.findByMesh(mesh);
    if (!entry) return false;

    const nextPointIndex = entry._pendingPointIndex ?? -1;
    const sameEntry = this.selected === entry;
    const samePoint = sameEntry && this._selectedPointIndex === nextPointIndex;

    if (samePoint) {
      delete entry._pendingPointIndex;
      return true;
    }

    if (!sameEntry) this.editor.deselectAll();
    this.select(entry);
    return true;
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
    this._selectedPointIndex = entry._pendingPointIndex ?? -1;
    delete entry._pendingPointIndex;

    const { feature } = entry;
    if (feature.shape === 'polyline' && this._selectedPointIndex >= 0) {
      const pt = feature.points[this._selectedPointIndex];
      this.editor._rawDragPos = { x: pt.x, z: pt.z };
    } else {
      this.editor._rawDragPos = { x: this._fx(feature), z: this._fz(feature) };
    }

    this._applyHandleVisualState(entry, true);
    this._showProperties();
  }

  deselect() {
    if (!this.selected) return;
    this._applyHandleVisualState(this.selected, false);
    this.selected = null;
    this._selectedPointIndex = -1;
    this.editor._rawDragPos = null;
    this._hideProperties();
  }

  _applyHandleVisualState(entry, selected) {
    const h = this._handles.get(entry);
    if (!h) return;
    h.handle.setSelected(selected);
    if (!h.pointHandles.length) return;
    const mats = EditorMaterials.for(this._scene).handleMaterials('decal');
    for (let i = 0; i < h.pointHandles.length; i++) {
      const isActive = selected && i === this._selectedPointIndex;
      h.pointHandles[i].material = isActive ? mats.selected : mats.handle;
    }
  }

  /** Rebuild the selected decal's baked mesh after a feature edit. */
  _rebuildSelected() {
    if (!this.selected) return;
    this._decalManager.rebuild(this.selected);
    this._syncHandles();
  }

  // ── Move / rotate (drag + Q/E, via EditorController selection interaction) ──

  move(movement) {
    if (!this.selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    const { feature } = this.selected;

    // Non-polyline decals follow whatever surface is under the cursor, so a decal
    // can be dragged between faces in either direction — ground → wall, wall →
    // ground, onto a ramp. A wall/ramp hit snaps straight to the pick (the XZ
    // delta means nothing off-horizontal); a flat hit while the decal is
    // currently a wall decal flips it back to flat, then falls through to the
    // XZ-plane drag below. (Polyline decals are flat-only — skip all this.)
    if (feature.shape !== 'polyline') {
      const hit = this._pickTargetSurface();
      const hitFlat = hit && Math.abs(hit.normal.y) > FLAT_NORMAL_Y;
      if (hit && !hitFlat) {
        this.editor.saveSnapshot(true);
        const [px, py, pz] = feature.position ?? [0, 0, 0];
        feature.position = [hit.point.x, hit.point.y, hit.point.z];
        feature.normal = [hit.normal.x, hit.normal.y, hit.normal.z];
        this._rebuildSelected();
        return new Vector3(feature.position[0] - px, feature.position[1] - py, feature.position[2] - pz);
      }
      if (hit && hitFlat && !this._isFlat(feature)) {
        this.editor.saveSnapshot(true);
        feature.normal = [0, 1, 0];
        feature.position = [hit.point.x, hit.point.y, hit.point.z];
        this.editor._rawDragPos = { x: hit.point.x, z: hit.point.z };
        this._rebuildSelected();
      } else if (!this._isFlat(feature)) {
        // Wall decal, cursor off any target surface — leave it put.
        return new Vector3(0, 0, 0);
      }
    }

    this.editor.saveSnapshot(true);
    const isPolyPoint = feature.shape === 'polyline' && this._selectedPointIndex >= 0;

    if (!this.editor._rawDragPos) {
      this.editor._rawDragPos = isPolyPoint
        ? { x: feature.points[this._selectedPointIndex].x, z: feature.points[this._selectedPointIndex].z }
        : { x: this._fx(feature), z: this._fz(feature) };
    }
    this.editor._rawDragPos.x += movement.x;
    this.editor._rawDragPos.z += movement.z;

    if (isPolyPoint) {
      const pt = feature.points[this._selectedPointIndex];
      const prevX = pt.x, prevZ = pt.z;
      pt.x = this.editor._snap(this.editor._rawDragPos.x);
      pt.z = this.editor._snap(this.editor._rawDragPos.z);
      const c = this._polylineCenter(feature.points);
      this._setXZ(feature, c.x, c.z);
      this._rebuildSelected();
      return new Vector3(pt.x - prevX, 0, pt.z - prevZ);
    }

    const prevX = this._fx(feature), prevZ = this._fz(feature);
    const nextX = this.editor._snap(this.editor._rawDragPos.x);
    const nextZ = this.editor._snap(this.editor._rawDragPos.z);
    const dx = nextX - prevX, dz = nextZ - prevZ;
    this._setXZ(feature, nextX, nextZ);
    if (feature.shape === 'polyline') {
      feature.points = feature.points.map(p => ({ ...p, x: p.x + dx, z: p.z + dz }));
    }
    this._rebuildSelected();
    return new Vector3(dx, 0, dz);
  }

  rotate(deltaRad) {
    if (!this.selected || this.selected.feature.shape === 'polyline') return;
    const f = this.selected.feature;
    f.rotation = norm180((f.rotation ?? 0) + deltaRad * 180 / Math.PI);
    this._rebuildSelected();
    this._syncEditPanel();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  duplicateSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const src = this.selected.feature;
    const flat = this._isFlat(src);
    const off = flat ? [3, 0, 3] : (Math.abs(src.normal?.[0] ?? 0) > 0.7 ? [0, 0, 3] : [3, 0, 0]);
    const newFeature = {
      ...src,
      position: [this._fx(src) + off[0], this._fy(src) + off[1], this._fz(src) + off[2]],
    };
    if (src.shape === 'polyline' && Array.isArray(src.points)) {
      newFeature.points = src.points.map(p => ({ ...p, x: p.x + off[0], z: p.z + off[2] }));
    }
    this.editor.currentTrack.features.push(newFeature);
    const mesh = this._decalManager.createDecal(newFeature);
    if (!mesh) return;
    this._syncHandles();
    this.select(this._decalManager.findByMesh(mesh));
  }

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const { feature } = this.selected;
    const idx = this.editor.currentTrack.features.indexOf(feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    this._decalManager.removeByFeature(feature);
    this.selected = null;
    this._selectedPointIndex = -1;
    this._syncHandles();
    this.editor._rawDragPos = null;
    this._hideProperties();
  }

  // ── Polyline point editing ──────────────────────────────────────────────────

  /** True when a point can carry a corner radius — needs both an incoming and outgoing segment. */
  _canHaveRadius(idx, pointCount) {
    return idx > 0 && idx < pointCount - 1;
  }

  insertPoint() {
    if (!this.selected || this.selected.feature.shape !== 'polyline') return;
    const feature = this.selected.feature;
    if (!Array.isArray(feature.points) || feature.points.length < POLY_POINT_MIN) return;

    this.editor.saveSnapshot();

    // Open line — no wraparound: inserting after the last point clamps against
    // itself (same as PolyWallEditor), inserting elsewhere splits that segment.
    const fromIdx = this._selectedPointIndex >= 0 ? this._selectedPointIndex : feature.points.length - 1;
    const toIdx = Math.min(fromIdx + 1, feature.points.length - 1);
    const a = feature.points[fromIdx];
    const b = feature.points[toIdx];
    const next = {
      x: this.editor._snap((a.x + b.x) * 0.5),
      z: this.editor._snap((a.z + b.z) * 0.5),
      radius: DEFAULT_CORNER_RADIUS,
    };

    feature.points.splice(fromIdx + 1, 0, next);
    this._selectedPointIndex = fromIdx + 1;
    this.editor._rawDragPos = { x: next.x, z: next.z };

    const c = this._polylineCenter(feature.points);
    this._setXZ(feature, c.x, c.z);

    this._rebuildSelected();
    this._syncEditPanel();
  }

  deletePoint() {
    if (!this.selected || this.selected.feature.shape !== 'polyline') return;
    const feature = this.selected.feature;
    if (this._selectedPointIndex < 0) return;
    if (!Array.isArray(feature.points) || feature.points.length <= POLY_POINT_MIN) return;

    this.editor.saveSnapshot();
    feature.points.splice(this._selectedPointIndex, 1);
    this._selectedPointIndex = Math.min(this._selectedPointIndex, feature.points.length - 1);

    const c = this._polylineCenter(feature.points);
    this._setXZ(feature, c.x, c.z);

    if (this._selectedPointIndex >= 0) {
      const pt = feature.points[this._selectedPointIndex];
      this.editor._rawDragPos = { x: pt.x, z: pt.z };
    } else {
      this.editor._rawDragPos = { x: this._fx(feature), z: this._fz(feature) };
    }

    this._rebuildSelected();
    this._syncEditPanel();
  }

  changeRadius(val) {
    if (!this.selected || this.selected.feature.shape !== 'polyline') return;
    const feature = this.selected.feature;
    if (this._selectedPointIndex < 0 || !this._canHaveRadius(this._selectedPointIndex, feature.points.length)) return;
    this.editor.saveSnapshot(true);
    feature.points[this._selectedPointIndex].radius = Math.max(0, val);
    this._rebuildSelected();
  }

  changeThickness(val) {
    if (!this.selected || this.selected.feature.shape !== 'polyline') return;
    this.editor.saveSnapshot(true);
    this.selected.feature.thickness = Math.max(0.1, val);
    this._rebuildSelected();
  }

  // ── Property edits (from the edit panel) ──────────────────────────────────

  changeWidth(val)   { this._changeSize('width', val); }
  changeHeight(val)   { this._changeSize('height', val); }
  changeRotation(val)   { this._changeProp('rotation', norm180(val)); }
  changeOpacity(val) { this._changeProp('opacity', val); }
  changeCount(val)   { this._changeProp('count', Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(val)))); }
  changeOutline(val) { this._changeProp('outline', !!val); }
  changeColor(val)   { if (DECAL_COLORS.includes(val)) this._changeProp('color', val); }
  changeText(val)    { this._changeProp('text', String(val ?? '')); }
  changeBrand(val)   { this._changeProp('brand', val); }

  _changeProp(prop, val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature[prop] = val;
    this._rebuildSelected();
  }

  /** Resize a placed decal. In linked mode the other dimension scales with it
   *  (aspect preserved); never linked for the polyline shape. */
  _changeSize(dim, val) {
    if (!this.selected) return;
    val = clampSize(val);
    this.editor.saveSnapshot(true);
    const f = this.selected.feature;
    const other = dim === 'width' ? 'height' : 'width';
    if (this._linkScale && f.shape !== 'polyline') {
      const factor = val / ((f[dim] ?? 4) || val);
      f[other] = clampSize((f[other] ?? 4) * factor);
    }
    f[dim] = val;
    this._rebuildSelected();
  }

  // ── Edit-panel store sync ─────────────────────────────────────────────────

  _showProperties() {
    const s = this.editor._editorStore;
    if (!s || !this.selected) return;
    s.selectedType = 'decalEdit';
    this._syncEditPanel();
  }

  _hideProperties() {
    if (this.editor._editorStore?.selectedType === 'decalEdit')
      this.editor._editorStore.selectedType = null;
  }

  _syncEditPanel() {
    const s = this.editor._editorStore?.decal;
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
    s.text       = f.text ?? '';
    s.hasText    = TEXT_SHAPES.includes(s.shape);
    s.brand      = f.brand ?? DEFAULT_BRAND;
    s.brands     = DECAL_BRANDS;
    s.hasBrand   = s.shape === 'brand';
    s.rotation   = Math.round(f.rotation ?? 0);
    s.width   = +(f.width ?? 4).toFixed(1);
    s.height   = +(f.height ?? 4).toFixed(1);
    s.linkScale = this._linkScale;
    s.opacity = +(f.opacity ?? 1).toFixed(2);
    s.thickness = +(f.thickness ?? 1).toFixed(1);
    s.pointCount = s.shape === 'polyline' ? (f.points?.length ?? 0) : 0;
    s.selectedPointIndex = s.shape === 'polyline' ? this._selectedPointIndex : -1;
    s.canHaveRadius = s.shape === 'polyline' && this._selectedPointIndex >= 0
      && this._canHaveRadius(this._selectedPointIndex, f.points.length);
    s.radius = s.canHaveRadius ? (f.points[this._selectedPointIndex]?.radius ?? 0) : 0;
  }

  // ── Ghost preview ─────────────────────────────────────────────────────────

  _createGhost() {
    if (this._ghost) return;

    this._ghostMat = new StandardMaterial('_decalGhostMat', this._scene);
    this._ghostMat.alphaMode  = Engine.ALPHA_COMBINE;
    this._ghostMat.backFaceCulling = false;
    this._ghostMat.disableLighting = true;
    this._ghostMat.useAlphaFromDiffuseTexture = true;
    this._ghostMat.zOffset    = -2;
    this._ghostMat.alpha      = this._opacity;
    this._updateGhostTexture();

    // 1×1 plane, scaled to width×height and oriented to the surface under the
    // cursor via a quaternion (see _updateGhostTransform).
    this._ghost = MeshBuilder.CreatePlane('_decalGhost', { size: 1 }, this._scene);
    this._ghost.rotationQuaternion = Quaternion.Identity();
    this._ghost.isPickable  = false;
    this._ghost.material    = this._ghostMat;
    this._ghostNormal = new Vector3(0, 1, 0);
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
    // (rounded, matching DecalManager._getMaterial). A polyline's path
    // isn't captured by that footprint alone, so its default outline (the same
    // one stamp() would seed) + thickness join the key too.
    let worldWidth = Math.max(1, Math.round(this._width));
    let worldDepth = Math.max(1, Math.round(this._height));
    let localPoints = null;
    if (this._shape === 'polyline') {
      const pts = this._defaultPolylinePoints(0, 0, this._rotation, this._width);
      const outlineData = decalPolylineLocalOutline(pts, this._thickness);
      worldWidth = Math.max(1, Math.round(outlineData.width));
      worldDepth = Math.max(1, Math.round(outlineData.depth));
      localPoints = outlineData.localPoints;
      // Same angle decalPolylineLocalOutline hands the real decal's projector
      // box — reused here so the ghost plane rotates the identical way.
      this._ghostAngleRad = outlineData.angleRad;
    }
    this._ghostBoxWidth = worldWidth;
    this._ghostBoxHeight = worldDepth;
    const pointsKey = localPoints
      ? `${localPoints.map(p => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(';')}@${this._thickness.toFixed(1)}`
      : '';
    const brandKey = this._shape === 'brand' ? this._brand : '';
    const key = `${this._shape}:${this._count}:${this._outline}:${this._color}:${this._text}:${brandKey}:${worldWidth}x${worldDepth}:${pointsKey}`;
    if (!this._ghostTexCache.has(key)) {
      this._ghostTexCache.set(key, createDecalTexture(this._scene, this._shape, {
        color: this._color,
        count: this._count,
        outline: this._outline,
        text: this._text,
        brand: this._brand,
        worldWidth,
        worldDepth,
        localPoints,
        thickness: this._thickness,
      }));
    }
    const tex = this._ghostTexCache.get(key);
    this._ghostMat.diffuseTexture  = tex;
    this._ghostMat.emissiveTexture = tex;
  }

  /**
   * Default 2-point straight segment seeded when a polyline decal is stamped,
   * centered at (cx, cz) and oriented by `angleDeg` (same convention as the
   * stamp-mode Q/E angle) — length is the stamp-mode "Length" slider (reuses
   * `_width`). Endpoints carry no radius: rounding only applies to interior
   * points, which `insertPoint()` adds.
   */
  _defaultPolylinePoints(cx, cz, angleDeg, length) {
    const halfLen = Math.max(0.5, length / 2);
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.sin(rad) * halfLen;
    const dz = -Math.cos(rad) * halfLen;
    return [
      { x: cx - dx, z: cz - dz },
      { x: cx + dx, z: cz + dz },
    ];
  }

  _updateGhostTransform() {
    if (!this._ghost) return;
    const n = this._ghostNormal;
    const poly = this._shape === 'polyline';
    // Polyline's box dims + rotation come from decalPolylineLocalOutline (same
    // values the baked decal's projector box uses); other shapes use w/h + the
    // rotation slider directly.
    this._ghost.scaling.x = poly ? (this._ghostBoxWidth ?? this._width) : this._width;
    this._ghost.scaling.y = poly ? (this._ghostBoxHeight ?? this._height) : this._height;
    const rotRad = poly ? (this._ghostAngleRad ?? this._rotation * DEG) : this._rotation * DEG;

    // Align the plane so local +X → the decal's U axis and +Y → its texture-V
    // axis, matching what projectDecal bakes. The decal's frame (U, V, U×V) is
    // left-handed w.r.t. the surface normal (U×V = -n), so feed
    // RotationQuaternionFromAxisToRef the proper basis (u, v, u×v) — passing n
    // as the third axis gives an improper basis and a bogus rotation (90° off on
    // the ground, wrong on ramps / ±X walls; only ±Z walls happen to survive it).
    const u = decalStableU(n, rotRad);
    const v = Vector3.Cross(u, n);
    Quaternion.RotationQuaternionFromAxisToRef(u, v, Vector3.Cross(u, v), this._ghost.rotationQuaternion);
  }

  // ── Surface pick (ghost + stamp + wall drag) ─────────────────────────────

  /** Pointer pick restricted to decal-target surfaces (+ the ground). */
  _pickTargetSurface() {
    const pick = this._scene.pick(
      this._scene.pointerX, this._scene.pointerY,
      (m) => m?.isEnabled?.() && (m.metadata?.decalTarget === true || m.metadata?.surfaceDecalTarget === true),
    );
    if (!pick?.hit || !pick.pickedPoint) return null;
    const normal = pick.getNormal(true) ?? Vector3.Up();
    return { point: pick.pickedPoint, normal, mesh: pick.pickedMesh };
  }

  // ── Pointer move — ghost follows the cursor, orients to the surface ───────

  _onPointerMove() {
    if (!this._ghost) return;
    if (!this.isOpen) {
      this._ghost.setEnabled(false);
      return;
    }
    const hit = this._pickTargetSurface();
    // Polyline only makes sense on a roughly-flat surface.
    if (!hit || (this._shape === 'polyline' && Math.abs(hit.normal.y) < FLAT_NORMAL_Y)) {
      this._ghost.setEnabled(false);
      return;
    }
    this._ghostNormal = hit.normal.normalizeToNew();
    this._ghostHit = hit;
    this._ghost.position.copyFrom(hit.point).addInPlace(this._ghostNormal.scale(0.05));
    this._updateGhostTransform();
    this._ghost.setEnabled(true);
  }

  // ── Stamp on click ────────────────────────────────────────────────────────

  /**
   * Called by EditorController.handlePointerDown when selectedType === 'decal'.
   * Places one decal where the ghost sits, then drops into edit mode — the stamp
   * settings persist as the starting point for the next new decal.
   */
  stamp() {
    if (!this._decalManager || !this._track) return;
    const hit = this._ghostHit ?? this._pickTargetSurface();
    if (!hit) return;
    const n = hit.normal.normalizeToNew();
    if (this._shape === 'polyline' && Math.abs(n.y) < FLAT_NORMAL_Y) return;

    const feature = {
      type:     'decal',
      position: [hit.point.x, hit.point.y, hit.point.z],
      normal:   [n.x, n.y, n.z],
      rotation: this._rotation,
      shape:    this._shape,
      color:    this._color,
      count:    this._count,
      outline:  this._outline,
      brand:    this._brand,
      width:    this._width,
      height:   this._height,
      opacity:  this._opacity,
    };

    if (this._shape === 'polyline') {
      feature.points = this._defaultPolylinePoints(hit.point.x, hit.point.z, this._rotation, this._width);
      feature.thickness = this._thickness;
    }

    this.editor.saveSnapshot();
    this._track.features.push(feature);
    const mesh = this._decalManager.createDecal(feature);
    this._syncHandles();

    // Leave placement mode and edit the decal we just placed.
    this.close();
    const entry = this._decalManager.findByMesh(mesh);
    if (entry) this.select(entry);
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  onKeyDown(event) {
    if (!this.isOpen) return false;
    const key = event.key.toLowerCase();
    if (key === 'q') {
      this.setRotation(this._rotation - 15);
      return true;
    }
    if (key === 'e') {
      this.setRotation(this._rotation + 15);
      return true;
    }
    return false;
  }

  // ── Mouse wheel (scale) ───────────────────────────────────────────────────

  _onWheel(event) {
    if (!this.isOpen) return;
    event.preventDefault();
    if (this._linkScale && this._shape !== 'polyline') {
      // Multiplicative so the aspect ratio holds through the zoom.
      const factor = event.deltaY > 0 ? 1 / 1.1 : 1.1;
      this._width = clampSize(this._width * factor);
      this._height = clampSize(this._height * factor);
    } else {
      const delta = event.deltaY > 0 ? -0.5 : 0.5;
      this._width  = clampSize(this._width  + delta);
      this._height  = clampSize(this._height  + delta);
    }
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

  setText(val) {
    const next = String(val ?? '');
    if (next === this._text) return;
    this._text = next;
    this._updateGhostTexture();
    this._syncStore();
  }

  setBrand(val) {
    if (val === this._brand) return;
    this._brand = val;
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

  setRotation(val) {
    this._rotation = norm180(val);
    // Polyline bakes angle into the seeded points' texture, not just the
    // plane's rotation, so its ghost texture needs regenerating too.
    if (this._shape === 'polyline') this._updateGhostTexture();
    this._updateGhostTransform();
    this._syncStore();
  }

  setOpacity(val) {
    this._opacity = val;
    if (this._ghostMat) this._ghostMat.alpha = val;
    this._syncStore();
  }

  setLinkScale(val) {
    this._linkScale = !!val;
    this._syncStore();
  }

  setWidth(val) { this._applySize('width', val); }
  setHeight(val) { this._applySize('height', val); }

  /** Stamp-mode resize; in linked mode the other dimension tracks the change. */
  _applySize(dim, val) {
    val = clampSize(val);
    if (this._linkScale && this._shape !== 'polyline') {
      const cur = dim === 'width' ? this._width : this._height;
      const factor = val / (cur || val);
      if (dim === 'width') { this._width = val; this._height = clampSize(this._height * factor); }
      else { this._height = val; this._width = clampSize(this._width * factor); }
    } else if (dim === 'width') {
      this._width = val;
    } else {
      this._height = val;
    }
    this._updateGhostTexture();
    this._updateGhostTransform();
    this._syncStore();
  }

  setSize(width, depth) {
    this._width = width;
    this._height = depth;
    this._updateGhostTexture();
    this._updateGhostTransform();
    this._syncStore();
  }

  setThickness(val) {
    this._thickness = Math.max(0.1, val);
    this._updateGhostTexture();
    this._updateGhostTransform();
    this._syncStore();
  }

  // ── Store sync ────────────────────────────────────────────────────────────

  _syncStore() {
    const s = this.editor._editorStore?.decal;
    if (!s) return;
    s.shape  = this._shape;
    s.shapes = DECAL_SHAPES;
    s.count = this._count;
    s.hasCount = COUNTED_SHAPES.includes(this._shape);
    s.outline = this._outline;
    s.hasOutline = OUTLINE_SHAPES.includes(this._shape);
    s.color = this._color;
    s.colors = DECAL_COLORS;
    s.text = this._text;
    s.hasText = TEXT_SHAPES.includes(this._shape);
    s.brand = this._brand;
    s.brands = DECAL_BRANDS;
    s.hasBrand = this._shape === 'brand';
    s.rotation = Math.round(this._rotation);
    s.width = +this._width.toFixed(1);
    s.height = +this._height.toFixed(1);
    s.linkScale = this._linkScale;
    s.opacity = +this._opacity.toFixed(2);
    s.thickness = +this._thickness.toFixed(1);
    // No point/radius selection exists until a polyline decal is actually placed.
    s.pointCount = 0;
    s.selectedPointIndex = -1;
    s.canHaveRadius = false;
    s.radius = 0;
  }
}
