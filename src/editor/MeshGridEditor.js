import { Vector3, MeshBuilder } from "@babylonjs/core";
import { EditorMaterials, LINE_COLOR_MESH_GRID } from './EditorMaterials.js';

/**
 * MeshGridEditor – terrain mesh deformation via a grid of selectable control points.
 *
 * A single `meshGrid` feature is stored in the track's features array.  Each
 * grid intersection is represented by a pickable sphere gizmo; clicking one
 * selects it and the user can then raise/lower it with the mouse wheel or the
 * [ / ] keys.  Grid density (cols × rows) and bounds (width × depth) are
 * configurable from the panel and take effect when "Apply Grid Changes" is
 * pressed, resampling existing heights into the new resolution.
 *
 * Height values are stored row-major in `feature.heights[]` and are bilinearly
 * interpolated in `Track.getHeightAt`.
 */
export class MeshGridEditor {
  constructor(editorController) {
    this.ec           = editorController;   // EditorController reference
    this.scene        = null;
    this.track        = null;
    this.activeFeature = null;

    // Gizmo state
    this.pointMeshes   = [];   // [{ mesh, r, c }]
    this.selectedPoint = null; // one of pointMeshes entries
    this.lineSystem    = null;

    // Materials (created in activate)
    this.normalMat    = null;
    this.highlightMat = null;

    // UI
    this.stepSize        = 0.5;

    this._boundWheel = this._onWheel.bind(this);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  activate(scene, track) {
    this.scene = scene;
    this.track = track;

    const m = EditorMaterials.for(scene);
    this.normalMat    = m.meshGridNode;
    this.highlightMat = m.meshGridHighlight;

    document.addEventListener('wheel', this._boundWheel, { passive: false });

    // Build gizmos for a meshGrid that already exists in the track (e.g. loaded file)
    const existing = track.features.find(f => f.type === 'meshGrid');
    if (existing) {
      this.activeFeature = existing;
      this.createGizmos(existing);
      // Panel is intentionally not shown here — it opens when a corner is clicked
      // or when a new mesh grid is added via the Add Entity menu.
    }
  }

  deactivate() {
    document.removeEventListener('wheel', this._boundWheel);
    this.destroyGizmos();
    const s = this.ec._editorStore;
    if (s) s.selectedType = null;
    this.normalMat    = null;
    this.highlightMat = null;
    this.activeFeature = null;
    this.selectedPoint = null;
    this.scene = null;
    this.track = null;
  }

  // ─── Feature management ───────────────────────────────────────────────────

  /** Called from EditorController "Add Entity → Mesh Grid" */
  addMeshGridFeature() {
    if (this.activeFeature) {
      // Already exists – just ensure the panel is visible
      this._syncToStore(this.activeFeature);
      return;
    }

    const cols = 9, rows = 9;
    const feature = {
      type:    'meshGrid',
      centerX: 0,
      centerZ: 0,
      width:   160,
      depth:   160,
      cols,
      rows,
      heights: new Array(cols * rows).fill(0),
    };

    this.ec.saveSnapshot();
    this.track.features.push(feature);
    this.activeFeature = feature;
    this.createGizmos(feature);
    this._syncToStore(feature);
    window.rebuildTerrain?.();
  }

  deleteMeshGrid() {
    if (!this.activeFeature) return;
    this.ec.saveSnapshot();
    const idx = this.track.features.indexOf(this.activeFeature);
    if (idx > -1) this.track.features.splice(idx, 1);
    this.destroyGizmos();
    this.deselectPoint();
    this.activeFeature = null;
    const s = this.ec._editorStore;
    if (s) s.selectedType = null;
    window.rebuildTerrain?.();
    window.rebuildTerrainTexture?.();
  }

  duplicateMeshGrid() {
    if (!this.activeFeature) return;
    this.ec.saveSnapshot();
    const src = this.activeFeature;
    const feature = {
      ...src,
      centerX: src.centerX + 10,
      centerZ: src.centerZ + 10,
      heights: [...src.heights],
    };
    this.track.features.push(feature);
    this.destroyGizmos();
    this.activeFeature = feature;
    this.createGizmos(feature);
    this._syncToStore(feature);
    window.rebuildTerrain?.();
  }

  flattenGrid() {
    if (!this.activeFeature) return;
    this.ec.saveSnapshot();
    this.activeFeature.heights.fill(0);
    this._updateGizmoPositions();
    window.rebuildTerrain?.();
  }

  /**
   * Resample the grid to new density + bounds in a single undo step.
   * Heights are bilinearly interpolated from the old grid into the new one.
   */
  applyGridChanges(newCols, newRows, newWidth, newDepth) {
    if (!this.activeFeature) return;
    this.ec.saveSnapshot();

    const f = this.activeFeature;
    const oldCols = f.cols, oldRows = f.rows, oldH = f.heights;

    // Resample heights
    const newH = [];
    for (let r = 0; r < newRows; r++) {
      for (let c = 0; c < newCols; c++) {
        const fc = (newCols > 1) ? c * (oldCols - 1) / (newCols - 1) : 0;
        const fr = (newRows > 1) ? r * (oldRows - 1) / (newRows - 1) : 0;
        const c0 = Math.max(0, Math.min(Math.floor(fc), oldCols - 2));
        const r0 = Math.max(0, Math.min(Math.floor(fr), oldRows - 2));
        const c1 = c0 + 1, r1 = r0 + 1;
        const tc = fc - c0, tr = fr - r0;
        newH.push(
          (oldH[r0 * oldCols + c0] ?? 0) * (1 - tc) * (1 - tr) +
          (oldH[r0 * oldCols + c1] ?? 0) *      tc  * (1 - tr) +
          (oldH[r1 * oldCols + c0] ?? 0) * (1 - tc) *      tr  +
          (oldH[r1 * oldCols + c1] ?? 0) *      tc  *      tr
        );
      }
    }

    f.cols   = newCols;
    f.rows   = newRows;
    f.width  = newWidth;
    f.depth  = newDepth;
    f.heights = newH;

    this.destroyGizmos();
    this.createGizmos(f);
    this._syncToStore(f);
    window.rebuildTerrain?.();
  }

  // ─── Gizmo creation / teardown ────────────────────────────────────────────

  createGizmos(feature) {
    this.destroyGizmos();

    const { cols, rows, centerX, centerZ, width, depth } = feature;
    const halfW  = width  / 2, halfD  = depth  / 2;
    const stepX  = cols > 1 ? width  / (cols - 1) : 0;
    const stepZ  = rows > 1 ? depth  / (rows - 1) : 0;
    const radius = Math.max(0.35, Math.min(1.4, Math.min(stepX, stepZ) * 0.09));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const worldX = centerX - halfW + c * stepX;
        const worldZ = centerZ - halfD + r * stepZ;
        const worldY = this.track.getHeightAt(worldX, worldZ);

        const mesh = MeshBuilder.CreateSphere(`mgPt_${r}_${c}`, {
          diameter: radius * 2,
          segments: 6,
        }, this.scene);
        mesh.position  = new Vector3(worldX, worldY, worldZ);
        mesh.material  = this.normalMat;
        mesh.isPickable = true;

        this.pointMeshes.push({ mesh, r, c });
      }
    }

