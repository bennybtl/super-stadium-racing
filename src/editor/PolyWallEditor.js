import { Vector3, MeshBuilder } from "@babylonjs/core";
import { EditorMaterials, LINE_COLOR_POLY_WALL } from './EditorMaterials.js';

/**
 * Editor – place and edit polyWall features in the track editor.
 *
 * Each control point is represented by a pickable sphere. Clicking a sphere
 * selects it; WASD moves it (via EditorController camera logic delegation) or
 * it can be dragged. The panel lets the user:
 *   • insert a point after the selected one
 *   • delete the selected point (minimum 2 kept)
 *   • set global wall height & thickness
 *   • close the panel (gizmos stay visible)
 *
 * Multiple polyWall features can exist; each gets its own PolyWallTool instance.
 * This tool manages ONE feature at a time (the "active" one). Clicking a gizmo
 * from a different feature switches focus.
 */
const POINT_HEIGHT_OFFSET = 0.7
export class PolyWallEditor {
  constructor(editorController) {
    this.ec    = editorController;
    this.scene = null;
    this.track = null;

    // All poly wall gizmo sets, keyed by feature
    this._wallGizmos = []; // [{ feature, pointMeshes, lineSystem }]
    this._activeWall = null; // one entry from _wallGizmos

    this.selectedPoint = null; // { wallGizmo, idx, mesh }

    // Materials
    this.normalMat    = null;
    this.activeMat    = null;  // active-wall (not selected) points
    this.highlightMat = null;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  activate(scene, track) {
    this.scene = scene;
    this.track = track;

    const m = EditorMaterials.for(scene);
    this.normalMat    = m.polyWallNode;
    this.activeMat    = m.polyWallNodeActive;
    this.highlightMat = m.nodeHighlight;

    // Build gizmos for any polyWalls already in the track
    for (const f of track.features) {
      if (f.type === 'polyWall') this._createWallGizmos(f);
    }
  }

  deactivate() {
    this._destroyAllGizmos();
    this.deselectPoint();
    this._activeWall = null;
    this.normalMat    = null;
    this.activeMat    = null;
    this.highlightMat = null;
    this.scene = null;
    this.track = null;
  }

  // ─── Adding a new poly wall ───────────────────────────────────────────────

  addPolyWallFeature() {
    const cam = this.ec.camera;
    const dir = cam.getTarget().subtract(cam.position).normalize();
    const cx  = cam.position.x + dir.x * 30;
    const cz  = cam.position.z + dir.z * 30;

    const feature = {
      type:      'polyWall',
      points:    [
        { x: cx - 10, z: cz - 5, radius: 0 },
        { x: cx,      z: cz + 5, radius: 0 },
        { x: cx + 10, z: cz - 5, radius: 0 },
        { x: cx + 20, z: cz + 5, radius: 0 },
      ],
      height:    2,
      thickness: 0.5,
      friction:  0.1,
      closed:    false,
    };

    this.ec.saveSnapshot();
    this.track.features.push(feature);
    const wg = this._createWallGizmos(feature);
    this._setActiveWall(wg);
    this._syncStoreToFeature(feature);
    this._rebuildWall(feature);
  }

  // ─── Gizmo management ─────────────────────────────────────────────────────

  _createWallGizmos(feature) {
    const pointMeshes = feature.points.map((pt, idx) =>
      this._createPointSphere(feature, idx)
    );
    const lineSystem = this._buildLineSystem(feature);
    const wg = { feature, pointMeshes, lineSystem };
    this._wallGizmos.push(wg);
    return wg;
  }

  _destroyWallGizmos(wg) {
    for (const m of wg.pointMeshes) m.dispose();
    wg.pointMeshes = [];
    if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
    const idx = this._wallGizmos.indexOf(wg);
    if (idx > -1) this._wallGizmos.splice(idx, 1);
    if (this._activeWall === wg) this._activeWall = null;
  }

  _destroyAllGizmos() {
    for (const wg of [...this._wallGizmos]) this._destroyWallGizmos(wg);
    this._wallGizmos = [];
  }

  _createPointSphere(feature, idx) {
    const pt = feature.points[idx];
    const y  = this.track.getHeightAt(pt.x, pt.z) + POINT_HEIGHT_OFFSET + (feature?.height || 0);
    const mesh = MeshBuilder.CreateSphere(`pwPt_${idx}_${Date.now()}`, {
      diameter: 1.4,
      segments: 6,
    }, this.scene);
    mesh.position  = new Vector3(pt.x, y + 0.7, pt.z);
    mesh.material  = this._activeWall?.feature === feature ? this.activeMat : this.normalMat;
    mesh.isPickable = true;
    return mesh;
  }

  _buildLineSystem(feature) {
    if (!feature.points || feature.points.length < 2) return null;

    // Draw the polyline
    const ctrlPts = feature.points.map(pt => {
      const y = this.track.getHeightAt(pt.x, pt.z) + (feature?.height || 0);
      return new Vector3(pt.x, y + 0.15, pt.z);
    });

    const lines = [ctrlPts];
    const ls = MeshBuilder.CreateLineSystem(`pwLines_${Date.now()}`, { lines }, this.scene);
    ls.color      = LINE_COLOR_POLY_WALL;
    ls.isPickable = false;
    return ls;
  }

  _refreshWallGizmos(wg) {
    // Rebuild point meshes to match current point count
    for (const m of wg.pointMeshes) m.dispose();
    wg.pointMeshes = wg.feature.points.map((_, idx) => {
      const m = this._createPointSphere(wg.feature, idx);
      // Re-apply correct material
      if (this._activeWall === wg) {
        m.material = this.activeMat;
      }
      if (this.selectedPoint && this.selectedPoint.wg === wg && this.selectedPoint.idx === idx) {
        m.material = this.highlightMat;
      }
      return m;
    });
    if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
    wg.lineSystem = this._buildLineSystem(wg.feature);
  }

  _updatePointPositions(wg, { rebuildLines = true } = {}) {
    const { feature, pointMeshes } = wg;
    for (let i = 0; i < pointMeshes.length; i++) {
      const pt = feature.points[i];
      if (!pt) continue;
      const y = this.track.getHeightAt(pt.x, pt.z) + POINT_HEIGHT_OFFSET + (this._activeWall?.feature?.height || 0);
      pointMeshes[i].position.set(pt.x, y + 0.7, pt.z);
    }
    if (rebuildLines) {
      if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
      wg.lineSystem = this._buildLineSystem(feature);
    }
  }

  /**
   * Debounced rebuild of the line system preview + physics wall.
   * Called during continuous movement so we don't thrash WebGL every frame.
   */
  _rebuildDeferred(wg, delayMs = 120) {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      if (!this.scene) return; // tool was deactivated
      if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
      wg.lineSystem = this._buildLineSystem(wg.feature);
      this._rebuildWall(wg.feature);
    }, delayMs);
  }

  _setActiveWall(wg) {
    // Dim the previously active wall
    if (this._activeWall && this._activeWall !== wg) {
      for (const m of this._activeWall.pointMeshes) m.material = this.normalMat;
    }
    this._activeWall = wg;
    if (wg) {
      for (const m of wg.pointMeshes) m.material = this.activeMat;
    }
  }

  // ─── Selection ────────────────────────────────────────────────────────────

  selectPoint(wg, idx) {
    this.deselectPoint();
    this._setActiveWall(wg);
    const mesh = wg.pointMeshes[idx];
    this.selectedPoint = { wg, idx, mesh };
    mesh.material = this.highlightMat;
    console.log(`[PolyWallTool] selectPoint: idx=${idx}, total points=${wg.feature.points.length}`);
    console.log(`[PolyWallTool] Selected point:`, wg.feature.points[idx]);
    this._syncStoreToFeature(wg.feature, idx);
  }

  deselectPoint() {
    if (this.selectedPoint) {
      const { wg, idx, mesh } = this.selectedPoint;
      // Restore material (active or normal depending on whether wall is still active)
      mesh.material = this._activeWall === wg ? this.activeMat : this.normalMat;
      this.selectedPoint = null;
    }
    this._rawDrag = null;  // clear stale drag origin so next selection starts fresh
    if (this.ec._editorStore) this.ec._editorStore.selectedType = null;
  }

  // ─── Point movement (called from EditorController.update) ─────────────────

  /**
   * Move the selected point by (dx, dz). Returns the actual delta so the
   * camera can pan to follow, mirroring the pattern used for hills etc.
   */
  moveSelectedPoint(dx, dz) {
    if (!this.selectedPoint) return { x: 0, z: 0 };
    this.ec.saveSnapshot(true);
    const { wg, idx } = this.selectedPoint;
    const pt = wg.feature.points[idx];

    // Support raw drag + snap
    if (!this._rawDrag) this._rawDrag = { x: pt.x, z: pt.z };
    this._rawDrag.x += dx;
    this._rawDrag.z += dz;
    const prevX = pt.x, prevZ = pt.z;
    pt.x = this.ec._snap(this._rawDrag.x);
    pt.z = this.ec._snap(this._rawDrag.z);

    // Update sphere positions only — no line system or physics rebuild every frame.
    this._updatePointPositions(wg, { rebuildLines: false });
    // Defer the expensive line + physics rebuild until movement pauses.
    this._rebuildDeferred(wg);
    return { x: pt.x - prevX, z: pt.z - prevZ };
  }

  beginDrag() {
    if (!this.selectedPoint) return;
    const { wg, idx } = this.selectedPoint;
    const pt = wg.feature.points[idx];
    this._rawDrag = { x: pt.x, z: pt.z };
  }

  endDrag() {
    this._rawDrag = null;
    // Flush any pending deferred rebuild immediately now that movement has stopped.
    if (this._rebuildTimer && this.selectedPoint) {
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = null;
      const { wg } = this.selectedPoint;
      if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
      wg.lineSystem = this._buildLineSystem(wg.feature);
      this._rebuildWall(wg.feature);
    }
  }

  // ─── Pointer / key delegation ──────────────────────────────────────────────

  /**
   * Returns true if this tool consumed the click.
   */
  onPointerDown(pickedMesh) {
    for (const wg of this._wallGizmos) {
      for (let idx = 0; idx < wg.pointMeshes.length; idx++) {
        if (pickedMesh === wg.pointMeshes[idx]) {
          if (this.selectedPoint && this.selectedPoint.wg === wg && this.selectedPoint.idx === idx) {
            this.deselectPoint();
          } else {
            this.selectPoint(wg, idx);
          }
          return true;
        }
      }
    }
    this.deselectPoint();
    return false;
  }

  // ─── Wall operations ──────────────────────────────────────────────────────

  _rebuildWall(feature) {
    window.rebuildTerrainGrid?.(); // keep terrain type grid in sync
    // Signal WallManager to rebuild this wall — EditorController exposes this
    window.rebuildPolyWall?.(feature);
  }

  insertPointAfterSelected() {
    if (!this.selectedPoint) return;
    const { wg, idx } = this.selectedPoint;
    const pts = wg.feature.points;
    const p1  = pts[idx];
    const p2  = pts[Math.min(idx + 1, pts.length - 1)];
    const newPt = {
      x: (p1.x + p2.x) / 2,
      z: (p1.z + p2.z) / 2,
      radius: 0,
    };
    this.ec.saveSnapshot();
    pts.splice(idx + 1, 0, newPt);
    this._refreshWallGizmos(wg);
    this.selectPoint(wg, idx + 1);
    this._rebuildWall(wg.feature);
  }

  deleteSelectedPoint() {
    if (!this.selectedPoint) return;
    const { wg, idx } = this.selectedPoint;
    if (wg.feature.points.length <= 2) return; // keep minimum
    this.ec.saveSnapshot();
    wg.feature.points.splice(idx, 1);
    this.deselectPoint();
    this._refreshWallGizmos(wg);
    // Select nearest remaining point
    const newIdx = Math.min(idx, wg.feature.points.length - 1);
    this.selectPoint(wg, newIdx);
    this._rebuildWall(wg.feature);
  }

  deleteActiveWall() {
    if (!this._activeWall) return;
    this.ec.saveSnapshot();
    const wg = this._activeWall;
    const fi = this.track.features.indexOf(wg.feature);
    if (fi > -1) this.track.features.splice(fi, 1);
    this.deselectPoint();
    this._destroyWallGizmos(wg);
    this._activeWall = null;
    if (this.ec._editorStore) this.ec._editorStore.selectedType = null;
    window.rebuildPolyWall?.(null); // signal full rebuild
  }

  // ─── Called after undo / redo ─────────────────────────────────────────────

  onSnapshotRestored() {
    this._destroyAllGizmos();
    this.deselectPoint();
    this._activeWall = null;
    for (const f of this.track.features) {
      if (f.type === 'polyWall') this._createWallGizmos(f);
    }
    if (this.ec._editorStore) this.ec._editorStore.selectedType = null;
  }

  // ─── Vue Store Sync ───────────────────────────────────────────────────────

  _syncStoreToFeature(feature, selectedIdx = null) {
    const store = this.ec._editorStore;
    if (!store) return;
    store.selectedType = 'polyWall';
    store.polyWall.hasSelection = selectedIdx !== null;
    // First and last points can't have radius in open polywalls (need both incoming and outgoing segments)
    // But in closed polywalls, all points can have radius
    const isClosed = feature.closed ?? false;
    const canHaveRadius = selectedIdx !== null && (
      isClosed || (selectedIdx > 0 && selectedIdx < feature.points.length - 1)
    );
    store.polyWall.canHaveRadius = canHaveRadius;
    store.polyWall.radius = selectedIdx !== null ? (feature.points[selectedIdx].radius ?? 0) : 0;
    // Compute the effective max radius for this point (mirrors expandPolyline's 0.49 clamp)
    if (canHaveRadius && selectedIdx !== null) {
      const pts = feature.points;
      const n = pts.length;
      const prevIdx = isClosed ? (selectedIdx - 1 + n) % n : selectedIdx - 1;
      const nextIdx = isClosed ? (selectedIdx + 1) % n : selectedIdx + 1;
      const p0 = pts[prevIdx], p1 = pts[selectedIdx], p2 = pts[nextIdx];
      const len1 = Math.sqrt((p1.x-p0.x)**2 + (p1.z-p0.z)**2);
      const len2 = Math.sqrt((p2.x-p1.x)**2 + (p2.z-p1.z)**2);
      store.polyWall.maxRadius = Math.min(len1, len2) * 0.49;
    } else {
      store.polyWall.maxRadius = Infinity;
    }
    store.polyWall.height = feature.height ?? 2;
    store.polyWall.thickness = feature.thickness ?? 0.5;
    store.polyWall.closed = feature.closed ?? false;
  }

  // Called by EditorController (bridge from Vue store actions)
  changePolyWallRadius(val) {
    if (!this.selectedPoint) return;
    console.log(`[PolyWallTool] changePolyWallRadius: idx=${this.selectedPoint.idx}, val=${val}`);
    console.log(`[PolyWallTool] Feature has ${this.selectedPoint.wg.feature.points.length} points`);
    console.log(`[PolyWallTool] All point radii:`, this.selectedPoint.wg.feature.points.map((p, i) => `${i}:${p.radius ?? 0}`).join(', '));
    this.ec.saveSnapshot(true);
    this.selectedPoint.wg.feature.points[this.selectedPoint.idx].radius = val;
    console.log(`[PolyWallTool] Updated point radius to:`, this.selectedPoint.wg.feature.points[this.selectedPoint.idx].radius);
    console.log(`[PolyWallTool] All point radii after:`, this.selectedPoint.wg.feature.points.map((p, i) => `${i}:${p.radius ?? 0}`).join(', '));
    this._updatePointPositions(this.selectedPoint.wg);
    this._rebuildWall(this.selectedPoint.wg.feature);
  }

  changePolyWallHeight(val) {
    if (!this._activeWall) return;
    this.ec.saveSnapshot(true);
    this._activeWall.feature.height = val;
    this._rebuildWall(this._activeWall.feature);
  }

  changePolyWallThickness(val) {
    if (!this._activeWall) return;
    this.ec.saveSnapshot(true);
    this._activeWall.feature.thickness = val;
    this._rebuildWall(this._activeWall.feature);
  }

  changePolyWallClosed(val) {
    if (!this._activeWall) return;
    this.ec.saveSnapshot(true);
    this._activeWall.feature.closed = val;
    this._rebuildWall(this._activeWall.feature);
  }

  insertPolyWallPoint() { this.insertPointAfterSelected(); }
  deletePolyWallPoint() { this.deleteSelectedPoint(); }
  deletePolyWall()      { this.deleteActiveWall(); }
  deselectPolyWall()    { this.deselectPoint(); }

  duplicatePolyWall() {
    if (!this._activeWall) return;
    this.ec.saveSnapshot();
    const src = this._activeWall.feature;
    const feature = {
      ...src,
      points: src.points.map(p => ({ ...p, x: p.x + 5, z: p.z + 5 })),
    };
    this.track.features.push(feature);
    const wg = this._createWallGizmos(feature);
    this._setActiveWall(wg);
    this._syncStoreToFeature(feature);
    this._rebuildWall(feature);
  }
}
