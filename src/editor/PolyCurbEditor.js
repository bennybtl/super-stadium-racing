import { Vector3, MeshBuilder } from "@babylonjs/core";
import rebuild from './editor-rebuild.js';
import { EditorMaterials, LINE_COLOR_POLY_CURB } from './EditorMaterials.js';

/**
 * PolyCurbEditor — place and edit polyCurb features in the track editor.
 *
 * Mirrors PolyWallEditor in structure; each control point is a pickable
 * sphere.  Clicking selects it; WASD moves it.  The panel lets the user
 * insert / delete points and adjust curb width, height, and closed state.
 *
 * Curb gizmo colour: teal / cyan (distinct from the orange polyWall gizmos).
 */

const POINT_HEIGHT_OFFSET = 0.5;

export class PolyCurbEditor {
  constructor(editorController) {
    this.ec    = editorController;
    this.scene = null;
    this.track = null;

    this._curbGizmos = []; // [{ feature, pointMeshes, lineSystem }]
    this._activeGizmo = null;

    this.selectedPoint = null; // { cg, idx, mesh }

    this.normalMat    = null;
    this.activeMat    = null;
    this.highlightMat = null;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  activate(scene, track) {
    this.scene = scene;
    this.track = track;

    const m = EditorMaterials.for(scene);
    this.normalMat    = m.polyCurbNode;         // inactive curb — faint
    this.activeMat    = m.polyCurbNodeActive;   // active curb — solid
    this.highlightMat = m.polyCurbNodeSelected; // selected node — solid + lit

    for (const f of track.features) {
      if (f.type === 'polyCurb') this._createGizmos(f);
    }
  }

  deactivate() {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = null;
    this._destroyAllGizmos();
    this.deselectPoint();
    this._activeGizmo = null;
    this.normalMat    = null;
    this.activeMat    = null;
    this.highlightMat = null;
    this.scene = null;
    this.track = null;
  }

  // ─── Adding a new curb ───────────────────────────────────────────────────

  /**
   * Create an empty poly curb and enter placement mode. The user then
   * right-clicks the terrain to drop control points one at a time (mirrors the
   * AI Path / Terrain Path flow). Opening the panel (selectedType = 'polyCurb')
   * is what activates the right-click-to-add branch in EditorController.
   */
  addPolyCurbFeature() {
    const feature = {
      type:   'polyCurb',
      points: [],
      height: 0.22,
      width:  0.9,
      closed: false,
    };

    this.ec.saveSnapshot();
    this.track.features.push(feature);
    const cg = this._createGizmos(feature);
    this._setActive(cg);
    this._syncStore(feature);
    this._rebuild(feature);
  }

  /**
   * Append a control point at (x, z) to the active curb and select it.
   * Called from EditorController while in poly-curb placement mode.
   */
  addPoint(x, z) {
    if (!this._activeGizmo) return;
    this.ec.saveSnapshot();
    const cg = this._activeGizmo;
    cg.feature.points.push({
      x: parseFloat(x.toFixed(2)),
      z: parseFloat(z.toFixed(2)),
      radius: 0,
    });
    this._refreshGizmos(cg);
    this.selectPoint(cg, cg.feature.points.length - 1);
    this._rebuild(cg.feature);
  }

  // ─── Gizmo management ─────────────────────────────────────────────────────

  _createGizmos(feature) {
    const pointMeshes = feature.points.map((_, idx) => this._createSphere(feature, idx));
    const lineSystem  = this._buildLines(feature);
    const cg = { feature, pointMeshes, lineSystem };
    this._curbGizmos.push(cg);
    return cg;
  }

  _destroyGizmos(cg) {
    for (const m of cg.pointMeshes) m.dispose();
    cg.pointMeshes = [];
    if (cg.lineSystem) { cg.lineSystem.dispose(); cg.lineSystem = null; }
    const idx = this._curbGizmos.indexOf(cg);
    if (idx > -1) this._curbGizmos.splice(idx, 1);
    if (this._activeGizmo === cg) this._activeGizmo = null;
  }

  _destroyAllGizmos() {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = null;
    for (const cg of [...this._curbGizmos]) this._destroyGizmos(cg);
    this._curbGizmos = [];
  }

  _createSphere(feature, idx) {
    const pt = feature.points[idx];
    const y  = this.ec.terrainQuery.heightAt(pt.x, pt.z) + POINT_HEIGHT_OFFSET + (feature.height ?? 0.22);
    const mesh = MeshBuilder.CreateSphere(`pcPt_${idx}_${Date.now()}`, { diameter: 1.2, segments: 6 }, this.scene);
    mesh.position  = new Vector3(pt.x, y + 0.6, pt.z);
    mesh.material  = this._activeGizmo?.feature === feature ? this.activeMat : this.normalMat;
    mesh.isPickable = true;
    return mesh;
  }

  _buildLines(feature) {
    if (!feature.points || feature.points.length < 2) return null;
    const pts  = feature.points.map(pt => {
      const y = this.ec.terrainQuery.heightAt(pt.x, pt.z) + (feature.height ?? 0.22);
      return new Vector3(pt.x, y + 0.08, pt.z);
    });
    const ls = MeshBuilder.CreateLineSystem(`pcLines_${Date.now()}`, { lines: [pts] }, this.scene);
    ls.color      = LINE_COLOR_POLY_CURB; // red preview line
    ls.isPickable = false;
    return ls;
  }

  _refreshGizmos(cg) {
    for (const m of cg.pointMeshes) m.dispose();
    cg.pointMeshes = cg.feature.points.map((_, idx) => {
      const m = this._createSphere(cg.feature, idx);
      if (this._activeGizmo === cg) m.material = this.activeMat;
      if (this.selectedPoint?.cg === cg && this.selectedPoint.idx === idx) m.material = this.highlightMat;
      return m;
    });
    if (cg.lineSystem) { cg.lineSystem.dispose(); cg.lineSystem = null; }
    cg.lineSystem = this._buildLines(cg.feature);
  }

  _updatePositions(cg, { rebuildLines = true } = {}) {
    const { feature, pointMeshes } = cg;
    for (let i = 0; i < pointMeshes.length; i++) {
      const pt = feature.points[i];
      if (!pt) continue;
      const y = this.ec.terrainQuery.heightAt(pt.x, pt.z) + POINT_HEIGHT_OFFSET + (this._activeGizmo?.feature?.height ?? 0.22);
      pointMeshes[i].position.set(pt.x, y + 0.6, pt.z);
    }
    if (rebuildLines) {
      if (cg.lineSystem) { cg.lineSystem.dispose(); cg.lineSystem = null; }
      cg.lineSystem = this._buildLines(feature);
    }
  }

  _rebuildDeferred(cg, delayMs = 120) {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      this._rebuildTimer = null;
      if (!this.scene) return;
      if (!this._curbGizmos.includes(cg)) return;
      if (cg.lineSystem) { cg.lineSystem.dispose(); cg.lineSystem = null; }
      cg.lineSystem = this._buildLines(cg.feature);
      this._rebuild(cg.feature);
    }, delayMs);
  }

  _setActive(cg) {
    if (this._activeGizmo && this._activeGizmo !== cg) {
      for (const m of this._activeGizmo.pointMeshes) m.material = this.normalMat;
    }
    this._activeGizmo = cg;
    if (cg) for (const m of cg.pointMeshes) m.material = this.activeMat;
  }

  // ─── Selection ────────────────────────────────────────────────────────────

  selectPoint(cg, idx) {
    this.deselectPoint();
    this._setActive(cg);
    const mesh = cg.pointMeshes[idx];
    this.selectedPoint = { cg, idx, mesh };
    mesh.material = this.highlightMat;
    this._syncStore(cg.feature, idx);
  }

  /**
   * Uniform sub-editor interface (EditorController.deselectAll / switch-away).
   * Fully deactivates: deselects the point AND reverts the active curb's points
   * to the dim/normal material, so switching to another feature returns these
   * gizmos to transparent instead of leaving them stuck solid.
   */
  deselect() { this.deselectPoint(); this.deactivate(); }

  /** Revert the active curb's points to the transparent/normal material. */
  deactivate() { this._setActive(null); }

  deselectPoint() {
    if (this.selectedPoint) {
      const { cg, mesh } = this.selectedPoint;
      mesh.material = this._activeGizmo === cg ? this.activeMat : this.normalMat;
      this.selectedPoint = null;
    }
    this._rawDrag = null;
    // NB: intentionally does NOT clear selectedType — placement mode stays active
    // (panel open) after deselecting a point, so the user can keep right-clicking
    // to add more points. The mode is exited explicitly via closePolyCurb
    // (panel X / Esc) or deleteActiveCurb.
  }

  // ─── Point movement ───────────────────────────────────────────────────────

  moveSelectedPoint(dx, dz) {
    if (!this.selectedPoint) return { x: 0, z: 0 };
    this.ec.saveSnapshot(true);
    const { cg, idx } = this.selectedPoint;
    const pt = cg.feature.points[idx];
    if (!this._rawDrag) this._rawDrag = { x: pt.x, z: pt.z };
    this._rawDrag.x += dx;
    this._rawDrag.z += dz;
    const prevX = pt.x, prevZ = pt.z;
    pt.x = this.ec._snap(this._rawDrag.x);
    pt.z = this.ec._snap(this._rawDrag.z);
    this._updatePositions(cg, { rebuildLines: false });
    this._rebuildDeferred(cg);
    return { x: pt.x - prevX, z: pt.z - prevZ };
  }

  beginDrag() {
    if (!this.selectedPoint) return;
    const { cg, idx } = this.selectedPoint;
    const pt = cg.feature.points[idx];
    this._rawDrag = { x: pt.x, z: pt.z };
  }

  endDrag() {
    this._rawDrag = null;
    if (this._rebuildTimer && this.selectedPoint) {
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = null;
      const { cg } = this.selectedPoint;
      if (cg.lineSystem) { cg.lineSystem.dispose(); cg.lineSystem = null; }
      cg.lineSystem = this._buildLines(cg.feature);
      this._rebuild(cg.feature);
    }
  }

  // ─── Pointer ─────────────────────────────────────────────────────────────

  onPointerDown(pickedMesh) {
    for (const cg of this._curbGizmos) {
      for (let idx = 0; idx < cg.pointMeshes.length; idx++) {
        if (pickedMesh === cg.pointMeshes[idx]) {
          if (this.selectedPoint?.cg === cg && this.selectedPoint.idx === idx) {
            return true;
          }
          this.selectPoint(cg, idx);
          return true;
        }
      }
    }
    // Missed all control points: keep the current selection. A terrain click no
    // longer deselects; EditorController treats the miss as a camera-pan candidate.
    return false;
  }

  // ─── Curb operations ─────────────────────────────────────────────────────

  _rebuild(feature) {
    rebuild.polyCurb?.(feature);
  }

  insertPointAfterSelected() {
    if (!this.selectedPoint) return;
    const { cg, idx } = this.selectedPoint;
    const pts = cg.feature.points;
    const p1  = pts[idx];
    const p2  = pts[Math.min(idx + 1, pts.length - 1)];
    const newPt = { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2, radius: 0 };
    this.ec.saveSnapshot();
    pts.splice(idx + 1, 0, newPt);
    this._refreshGizmos(cg);
    this.selectPoint(cg, idx + 1);
    this._rebuild(cg.feature);
  }

  deleteSelectedPoint() {
    if (!this.selectedPoint) return;
    const { cg, idx } = this.selectedPoint;
    if (cg.feature.points.length <= 2) return;
    this.ec.saveSnapshot();
    cg.feature.points.splice(idx, 1);
    this.deselectPoint();
    this._refreshGizmos(cg);
    this.selectPoint(cg, Math.min(idx, cg.feature.points.length - 1));
    this._rebuild(cg.feature);
  }

  deleteActiveCurb() {
    if (!this._activeGizmo) return;
    this.ec.saveSnapshot();
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = null;
    const cg = this._activeGizmo;
    const fi = this.track.features.indexOf(cg.feature);
    if (fi > -1) this.track.features.splice(fi, 1);
    this.deselectPoint();
    this._destroyGizmos(cg);
    this._activeGizmo = null;
    if (this.ec._editorStore) this.ec._editorStore.selectedType = null;
    rebuild.polyCurb?.(null);
  }

  /**
   * Remove the active curb if it has no points — called on close so opening the
   * tool then exiting without placing anything doesn't leave litter in the
   * track. No snapshot: creation already pushed one capturing the pre-create
   * state, so undo stays consistent.
   */
  discardActiveIfEmpty() {
    const cg = this._activeGizmo;
    if (!cg || cg.feature.points.length > 0) return false;
    const fi = this.track.features.indexOf(cg.feature);
    if (fi > -1) this.track.features.splice(fi, 1);
    this._destroyGizmos(cg); // clears _activeGizmo; empty gizmo arrays dispose cleanly
    return true;
  }

  // ─── Snapshot restore ─────────────────────────────────────────────────────

  onSnapshotRestored() {
    this._destroyAllGizmos();
    this.deselectPoint();
    this._activeGizmo = null;
    for (const f of this.track.features) {
      if (f.type === 'polyCurb') this._createGizmos(f);
    }
    if (this.ec._editorStore) this.ec._editorStore.selectedType = null;
  }

  // ─── Vue Store Sync ───────────────────────────────────────────────────────

  _syncStore(feature, selectedIdx = null) {
    const store = this.ec._editorStore;
    if (!store) return;
    store.selectedType = 'polyCurb';
    store.polyCurb.hasSelection  = selectedIdx !== null;
    const isClosed = feature.closed ?? false;
    const canHaveRadius = selectedIdx !== null && (
      isClosed || (selectedIdx > 0 && selectedIdx < feature.points.length - 1)
    );
    store.polyCurb.canHaveRadius = canHaveRadius;
    store.polyCurb.radius = selectedIdx !== null ? (feature.points[selectedIdx].radius ?? 0) : 0;
    // Compute the effective max radius for this point (mirrors expandPolyline's 0.49 clamp)
    if (canHaveRadius && selectedIdx !== null) {
      const pts = feature.points;
      const n = pts.length;
      const prevIdx = isClosed ? (selectedIdx - 1 + n) % n : selectedIdx - 1;
      const nextIdx = isClosed ? (selectedIdx + 1) % n : selectedIdx + 1;
      const p0 = pts[prevIdx], p1 = pts[selectedIdx], p2 = pts[nextIdx];
      const len1 = Math.sqrt((p1.x-p0.x)**2 + (p1.z-p0.z)**2);
      const len2 = Math.sqrt((p2.x-p1.x)**2 + (p2.z-p1.z)**2);
      store.polyCurb.maxRadius = Math.min(len1, len2) * 0.49;
    } else {
      store.polyCurb.maxRadius = Infinity;
    }
    store.polyCurb.height = feature.height ?? 0.22;
    store.polyCurb.width  = feature.width  ?? 0.9;
    store.polyCurb.closed = feature.closed ?? false;
    store.polyCurb.style  = feature.style  ?? 'red_white';
  }

  changePolyCurbRadius(val) {
    if (!this.selectedPoint) return;
    this.ec.saveSnapshot(true);
    this.selectedPoint.cg.feature.points[this.selectedPoint.idx].radius = val;
    this._updatePositions(this.selectedPoint.cg);
    this._rebuild(this.selectedPoint.cg.feature);
  }

  changePolyCurbHeight(val) {
    if (!this._activeGizmo) return;
    this.ec.saveSnapshot(true);
    this._activeGizmo.feature.height = val;
    this._rebuild(this._activeGizmo.feature);
  }

  changePolyCurbWidth(val) {
    if (!this._activeGizmo) return;
    this.ec.saveSnapshot(true);
    this._activeGizmo.feature.width = val;
    this._rebuild(this._activeGizmo.feature);
  }

  changePolyCurbClosed(val) {
    if (!this._activeGizmo) return;
    this.ec.saveSnapshot(true);
    this._activeGizmo.feature.closed = val;
    this._rebuild(this._activeGizmo.feature);
  }

  changePolyCurbStyle(val) {
    if (!this._activeGizmo) return;
    this.ec.saveSnapshot(true);
    this._activeGizmo.feature.style = val;
    this._rebuild(this._activeGizmo.feature);
  }

  insertPolyCurbPoint() { this.insertPointAfterSelected(); }
  deletePolyCurbPoint() { this.deleteSelectedPoint(); }
  deletePolyCurb()      { this.deleteActiveCurb(); }
  deselectPolyCurb()    { this.deselectPoint(); }

  duplicatePolyCurb() {
    if (!this._activeGizmo) return;
    this.ec.saveSnapshot();
    const src = this._activeGizmo.feature;
    const feature = {
      ...src,
      points: src.points.map(p => ({ ...p, x: p.x + 5, z: p.z + 5 })),
    };
    this.track.features.push(feature);
    const cg = this._createGizmos(feature);
    this._setActive(cg);
    this._syncStore(feature);
    this._rebuild(feature);
  }
}
