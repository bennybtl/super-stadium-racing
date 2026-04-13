import { Vector3, MeshBuilder } from "@babylonjs/core";
import { EditorMaterials } from './EditorMaterials.js';

/**
 * BezierWallEditor – place and edit bezierWall features in the track editor.
 *
 * Each anchor point is represented by a pickable sphere. Each anchor can have
 * control handles (handleIn/handleOut) that are also represented as spheres
 * and can be dragged to adjust the curve shape.
 *
 * The panel lets the user:
 *   • adjust the selected handle's strength/position
 *   • insert a point after the selected anchor
 *   • delete the selected anchor point (minimum 2 kept)
 *   • set global wall height & thickness
 *   • toggle closed loop
 *   • close the panel (gizmos stay visible)
 */
const POINT_HEIGHT_OFFSET = 0.7;
const HANDLE_HEIGHT_OFFSET = 0.4;

export class BezierWallEditor {
  constructor(editorController) {
    this.ec = editorController;
    this.scene = null;
    this.track = null;

    // All bezier wall gizmo sets
    this._wallGizmos = []; // [{ feature, anchorMeshes, handleMeshes, lineSystem }]
    this._activeWall = null;

    this.selectedAnchor = null; // { wallGizmo, idx, mesh }
    this.selectedHandle = null; // { wallGizmo, anchorIdx, type: 'in'|'out', mesh }

    // Materials
    this.anchorMat = null;
    this.activeAnchorMat = null;
    this.highlightMat = null;
    this.handleMat = null;
    this.handleHighlightMat = null;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  activate(scene, track) {
    this.scene = scene;
    this.track = track;

    const m = EditorMaterials.for(scene);
    this.anchorMat          = m.bezierAnchor;
    this.activeAnchorMat    = m.bezierAnchorActive;
    this.highlightMat       = m.nodeHighlight;
    this.handleMat          = m.bezierHandle;
    this.handleHighlightMat = m.bezierHandleHighlight;

    // Build gizmos for any bezierWalls already in the track
    for (const f of track.features) {
      if (f.type === 'bezierWall') this._createWallGizmos(f);
    }
  }

  deactivate() {
    this._destroyAllGizmos();
    this.deselectAll();
    this._activeWall = null;
    this.anchorMat          = null;
    this.activeAnchorMat    = null;
    this.highlightMat       = null;
    this.handleMat          = null;
    this.handleHighlightMat = null;
    this.scene = null;
    this.track = null;
  }

  // ─── Adding a new bezier wall ─────────────────────────────────────────────

  addBezierWallFeature() {
    const cam = this.ec.camera;
    const dir = cam.getTarget().subtract(cam.position).normalize();
    const cx = cam.position.x + dir.x * 30;
    const cz = cam.position.z + dir.z * 30;

    const feature = {
      type: 'bezierWall',
      points: [
        { x: cx - 15, z: cz, handleOut: { x: 5, z: 0 } },
        { x: cx, z: cz + 10, handleIn: { x: -5, z: 0 }, handleOut: { x: 5, z: 0 } },
        { x: cx + 15, z: cz, handleIn: { x: -5, z: 0 } },
      ],
      height: 2,
      thickness: 0.5,
      friction: 0.1,
      closed: false,
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
    const anchorMeshes = feature.points.map((pt, idx) =>
      this._createAnchorSphere(feature, idx)
    );
    const handleMeshes = this._createHandleMeshes(feature);
    const lineSystem = this._buildLineSystem(feature);
    const wg = { feature, anchorMeshes, handleMeshes, lineSystem };
    this._wallGizmos.push(wg);
    return wg;
  }

  _destroyWallGizmos(wg) {
    for (const m of wg.anchorMeshes) m.dispose();
    for (const hm of wg.handleMeshes) hm.mesh.dispose();
    wg.anchorMeshes = [];
    wg.handleMeshes = [];
    if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
    const idx = this._wallGizmos.indexOf(wg);
    if (idx > -1) this._wallGizmos.splice(idx, 1);
    if (this._activeWall === wg) this._activeWall = null;
  }

  _destroyAllGizmos() {
    for (const wg of [...this._wallGizmos]) this._destroyWallGizmos(wg);
    this._wallGizmos = [];
  }

  _createAnchorSphere(feature, idx) {
    const pt = feature.points[idx];
    const y = this.track.getHeightAt(pt.x, pt.z) + POINT_HEIGHT_OFFSET + (feature?.height || 0);
    const mesh = MeshBuilder.CreateSphere(`bzAnchor_${idx}_${Date.now()}`, {
      diameter: 1.4,
      segments: 6,
    }, this.scene);
    mesh.position = new Vector3(pt.x, y + 0.7, pt.z);
    mesh.material = this._activeWall?.feature === feature ? this.activeAnchorMat : this.anchorMat;
    mesh.isPickable = true;
    return mesh;
  }

  _createHandleMeshes(feature) {
    const handles = [];
    for (let i = 0; i < feature.points.length; i++) {
      const pt = feature.points[i];
      const y = this.track.getHeightAt(pt.x, pt.z) + HANDLE_HEIGHT_OFFSET + (feature?.height || 0);
      
      if (pt.handleIn) {
        const mesh = MeshBuilder.CreateSphere(`bzHandleIn_${i}_${Date.now()}`, {
          diameter: 0.9,
          segments: 4,
        }, this.scene);
        mesh.position = new Vector3(pt.x + pt.handleIn.x, y, pt.z + pt.handleIn.z);
        mesh.material = this.handleMat;
        mesh.isPickable = true;
        handles.push({ anchorIdx: i, type: 'in', mesh });
      }
      
      if (pt.handleOut) {
        const mesh = MeshBuilder.CreateSphere(`bzHandleOut_${i}_${Date.now()}`, {
          diameter: 0.9,
          segments: 4,
        }, this.scene);
        mesh.position = new Vector3(pt.x + pt.handleOut.x, y, pt.z + pt.handleOut.z);
        mesh.material = this.handleMat;
        mesh.isPickable = true;
        handles.push({ anchorIdx: i, type: 'out', mesh });
      }
    }
    return handles;
  }

  _buildLineSystem(feature) {
    if (!feature.points || feature.points.length < 2) return null;

    const lines = [];

    // Draw anchor points and handle lines
    for (let i = 0; i < feature.points.length; i++) {
      const pt = feature.points[i];
      const y = this.track.getHeightAt(pt.x, pt.z) + (feature?.height || 0);
      const anchor = new Vector3(pt.x, y + 0.15, pt.z);
      
      if (pt.handleIn) {
        const handlePos = new Vector3(pt.x + pt.handleIn.x, y + 0.12, pt.z + pt.handleIn.z);
        lines.push([anchor, handlePos]);
      }
      if (pt.handleOut) {
        const handlePos = new Vector3(pt.x + pt.handleOut.x, y + 0.12, pt.z + pt.handleOut.z);
        lines.push([anchor, handlePos]);
      }
    }

    // Draw the bezier curve preview
    const curvePoints = this._expandBezierPreview(feature.points, feature.closed);
    const curveLine = curvePoints.map(pt => {
      const y = this.track.getHeightAt(pt.x, pt.z);
      return new Vector3(pt.x, y + 0.12, pt.z);
    });
    lines.push(curveLine);

    const ls = MeshBuilder.CreateLineSystem(`bzLines_${Date.now()}`, { lines }, this.scene);
    ls.color = new Color3(0.3, 0.7, 1.0);
    ls.isPickable = false;
    return ls;
  }

  _expandBezierPreview(points, closed = false) {
    if (points.length < 2) return points;
    const out = [];
    const numPoints = points.length;
    const segmentCount = closed ? numPoints : numPoints - 1;

    for (let i = 0; i < segmentCount; i++) {
      const p0 = points[i];
      const p3 = points[(i + 1) % numPoints];
      
      const p1 = p0.handleOut 
        ? { x: p0.x + p0.handleOut.x, z: p0.z + p0.handleOut.z }
        : { x: p0.x + (p3.x - p0.x) / 3, z: p0.z + (p3.z - p0.z) / 3 };
      
      const p2 = p3.handleIn
        ? { x: p3.x + p3.handleIn.x, z: p3.z + p3.handleIn.z }
        : { x: p3.x - (p3.x - p0.x) / 3, z: p3.z - (p3.z - p0.z) / 3 };

      const samples = 16;
      for (let t = 0; t < samples; t++) {
        const u = t / samples;
        const mt = 1 - u;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const u2 = u * u;
        const u3 = u2 * u;
        out.push({
          x: mt3 * p0.x + 3 * mt2 * u * p1.x + 3 * mt * u2 * p2.x + u3 * p3.x,
          z: mt3 * p0.z + 3 * mt2 * u * p1.z + 3 * mt * u2 * p2.z + u3 * p3.z,
        });
      }
    }
    
    if (!closed) {
      const last = points[points.length - 1];
      out.push({ x: last.x, z: last.z });
    }
    
    return out;
  }

  _refreshWallGizmos(wg) {
    // Rebuild all meshes
    for (const m of wg.anchorMeshes) m.dispose();
    wg.anchorMeshes = wg.feature.points.map((_, idx) => {
      const m = this._createAnchorSphere(wg.feature, idx);
      if (this._activeWall === wg) m.material = this.activeAnchorMat;
      if (this.selectedAnchor && this.selectedAnchor.wg === wg && this.selectedAnchor.idx === idx) {
        m.material = this.highlightMat;
      }
      return m;
    });
    
    for (const hm of wg.handleMeshes) hm.mesh.dispose();
    wg.handleMeshes = this._createHandleMeshes(wg.feature);
    
    if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
    wg.lineSystem = this._buildLineSystem(wg.feature);
  }

  _updatePositions(wg, { rebuildLines = true } = {}) {
    const { feature, anchorMeshes, handleMeshes } = wg;
    
    // Update anchor positions
    for (let i = 0; i < anchorMeshes.length; i++) {
      const pt = feature.points[i];
      if (!pt) continue;
      const y = this.track.getHeightAt(pt.x, pt.z) + POINT_HEIGHT_OFFSET + (this._activeWall?.feature?.height || 0);
      anchorMeshes[i].position.set(pt.x, y + 0.7, pt.z);
    }
    
    // Update handle positions
    for (const hm of handleMeshes) {
      const pt = feature.points[hm.anchorIdx];
      const handle = hm.type === 'in' ? pt.handleIn : pt.handleOut;
      if (!handle) continue;
      const y = this.track.getHeightAt(pt.x, pt.z) + HANDLE_HEIGHT_OFFSET + (this._activeWall?.feature?.height || 0);
      hm.mesh.position.set(pt.x + handle.x, y, pt.z + handle.z);
    }
    
    if (rebuildLines) {
      if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
      wg.lineSystem = this._buildLineSystem(feature);
    }
  }

  _rebuildDeferred(wg, delayMs = 120) {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      if (!this.scene) return;
      if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
      wg.lineSystem = this._buildLineSystem(wg.feature);
      this._rebuildWall(wg.feature);
    }, delayMs);
  }

