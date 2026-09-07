import { Vector3, MeshBuilder } from "@babylonjs/core";
import { EditorMaterials } from './EditorMaterials.js';
import { REBUILD_DEBOUNCE_MS } from './editor-rebuild.js';
import { gizmoY, gizmoLineY } from './gizmo-height.js';
import { DEFAULT_CORNER_RADIUS } from '../utils/polyline-utils.js';

// How far past the track perimeter a control point may be dragged — matches the
// dead-space band that surrounds the editable area (ground mesh = track + 10 per
// side). Lets walls / curbs / hills be built right up to and into that band.
export const DEAD_SPACE_REACH = 10;

/**
 * PolyPointEditor — shared machinery for the editors whose feature is an ordered
 * list of `{ x, z, radius? }` control points, each shown as a draggable sphere
 * with a connecting preview line: polyWall, polyCurb, polyHill.
 *
 * One instance manages every feature of its `featureType`; the "active" one is
 * the feature currently being edited. Subclasses provide the small feature-
 * specific pieces:
 *
 *   _newFeature()                     → the seed object pushed by "Add"
 *   _rebuildGeometry(featureOrNull)   → the rebuild.* calls for this feature type
 *   _syncStoreExtra(slice, f, idx)    → feature-specific panel fields
 *
 * and may override `_pointY` / `_lineY` (default: ride the ground) or the snap
 * config. Everything else — gizmo pooling, selection, drag+snap, insert/delete,
 * duplicate, snapshot restore, visibility — lives here.
 *
 * Controller contract (unchanged across the three): `.selectedPoint`,
 * `moveSelectedPoint(dx,dz)`, `beginDrag()`, `endDrag()`, `deleteSelectedPoint()`,
 * `onPointerDown(mesh)`, `pickControlPoint()`, `onSnapshotRestored()`,
 * `refreshGizmoHeights()`, `deselect()`, `setHandlesVisible()`,
 * `discardActiveIfEmpty()`, `deactivate()`.
 */