    this._buildLineSystem(feature);
    this._updatePointVisibility();
  }

  destroyGizmos() {
    for (const p of this.pointMeshes) p.mesh.dispose();
    this.pointMeshes = [];
    if (this.lineSystem) { this.lineSystem.dispose(); this.lineSystem = null; }
    this.selectedPoint = null;
  }

  /**
   * Show all gizmos when a point is selected; otherwise show only the four
   * corner spheres so inner points don't clutter the view.
   */
  _updatePointVisibility() {
    if (!this.activeFeature) return;
    const { cols, rows } = this.activeFeature;
    const hasSelection = !!this.selectedPoint;
    for (const p of this.pointMeshes) {
      const isCorner = (p.r === 0 || p.r === rows - 1) && (p.c === 0 || p.c === cols - 1);
      p.mesh.isVisible = hasSelection || isCorner;
      p.mesh.isPickable = hasSelection || isCorner;
    }
  }

  _buildLineSystem(feature) {
    if (this.lineSystem) { this.lineSystem.dispose(); this.lineSystem = null; }

    const { cols, rows, centerX, centerZ, width, depth } = feature;
    const halfW = width / 2, halfD = depth / 2;
    const stepX = cols > 1 ? width  / (cols - 1) : 0;
    const stepZ = rows > 1 ? depth  / (rows - 1) : 0;
    const LINE_Y_OFFSET = 0.08;

    const lines = [];

    // Horizontal lines (each row left→right)
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const wx = centerX - halfW + c * stepX;
        const wz = centerZ - halfD + r * stepZ;
        row.push(new Vector3(wx, this.track.getHeightAt(wx, wz) + LINE_Y_OFFSET, wz));
      }
      lines.push(row);
    }

    // Vertical lines (each column top→bottom)
    for (let c = 0; c < cols; c++) {
      const col = [];
      for (let r = 0; r < rows; r++) {
        const wx = centerX - halfW + c * stepX;
        const wz = centerZ - halfD + r * stepZ;
        col.push(new Vector3(wx, this.track.getHeightAt(wx, wz) + LINE_Y_OFFSET, wz));
      }
      lines.push(col);
    }

    this.lineSystem = MeshBuilder.CreateLineSystem('mgLines', { lines }, this.scene);
    this.lineSystem.color       = LINE_COLOR_MESH_GRID;
    this.lineSystem.isPickable  = false;
  }

  /**
   * Refresh sphere Y positions and the line grid after height changes.
   * Called after each height adjustment before rebuildTerrain.
   */
  _updateGizmoPositions() {
    if (!this.activeFeature) return;
    const { cols, rows, centerX, centerZ, width, depth } = this.activeFeature;
    const halfW = width / 2, halfD = depth / 2;
    const stepX = cols > 1 ? width  / (cols - 1) : 0;
    const stepZ = rows > 1 ? depth  / (rows - 1) : 0;

    for (const p of this.pointMeshes) {
      const wx = centerX - halfW + p.c * stepX;
      const wz = centerZ - halfD + p.r * stepZ;
      p.mesh.position.y = this.track.getHeightAt(wx, wz);
    }

    this._buildLineSystem(this.activeFeature);
  }

  // ─── Selection ────────────────────────────────────────────────────────────

  selectPoint(pointData) {
    this.deselectPoint();
    this.selectedPoint = pointData;
    pointData.mesh.material = this.highlightMat;
    this._updatePointVisibility();
    this._syncPointToStore();
    // Show panel when a corner point is clicked (corners are the entry point
    // to the tool; inner points are only reachable once the panel is already open).
    if (this.activeFeature) {
      const { cols, rows } = this.activeFeature;
      const isCorner = (pointData.r === 0 || pointData.r === rows - 1) &&
                       (pointData.c === 0 || pointData.c === cols - 1);
      if (isCorner) this._syncToStore(this.activeFeature);
    }
  }

  deselectPoint() {
    if (this.selectedPoint) {
      this.selectedPoint.mesh.material = this.normalMat;
      this.selectedPoint = null;
    }
    this._updatePointVisibility();
    this._syncPointToStore();
  }

  // ─── Height adjustment ────────────────────────────────────────────────────

  adjustHeight(delta) {
    if (!this.selectedPoint || !this.activeFeature) return;
    this.ec.saveSnapshot(true);
    const { r, c } = this.selectedPoint;
    const f = this.activeFeature;
    f.heights[r * f.cols + c] += delta;
    this._updateGizmoPositions();
    this._syncPointToStore();
    window.rebuildTerrain?.();
  }

  _onWheel(event) {
    if (!this.selectedPoint) return;
    // Only intercept when over the 3-D canvas, not the UI panel
    if (event.target && event.target.closest('#mesh-grid-panel')) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? this.stepSize : -this.stepSize;
    this.adjustHeight(delta);
  }

  // ─── Pointer / key event delegation ─────────────────────────────────────

  /**
   * Call from EditorController's handlePointerDown BEFORE other entity checks.
   * Returns true if this tool consumed the click.
   */
  onPointerDown(pickedMesh) {
    for (const p of this.pointMeshes) {
      if (pickedMesh === p.mesh) {
        if (this.selectedPoint === p) {
          this.deselectPoint();
        } else {
          this.selectPoint(p);
        }
        return true;
      }
    }
    // Clicked elsewhere – deselect any selected point but don't consume
    this.deselectPoint();
    return false;
  }

  /**
   * Call from EditorController's handleKeyDown.
   * Returns true if this tool consumed the key event.
   */
  onKeyDown(event) {
    if (!this.activeFeature) return false;

    if (event.key === 'ArrowDown') {
      this.adjustHeight(-this.stepSize);
      return true;
    }
    if (event.key === 'ArrowUp') {
      this.adjustHeight(this.stepSize);
      return true;
    }
    if (event.key === '[') {
      this.adjustHeight(-this.stepSize);
      return true;
    }
    if (event.key === ']') {
      this.adjustHeight(this.stepSize);
      return true;
    }
    return false;
  }

  // ─── Called by _applySnapshot (undo / redo) ───────────────────────────────

  /**
   * After undo/redo restores features[], tear down old gizmos and rebuild
   * from whatever meshGrid feature (if any) now exists in the track.
   */
  onSnapshotRestored() {
    this.destroyGizmos();
    this.deselectPoint();
    const f = this.track.features.find(f => f.type === 'meshGrid');
    if (f) {
      this.activeFeature = f;
      this.createGizmos(f);
      this._syncToStore(f);
    } else {
      this.activeFeature = null;
      const s = this.ec._editorStore;
      if (s) s.selectedType = null;
    }
  }

  // ─── Store sync (replaces the old DOM panel) ─────────────────────────────────────

  /** Push feature properties to the Pinia store and open the Vue panel. */
  _syncToStore(feature) {
    const s = this.ec._editorStore;
    if (!s) return;
    s.meshGrid.cols      = feature.cols;
    s.meshGrid.rows      = feature.rows;
    s.meshGrid.width     = feature.width;
    s.meshGrid.depth     = feature.depth;
    s.meshGrid.smoothing = feature.smoothing ?? 0;
    s.selectedType       = 'meshGrid';
  }

  /** Push the currently selected point's height (or clear selection) to the store. */
  _syncPointToStore() {
    const s = this.ec._editorStore;
    if (!s) return;
    if (this.selectedPoint && this.activeFeature) {
      const { r, c } = this.selectedPoint;
      s.meshGrid.pointHeight  = this.activeFeature.heights[r * this.activeFeature.cols + c];
      s.meshGrid.hasSelection = true;
    } else {
      s.meshGrid.hasSelection = false;
      s.meshGrid.pointHeight  = 0;
    }
  }

  /** Called by the bridge when the Vue height input commits a value. */
  setPointHeightFromStore(v) {
    if (!this.selectedPoint || !this.activeFeature) return;
    this.ec.saveSnapshot(true);
    const { r, c } = this.selectedPoint;
    const f = this.activeFeature;
    f.heights[r * f.cols + c] = v;
    this._updateGizmoPositions();
    const s = this.ec._editorStore;
    if (s) s.meshGrid.pointHeight = v;
    window.rebuildTerrain?.();
  }
}