  _setActiveWall(wg) {
    if (this._activeWall && this._activeWall !== wg) {
      for (const m of this._activeWall.anchorMeshes) m.material = this.anchorMat;
    }
    this._activeWall = wg;
    if (wg) {
      for (const m of wg.anchorMeshes) m.material = this.activeAnchorMat;
    }
  }

  // ─── Selection ────────────────────────────────────────────────────────────

  selectAnchor(wg, idx) {
    this.deselectAll();
    this._setActiveWall(wg);
    const mesh = wg.anchorMeshes[idx];
    this.selectedAnchor = { wg, idx, mesh };
    mesh.material = this.highlightMat;
    this._syncStoreToFeature(wg.feature, idx, null);
  }

  selectHandle(wg, anchorIdx, type) {
    this.deselectAll();
    this._setActiveWall(wg);
    const hm = wg.handleMeshes.find(h => h.anchorIdx === anchorIdx && h.type === type);
    if (!hm) return;
    this.selectedHandle = { wg, anchorIdx, type, mesh: hm.mesh };
    hm.mesh.material = this.handleHighlightMat;
    this._syncStoreToFeature(wg.feature, anchorIdx, type);
  }

  deselectAll() {
    if (this.selectedAnchor) {
      const { wg, mesh } = this.selectedAnchor;
      mesh.material = this._activeWall === wg ? this.activeAnchorMat : this.anchorMat;
      this.selectedAnchor = null;
    }
    if (this.selectedHandle) {
      this.selectedHandle.mesh.material = this.handleMat;
      this.selectedHandle = null;
    }
    this._rawDrag = null;
    if (this.ec._editorStore) this.ec._editorStore.selectedType = null;
  }

