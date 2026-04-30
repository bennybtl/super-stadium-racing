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
    this.material = null;
    this.highlightMaterial = null;
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
    this.material          = m.aiWaypoint;
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
      feat = { type: 'aiPath', points: [] };
      track.features.push(feat);
    }
    return feat;
  }

  _buildFromTrack(track) {
    const feat = track.features.find(f => f.type === 'aiPath');
    if (!feat || feat.points.length === 0) return;
    this._rebuildHandles(feat);
    this._rebuildLine(feat);
  }

  _rebuildHandles(feature) {
    // Dispose old handles
    for (const h of this.handles) h.mesh.dispose();
    this.handles = [];
    this.selected = null;

    for (let i = 0; i < feature.points.length; i++) {
      this._createHandle(feature, i);
    }
  }

  _createHandle(feature, index) {
    const pt  = feature.points[index];
    const y   = this.editor.terrainQuery.heightAt(pt.x, pt.z) + 1.5;
    const mesh = MeshBuilder.CreateSphere(`aiWpt_${index}`, { diameter: 1.4, segments: 6 }, this.scene);
    mesh.position  = new Vector3(pt.x, y, pt.z);
    mesh.material  = this.material;
    mesh.isPickable = true;

    // Label index on userData for debugging
    mesh._aiPathIndex = index;

    const handle = { feature, pointIndex: index, mesh };
    this.handles.push(handle);
    return handle;
  }

  _rebuildLine(feature) {
    if (this.lineMesh) { this.lineMesh.dispose(); this.lineMesh = null; }
    const pts = feature.points;
    if (pts.length < 2) return;

    // Close the loop by appending the first point at the end
    const positions = [...pts, pts[0]].map(p => {
      const y = this.editor.terrainQuery.heightAt(p.x, p.z) + 1.6;
      return new Vector3(p.x, y, p.z);
    });

    this.lineMesh = MeshBuilder.CreateLines('aiPathLine', {
      points: positions,
      colors: positions.map(() => new Color4(1, 0.85, 0, 0.85)),
      updatable: false,
    }, this.scene);
    this.lineMesh.isPickable = false;
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
    this.editor._rawDragPos = {
      x: handle.feature.points[handle.pointIndex].x,
      z: handle.feature.points[handle.pointIndex].z,
    };
  }

  deselect() {
    if (!this.selected) return;
    this.selected.mesh.material = this.material;
    this.selected = null;
    this.editor._rawDragPos = null;
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  move(movement) {
    if (!this.selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    const e = this.editor;
    e.saveSnapshot(true);
    const { feature, pointIndex } = this.selected;
    const pt = feature.points[pointIndex];

    if (!e._rawDragPos) e._rawDragPos = { x: pt.x, z: pt.z };
    e._rawDragPos.x += movement.x;
    e._rawDragPos.z += movement.z;

    const prevX = pt.x;
    const prevZ = pt.z;
    pt.x = e._snap(e._rawDragPos.x);
    pt.z = e._snap(e._rawDragPos.z);

    const y = this.editor.terrainQuery.heightAt(pt.x, pt.z) + 1.5;
    this.selected.mesh.position.set(pt.x, y, pt.z);

    this._rebuildLine(feature);
    this._scheduleTerrainRebuild();

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
    feature.points.push(pt);

    const handle = this._createHandle(feature, feature.points.length - 1);
    this._rebuildLine(feature);
    this._scheduleTerrainRebuild();
    // Auto-select the new point
    this.select(handle);
  }

  /**
   * Delete the currently selected waypoint.
   * If this was the last point, also removes the aiPath feature entirely.
   */
  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const { feature, pointIndex, mesh } = this.selected;

    mesh.dispose();
    this.handles.splice(this.handles.indexOf(this.selected), 1);
    feature.points.splice(pointIndex, 1);
    this.selected = null;
    this.editor._rawDragPos = null;

    this._renumberHandles();
    this._rebuildLine(feature);
    this._scheduleTerrainRebuild();

    // Remove feature entirely if no points left
    if (feature.points.length === 0) {
      const track = this.editor.currentTrack;
      const idx = track.features.indexOf(feature);
      if (idx > -1) track.features.splice(idx, 1);
    }
  }

  /** Remove all waypoints and the aiPath feature from the track. */
  clearAll() {
    this.editor.saveSnapshot();
    this.clearMeshes();
    const track = this.editor.currentTrack;
    const idx = track.features.findIndex(f => f.type === 'aiPath');
    if (idx > -1) track.features.splice(idx, 1);
    this._scheduleTerrainRebuild();
  }

  /** Called after an undo/redo snapshot restore. */
  onSnapshotRestored(track) {
    this.clearMeshes();
    this._buildFromTrack(track);
    this._scheduleTerrainRebuild();
  }

  _scheduleTerrainRebuild() {
    window.rebuildTerrainTexture?.();
  }
}
