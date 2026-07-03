import { Vector3, MeshBuilder } from "@babylonjs/core";
import { EditorMaterials, LINE_COLOR_MESH_GRID } from './EditorMaterials.js';

// Defaults for a new *regional* mesh grid (added when a base mesh already exists).
const REGIONAL_DEFAULT = { width: 60, depth: 60, falloff: 15, angle: 0, cols: 9, rows: 9 };

/**
 * MeshGridEditor – terrain mesh deformation via a grid of selectable control points.
 *
 * The track may hold any number of `meshGrid` features. Each is a `cols × rows`
 * grid of control-point heights (row-major in `feature.heights[]`) placed at
 * `centerX/Z` with `width/depth`, an optional `angle` (degrees) and, for regional
 * meshes, a `falloff` blend band. `Track.getHeightAt` samples and sums them.
 *
 * The first mesh added is a full-track base (regional: false → clamp-to-edge
 * spread, unchanged legacy behaviour). Subsequent meshes are smaller regions
 * (regional: true) that ease to zero across their falloff band so they stack
 * without bleeding edge heights across the whole map.
 *
 * Editing: every mesh shows corner-sphere handles; clicking a corner makes that
 * mesh active and reveals its full grid. Clicking any sphere on the active mesh
 * selects that control point for raise/lower via wheel or [ / ] keys.
 */