  // ─── Point/Handle movement ────────────────────────────────────────────────

  moveSelectedAnchor(dx, dz) {
    if (!this.selectedAnchor) return { x: 0, z: 0 };
    this.ec.saveSnapshot(true);
    const { wg, idx } = this.selectedAnchor;
    const pt = wg.feature.points[idx];

    if (!this._rawDrag) this._rawDrag = { x: pt.x, z: pt.z };
    this._rawDrag.x += dx;
    this._rawDrag.z += dz;
    const prevX = pt.x, prevZ = pt.z;
    pt.x = this.ec._snap(this._rawDrag.x);
    pt.z = this.ec._snap(this._rawDrag.z);

    this._updatePositions(wg, { rebuildLines: false });
    this._rebuildDeferred(wg);
    return { x: pt.x - prevX, z: pt.z - prevZ };
  }

  moveSelectedHandle(dx, dz) {
    if (!this.selectedHandle) return { x: 0, z: 0 };
    this.ec.saveSnapshot(true);
    const { wg, anchorIdx, type } = this.selectedHandle;
    const pt = wg.feature.points[anchorIdx];
    const handle = type === 'in' ? pt.handleIn : pt.handleOut;
    
    if (!this._rawDrag) this._rawDrag = { x: handle.x, z: handle.z };
    this._rawDrag.x += dx;
    this._rawDrag.z += dz;
    const prevX = handle.x, prevZ = handle.z;
    handle.x = this.ec._snap(this._rawDrag.x);
    handle.z = this.ec._snap(this._rawDrag.z);

    this._updatePositions(wg, { rebuildLines: false });
    this._rebuildDeferred(wg);
    return { x: handle.x - prevX, z: handle.z - prevZ };
  }

