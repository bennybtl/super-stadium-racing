import { Vector3, MeshBuilder } from "@babylonjs/core";
import { EditorMaterials, LINE_COLOR_MESH_GRID } from './EditorMaterials.js';

/**
 * BridgeMeshEditor — edits `bridgeMesh` features via a grid of draggable
 * control points, similar to MeshGridEditor.
 *
 * Key difference from MeshGridEditor: heights are **absolute world Y** values,
 * not relative offsets.  The meshes are rebuilt via window.rebuildBridgeMesh
 * rather than window.rebuildTerrain.
 *
 * Multiple bridgeMesh features can exist per track.  The currently active
 * (selected) feature is tracked via `this.activeFeature`.
 */
export class BridgeMeshEditor {
  constructor(editorController) {
    this.ec = editorController;
    this.scene = null;
    this.track = null;
    this.activeFeature = null;

    this.pointMeshes   = [];   // [{ mesh, r, c, featureRef }]
    this.centerGizmos  = [];   // [{ mesh, featureRef }]
    this.selectedPoint = null;
    this.selectedCenter = null;
    this.lineSystem    = null;

    this.normalMat    = null;
    this.highlightMat = null;

    this.stepSize = 0.5;

    this._boundWheel = this._onWheel.bind(this);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  activate(scene, track) {
    this.scene = scene;
    this.track = track;

    const m = EditorMaterials.for(scene);
    this.normalMat    = m.meshGridNode;
    this.highlightMat = m.meshGridHighlight;

    document.addEventListener('wheel', this._boundWheel, { passive: false });

    // Build gizmos for any bridgeMesh features that already exist
    for (const f of track.features) {
      if (f.type === 'bridgeMesh') this._addGizmosForFeature(f);
    }
  }

  deactivate() {
    document.removeEventListener('wheel', this._boundWheel);
    this._destroyAllGizmos();
    this.activeFeature = null;
    this.selectedPoint = null;
    this.selectedCenter = null;
    this.normalMat = null;
    this.highlightMat = null;
    this.scene = null;
    this.track = null;
  }

  // ─── Feature management ────────────────────────────────────────────────────

  addBridgeMeshFeature() {
    const track = this.track;
    const centerX = 0;
    const centerZ = 0;
    const cols = 4, rows = 2;
    const defaultElevation = 5;

    // Sample terrain under each control point for initial heights
    const heights = [];
    const halfW = 20 / 2, halfD = 20 / 2;
    const stepX = cols > 1 ? 20 / (cols - 1) : 0;
    const stepZ = rows > 1 ? 20 / (rows - 1) : 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = centerX - halfW + c * stepX;
        const wz = centerZ - halfD + r * stepZ;
        heights.push((track.getHeightAt(wx, wz) ?? 0) + defaultElevation);
      }
    }

    const feature = {
      type: 'bridgeMesh',
      centerX,
      centerZ,
      width:  20,
      depth:  20,
      cols,
      rows,
      heights,
      thickness: 0.4,
      transitionEnabled: true,
      transitionDepth: 8,
      transitionYOffset: 0,
      materialType: 'packed_dirt',
      level: 1,
    };

