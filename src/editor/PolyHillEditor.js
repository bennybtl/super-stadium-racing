import { Vector3, StandardMaterial, Color3, MeshBuilder } from "@babylonjs/core";

/**
 * PolyHillEditor – place and edit polyHill features in the track editor.
 *
 * Each control point is represented by a pickable sphere. Clicking a sphere
 * selects it; WASD moves it (via EditorController camera logic delegation) or
 * it can be dragged. The panel lets the user:
 *   • insert a point after the selected one
 *   • delete the selected point (minimum 4 kept)
 *   • set global hill height & slope
 *   • toggle closed loop
 *   • close the panel (gizmos stay visible)
 *
 * Multiple polyHill features can exist; each gets its own PolyHillEditor instance.
 * This tool manages ONE feature at a time (the "active" one). Clicking a gizmo
 * from a different feature switches focus.
 */
const POINT_HEIGHT_OFFSET = 0.7;

export class PolyHillEditor {
  constructor(editorController) {
    this.ec = editorController;
    this.scene = null;
    this.track = null;

    // All poly hill gizmo sets, keyed by feature
    this._hillGizmos = []; // [{ feature, pointMeshes, lineSystem }]
    this._activeHill = null; // one entry from _hillGizmos

    this.selectedPoint = null; // { hillGizmo, idx, mesh }

    // Materials
    this.normalMat = null;
    this.activeMat = null;  // active-hill (not selected) points
    this.highlightMat = null;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  activate(scene, track) {
    this.scene = scene;
    this.track = track;

    this.normalMat = new StandardMaterial('phNormal', scene);
    this.normalMat.diffuseColor = new Color3(0.4, 0.6, 0.2);
    this.normalMat.emissiveColor = new Color3(0.1, 0.2, 0.05);
    this.normalMat.alpha = 0.90;

    this.activeMat = new StandardMaterial('phActive', scene);
    this.activeMat.diffuseColor = new Color3(0.6, 0.8, 0.3);
    this.activeMat.emissiveColor = new Color3(0.2, 0.3, 0.1);
    this.activeMat.alpha = 0.90;

    this.highlightMat = new StandardMaterial('phHighlight', scene);
    this.highlightMat.diffuseColor = new Color3(1.0, 1.0, 0.2);
    this.highlightMat.emissiveColor = new Color3(0.6, 0.6, 0.0);

    // Build gizmos for any polyHills already in the track
    for (const f of track.features) {
      if (f.type === 'polyHill') this._createHillGizmos(f);
    }
  }

  deactivate() {
    this._destroyAllGizmos();
    this.deselectPoint();
    this._activeHill = null;
    if (this.normalMat) { this.normalMat.dispose(); this.normalMat = null; }
    if (this.activeMat) { this.activeMat.dispose(); this.activeMat = null; }
    if (this.highlightMat) { this.highlightMat.dispose(); this.highlightMat = null; }
    this.scene = null;
    this.track = null;
  }

  // ─── Adding a new poly hill ───────────────────────────────────────────────

  addPolyHillFeature() {
    const cam = this.ec.camera;
    const dir = cam.getTarget().subtract(cam.position).normalize();
    const cx = cam.position.x + dir.x * 30;
    const cz = cam.position.z + dir.z * 30;

    const feature = {
      type: 'polyHill',
      points: [
        { x: cx - 10, z: cz - 10, radius: 0 },
        { x: cx + 10, z: cz - 10, radius: 0 },
        { x: cx + 10, z: cz + 10, radius: 0 },
        { x: cx - 10, z: cz + 10, radius: 0 },
      ],
      height: 3,
      width: 5,
      closed: false,
    };

    this.ec.saveSnapshot();
    this.track.features.push(feature);
    const hg = this._createHillGizmos(feature);
    this._setActiveHill(hg);
    this._syncStoreToFeature(feature);
    this._rebuildHill(feature);
  }

  // ─── Gizmo management ─────────────────────────────────────────────────────

  _createHillGizmos(feature) {
    const pointMeshes = feature.points.map((pt, idx) =>
      this._createPointSphere(feature, idx)
    );
    const lineSystem = this._buildLineSystem(feature);
    const hg = { feature, pointMeshes, lineSystem };
    this._hillGizmos.push(hg);
    return hg;
  }

  _destroyHillGizmos(hg) {
    for (const m of hg.pointMeshes) m.dispose();
    hg.pointMeshes = [];
    if (hg.lineSystem) { hg.lineSystem.dispose(); hg.lineSystem = null; }
    const idx = this._hillGizmos.indexOf(hg);
    if (idx > -1) this._hillGizmos.splice(idx, 1);
    if (this._activeHill === hg) this._activeHill = null;
  }

  _destroyAllGizmos() {
    for (const hg of [...this._hillGizmos]) this._destroyHillGizmos(hg);
    this._hillGizmos = [];
  }

  _createPointSphere(feature, idx) {
    const pt = feature.points[idx];
    const y = this.track.getHeightAt(pt.x, pt.z) + POINT_HEIGHT_OFFSET + (feature?.height || 0);
    const mesh = MeshBuilder.CreateSphere(`phPt_${idx}_${Date.now()}`, {
      diameter: 1.4,
      segments: 6,
    }, this.scene);
    mesh.position = new Vector3(pt.x, y + 0.7, pt.z);
    mesh.material = this._activeHill?.feature === feature ? this.activeMat : this.normalMat;
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
    const ls = MeshBuilder.CreateLineSystem(`phLines_${Date.now()}`, { lines }, this.scene);
    ls.color = new Color3(0.5, 0.8, 0.3);
    ls.isPickable = false;
    return ls;
  }

  _refreshHillGizmos(hg) {
    // Rebuild point meshes to match current point count
    for (const m of hg.pointMeshes) m.dispose();
    hg.pointMeshes = hg.feature.points.map((_, idx) => {
      const m = this._createPointSphere(hg.feature, idx);
      // Re-apply correct material
      if (this._activeHill === hg) {
        m.material = this.activeMat;
      }
      if (this.selectedPoint && this.selectedPoint.hg === hg && this.selectedPoint.idx === idx) {
        m.material = this.highlightMat;
      }
      return m;
    });
    if (hg.lineSystem) { hg.lineSystem.dispose(); hg.lineSystem = null; }
    hg.lineSystem = this._buildLineSystem(hg.feature);
  }

  _updatePointPositions(hg, { rebuildLines = true } = {}) {
    const { feature, pointMeshes } = hg;
    for (let i = 0; i < pointMeshes.length; i++) {
      const pt = feature.points[i];
      if (!pt) continue;
      const y = this.track.getHeightAt(pt.x, pt.z) + POINT_HEIGHT_OFFSET + (this._activeHill?.feature?.height || 0);
      pointMeshes[i].position.set(pt.x, y + 0.7, pt.z);
    }
    if (rebuildLines) {
      if (hg.lineSystem) { hg.lineSystem.dispose(); hg.lineSystem = null; }
      hg.lineSystem = this._buildLineSystem(feature);
    }
  }

  /**
   * Debounced rebuild of the line system preview + hill mesh.
   * Called during continuous movement so we don't thrash WebGL every frame.
   */
  _rebuildDeferred(hg, delayMs = 120) {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      if (!this.scene) return; // tool was deactivated
      if (hg.lineSystem) { hg.lineSystem.dispose(); hg.lineSystem = null; }
      hg.lineSystem = this._buildLineSystem(hg.feature);
      this._rebuildHill(hg.feature);
    }, delayMs);
  }

  _setActiveHill(hg) {
    // Dim the previously active hill
    if (this._activeHill && this._activeHill !== hg) {
      for (const m of this._activeHill.pointMeshes) m.material = this.normalMat;
    }
    this._activeHill = hg;
    if (hg) {
      for (const m of hg.pointMeshes) m.material = this.activeMat;
    }
  }

  // ─── Selection ────────────────────────────────────────────────────────────

  selectPoint(hg, idx) {
    this.deselectPoint();
    this._setActiveHill(hg);
    const mesh = hg.pointMeshes[idx];
    this.selectedPoint = { hg, idx, mesh };
    mesh.material = this.highlightMat;
    this._syncStoreToFeature(hg.feature, idx);
  }

  deselectPoint() {
    if (this.selectedPoint) {
      const { hg, idx, mesh } = this.selectedPoint;
      // Restore material (active or normal depending on whether hill is still active)
      mesh.material = this._activeHill === hg ? this.activeMat : this.normalMat;
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
    const { hg, idx } = this.selectedPoint;
    const pt = hg.feature.points[idx];
    pt.x += dx;
    pt.z += dz;
    this._updatePointPositions(hg, { rebuildLines: false });
    this._rebuildDeferred(hg);
    return { x: dx, z: dz };
  }

  endDrag() {
    if (!this.selectedPoint) return;
    const { hg } = this.selectedPoint;
    // Force immediate rebuild on drag end
    clearTimeout(this._rebuildTimer);
    if (hg.lineSystem) { hg.lineSystem.dispose(); hg.lineSystem = null; }
    hg.lineSystem = this._buildLineSystem(hg.feature);
    this._rebuildHill(hg.feature);
  }

  // ─── Pointer events (called from EditorController) ────────────────────────

  onPointerDown(mesh) {
    if (!mesh || !mesh.name) return false;
    if (!mesh.name.startsWith('phPt_')) return false;

    // Find which hill and which point
    for (const hg of this._hillGizmos) {
      const idx = hg.pointMeshes.indexOf(mesh);
      if (idx !== -1) {
        this.selectPoint(hg, idx);
        this._startDrag(mesh);
        return true;
      }
    }
    return false;
  }

  _startDrag(mesh) {
    this._rawDrag = { startPos: mesh.position.clone() };
  }

  // ─── Insert / Delete points ───────────────────────────────────────────────

  insertPointAfter() {
    if (!this.selectedPoint) return;
    this.ec.saveSnapshot();
    const { hg, idx } = this.selectedPoint;
    const pts = hg.feature.points;
    const p1 = pts[idx];
    const p2 = pts[(idx + 1) % pts.length];
    const newPt = {
      x: (p1.x + p2.x) / 2,
      z: (p1.z + p2.z) / 2,
      radius: 0,
    };
    pts.splice(idx + 1, 0, newPt);
    this._refreshHillGizmos(hg);
    this.selectPoint(hg, idx + 1);
    this._rebuildHill(hg.feature);
  }

  deleteSelectedPoint() {
    if (!this.selectedPoint) return;
    const { hg, idx } = this.selectedPoint;
    // Keep minimum 4 points
    if (hg.feature.points.length <= 4) return;

    this.ec.saveSnapshot();
    hg.feature.points.splice(idx, 1);
    this.deselectPoint();
    this._refreshHillGizmos(hg);
    this._rebuildHill(hg.feature);
  }

  // ─── Property setters (called from store actions) ─────────────────────────

  setPointRadius(radius) {
    if (!this.selectedPoint) return;
    this.ec.saveSnapshot(true);
    const { hg, idx } = this.selectedPoint;
    hg.feature.points[idx].radius = radius;
    this._rebuildHill(hg.feature);
  }

  setHeight(height) {
    if (!this._activeHill) return;
    this.ec.saveSnapshot(true);
    this._activeHill.feature.height = height;
    this._updatePointPositions(this._activeHill, { rebuildLines: true });
    this._rebuildHill(this._activeHill.feature);
  }

  setWidth(width) {
    if (!this._activeHill) return;
    this.ec.saveSnapshot(true);
    this._activeHill.feature.width = width;
    this._rebuildHill(this._activeHill.feature);
  }

  setClosed(closed) {
    if (!this._activeHill) return;
    this.ec.saveSnapshot(true);
    this._activeHill.feature.closed = closed;
    this._refreshHillGizmos(this._activeHill);
    this._rebuildHill(this._activeHill.feature);
  }

  deletePolyHill() {
    if (!this._activeHill) return;
    this.ec.saveSnapshot();
    const { feature } = this._activeHill;
    const idx = this.track.features.indexOf(feature);
    if (idx !== -1) this.track.features.splice(idx, 1);
    this._destroyHillGizmos(this._activeHill);
    this.deselectPoint();
    this._rebuildHill(feature);
  }

  // ─── Store sync ───────────────────────────────────────────────────────────

  _syncStoreToFeature(feature, selectedIdx = null) {
    if (!this.ec._editorStore) return;
    const store = this.ec._editorStore;
    store.selectedType = 'polyHill';
    store.polyHill.hasSelection = selectedIdx !== null;
    store.polyHill.radius = selectedIdx !== null ? (feature.points[selectedIdx]?.radius ?? 0) : 0;
    store.polyHill.canHaveRadius = selectedIdx !== null && this._canHaveRadius(feature, selectedIdx);
    store.polyHill.height = feature.height ?? 3;
    store.polyHill.width = feature.width ?? feature.slope ?? 5;
    store.polyHill.closed = feature.closed ?? false;
  }

  _canHaveRadius(feature, idx) {
    if (feature.closed) return true;
    return idx > 0 && idx < feature.points.length - 1;
  }

  // ─── Rebuild (delegate to window.rebuildPolyHill) ─────────────────────────

  _rebuildHill(feature) {
    if (window.rebuildPolyHill) {
      window.rebuildPolyHill(feature);
    }
  }

  // ─── Snapshot restore ─────────────────────────────────────────────────────

  onSnapshotRestored() {
    this._destroyAllGizmos();
    this.deselectPoint();
    for (const f of this.track.features) {
      if (f.type === 'polyHill') this._createHillGizmos(f);
    }
  }
}