export class MeshGridEditor {
  constructor(editorController) {
    this.ec           = editorController;   // EditorController reference
    this.scene        = null;
    this.track        = null;
    this.activeFeature = null;

    // Gizmo state — pointMeshes span every meshGrid feature; each entry knows
    // which feature it belongs to so a click can switch the active mesh.
    this.pointMeshes   = [];   // [{ mesh, r, c, feature }]
    this.selectedPoint = null; // one of pointMeshes entries
    this.lineSystems   = [];   // one LineSystem per feature

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

    // Build handles for any meshGrid features already in the track (loaded file).
    const features = this._features();
    this.activeFeature = features[0] ?? null;
    if (features.length > 0) {
      this.rebuildGizmos();
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

  /** All meshGrid features on the track, in array order. */
  _features() {
    return this.track ? this.track.features.filter(f => f.type === 'meshGrid') : [];
  }

  // ─── Feature management ───────────────────────────────────────────────────

  /** Called from EditorController "Add Entity → Mesh Grid" */
  addMeshGridFeature() {
    const existing = this._features();

    let feature;
    if (existing.length === 0) {
      // Base mesh: full-track, legacy clamp-to-edge spread.
      const trackWidth = this.track.width ?? 160;
      const trackDepth = this.track.depth ?? 160;
      const cols = 9, rows = 9;
      feature = {
        type: 'meshGrid', regional: false,
        centerX: 0, centerZ: 0, angle: 0,
        width: trackWidth, depth: trackDepth,
        cols, rows, heights: new Array(cols * rows).fill(0),
      };
    } else {
      // Additional region: smaller, rotatable, blends out across a falloff band.
      const { width, depth, falloff, angle, cols, rows } = REGIONAL_DEFAULT;
      feature = {
        type: 'meshGrid', regional: true,
        centerX: 0, centerZ: 0, angle,
        width, depth, falloff,
        cols, rows, heights: new Array(cols * rows).fill(0),
      };
    }

    this.ec.saveSnapshot();
    this.track.features.push(feature);
    this.activeFeature = feature;
    this.rebuildGizmos();

    // Auto-select the active mesh's first corner so all its points are visible.
    const firstCorner = this.pointMeshes.find(p => p.feature === feature && p.r === 0 && p.c === 0);
    if (firstCorner) {
      this.selectPoint(firstCorner);
    } else {
      this._syncToStore(feature);
    }

    window.rebuildTerrain?.();
  }

  deleteMeshGrid() {
    if (!this.activeFeature) return;
    this.ec.saveSnapshot();
    const idx = this.track.features.indexOf(this.activeFeature);
    if (idx > -1) this.track.features.splice(idx, 1);
    this.deselectPoint();
    this.activeFeature = this._features()[0] ?? null;
    this.rebuildGizmos();
    if (this.activeFeature) {
      this._syncToStore(this.activeFeature);
    } else {
      const s = this.ec._editorStore;
      if (s) s.selectedType = null;
    }
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
    this.activeFeature = feature;
    this.rebuildGizmos();
    this._syncToStore(feature);
    window.rebuildTerrain?.();
  }

  flattenGrid() {
    if (!this.activeFeature) return;
    this.ec.saveSnapshot();
    this.activeFeature.heights.fill(0);
    this._updateGizmoPositions();
    window.rebuildTerrain?.(this.activeFeature);
  }

  /**
   * Resample the active grid to new density + bounds in a single undo step.
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

    this.rebuildGizmos();

    // Keep editing flow continuous: auto-select the active mesh's first corner.
    const firstCorner = this.pointMeshes.find(p => p.feature === f && p.r === 0 && p.c === 0);
    if (firstCorner) {
      this.selectPoint(firstCorner);
    } else {
      this._syncToStore(f);
    }

    window.rebuildTerrain?.();
  }

  // ─── Gizmo creation / teardown ────────────────────────────────────────────

  /** World position of grid point (r, c), applying the mesh's rotation. */
  _gridPointWorld(feature, r, c) {
    const { centerX, centerZ, width, depth, cols, rows } = feature;
    const halfW = width / 2, halfD = depth / 2;
    const stepX = cols > 1 ? width / (cols - 1) : 0;
    const stepZ = rows > 1 ? depth / (rows - 1) : 0;
    const lx = -halfW + c * stepX;
    const lz = -halfD + r * stepZ;
    const a = (feature.angle ?? 0) * Math.PI / 180;
    const cosA = Math.cos(a), sinA = Math.sin(a);
    return {
      x: centerX + lx * cosA - lz * sinA,
      z: centerZ + lx * sinA + lz * cosA,
    };
  }

  /** Rebuild handles + grid lines for every meshGrid feature. */
  rebuildGizmos() {
    this.destroyGizmos();
    for (const feature of this._features()) {
      this._createFeatureGizmos(feature);
    }
    this._updatePointVisibility();
  }

  _createFeatureGizmos(feature) {
    const { cols, rows, width, depth } = feature;
    const stepX  = cols > 1 ? width  / (cols - 1) : 0;
    const stepZ  = rows > 1 ? depth  / (rows - 1) : 0;
    const radius = Math.max(0.9, Math.min(2.0, Math.min(stepX, stepZ) * 0.16));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const { x: worldX, z: worldZ } = this._gridPointWorld(feature, r, c);
        const worldY = this.track.getHeightAt(worldX, worldZ);

        const mesh = MeshBuilder.CreateSphere(`mgPt_${r}_${c}`, {
          diameter: radius,
          segments: 6,
        }, this.scene);
        mesh.position  = new Vector3(worldX, worldY, worldZ);
        mesh.material  = this.normalMat;
        mesh.isPickable = true;

        this.pointMeshes.push({ mesh, r, c, feature });
      }
    }

    this._buildLineSystem(feature);
  }

  destroyGizmos() {
    for (const p of this.pointMeshes) p.mesh.dispose();
    this.pointMeshes = [];
    for (const ls of this.lineSystems) ls.dispose();
    this.lineSystems = [];
    this.selectedPoint = null;
  }

  /**
   * On the active mesh show all gizmos once a point is selected (otherwise just
   * its corners); on every other mesh show only the corner spheres so an
   * inactive region stays a pickable handle without cluttering the view.
   */
  _updatePointVisibility() {
    const hasSelection = !!this.selectedPoint;
    for (const p of this.pointMeshes) {
      const { cols, rows } = p.feature;
      const isCorner = (p.r === 0 || p.r === rows - 1) && (p.c === 0 || p.c === cols - 1);
      const isActive = p.feature === this.activeFeature;
      const visible = isCorner || (isActive && hasSelection);
      p.mesh.isVisible = visible;
      p.mesh.isPickable = visible;
    }
  }