    this.ec.saveSnapshot();
    track.features.push(feature);
    this._addGizmosForFeature(feature);
    this._selectFeature(feature);
    window.rebuildBridgeMesh?.(feature);
  }

  deleteBridgeMesh(feature = this.activeFeature) {
    if (!feature) return;
    this.ec.saveSnapshot();
    const idx = this.track.features.indexOf(feature);
    if (idx > -1) this.track.features.splice(idx, 1);
    this._removeGizmosForFeature(feature);
    if (this.activeFeature === feature) {
      this.activeFeature = null;
      this.selectedPoint = null;
      const s = this.ec._editorStore;
      if (s) s.selectedType = null;
    }
    window.rebuildBridgeMesh?.(feature);
  }

  duplicateBridgeMesh(feature = this.activeFeature) {
    if (!feature) return;
    this.ec.saveSnapshot();
    const newFeature = {
      ...feature,
      centerX: feature.centerX + 5,
      centerZ: feature.centerZ + 5,
      heights: [...feature.heights],
    };
    this.track.features.push(newFeature);
    this._addGizmosForFeature(newFeature);
    this._selectFeature(newFeature);
    window.rebuildBridgeMesh?.(newFeature);
  }

  flattenBridgeMesh(elevation = null) {
    if (!this.activeFeature) return;
    this.ec.saveSnapshot();
    const f = this.activeFeature;
    const halfW = f.width / 2, halfD = f.depth / 2;
    const stepX = f.cols > 1 ? f.width / (f.cols - 1) : 0;
    const stepZ = f.rows > 1 ? f.depth / (f.rows - 1) : 0;

    for (let r = 0; r < f.rows; r++) {
      for (let c = 0; c < f.cols; c++) {
        const wx = f.centerX - halfW + c * stepX;
        const wz = f.centerZ - halfD + r * stepZ;
        const terrainY = this.track.getHeightAt(wx, wz) ?? 0;
        const target = elevation !== null ? elevation : (terrainY + 5);
        f.heights[r * f.cols + c] = target;
      }
    }

    this._updateGizmoPositions();
    window.rebuildBridgeMesh?.(this.activeFeature);
  }

  /**
   * Resize the grid, resampling heights bilinearly into the new resolution.
   */
  applyGridChanges(newCols, newRows, newWidth, newDepth) {
    if (!this.activeFeature) return;
    this.ec.saveSnapshot();
    const f = this.activeFeature;

    const newH = [];
    for (let r = 0; r < newRows; r++) {
      for (let c = 0; c < newCols; c++) {
        const fc = newCols > 1 ? c * (f.cols - 1) / (newCols - 1) : 0;
        const fr = newRows > 1 ? r * (f.rows - 1) / (newRows - 1) : 0;
        const c0 = Math.max(0, Math.min(Math.floor(fc), f.cols - 2));
        const r0 = Math.max(0, Math.min(Math.floor(fr), f.rows - 2));
        const c1 = c0 + 1, r1 = r0 + 1;
        const tc = fc - c0, tr = fr - r0;
        newH.push(
          (f.heights[r0 * f.cols + c0] ?? 0) * (1 - tc) * (1 - tr) +
          (f.heights[r0 * f.cols + c1] ?? 0) *      tc  * (1 - tr) +
          (f.heights[r1 * f.cols + c0] ?? 0) * (1 - tc) *      tr  +
          (f.heights[r1 * f.cols + c1] ?? 0) *      tc  *      tr
        );
      }
    }

    f.cols   = newCols;
    f.rows   = newRows;
    f.width  = newWidth;
    f.depth  = newDepth;
    f.heights = newH;

    this._removeGizmosForFeature(f);
    this._addGizmosForFeature(f);
    this._selectFeature(f);
    window.rebuildBridgeMesh?.(f);
  }

  // ─── Gizmos ────────────────────────────────────────────────────────────────

  _addGizmosForFeature(feature) {
    const { cols, rows, centerX, centerZ, width, depth, heights } = feature;
    const halfW = width / 2, halfD = depth / 2;
    const stepX = cols > 1 ? width / (cols - 1) : 0;
    const stepZ = rows > 1 ? depth / (rows - 1) : 0;
    const radius = Math.max(0.35, Math.min(1.4, Math.min(stepX || 1, stepZ || 1) * 0.18));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = centerX - halfW + c * stepX;
        const wz = centerZ - halfD + r * stepZ;
        const wy = heights[r * cols + c] ?? 0;

        const mesh = MeshBuilder.CreateSphere(`bmPt_${centerX}_${centerZ}_${r}_${c}`, {
          diameter: radius * 2,
          segments: 6,
        }, this.scene);
        mesh.position = new Vector3(wx, wy, wz);
        mesh.material = this.normalMat;
        mesh.isPickable = true;

        this.pointMeshes.push({ mesh, r, c, featureRef: feature });
      }
    }

    const centerHandle = MeshBuilder.CreateSphere(`bmCenter_${centerX}_${centerZ}`, {
      diameter: Math.max(1.2, radius * 2.5),
      segments: 8,
    }, this.scene);
    centerHandle.position = new Vector3(
      centerX,
      this._centerHandleY(feature),
      centerZ
    );
    centerHandle.material = this.normalMat;
    centerHandle.isPickable = true;
    this.centerGizmos.push({ mesh: centerHandle, featureRef: feature });

    this._buildLineSystemForFeature(feature);
    this._updateVisibilityForFeature(feature);
  }

  _removeGizmosForFeature(feature) {
    const toRemove = this.pointMeshes.filter(p => p.featureRef === feature);
    for (const p of toRemove) p.mesh.dispose();
    this.pointMeshes = this.pointMeshes.filter(p => p.featureRef !== feature);

    const centersToRemove = this.centerGizmos.filter(c => c.featureRef === feature);
    for (const c of centersToRemove) c.mesh.dispose();
    this.centerGizmos = this.centerGizmos.filter(c => c.featureRef !== feature);

    if (this.lineSystem) {
      this.lineSystem.dispose();
      this.lineSystem = null;
    }

    if (this.selectedPoint?.featureRef === feature) {
      this.selectedPoint = null;
    }
    if (this.selectedCenter?.featureRef === feature) {
      this.selectedCenter = null;
    }
  }

  _destroyAllGizmos() {
    for (const p of this.pointMeshes) p.mesh.dispose();
    this.pointMeshes = [];
    for (const c of this.centerGizmos) c.mesh.dispose();
    this.centerGizmos = [];
    if (this.lineSystem) { this.lineSystem.dispose(); this.lineSystem = null; }
    this.selectedPoint = null;
    this.selectedCenter = null;
  }

  _buildLineSystemForFeature(feature) {
    if (this.lineSystem) { this.lineSystem.dispose(); this.lineSystem = null; }

    const { cols, rows, centerX, centerZ, width, depth, heights } = feature;
    const halfW = width / 2, halfD = depth / 2;
    const stepX = cols > 1 ? width / (cols - 1) : 0;
    const stepZ = rows > 1 ? depth / (rows - 1) : 0;
    const OFFSET = 0.08;

    const lines = [];

    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const wx = centerX - halfW + c * stepX;
        const wz = centerZ - halfD + r * stepZ;
        const wy = (heights[r * cols + c] ?? 0) + OFFSET;
        row.push(new Vector3(wx, wy, wz));
      }
      lines.push(row);
    }

    for (let c = 0; c < cols; c++) {
      const col = [];
      for (let r = 0; r < rows; r++) {
        const wx = centerX - halfW + c * stepX;
        const wz = centerZ - halfD + r * stepZ;
        const wy = (heights[r * cols + c] ?? 0) + OFFSET;
        col.push(new Vector3(wx, wy, wz));
      }
      lines.push(col);
    }

    this.lineSystem = MeshBuilder.CreateLineSystem('bmLines', { lines }, this.scene);
    this.lineSystem.color = LINE_COLOR_MESH_GRID;
    this.lineSystem.isPickable = false;
  }

  _updateGizmoPositions() {
    if (!this.activeFeature) return;
    const { cols, rows, centerX, centerZ, width, depth, heights } = this.activeFeature;
    const halfW = width / 2, halfD = depth / 2;
    const stepX = cols > 1 ? width / (cols - 1) : 0;
    const stepZ = rows > 1 ? depth / (rows - 1) : 0;

    for (const p of this.pointMeshes) {
      if (p.featureRef !== this.activeFeature) continue;
      const wx = centerX - halfW + p.c * stepX;
      const wz = centerZ - halfD + p.r * stepZ;
      p.mesh.position.set(wx, heights[p.r * cols + p.c] ?? 0, wz);
    }

    for (const c of this.centerGizmos) {
      if (c.featureRef !== this.activeFeature) continue;
      c.mesh.position.set(centerX, this._centerHandleY(this.activeFeature), centerZ);
    }

    this._buildLineSystemForFeature(this.activeFeature);
  }

  _updateVisibilityForFeature(feature) {
    const { cols, rows } = feature;
    const hasSelection = this.selectedPoint?.featureRef === feature;
    for (const p of this.pointMeshes) {
      if (p.featureRef !== feature) continue;
      const isCorner = (p.r === 0 || p.r === rows - 1) && (p.c === 0 || p.c === cols - 1);
      p.mesh.isVisible  = hasSelection || isCorner;
      p.mesh.isPickable = hasSelection || isCorner;
    }

    const center = this.centerGizmos.find(c => c.featureRef === feature);
    if (center?.mesh) {
      center.mesh.isVisible = true;
      center.mesh.isPickable = true;
    }
  }

  // ─── Selection ─────────────────────────────────────────────────────────────

  _selectFeature(feature) {
    this.activeFeature = feature;
    this._syncToStore(feature);
  }

  _selectCenter(centerData) {
    this.deselect();
    this.selectedCenter = centerData;
    this.activeFeature = centerData.featureRef;
    centerData.mesh.material = this.highlightMat;
    this._updateVisibilityForFeature(centerData.featureRef);
    this._syncToStore(centerData.featureRef);
    this._syncPointToStore();
  }

  selectPoint(pointData) {
    this.deselect();
    this.selectedPoint = pointData;
    pointData.mesh.material = this.highlightMat;
    this.activeFeature = pointData.featureRef;
    this._updateVisibilityForFeature(pointData.featureRef);
    this._syncPointToStore();

    const { cols, rows } = pointData.featureRef;
    const isCorner = (pointData.r === 0 || pointData.r === rows - 1) &&
                     (pointData.c === 0 || pointData.c === cols - 1);
    if (isCorner) this._syncToStore(pointData.featureRef);
  }

  _deselectPoint() {
    if (this.selectedPoint) {
      this.selectedPoint.mesh.material = this.normalMat;
      if (this.selectedPoint.featureRef) {
        this._updateVisibilityForFeature(this.selectedPoint.featureRef);
      }
      this.selectedPoint = null;
    }
    this._syncPointToStore();
  }

  _deselectCenter() {
    if (!this.selectedCenter) return;
    this.selectedCenter.mesh.material = this.normalMat;
    this.selectedCenter = null;
  }

  deselect() {
    this._deselectPoint();
    this._deselectCenter();
  }

  // ─── Height adjustment ─────────────────────────────────────────────────────

  adjustHeight(delta) {
    if (!this.selectedPoint || !this.activeFeature) return;
    this.ec.saveSnapshot(true);
    const { r, c, featureRef } = this.selectedPoint;
    const f = featureRef;
    f.heights[r * f.cols + c] = (f.heights[r * f.cols + c] ?? 0) + delta;
    this._updateGizmoPositions();
    this._syncPointToStore();
    window.rebuildBridgeMesh?.(f);
  }

  setPointHeight(value) {
    if (!this.selectedPoint || !this.activeFeature) return;
    this.ec.saveSnapshot(true);
    const { r, c, featureRef } = this.selectedPoint;
    const f = featureRef;
    f.heights[r * f.cols + c] = value;
    this._updateGizmoPositions();
    this._syncPointToStore();
    window.rebuildBridgeMesh?.(f);
  }

  _onWheel(event) {
    if (!this.selectedPoint) return;
    if (event.target?.closest?.('#bridge-mesh-panel')) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? this.stepSize : -this.stepSize;
    this.adjustHeight(delta);
  }

  // ─── Pointer / key delegation ──────────────────────────────────────────────

  onPointerDown(pickedMesh) {
    for (const c of this.centerGizmos) {
      if (pickedMesh === c.mesh) {
        if (this.selectedCenter === c) return true;
        this._selectCenter(c);
        return true;
      }
    }

    for (const p of this.pointMeshes) {
      if (pickedMesh === p.mesh) {
        if (this.selectedPoint === p) return true;
        this.selectPoint(p);
        return true;
      }
    }
    this.deselect();
    return false;
  }

  onKeyDown(event) {
    if (!this.activeFeature) return false;

    if (event.key === 'ArrowUp' || event.key === ']') {
      this.adjustHeight(this.stepSize);
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === '[') {
      this.adjustHeight(-this.stepSize);
      return true;
    }
    return false;
  }

  // ─── Snapshot restore ──────────────────────────────────────────────────────

  onSnapshotRestored() {
    this._destroyAllGizmos();
    this.activeFeature = null;
    this.selectedPoint = null;
    this.selectedCenter = null;

    for (const f of this.track.features) {
      if (f.type === 'bridgeMesh') this._addGizmosForFeature(f);
    }

    const first = this.track.features.find(f => f.type === 'bridgeMesh');
    if (first) {
      this._selectFeature(first);
    } else {
      const s = this.ec._editorStore;
      if (s && s.selectedType === 'bridgeMesh') s.selectedType = null;
    }
  }

  // ─── Store sync ─────────────────────────────────────────────────────────────

  _syncToStore(feature) {
    const s = this.ec._editorStore;
    if (!s) return;
    s.bridgeMesh.cols      = feature.cols;
    s.bridgeMesh.rows      = feature.rows;
    s.bridgeMesh.width     = feature.width;
    s.bridgeMesh.depth     = feature.depth;
    s.bridgeMesh.thickness = feature.thickness ?? 0.4;
    s.bridgeMesh.transitionEnabled = feature.transitionEnabled ?? true;
    s.bridgeMesh.transitionDepth = feature.transitionDepth ?? 8;
    s.bridgeMesh.transitionYOffset = feature.transitionYOffset ?? 0;
    s.selectedType         = 'bridgeMesh';
  }

  _syncPointToStore() {
    const s = this.ec._editorStore;
    if (!s) return;
    if (this.selectedPoint && this.activeFeature) {
      const { r, c } = this.selectedPoint;
      s.bridgeMesh.pointHeight  = this.activeFeature.heights[r * this.activeFeature.cols + c] ?? 0;
      s.bridgeMesh.hasSelection = true;
    } else {
      s.bridgeMesh.hasSelection = false;
      s.bridgeMesh.pointHeight  = 0;
    }
  }

  setStepSize(v) {
    this.stepSize = v;
    const s = this.ec._editorStore;
    if (s) s.bridgeMesh.stepSize = v;
  }

  get selected() {
    return this.selectedCenter;
  }

  move(movement) {
    if (!this.selectedCenter || !this.activeFeature) return new Vector3(0, 0, 0);
    if (movement.x === 0 && movement.z === 0) return new Vector3(0, 0, 0);

    this.ec.saveSnapshot(true);
    const f = this.activeFeature;
    if (!this.ec._rawDragPos) this.ec._rawDragPos = { x: f.centerX, z: f.centerZ };
    this.ec._rawDragPos.x += movement.x;
    this.ec._rawDragPos.z += movement.z;

    const prevX = f.centerX;
    const prevZ = f.centerZ;
    f.centerX = this.ec._snap(this.ec._rawDragPos.x, 'x');
    f.centerZ = this.ec._snap(this.ec._rawDragPos.z, 'z');

    this._updateGizmoPositions();
    window.rebuildBridgeMesh?.(f);
    return new Vector3(f.centerX - prevX, 0, f.centerZ - prevZ);
  }

  _centerHandleY(feature) {
    const safeHeights = (feature.heights ?? []).filter(v => Number.isFinite(v));
    const maxY = safeHeights.length > 0 ? Math.max(...safeHeights) : 0;
    return maxY + 1.5;
  }
}