  beginDrag() {
    if (this.selectedAnchor) {
      const { wg, idx } = this.selectedAnchor;
      const pt = wg.feature.points[idx];
      this._rawDrag = { x: pt.x, z: pt.z };
    } else if (this.selectedHandle) {
      const { wg, anchorIdx, type } = this.selectedHandle;
      const pt = wg.feature.points[anchorIdx];
      const handle = type === 'in' ? pt.handleIn : pt.handleOut;
      this._rawDrag = { x: handle.x, z: handle.z };
    }
  }

  endDrag() {
    this._rawDrag = null;
    if (this._rebuildTimer && (this.selectedAnchor || this.selectedHandle)) {
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = null;
      const wg = this.selectedAnchor?.wg || this.selectedHandle?.wg;
      if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
      wg.lineSystem = this._buildLineSystem(wg.feature);
      this._rebuildWall(wg.feature);
    }
  }

  // ─── Pointer delegation ───────────────────────────────────────────────────

  onPointerDown(pickedMesh) {
    // Check anchors
    for (const wg of this._wallGizmos) {
      for (let idx = 0; idx < wg.anchorMeshes.length; idx++) {
        if (pickedMesh === wg.anchorMeshes[idx]) {
          if (this.selectedAnchor && this.selectedAnchor.wg === wg && this.selectedAnchor.idx === idx) {
            this.deselectAll();
          } else {
            this.selectAnchor(wg, idx);
          }
          return true;
        }
      }
      
      // Check handles
      for (const hm of wg.handleMeshes) {
        if (pickedMesh === hm.mesh) {
          if (this.selectedHandle && this.selectedHandle.wg === wg && 
              this.selectedHandle.anchorIdx === hm.anchorIdx && 
              this.selectedHandle.type === hm.type) {
            this.deselectAll();
          } else {
            this.selectHandle(wg, hm.anchorIdx, hm.type);
          }
          return true;
        }
      }
    }
    this.deselectAll();
    return false;
  }

