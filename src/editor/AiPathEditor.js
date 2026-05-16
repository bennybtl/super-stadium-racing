import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4 } from "@babylonjs/core";
import { EditorMaterials } from './EditorMaterials.js';

/**
 * AiPathEditor — manages an ordered list of AI path waypoints stored as a
 * single `{ type: 'aiPath', points: [{x, z}, …] }` feature in the track JSON.
 *
 * Each point is represented by a small pickable sphere in the scene.
 * A line mesh connects all points in order (and wraps back to the first).
 *
 * Only ONE aiPath feature is allowed per track.  If none exists when the
 * first waypoint is added, one is created automatically.
 */
export class AiPathEditor {
  constructor(editor) {
    this.editor = editor;
    /** @type {{ feature: object, pointIndex: number, mesh: BABYLON.Mesh }[]} */
    this.handles = [];
    this.selected = null;   // { feature, pointIndex, mesh }
    this.lineMesh = null;
    this.lineMeshes = [];
    this.material = null;
    this.branchMaterial = null;
    this.highlightMaterial = null;
    this.activeBranchId = null; // null = edit main path
  }

  get scene() { return this.editor.scene; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  activate(scene, track) {
    // Materials are created lazily on first use via EditorMaterials
    const m = EditorMaterials.for(scene);
    if (!m.aiWaypoint) {
      const mat = new StandardMaterial('aiWaypointMat', scene);
      mat.diffuseColor  = new Color3(1, 0.85, 0);
      mat.emissiveColor = new Color3(0.4, 0.3, 0);
      mat.specularColor = new Color3(0, 0, 0);
      m.aiWaypoint = mat;
    }
    if (!m.aiWaypointHighlight) {
      const mat = new StandardMaterial('aiWaypointHighlightMat', scene);
      mat.diffuseColor  = new Color3(1, 0.4, 0);
      mat.emissiveColor = new Color3(0.5, 0.2, 0);
      mat.specularColor = new Color3(0, 0, 0);
      m.aiWaypointHighlight = mat;
    }
    if (!m.aiWaypointBranch) {
      const mat = new StandardMaterial('aiWaypointBranchMat', scene);
      mat.diffuseColor  = new Color3(0.2, 0.85, 1);
      mat.emissiveColor = new Color3(0.08, 0.32, 0.4);
      mat.specularColor = new Color3(0, 0, 0);
      m.aiWaypointBranch = mat;
    }
    this.material          = m.aiWaypoint;
    this.branchMaterial    = m.aiWaypointBranch;
    this.highlightMaterial = m.aiWaypointHighlight;

    this._buildFromTrack(track);
  }

  dispose() {
    this.clearMeshes();
  }

  // ── Visual construction ───────────────────────────────────────────────────

  _getOrCreateFeature(track) {
    let feat = track.features.find(f => f.type === 'aiPath');
    if (!feat) {
      feat = { type: 'aiPath', points: [], branches: [] };
      track.features.push(feat);
    } else if (!Array.isArray(feat.branches)) {
      feat.branches = [];
    }
    return feat;
  }

  _buildFromTrack(track) {
    const feat = track.features.find(f => f.type === 'aiPath');
    if (!feat || feat.points.length === 0) return;
    if (!Array.isArray(feat.branches)) feat.branches = [];
    if (this.activeBranchId && !feat.branches.some(b => b.id === this.activeBranchId)) {
      this.activeBranchId = null;
    }
    this._rebuildHandles(feat);
    this._rebuildLine(feat);
  }

  _rebuildHandles(feature) {
    // Dispose old handles
    for (const h of this.handles) h.mesh.dispose();
    this.handles = [];
    this.selected = null;

    const points = this._getActivePoints(feature);
    for (let i = 0; i < points.length; i++) {
      this._createHandle(feature, i);
    }
  }

  _createHandle(feature, index) {
    const pt  = this._getActivePoints(feature)[index];
    const y   = this.editor.terrainQuery.heightAt(pt.x, pt.z) + 1.5;
    const pathPrefix = this.activeBranchId ? `aiWpt_b_${this.activeBranchId}` : 'aiWpt_main';
    const mesh = MeshBuilder.CreateSphere(`${pathPrefix}_${index}`, { diameter: 1.4, segments: 6 }, this.scene);
    mesh.position  = new Vector3(pt.x, y, pt.z);
    mesh.material  = this.activeBranchId ? this.branchMaterial : this.material;
    mesh.isPickable = true;

    // Label index on userData for debugging
    mesh._aiPathIndex = index;

    const handle = {
      feature,
      pointIndex: index,
      mesh,
      pathType: this.activeBranchId ? 'branch' : 'main',
      branchId: this.activeBranchId,
    };
    this.handles.push(handle);
    return handle;
  }

  _rebuildLine(feature) {
    if (this.lineMesh) { this.lineMesh.dispose(); this.lineMesh = null; }
    for (const mesh of this.lineMeshes) mesh.dispose();
    this.lineMeshes = [];

    const mainPoints = feature.points;
    if (mainPoints.length >= 2) {
      const positions = [...mainPoints, mainPoints[0]].map(p => {
        const y = this.editor.terrainQuery.heightAt(p.x, p.z) + 1.6;
        return new Vector3(p.x, y, p.z);
      });

      this.lineMesh = MeshBuilder.CreateLines('aiPathLineMain', {
        points: positions,
        colors: positions.map(() => new Color4(1, 0.85, 0, 0.85)),
        updatable: false,
      }, this.scene);
      this.lineMesh.isPickable = false;
    }

    const branches = Array.isArray(feature.branches) ? feature.branches : [];
    for (const branch of branches) {
      if (!Array.isArray(branch.points) || branch.points.length < 2) continue;
      const branchPositions = branch.points.map(p => {
        const y = this.editor.terrainQuery.heightAt(p.x, p.z) + 1.65;
        return new Vector3(p.x, y, p.z);
      });
      const isActive = branch.id === this.activeBranchId;
      const line = MeshBuilder.CreateLines(`aiPathLineBranch_${branch.id}`, {
        points: branchPositions,
        colors: branchPositions.map(() => isActive ? new Color4(0.2, 0.85, 1, 0.9) : new Color4(0.2, 0.85, 1, 0.45)),
        updatable: false,
      }, this.scene);
      line.isPickable = false;
      this.lineMeshes.push(line);
    }
  }

  /** Renumber handle pointIndex values after insertion / deletion. */
  _renumberHandles() {
    for (let i = 0; i < this.handles.length; i++) {
      this.handles[i].pointIndex = i;
      this.handles[i].mesh._aiPathIndex = i;
    }
  }

  clearMeshes() {
    for (const h of this.handles) h.mesh.dispose();
    this.handles = [];
    this.selected = null;
    if (this.lineMesh) { this.lineMesh.dispose(); this.lineMesh = null; }
    for (const mesh of this.lineMeshes) mesh.dispose();
    this.lineMeshes = [];
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    return this.handles.find(h => h.mesh === mesh) ?? null;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  select(handle) {
    this.deselect();
    this.selected = handle;
    handle.mesh.material = this.highlightMaterial;
    if (handle.pathType === 'branch') {
      this.activeBranchId = handle.branchId;
      this._rebuildLine(handle.feature);
    }
    const points = this._pointsForHandle(handle);
    this.editor._rawDragPos = {
      x: points[handle.pointIndex].x,
      z: points[handle.pointIndex].z,
    };
    this._notifyPanelChanged();
  }

  deselect() {
    if (!this.selected) return;
    this.selected.mesh.material = this.selected.pathType === 'branch' ? this.branchMaterial : this.material;
    this.selected = null;
    this.editor._rawDragPos = null;
    this._notifyPanelChanged();
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  move(movement) {
    if (!this.selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    const e = this.editor;
    e.saveSnapshot(true);
    const { pointIndex } = this.selected;
    const points = this._pointsForHandle(this.selected);
    const pt = points[pointIndex];

    if (!e._rawDragPos) e._rawDragPos = { x: pt.x, z: pt.z };
    e._rawDragPos.x += movement.x;
    e._rawDragPos.z += movement.z;

    const prevX = pt.x;
    const prevZ = pt.z;
    pt.x = e._snap(e._rawDragPos.x);
    pt.z = e._snap(e._rawDragPos.z);

    const y = this.editor.terrainQuery.heightAt(pt.x, pt.z) + 1.5;
    this.selected.mesh.position.set(pt.x, y, pt.z);

    this._rebuildLine(this.selected.feature);
    this._scheduleTerrainRebuild();
    this._notifyPanelChanged();

    return new Vector3(pt.x - prevX, 0, pt.z - prevZ);
  }

  // ── Add / Delete ──────────────────────────────────────────────────────────

  /**
   * Add a new waypoint at (x, z).  Creates the aiPath feature if it doesn't
   * exist yet.  New point is appended at the end of the points array.
   */
  addPoint(x, z) {
    this.editor.saveSnapshot();
    const track = this.editor.currentTrack;
    const feature = this._getOrCreateFeature(track);
    const pt = {
      x: parseFloat(x.toFixed(2)),
      z: parseFloat(z.toFixed(2)),
    };
    const points = this._getActivePoints(feature);
    points.push(pt);

    const handle = this._createHandle(feature, points.length - 1);
    this._rebuildLine(feature);
    this._scheduleTerrainRebuild();
    // Auto-select the new point
    this.select(handle);
    this._notifyPanelChanged();
  }

  /**
   * Delete the currently selected waypoint.
   * If this was the last point, also removes the aiPath feature entirely.
   */
  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const { feature, pointIndex, mesh } = this.selected;
    const points = this._pointsForHandle(this.selected);

    mesh.dispose();
    this.handles.splice(this.handles.indexOf(this.selected), 1);
    points.splice(pointIndex, 1);
    this.selected = null;
    this.editor._rawDragPos = null;

    if (this.activeBranchId) {
      const branch = this._getActiveBranch(feature);
      if (!branch || !Array.isArray(branch.points) || branch.points.length < 2) {
        const branches = Array.isArray(feature.branches) ? feature.branches : [];
        const idx = branches.findIndex(b => b.id === this.activeBranchId);
        if (idx > -1) branches.splice(idx, 1);
        this.activeBranchId = null;
      }
    }

    this._rebuildHandles(feature);
    this._rebuildLine(feature);
    this._scheduleTerrainRebuild();

    // Remove feature entirely if no points left
    if (feature.points.length === 0) {
      const track = this.editor.currentTrack;
      const idx = track.features.indexOf(feature);
      if (idx > -1) track.features.splice(idx, 1);
    }

    this._notifyPanelChanged();
  }

  /** Remove all waypoints and the aiPath feature from the track. */
  clearAll() {
    this.editor.saveSnapshot();
    this.clearMeshes();
    const track = this.editor.currentTrack;
    const idx = track.features.findIndex(f => f.type === 'aiPath');
    if (idx > -1) track.features.splice(idx, 1);
    this.activeBranchId = null;
    this._scheduleTerrainRebuild();
    this._notifyPanelChanged();
  }

  /** Called after an undo/redo snapshot restore. */
  onSnapshotRestored(track) {
    this.clearMeshes();
    this._buildFromTrack(track);
    this._scheduleTerrainRebuild();
    this._notifyPanelChanged();
  }

  _getActiveBranch(feature) {
    if (!this.activeBranchId) return null;
    const branches = Array.isArray(feature.branches) ? feature.branches : [];
    return branches.find(b => b.id === this.activeBranchId) ?? null;
  }

  _getActivePoints(feature) {
    const branch = this._getActiveBranch(feature);
    if (branch) return branch.points;
    return feature.points;
  }

  _pointsForHandle(handle) {
    if (handle.pathType === 'branch') {
      const branches = Array.isArray(handle.feature.branches) ? handle.feature.branches : [];
      const branch = branches.find(b => b.id === handle.branchId);
      if (branch?.points) return branch.points;
    }
    return handle.feature.points;
  }

  _makeBranchId(feature) {
    const branches = Array.isArray(feature.branches) ? feature.branches : [];
    let n = branches.length + 1;
    let id = `branch_${n}`;
    while (branches.some(b => b.id === id)) {
      n += 1;
      id = `branch_${n}`;
    }
    return id;
  }

  editMainPath() {
    const feature = this.editor.currentTrack?.features?.find(f => f.type === 'aiPath');
    this.activeBranchId = null;
    if (feature) {
      this._rebuildHandles(feature);
      this._rebuildLine(feature);
    }
    this._notifyPanelChanged();
  }

  selectBranch(branchId) {
    const feature = this.editor.currentTrack?.features?.find(f => f.type === 'aiPath');
    if (!feature || !Array.isArray(feature.branches)) return;
    if (!feature.branches.some(b => b.id === branchId)) return;

    this.activeBranchId = branchId;
    this.deselect();
    this._rebuildHandles(feature);
    this._rebuildLine(feature);
    this._notifyPanelChanged();
  }

  createBranchFromSelected(weight = 1) {
    const track = this.editor.currentTrack;
    if (!track) return;
    const feature = this._getOrCreateFeature(track);
    if (!this.selected || this.selected.pathType !== 'main') return;

    const fromMainIndex = this.selected.pointIndex;
    const toMainIndex = fromMainIndex + 1;
    if (fromMainIndex < 0 || toMainIndex >= feature.points.length) return;

    this.editor.saveSnapshot();
    const newBranch = {
      id: this._makeBranchId(feature),
      fromMainIndex,
      toMainIndex,
      weight: Number.isFinite(weight) ? Math.max(0, weight) : 1,
      points: [
        { x: feature.points[fromMainIndex].x, z: feature.points[fromMainIndex].z },
        { x: feature.points[toMainIndex].x, z: feature.points[toMainIndex].z },
      ],
    };
    feature.branches.push(newBranch);

    this.activeBranchId = newBranch.id;
    this.deselect();
    this._rebuildHandles(feature);
    this._rebuildLine(feature);
    this._scheduleTerrainRebuild();
    this._notifyPanelChanged();
  }

  setActiveBranchWeight(weight) {
    const feature = this.editor.currentTrack?.features?.find(f => f.type === 'aiPath');
    if (!feature) return;
    const branch = this._getActiveBranch(feature);
    if (!branch) return;

    this.editor.saveSnapshot(true);
    branch.weight = Number.isFinite(weight) ? Math.max(0, weight) : 1;
    this._notifyPanelChanged();
  }

  setActiveBranchRejoinIndex(toMainIndex) {
    const feature = this.editor.currentTrack?.features?.find(f => f.type === 'aiPath');
    if (!feature || !Array.isArray(feature.points) || feature.points.length < 2) return;
    const branch = this._getActiveBranch(feature);
    if (!branch) return;

    const next = Number.isFinite(toMainIndex) ? Math.round(toMainIndex) : NaN;
    if (!Number.isInteger(next)) return;
    if (next <= branch.fromMainIndex || next >= feature.points.length) return;

    this.editor.saveSnapshot();
    branch.toMainIndex = next;

    // Keep branch endpoint anchored to the selected main rejoin node.
    if (!Array.isArray(branch.points) || branch.points.length < 2) {
      branch.points = [
        { x: feature.points[branch.fromMainIndex].x, z: feature.points[branch.fromMainIndex].z },
        { x: feature.points[next].x, z: feature.points[next].z },
      ];
    } else {
      const dst = feature.points[next];
      branch.points[branch.points.length - 1] = { x: dst.x, z: dst.z };
    }

    this._rebuildHandles(feature);
    this._rebuildLine(feature);
    this._scheduleTerrainRebuild();
    this._notifyPanelChanged();
  }

  deleteActiveBranch() {
    const feature = this.editor.currentTrack?.features?.find(f => f.type === 'aiPath');
    if (!feature || !this.activeBranchId) return;
    const branches = Array.isArray(feature.branches) ? feature.branches : [];
    const idx = branches.findIndex(b => b.id === this.activeBranchId);
    if (idx < 0) return;

    this.editor.saveSnapshot();
    branches.splice(idx, 1);
    this.activeBranchId = null;
    this.deselect();
    this._rebuildHandles(feature);
    this._rebuildLine(feature);
    this._scheduleTerrainRebuild();
    this._notifyPanelChanged();
  }

  clearBranches() {
    const feature = this.editor.currentTrack?.features?.find(f => f.type === 'aiPath');
    if (!feature || !Array.isArray(feature.branches) || feature.branches.length === 0) return;
    this.editor.saveSnapshot();
    feature.branches = [];
    this.activeBranchId = null;
    this.deselect();
    this._rebuildHandles(feature);
    this._rebuildLine(feature);
    this._scheduleTerrainRebuild();
    this._notifyPanelChanged();
  }

  getPanelState() {
    const feature = this.editor.currentTrack?.features?.find(f => f.type === 'aiPath');
    const branches = Array.isArray(feature?.branches)
      ? feature.branches.map(b => ({
          id: b.id,
          fromMainIndex: b.fromMainIndex,
          toMainIndex: b.toMainIndex,
          weight: Number.isFinite(b.weight) ? b.weight : 1,
          pointCount: Array.isArray(b.points) ? b.points.length : 0,
        }))
      : [];

    const activeBranch = this.activeBranchId
      ? branches.find(b => b.id === this.activeBranchId) ?? null
      : null;

    return {
      editingMainPath: !this.activeBranchId,
      activeBranchId: this.activeBranchId,
      activeBranchWeight: activeBranch?.weight ?? 1,
      activeBranchFromMainIndex: activeBranch?.fromMainIndex ?? null,
      activeBranchToMainIndex: activeBranch?.toMainIndex ?? null,
      mainWaypointCount: Array.isArray(feature?.points) ? feature.points.length : 0,
      branches,
    };
  }

  _notifyPanelChanged() {
    this.editor?._syncAiPathPanel?.();
  }

  _scheduleTerrainRebuild() {
    window.rebuildTerrainTexture?.();
  }
}