export class PolyPointEditor {
  /**
   * @param {object} ec  EditorController
   * @param {object} cfg
   * @param {string} cfg.featureType   e.g. 'polyWall'
   * @param {string} [cfg.storeKey]    editor-store slice key (default: featureType)
   * @param {import('@babylonjs/core').Color3} cfg.lineColor  preview-line colour
   * @param {{normal:string,active:string,selected:string}} cfg.materials
   *        EditorMaterials getter names for the three node states
   * @param {string} cfg.spherePrefix  sphere mesh-name prefix (e.g. 'pwPt_')
   * @param {string} cfg.linePrefix    line mesh-name prefix (e.g. 'pwLines_')
   * @param {number} [cfg.sphereDiameter=1.4]
   * @param {number} [cfg.minPoints=2]
   */
  constructor(ec, cfg) {
    this.ec = ec;
    this.scene = null;
    this.track = null;

    this._cfg = cfg;
    this._featureType = cfg.featureType;
    this._storeKey = cfg.storeKey ?? cfg.featureType;
    this._minPoints = cfg.minPoints ?? 2;

    /** @type {{ feature: object, pointMeshes: import('@babylonjs/core').Mesh[], lineSystem: import('@babylonjs/core').Mesh|null }[]} */
    this._gizmos = [];
    this._active = null;                 // one entry from _gizmos
    this.selectedPoint = null;           // { gz, idx, mesh }
    this._rawDrag = null;
    this._rebuildTimer = null;

    this.normalMat = null;
    this.activeMat = null;
    this.highlightMat = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  activate(scene, track) {
    this.scene = scene;
    this.track = track;
    const m = EditorMaterials.for(scene);
    this.normalMat = m[this._cfg.materials.normal];
    this.activeMat = m[this._cfg.materials.active];
    this.highlightMat = m[this._cfg.materials.selected];
    for (const f of track.features) {
      if (f.type === this._featureType) this._createGizmos(f);
    }
  }

  /**
   * Light "stop editing this feature" — dims the active feature's points but
   * leaves every gizmo on screen. Used by the panel-close handlers and
   * `deselect()`. Full teardown is `dispose()`.
   */
  deactivate() { this._setActive(null); }

  /** Full teardown — EditorController's sub-editor cleanup loop. */
  dispose() {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = null;
    this._destroyAllGizmos();
    this._deselectPoint();
    this._active = null;
    this.normalMat = this.activeMat = this.highlightMat = null;
    this.scene = null;
    this.track = null;
  }

  // ── Add ───────────────────────────────────────────────────────────────────

  /** Push a fresh feature (from the subclass's `_newFeature`) and make it active. */
  _addFeature() {
    this.ec.saveSnapshot();
    const feature = this._newFeature();
    this.track.features.push(feature);
    const gz = this._createGizmos(feature);
    this._setActive(gz);
    this._syncStore(feature, null);
    this._rebuildNow(feature);
    return feature;
  }

  /** Append a control point at (x, z) to the active feature and select it. */
  addPoint(x, z) {
    if (!this._active) return;
    this.ec.saveSnapshot();
    this._active.feature.points.push({
      x: parseFloat(x.toFixed(2)),
      z: parseFloat(z.toFixed(2)),
      radius: DEFAULT_CORNER_RADIUS,
    });
    this._refreshGizmos(this._active);
    this._selectPoint(this._active, this._active.feature.points.length - 1);
    this._rebuildNow(this._active.feature);
  }

  // ── Gizmo pool ────────────────────────────────────────────────────────────

  _createGizmos(feature) {
    const gz = {
      feature,
      pointMeshes: feature.points.map((_, idx) => this._createSphere(feature, idx)),
      lineSystem: null,
    };
    gz.lineSystem = this._buildLine(feature);
    this._gizmos.push(gz);
    return gz;
  }

  _destroyGizmos(gz) {
    for (const m of gz.pointMeshes) m.dispose();
    gz.pointMeshes = [];
    gz.lineSystem?.dispose();
    gz.lineSystem = null;
    const idx = this._gizmos.indexOf(gz);
    if (idx > -1) this._gizmos.splice(idx, 1);
    if (this._active === gz) this._active = null;
  }

  _destroyAllGizmos() {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = null;
    for (const gz of [...this._gizmos]) this._destroyGizmos(gz);
    this._gizmos = [];
  }

  _createSphere(feature, idx) {
    const pt = feature.points[idx];
    const mesh = MeshBuilder.CreateSphere(
      `${this._cfg.spherePrefix}${idx}_${Date.now()}`,
      { diameter: this._cfg.sphereDiameter ?? 1.4, segments: 6 },
      this.scene,
    );
    mesh.position = new Vector3(pt.x, this._pointY(feature, pt), pt.z);
    mesh.material = this._active?.feature === feature ? this.activeMat : this.normalMat;
    mesh.isPickable = true;
    return mesh;
  }

  _buildLine(feature) {
    if (!feature.points || feature.points.length < 2) return null;
    const pts = feature.points.map((pt) => new Vector3(pt.x, this._lineY(feature, pt), pt.z));
    const ls = MeshBuilder.CreateLineSystem(`${this._cfg.linePrefix}${Date.now()}`, { lines: [pts] }, this.scene);
    ls.color = this._cfg.lineColor;
    ls.isPickable = false;
    return ls;
  }

  /** Rebuild a gizmo's spheres + line to match its (possibly-changed) point count. */
  _refreshGizmos(gz) {
    for (const m of gz.pointMeshes) m.dispose();
    const selIdx = this.selectedPoint?.gz === gz ? this.selectedPoint.idx : null;
    gz.pointMeshes = gz.feature.points.map((_, idx) => {
      const m = this._createSphere(gz.feature, idx);
      if (this._active === gz) m.material = this.activeMat;
      if (selIdx === idx) m.material = this.highlightMat;
      return m;
    });
    if (selIdx !== null) this.selectedPoint.mesh = gz.pointMeshes[selIdx] ?? null;
    gz.lineSystem?.dispose();
    gz.lineSystem = this._buildLine(gz.feature);
  }

  _updatePositions(gz, { rebuildLine = true } = {}) {
    for (let i = 0; i < gz.pointMeshes.length; i++) {
      const pt = gz.feature.points[i];
      if (!pt) continue;
      gz.pointMeshes[i].position.set(pt.x, this._pointY(gz.feature, pt), pt.z);
    }
    if (rebuildLine) {
      gz.lineSystem?.dispose();
      gz.lineSystem = this._buildLine(gz.feature);
    }
  }

  /** Re-sample every feature's gizmo heights after a terrain rebuild. */
  refreshGizmoHeights() {
    for (const gz of this._gizmos) this._updatePositions(gz);
  }

  setHandlesVisible(visible) {
    for (const gz of this._gizmos) {
      for (const m of gz.pointMeshes) m.isVisible = visible;
      if (gz.lineSystem) gz.lineSystem.isVisible = visible;
    }
  }

  // ── Deferred rebuild ──────────────────────────────────────────────────────

  _rebuildDeferred(gz) {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      this._rebuildTimer = null;
      if (!this.scene || !this._gizmos.includes(gz)) return;
      gz.lineSystem?.dispose();
      gz.lineSystem = this._buildLine(gz.feature);
      this._rebuildGeometry(gz.feature);
    }, REBUILD_DEBOUNCE_MS);
  }

  _flushRebuild() {
    if (!this._rebuildTimer || !this.selectedPoint) return;
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = null;
    const gz = this.selectedPoint.gz;
    gz.lineSystem?.dispose();
    gz.lineSystem = this._buildLine(gz.feature);
    this._rebuildGeometry(gz.feature);
  }

  _rebuildNow(feature) {
    this._rebuildGeometry(feature);
  }

  // ── Active-feature material state ─────────────────────────────────────────

  _setActive(gz) {
    if (this._active && this._active !== gz) {
      for (const m of this._active.pointMeshes) m.material = this.normalMat;
    }
    this._active = gz;
    if (gz) for (const m of gz.pointMeshes) m.material = this.activeMat;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  _selectPoint(gz, idx) {
    this._deselectPoint();
    this._setActive(gz);
    const mesh = gz.pointMeshes[idx];
    this.selectedPoint = { gz, idx, mesh };
    if (mesh) mesh.material = this.highlightMat;
    this._syncStore(gz.feature, idx);
  }

  _deselectPoint() {
    if (this.selectedPoint) {
      const { gz, mesh } = this.selectedPoint;
      if (mesh) mesh.material = this._active === gz ? this.activeMat : this.normalMat;
      this.selectedPoint = null;
    }
    this._rawDrag = null;
  }

  /** EditorController.deselectAll — fully revert: drop the point AND dim the feature. */
  deselect() { this._deselectPoint(); this._setActive(null); }

  /** Public alias kept for the controller / panel-close handlers. */
  deselectPoint() { this._deselectPoint(); }

  onPointerDown(pickedMesh) {
    for (const gz of this._gizmos) {
      const idx = gz.pointMeshes.indexOf(pickedMesh);
      if (idx === -1) continue;
      if (this.selectedPoint?.gz === gz && this.selectedPoint.idx === idx) return true;
      this._selectPoint(gz, idx);
      return true;
    }
    return false;
  }

  /**
   * Dedicated pick restricted to this editor's own spheres — the ground mesh is
   * pickable and the handles sit on the surface, so a plain closest-hit pick can
   * return the ground instead of a half-buried handle.
   */
  pickControlPoint() {
    if (!this.scene) return null;
    const prefix = this._cfg.spherePrefix;
    const pick = this.scene.pick(
      this.scene.pointerX, this.scene.pointerY,
      (m) => m.isPickable && typeof m.name === 'string' && m.name.startsWith(prefix),
    );
    return pick?.hit ? pick.pickedMesh : null;
  }

  // ── Drag ──────────────────────────────────────────────────────────────────

  moveSelectedPoint(dx, dz) {
    if (!this.selectedPoint) return { x: 0, z: 0 };
    this.ec.saveSnapshot(true);
    const { gz, idx } = this.selectedPoint;
    const pt = gz.feature.points[idx];
    if (!this._rawDrag) this._rawDrag = { x: pt.x, z: pt.z };
    this._rawDrag.x += dx;
    this._rawDrag.z += dz;
    const prevX = pt.x, prevZ = pt.z;
    pt.x = this._snap(this._rawDrag.x, 'x');
    pt.z = this._snap(this._rawDrag.z, 'z');
    this._updatePositions(gz, { rebuildLine: false });
    this._rebuildDeferred(gz);
    return { x: pt.x - prevX, z: pt.z - prevZ };
  }

  beginDrag() {
    if (!this.selectedPoint) return;
    const { gz, idx } = this.selectedPoint;
    const pt = gz.feature.points[idx];
    this._rawDrag = { x: pt.x, z: pt.z };
  }

  endDrag() {
    this._rawDrag = null;
    this._flushRebuild();
  }

  _snap(v, axis) {
    return this.ec._snap(v, this._snapAxis ? axis : null, this._snapPadding);
  }

  // ── Insert / delete points ───────────────────────────────────────────────

  insertPointAfterSelected() {
    if (!this.selectedPoint) return;
    const { gz, idx } = this.selectedPoint;
    const pts = gz.feature.points;
    const a = pts[idx];
    const b = pts[Math.min(idx + 1, pts.length - 1)];
    this.ec.saveSnapshot();
    pts.splice(idx + 1, 0, {
      x: (a.x + b.x) / 2,
      z: (a.z + b.z) / 2,
      radius: DEFAULT_CORNER_RADIUS,
    });
    this._refreshGizmos(gz);
    this._selectPoint(gz, idx + 1);
    this._rebuildNow(gz.feature);
  }

  deleteSelectedPoint() {
    if (!this.selectedPoint) return;
    const { gz, idx } = this.selectedPoint;
    if (gz.feature.points.length <= this._minPoints) return;
    this.ec.saveSnapshot();
    gz.feature.points.splice(idx, 1);
    this._deselectPoint();
    this._refreshGizmos(gz);
    this._selectPoint(gz, Math.min(idx, gz.feature.points.length - 1));
    this._rebuildNow(gz.feature);
  }

  // ── Feature CRUD ─────────────────────────────────────────────────────────

  deleteActiveFeature() {
    if (!this._active) return;
    this.ec.saveSnapshot();
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = null;
    const { feature } = this._active;
    const fi = this.track.features.indexOf(feature);
    if (fi > -1) this.track.features.splice(fi, 1);
    this._deselectPoint();
    this._destroyGizmos(this._active);
    this._active = null;
    if (this.ec._editorStore) this.ec._editorStore.selectedType = null;
    this._rebuildGeometry(null);
  }

  /** Drop the active feature if it has no points (tool opened then closed). */
  discardActiveIfEmpty() {
    const gz = this._active;
    if (!gz || gz.feature.points.length > 0) return false;
    const fi = this.track.features.indexOf(gz.feature);
    if (fi > -1) this.track.features.splice(fi, 1);
    this._destroyGizmos(gz);
    return true;
  }

  duplicateActiveFeature() {
    if (!this._active) return;
    this.ec.saveSnapshot();
    const src = this._active.feature;
    const feature = { ...src, points: src.points.map((p) => ({ ...p, x: p.x + 5, z: p.z + 5 })) };
    this.track.features.push(feature);
    const gz = this._createGizmos(feature);
    this._setActive(gz);
    this._syncStore(feature, null);
    this._rebuildNow(feature);
  }

  // ── Snapshot restore ─────────────────────────────────────────────────────

  onSnapshotRestored() {
    this._destroyAllGizmos();
    this._deselectPoint();
    this._active = null;
    for (const f of this.track.features) {
      if (f.type === this._featureType) this._createGizmos(f);
    }
    if (this.ec._editorStore) this.ec._editorStore.selectedType = null;
  }

  // ── Store sync ───────────────────────────────────────────────────────────

  _syncStore(feature, selectedIdx = null) {
    const store = this.ec._editorStore;
    if (!store) return;
    store.selectedType = this._storeKey;
    const slice = store[this._storeKey];
    slice.hasSelection = selectedIdx !== null;
    slice.canHaveRadius = selectedIdx !== null && this._canHaveRadius(feature, selectedIdx);
    slice.radius = selectedIdx !== null ? (feature.points[selectedIdx]?.radius ?? 0) : 0;
    this._syncStoreExtra(slice, feature, selectedIdx);
  }

  /** A point can carry a corner radius when it has both an incoming and an outgoing segment. */
  _canHaveRadius(feature, idx) {
    if (feature.closed) return true;
    return idx > 0 && idx < feature.points.length - 1;
  }

  /**
   * The effective max radius for a rounded point — mirrors expandPolyline's 0.49
   * clamp (half the shorter adjoining segment). Infinity when the point can't be
   * rounded. Shared by the wall / curb panels.
   */
  _maxRadiusFor(feature, idx) {
    if (idx === null || !this._canHaveRadius(feature, idx)) return Infinity;
    const pts = feature.points;
    const n = pts.length;
    const isClosed = feature.closed ?? false;
    const prev = pts[isClosed ? (idx - 1 + n) % n : idx - 1];
    const next = pts[isClosed ? (idx + 1) % n : idx + 1];
    const cur = pts[idx];
    const len1 = Math.hypot(cur.x - prev.x, cur.z - prev.z);
    const len2 = Math.hypot(next.x - cur.x, next.z - cur.z);
    return Math.min(len1, len2) * 0.49;
  }

  // ── Overridable geometry hooks (default: ride the ground) ─────────────────

  _pointY(feature, pt) { return gizmoY(this.track, pt.x, pt.z); }
  _lineY(feature, pt) { return gizmoLineY(this.track, pt.x, pt.z); }

  get _snapAxis() { return true; }
  get _snapPadding() { return DEAD_SPACE_REACH; }

  // ── Abstract — subclass MUST implement ───────────────────────────────────

  /* eslint-disable class-methods-use-this */
  _newFeature() { throw new Error('PolyPointEditor: _newFeature() not implemented'); }
  _rebuildGeometry(_featureOrNull) { throw new Error('PolyPointEditor: _rebuildGeometry() not implemented'); }
  _syncStoreExtra(_slice, _feature, _selectedIdx) {}
  /* eslint-enable class-methods-use-this */
}
