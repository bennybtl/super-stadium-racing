import {
  MeshBuilder,
  StandardMaterial,
  Engine,
  Vector3,
} from "@babylonjs/core";
import { DECAL_SHAPES, COUNTED_SHAPES, OUTLINE_SHAPES, TEXT_SHAPES, DECAL_COLORS, MIN_COUNT, MAX_COUNT, createDecalTexture, decalPolylineLocalOutline } from "../managers/decalShapes.js";
import { DEFAULT_CORNER_RADIUS, expandPolyline } from "../polyline-utils.js";
import { GizmoHandle } from "./GizmoHandle.js";
import { EditorMaterials, LINE_COLOR_SURFACE_DECAL } from "./EditorMaterials.js";
import { gizmoY, gizmoLineY } from './gizmo-height.js';

const POLY_POINT_MIN = 2; // open polyline — a bare segment is valid

// Babylon's CreateDecal (normal = +Y) bakes a −90° roll relative to a flat
// plane's yaw, so the ghost plane needs the same offset to visually match the
// stamped decal at every angle.
const GHOST_ROTATION_OFFSET_DEG = -90;

// Normalize degrees into [-180, 180) — decal rotation is signed.
const norm180 = (deg) => ((deg % 360) + 540) % 360 - 180;

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
    this._text = 'TEXT';
    this._angle = 0;
    this._width = 4;
    this._depth = 4;
    this._opacity = 1;
    this._thickness = 1; // polyline shape only — stroke width in world units

    // Reference to the live SurfaceDecalManager set by EditorMode
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

  /** Called by EditorMode after SceneBuilder creates SurfaceDecalManager. */
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
      const { centerX, centerZ } = entry.feature;
      h.handle.setPosition(centerX, gizmoY(this._track, centerX, centerZ), centerZ);
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
      h.pointHandles[i].position.set(pt.x, gizmoY(this._track, pt.x, pt.z), pt.z);
      const isActive = isSelectedEntry && i === this._selectedPointIndex;
      h.pointHandles[i].material = isActive ? mats.selected : mats.handle;
    }

    h.lineSystem?.dispose();
    h.lineSystem = this._buildPolylineLine(points);
  }

  _buildPolylineLine(points) {
    if (!points || points.length < POLY_POINT_MIN) return null;
    const expanded = expandPolyline(points, false);
    const linePoints = expanded.map(p => new Vector3(p.x, gizmoLineY(this._track, p.x, p.z), p.z));
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
      this.editor._rawDragPos = { x: feature.centerX, z: feature.centerZ };
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
    this.editor.saveSnapshot(true);
    const { feature } = this.selected;
    const isPolyPoint = feature.shape === 'polyline' && this._selectedPointIndex >= 0;

    if (!this.editor._rawDragPos) {
      this.editor._rawDragPos = isPolyPoint
        ? { x: feature.points[this._selectedPointIndex].x, z: feature.points[this._selectedPointIndex].z }
        : { x: feature.centerX, z: feature.centerZ };
    }
    this.editor._rawDragPos.x += movement.x;
    this.editor._rawDragPos.z += movement.z;

    if (isPolyPoint) {
      const pt = feature.points[this._selectedPointIndex];
      const prevX = pt.x, prevZ = pt.z;
      pt.x = this.editor._snap(this.editor._rawDragPos.x);
      pt.z = this.editor._snap(this.editor._rawDragPos.z);
      const c = this._polylineCenter(feature.points);
      feature.centerX = c.x;
      feature.centerZ = c.z;
      this._rebuildSelected();
      return new Vector3(pt.x - prevX, 0, pt.z - prevZ);
    }

    const prevX = feature.centerX, prevZ = feature.centerZ;
    const nextX = this.editor._snap(this.editor._rawDragPos.x);
    const nextZ = this.editor._snap(this.editor._rawDragPos.z);
    const dx = nextX - prevX, dz = nextZ - prevZ;
    feature.centerX = nextX;
    feature.centerZ = nextZ;
    if (feature.shape === 'polyline') {
      feature.points = feature.points.map(p => ({ ...p, x: p.x + dx, z: p.z + dz }));
    }
    this._rebuildSelected();
    return new Vector3(dx, 0, dz);
  }

  rotate(deltaRad) {
    if (!this.selected || this.selected.feature.shape === 'polyline') return;
    const f = this.selected.feature;
    f.angle = norm180((f.angle ?? 0) + deltaRad * 180 / Math.PI);
    this._rebuildSelected();
    this._syncEditPanel();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  duplicateSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const src = this.selected.feature;
    const newFeature = { ...src, centerX: src.centerX + 3, centerZ: src.centerZ + 3 };
    if (src.shape === 'polyline' && Array.isArray(src.points)) {
      newFeature.points = src.points.map(p => ({ ...p, x: p.x + 3, z: p.z + 3 }));
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
    feature.centerX = c.x;
    feature.centerZ = c.z;

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
    feature.centerX = c.x;
    feature.centerZ = c.z;

    if (this._selectedPointIndex >= 0) {
      const pt = feature.points[this._selectedPointIndex];
      this.editor._rawDragPos = { x: pt.x, z: pt.z };
    } else {
      this.editor._rawDragPos = { x: feature.centerX, z: feature.centerZ };
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

  changeWidth(val)   { this._changeProp('width', val); }
  changeDepth(val)   { this._changeProp('depth', val); }
  changeAngle(val)   { this._changeProp('angle', norm180(val)); }
  changeOpacity(val) { this._changeProp('opacity', val); }
  changeCount(val)   { this._changeProp('count', Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(val)))); }
  changeOutline(val) { this._changeProp('outline', !!val); }
  changeColor(val)   { if (DECAL_COLORS.includes(val)) this._changeProp('color', val); }
  changeText(val)    { this._changeProp('text', String(val ?? '')); }

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
    s.text       = f.text ?? '';
    s.hasText    = TEXT_SHAPES.includes(s.shape);
    s.angle   = Math.round(f.angle ?? 0);
    s.width   = +(f.width ?? 4).toFixed(1);
    s.depth   = +(f.depth ?? 4).toFixed(1);
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
    // (rounded, matching SurfaceDecalManager._getMaterial). A polyline's path
    // isn't captured by that footprint alone, so its default outline (the same
    // one stamp() would seed) + thickness join the key too.
    let worldWidth = Math.max(1, Math.round(this._width));
    let worldDepth = Math.max(1, Math.round(this._depth));
    let localPoints = null;
    if (this._shape === 'polyline') {
      const pts = this._defaultPolylinePoints(0, 0, this._angle, this._width);
      const outlineData = decalPolylineLocalOutline(pts, this._thickness);
      worldWidth = Math.max(1, Math.round(outlineData.width));
      worldDepth = Math.max(1, Math.round(outlineData.depth));
      localPoints = outlineData.localPoints;
      // Same angle decalPolylineLocalOutline hands the real decal's projector
      // box — reused here so the ghost plane rotates the identical way.
      this._ghostAngleRad = outlineData.angleRad;
    }
    this._ghostBoxWidth = worldWidth;
    this._ghostBoxDepth = worldDepth;
    const pointsKey = localPoints
      ? `${localPoints.map(p => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(';')}@${this._thickness.toFixed(1)}`
      : '';
    const key = `${this._shape}:${this._count}:${this._outline}:${this._color}:${this._text}:${worldWidth}x${worldDepth}:${pointsKey}`;
    if (!this._ghostTexCache.has(key)) {
      this._ghostTexCache.set(key, createDecalTexture(this._scene, this._shape, {
        color: this._color,
        count: this._count,
        outline: this._outline,
        text: this._text,
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
    if (this._shape === 'polyline') {
      // Box dims + angle both come from decalPolylineLocalOutline (computed in
      // _updateGhostTexture) — the same values the real decal's projector box
      // uses, so the ghost plane rotates/scales identically to the baked mesh.
      this._ghost.scaling.x  = this._ghostBoxWidth  ?? this._width;
      this._ghost.scaling.y  = this._ghostBoxDepth ?? this._depth;
      // Non-polyline shapes get here via rotation.y = (feature.angle + OFFSET)°
      // where the real decal is built with CreateDecal angle = -(feature.angle)°;
      // substituting that relationship for polyline's own CreateDecal angle
      // (`_ghostAngleRad`, already in radians, no sign flip) gives this directly.
      const angleRad = this._ghostAngleRad ?? (this._angle * Math.PI) / 180;
      this._ghost.rotation.y = -angleRad + (GHOST_ROTATION_OFFSET_DEG * Math.PI) / 180;
      return;
    }
    this._ghost.scaling.x  = this._width;
    this._ghost.scaling.y  = this._depth;
    this._ghost.rotation.y = ((this._angle + GHOST_ROTATION_OFFSET_DEG) * Math.PI) / 180;
  }

  // ── Pointer move — move ghost to cursor ───────────────────────────────────

  _onPointerMove(pointerInfo) {
    if (!this._ghost) return;
    if (!this.isOpen) {
      // Stamp mode was left without an explicit close() (e.g. selecting an
      // existing decal switches selectedType away from 'surfaceDecal') — hide
      // the ghost instead of leaving it frozen at its last position.
      this._ghost.setEnabled(false);
      return;
    }
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

    if (this._shape === 'polyline') {
      feature.points = this._defaultPolylinePoints(x, z, this._angle, this._width);
      feature.thickness = this._thickness;
    }

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
      this.setAngle(this._angle - 15);
      return true;
    }
    if (key === 'e') {
      this.setAngle(this._angle + 15);
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

  setText(val) {
    const next = String(val ?? '');
    if (next === this._text) return;
    this._text = next;
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
    this._angle = norm180(val);
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

  setThickness(val) {
    this._thickness = Math.max(0.1, val);
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
    s.text = this._text;
    s.hasText = TEXT_SHAPES.includes(this._shape);
    s.angle = Math.round(this._angle);
    s.width = +this._width.toFixed(1);
    s.depth = +this._depth.toFixed(1);
    s.opacity = +this._opacity.toFixed(2);
    s.thickness = +this._thickness.toFixed(1);
    // No point/radius selection exists until a polyline decal is actually placed.
    s.pointCount = 0;
    s.selectedPointIndex = -1;
    s.canHaveRadius = false;
    s.radius = 0;
  }
}