  _buildLineSystem(feature) {
    const { cols, rows } = feature;
    const LINE_Y_OFFSET = 0.08;
    const lines = [];

    // Horizontal lines (each row left→right)
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const { x: wx, z: wz } = this._gridPointWorld(feature, r, c);
        row.push(new Vector3(wx, this.track.getHeightAt(wx, wz) + LINE_Y_OFFSET, wz));
      }
      lines.push(row);
    }

    // Vertical lines (each column top→bottom)
    for (let c = 0; c < cols; c++) {
      const col = [];
      for (let r = 0; r < rows; r++) {
        const { x: wx, z: wz } = this._gridPointWorld(feature, r, c);
        col.push(new Vector3(wx, this.track.getHeightAt(wx, wz) + LINE_Y_OFFSET, wz));
      }
      lines.push(col);
    }

    const ls = MeshBuilder.CreateLineSystem('mgLines', { lines }, this.scene);
    ls.color       = LINE_COLOR_MESH_GRID;
    ls.isPickable  = false;
    this.lineSystems.push(ls);
  }

  /**
   * Refresh sphere positions (rotation/height aware) and rebuild grid lines.
   * Called after height, position, angle or size changes before rebuildTerrain.
   */
  _updateGizmoPositions() {
    for (const p of this.pointMeshes) {
      const { x: wx, z: wz } = this._gridPointWorld(p.feature, p.r, p.c);
      p.mesh.position.x = wx;
      p.mesh.position.z = wz;
      p.mesh.position.y = this.track.getHeightAt(wx, wz);
    }
    for (const ls of this.lineSystems) ls.dispose();
    this.lineSystems = [];
    for (const feature of this._features()) this._buildLineSystem(feature);
  }

  // ─── Selection ────────────────────────────────────────────────────────────

  selectPoint(pointData) {
    // Switching to a point on a different mesh makes that mesh active.
    if (pointData.feature !== this.activeFeature) {
      this.activeFeature = pointData.feature;
      this._syncToStore(this.activeFeature);
    }
    this.deselectPoint();
    this.selectedPoint = pointData;
    pointData.mesh.material = this.highlightMat;
    this._updatePointVisibility();
    this._syncPointToStore();
    // Show panel when a corner point is clicked (corners are the entry point
    // to the tool; inner points are only reachable once the panel is already open).
    const { cols, rows } = pointData.feature;
    const isCorner = (pointData.r === 0 || pointData.r === rows - 1) &&
                     (pointData.c === 0 || pointData.c === cols - 1);
    if (isCorner) this._syncToStore(pointData.feature);
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
    if (!this.selectedPoint) return;
    this.ec.saveSnapshot(true);
    const { r, c, feature } = this.selectedPoint;
    feature.heights[r * feature.cols + c] += delta;
    this._updateGizmoPositions();
    this._syncPointToStore();
    window.rebuildTerrain?.(feature);
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
   * Pick the control-point sphere under the cursor, considering only this
   * tool's own (visible, pickable) spheres. The coarse ground mesh is pickable
   * and the spheres sit on the terrain surface, so a normal closest-hit pick
   * frequently returns the ground instead of a half-buried sphere — restricting
   * the pick to the handles makes them reliably clickable. Returns the sphere
   * mesh or null.
   */
  pickControlPoint() {
    if (!this.scene) return null;
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (m) => m.isPickable && this.pointMeshes.some(p => p.mesh === m),
    );
    return pick?.hit ? pick.pickedMesh : null;
  }

  /**
   * Call from EditorController's handlePointerDown BEFORE other entity checks.
   * Returns true if this tool consumed the click.
   */
  onPointerDown(pickedMesh) {
    for (const p of this.pointMeshes) {
      if (pickedMesh === p.mesh) {
        if (this.selectedPoint === p) {
          return true;
        }
        this.selectPoint(p);
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
    if (!this.selectedPoint) return false;

    if (event.key === 'ArrowDown' || event.key === '[') {
      this.adjustHeight(-this.stepSize);
      return true;
    }
    if (event.key === 'ArrowUp' || event.key === ']') {
      this.adjustHeight(this.stepSize);
      return true;
    }
    return false;
  }

  // ─── Called by _applySnapshot (undo / redo) ───────────────────────────────

  /**
   * After undo/redo restores features[], tear down old gizmos and rebuild
   * from whatever meshGrid features now exist in the track.
   */
  onSnapshotRestored() {
    this.deselectPoint();
    const features = this._features();
    // Keep the active mesh if it survived the restore, else fall back to first.
    if (!features.includes(this.activeFeature)) {
      this.activeFeature = features[0] ?? null;
    }
    this.rebuildGizmos();
    if (this.activeFeature) {
      this._syncToStore(this.activeFeature);
    } else {
      const s = this.ec._editorStore;
      if (s) s.selectedType = null;
    }
  }

  // ─── Store sync (replaces the old DOM panel) ─────────────────────────────────────

  /** Push feature properties to the Pinia store and open the Vue panel. */
  _syncToStore(feature) {
    const s = this.ec._editorStore;
    if (!s) return;
    const trackWidth = this.track.width ?? 160;
    const trackDepth = this.track.depth ?? 160;
    s.meshGrid.cols      = feature.cols;
    s.meshGrid.rows      = feature.rows;
    s.meshGrid.width     = feature.width;
    s.meshGrid.depth     = feature.depth;
    s.meshGrid.maxWidth  = Math.max(trackWidth, feature.width);
    s.meshGrid.maxDepth  = Math.max(trackDepth, feature.depth);
    s.meshGrid.smoothing = feature.smoothing ?? 0;
    s.meshGrid.angle     = feature.angle ?? 0;
    s.meshGrid.falloff   = feature.falloff ?? REGIONAL_DEFAULT.falloff;
    s.meshGrid.regional  = !!feature.regional;
    s.selectedType       = 'meshGrid';
  }

  /** Push the currently selected point's height (or clear selection) to the store. */
  _syncPointToStore() {
    const s = this.ec._editorStore;
    if (!s) return;
    if (this.selectedPoint) {
      const { r, c, feature } = this.selectedPoint;
      s.meshGrid.pointHeight  = feature.heights[r * feature.cols + c];
      s.meshGrid.hasSelection = true;
    } else {
      s.meshGrid.hasSelection = false;
      s.meshGrid.pointHeight  = 0;
    }
  }

  /** Called by the bridge when the Vue height input commits a value. */
  setPointHeightFromStore(v) {
    if (!this.selectedPoint) return;
    this.ec.saveSnapshot(true);
    const { r, c, feature } = this.selectedPoint;
    feature.heights[r * feature.cols + c] = v;
    this._updateGizmoPositions();
    const s = this.ec._editorStore;
    if (s) s.meshGrid.pointHeight = v;
    window.rebuildTerrain?.(feature);
  }

  /** Set the active mesh's rotation (degrees). Repositions gizmos live. */
  setAngle(v) {
    if (!this.activeFeature) return;
    this.ec.saveSnapshot(true);
    this.activeFeature.angle = v;
    this._updateGizmoPositions();
    window.rebuildTerrain?.(this.activeFeature);
  }

  /** Set the active region's edge-blend band width. */
  setFalloff(v) {
    if (!this.activeFeature) return;
    this.ec.saveSnapshot(true);
    this.activeFeature.falloff = v;
    window.rebuildTerrain?.(this.activeFeature);
  }
}