  // ─── Wall operations ──────────────────────────────────────────────────────

  _rebuildWall(feature) {
    window.rebuildTerrainGrid?.();
    window.rebuildBezierWall?.(feature);
  }

  insertPointAfterSelected() {
    if (!this.selectedAnchor) return;
    const { wg, idx } = this.selectedAnchor;
    const pts = wg.feature.points;
    const p1 = pts[idx];
    const p2 = pts[Math.min(idx + 1, pts.length - 1)];
    const newPt = {
      x: (p1.x + p2.x) / 2,
      z: (p1.z + p2.z) / 2,
      handleIn: { x: -3, z: 0 },
      handleOut: { x: 3, z: 0 },
    };
    this.ec.saveSnapshot();
    pts.splice(idx + 1, 0, newPt);
    this._refreshWallGizmos(wg);
    this.selectAnchor(wg, idx + 1);
    this._rebuildWall(wg.feature);
  }

  deleteSelectedPoint() {
    if (!this.selectedAnchor) return;
    const { wg, idx } = this.selectedAnchor;
    if (wg.feature.points.length <= 2) return;
    this.ec.saveSnapshot();
    wg.feature.points.splice(idx, 1);
    this.deselectAll();
    this._refreshWallGizmos(wg);
    const newIdx = Math.min(idx, wg.feature.points.length - 1);
    this.selectAnchor(wg, newIdx);
    this._rebuildWall(wg.feature);
  }

  deleteActiveWall() {
    if (!this._activeWall) return;
    this.ec.saveSnapshot();
    const wg = this._activeWall;
    const fi = this.track.features.indexOf(wg.feature);
    if (fi > -1) this.track.features.splice(fi, 1);
    this.deselectAll();
    this._destroyWallGizmos(wg);
    this._activeWall = null;
    if (this.ec._editorStore) this.ec._editorStore.selectedType = null;
    window.rebuildBezierWall?.(null);
  }

  // ─── Snapshot restore ─────────────────────────────────────────────────────

  onSnapshotRestored() {
    this._destroyAllGizmos();
    this.deselectAll();
    this._activeWall = null;
    for (const f of this.track.features) {
      if (f.type === 'bezierWall') this._createWallGizmos(f);
    }
    if (this.ec._editorStore) this.ec._editorStore.selectedType = null;
  }

  // ─── Vue Store Sync ───────────────────────────────────────────────────────

  _syncStoreToFeature(feature, selectedAnchorIdx = null, selectedHandleType = null) {
    const store = this.ec._editorStore;
    if (!store) return;
    store.selectedType = 'bezierWall';
    store.bezierWall.hasSelection = selectedAnchorIdx !== null;
    store.bezierWall.height = feature.height ?? 2;
    store.bezierWall.thickness = feature.thickness ?? 0.5;
    store.bezierWall.closed = feature.closed ?? false;
  }

  changeBezierWallHeight(val) {
    if (!this._activeWall) return;
    this.ec.saveSnapshot(true);
    this._activeWall.feature.height = val;
    this._rebuildWall(this._activeWall.feature);
  }

  changeBezierWallThickness(val) {
    if (!this._activeWall) return;
    this.ec.saveSnapshot(true);
    this._activeWall.feature.thickness = val;
    this._rebuildWall(this._activeWall.feature);
  }

  changeBezierWallClosed(val) {
    if (!this._activeWall) return;
    this.ec.saveSnapshot(true);
    this._activeWall.feature.closed = val;
    this._rebuildWall(this._activeWall.feature);
  }

  insertBezierWallPoint() { this.insertPointAfterSelected(); }
  deleteBezierWallPoint() { this.deleteSelectedPoint(); }
  deleteBezierWall() { this.deleteActiveWall(); }
  deselectBezierWall() { this.deselectAll(); }
}
