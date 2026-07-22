import rebuild from './editor-rebuild.js';
// Debounce helper (simple, per-instance)
function debounce(fn, delay = 100) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
import { Vector3, MeshBuilder, Color3, Color4 } from "@babylonjs/core";
import { EditorMaterials, RESTING_ALPHA, SELECTED_ALPHA } from './EditorMaterials.js';
import { TERRAIN_TYPES } from '../terrain.js';
import { expandPolyline } from '../polyline-utils.js';

const FALLBACK_COLOR = new Color3(0.5, 0.5, 0.5);

/**
 * TerrainPathEditor — manages an ordered list of waypoints for terrain-painted
 * path features (type: 'terrainPath').  Each feature carries:
 *   { type: 'terrainPath', points: [{x, z}, …], width: 8, terrainType: <TERRAIN_TYPE_OBJ> }
 *
 * Multiple terrainPath features are allowed per track.
 * The currently "active" feature (being edited / just created) is tracked via
 * this.activeFeature.  Clicking an existing waypoint belonging to a different
 * feature switches the active feature.
 *
 * Interaction model mirrors AiPathEditor:
 *   - While selectedType === 'terrainPath', clicking terrain adds a point.
 *   - Clicking an existing waypoint selects it (drag or delete).
 */
export class TerrainPathEditor {
    _debouncedTerrainRebuild = debounce(() => {
      rebuild.terrainGrid?.();
      rebuild.terrainTexture?.(false, { wear: false });
    }, 300);
  constructor(editor) {
    this.editor = editor;
    /** @type {{ feature: object, pointIndex: number, mesh: BABYLON.Mesh }[]} */
    this.handles = [];
    this.selected = null;       // { feature, pointIndex, mesh }
    this.activeFeature = null;  // feature currently being edited

    /** @type {Map<object, BABYLON.Mesh>} feature → line mesh */
    this.lineMeshes = new Map();

    // Clone template for waypoint materials; each handle owns a tinted clone.
    this.material = null;
  }

  get scene() { return this.editor.scene; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  activate(scene, track) {
    this.material = EditorMaterials.for(scene).terrainPathWaypoint;
    this._buildFromTrack(track);
  }

  /**
   * Apply the resting / selected look to a waypoint's own (terrain-tinted)
   * material. The tint itself never changes — selection is the shared alpha
   * jump to solid plus a brighter emissive, matching every other gizmo. This
   * used to brighten diffuseColor instead, which read as a colour change.
   */
  _applyHandleState(handle, selected) {
    const col = this._colorForFeature(handle.feature);
    const mat = handle.mesh.material;
    mat.diffuseColor  = col;
    mat.emissiveColor = selected
      ? new Color3(
          Math.min(1, col.r * 0.4 + 0.25),
          Math.min(1, col.g * 0.4 + 0.25),
          Math.min(1, col.b * 0.4 + 0.25),
        )
      : col.scale(0.4);
    mat.alpha = selected ? SELECTED_ALPHA : RESTING_ALPHA;
  }

  dispose() {
    this.clearMeshes();
  }

  // ── Visual construction ───────────────────────────────────────────────────

  _colorForFeature(feature) {
    const tt = feature.terrainType;
    if (!tt) return FALLBACK_COLOR;
    const c = tt.color;
    return (c && typeof c.r === 'number') ? new Color3(c.r, c.g, c.b) : FALLBACK_COLOR;
  }

  _buildFromTrack(track) {
    for (const feat of track.features) {
      if (feat.type === 'terrainPath' && feat.points?.length > 0) {
        this._rebuildHandlesForFeature(feat);
        this._rebuildLineForFeature(feat);
      }
    }
  }

  _rebuildHandlesForFeature(feature) {
    // Dispose old handles for this feature
    const kept = [];
    for (const h of this.handles) {
      if (h.feature === feature) {
        h.mesh.dispose();
      } else {
        kept.push(h);
      }
    }
    this.handles = kept;
    if (this.selected?.feature === feature) {
      this.selected = null;
      this.editor._rawDragPos = null;
    }

    for (let i = 0; i < feature.points.length; i++) {
      this._createHandle(feature, i);
    }
  }

  _createHandle(feature, index) {
    const pt  = feature.points[index];
    const y   = this.editor.terrainQuery.heightAt(pt.x, pt.z) + 1.5;
    const mesh = MeshBuilder.CreateSphere(`tpWpt_${index}_${Date.now()}`, { diameter: 1.4, segments: 6 }, this.scene);
    mesh.position  = new Vector3(pt.x, y, pt.z);

    // Each waypoint owns a clone so it can carry its feature's terrain tint.
    const mat = this.material.clone('tpWptMat_' + Date.now());
    mesh.material  = mat;
    mesh.isPickable = true;
    mesh._tpIndex   = index;

    const handle = { feature, pointIndex: index, mesh, mat };
    this._applyHandleState(handle, false);
    this.handles.push(handle);
    return handle;
  }

  _rebuildLineForFeature(feature) {
    const old = this.lineMeshes.get(feature);
    if (old) { old.dispose(); this.lineMeshes.delete(feature); }

    const pts = feature.points;
    if (pts.length < 2) return;

    const col = this._colorForFeature(feature);
    const color4 = new Color4(col.r, col.g, col.b, 0.85);

    const cornerRadius = feature.cornerRadius ?? 0;
    const closed = feature.closed ?? false;
    const displayPts = cornerRadius > 0.1
      ? expandPolyline(pts.map(p => ({ ...p, radius: cornerRadius })), closed)
      : pts;

    const positions = displayPts.map(p => {
      const y = this.editor.terrainQuery.heightAt(p.x, p.z) + 1.6;
      return new Vector3(p.x, y, p.z);
    });
    // Close the visual loop back to the first point.
    if (closed && positions.length > 1) {
      positions.push(positions[0].clone());
    }

    const lineMesh = MeshBuilder.CreateLines(`tpLine_${Date.now()}`, {
      points: positions,
      colors: positions.map(() => color4),
      updatable: false,
    }, this.scene);
    lineMesh.isPickable = false;
    this.lineMeshes.set(feature, lineMesh);
  }

  /** Renumber handle pointIndex values for a specific feature after insertion / deletion. */
  _renumberHandlesForFeature(feature) {
    let idx = 0;
    for (const h of this.handles) {
      if (h.feature === feature) {
        h.pointIndex = idx;
        h.mesh._tpIndex = idx;
        idx++;
      }
    }
  }

  clearMeshes() {
    for (const h of this.handles) h.mesh.dispose();
    this.handles = [];
    this.selected = null;
    this.activeFeature = null;
    this.editor._rawDragPos = null;
    for (const lm of this.lineMeshes.values()) lm.dispose();
    this.lineMeshes.clear();
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    return this.handles.find(h => h.mesh === mesh) ?? null;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  select(handle) {
    this.deselect();
    this.selected = handle;
    this.activeFeature = handle.feature;
    this._applyHandleState(handle, true);
    this.editor._rawDragPos = {
      x: handle.feature.points[handle.pointIndex].x,
      z: handle.feature.points[handle.pointIndex].z,
    };
    this._showProperties();
  }

  deselect() {
    if (this.selected) {
      this._applyHandleState(this.selected, false);
      this.selected = null;
      this.editor._rawDragPos = null;
    }
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
    this._rebuildLineForFeature(feature);
    this._scheduleTerrainRebuild();

    return new Vector3(pt.x - prevX, 0, pt.z - prevZ);
  }

  // ── Add / Delete ──────────────────────────────────────────────────────────

  /**
   * Create a brand-new terrainPath feature and make it the active one.
   * Called when the user picks "Terrain Path" from the Add Entity menu.
   */
  createNewPath(terrainTypeName = 'mud') {
    this.editor.saveSnapshot();
    const track = this.editor.currentTrack;
    const entry = Object.values(TERRAIN_TYPES).find(t => t.name === terrainTypeName)
                  ?? TERRAIN_TYPES.MUD;
    const feature = {
      type: 'terrainPath',
      points: [],
      width: 16,
      blendWidth: 2,
      cornerRadius: 5,
      closed: false,
      terrainType: entry,
    };
    track.features.push(feature);
    this.activeFeature = feature;
    return feature;
  }

  /**
   * Add a new waypoint at (x, z) to the activeFeature.
   * If no activeFeature exists, one is created automatically.
   */
  addPoint(x, z) {
    this.editor.saveSnapshot();
    if (!this.activeFeature) {
      this.createNewPath();
    }
    const feature = this.activeFeature;
    const pt = {
      x: parseFloat(x.toFixed(2)),
      z: parseFloat(z.toFixed(2)),
    };
    feature.points.push(pt);
    const handle = this._createHandle(feature, feature.points.length - 1);
    this._rebuildLineForFeature(feature);
    this._scheduleTerrainRebuild();
    this.select(handle);
  }

  /**
   * Delete the currently selected waypoint.
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

    this._renumberHandlesForFeature(feature);
    this._rebuildLineForFeature(feature);
    this._scheduleTerrainRebuild();

    // Remove feature entirely if no points left
    if (feature.points.length === 0) {
      const track = this.editor.currentTrack;
      const idx = track.features.indexOf(feature);
      if (idx > -1) track.features.splice(idx, 1);
      if (this.activeFeature === feature) this.activeFeature = null;
    }
  }

  /** Remove all waypoints and the active terrainPath feature from the track. */
  clearActivePath() {
    if (!this.activeFeature) return;
    this.editor.saveSnapshot();
    const feature = this.activeFeature;

    // Dispose handles for this feature
    const kept = [];
    for (const h of this.handles) {
      if (h.feature === feature) h.mesh.dispose();
      else kept.push(h);
    }
    this.handles = kept;
    if (this.selected?.feature === feature) {
      this.selected = null;
      this.editor._rawDragPos = null;
    }

    const lm = this.lineMeshes.get(feature);
    if (lm) { lm.dispose(); this.lineMeshes.delete(feature); }

    const track = this.editor.currentTrack;
    const idx = track.features.indexOf(feature);
    if (idx > -1) track.features.splice(idx, 1);
    this.activeFeature = null;
    this._scheduleTerrainRebuild();
  }

  /**
   * Insert a new waypoint just after the selected one (at the midpoint to the
   * next point), then select it. Mirrors PolyWall's "Insert After".
   */
  insertAfterSelected() {
    if (!this.selected) return;
    const { feature, pointIndex } = this.selected;
    const pts = feature.points;
    const p1 = pts[pointIndex];
    const p2 = pts[Math.min(pointIndex + 1, pts.length - 1)];

    this.editor.saveSnapshot();
    pts.splice(pointIndex + 1, 0, {
      x: parseFloat(((p1.x + p2.x) / 2).toFixed(2)),
      z: parseFloat(((p1.z + p2.z) / 2).toFixed(2)),
    });

    this._rebuildHandlesForFeature(feature);
    this._rebuildLineForFeature(feature);
    this._scheduleTerrainRebuild();

    const newHandle = this.handles.find(
      h => h.feature === feature && h.pointIndex === pointIndex + 1
    );
    if (newHandle) this.select(newHandle);
  }

  /** Duplicate the active path, offset slightly, and make the copy active. */
  duplicateActivePath() {
    if (!this.activeFeature) return;
    this.editor.saveSnapshot();
    this.deselect();
    const src = this.activeFeature;
    const feature = {
      ...src,
      points: src.points.map(p => ({ ...p, x: p.x + 5, z: p.z + 5 })),
    };
    this.editor.currentTrack.features.push(feature);

    this._rebuildHandlesForFeature(feature);
    this._rebuildLineForFeature(feature);
    this.activeFeature = feature;
    this._scheduleTerrainRebuild();
    this._showProperties();
  }

  /** Toggle whether the path forms a closed loop. */
  setClosed(val) {
    if (!this.activeFeature) return;
    this.editor.saveSnapshot(true);
    this.activeFeature.closed = !!val;
    this._rebuildLineForFeature(this.activeFeature);
    this._scheduleTerrainRebuild();
  }

  /**
   * Remove the active feature if it has no points — called on close so opening
   * the tool then exiting without placing anything doesn't leave litter in the
   * track. No snapshot: creation already pushed one capturing the pre-create
   * state, so undo stays consistent.
   */
  discardActiveIfEmpty() {
    const f = this.activeFeature;
    if (!f || (f.points?.length ?? 0) > 0) return false;
    const track = this.editor.currentTrack;
    const idx = track.features.indexOf(f);
    if (idx > -1) track.features.splice(idx, 1);
    this.activeFeature = null;
    return true;
  }

  /** Called after an undo/redo snapshot restore. */
  onSnapshotRestored(track) {
    this.clearMeshes();
    this._buildFromTrack(track);
  }

  // ── Properties panel ─────────────────────────────────────────────────────

  _showProperties() {
    const s = this.editor._editorStore;
    if (!s || !this.activeFeature) return;
    const f = this.activeFeature;
    s.terrainPath.width        = f.width ?? 8;
    s.terrainPath.blendWidth   = f.blendWidth ?? 0;
    s.terrainPath.cornerRadius = f.cornerRadius ?? 0;
    s.terrainPath.closed       = f.closed ?? false;
    s.terrainPath.terrainType  = f.terrainType?.name ?? 'mud';
    s.selectedType = 'terrainPath';
  }

  _hideProperties() {
    const s = this.editor._editorStore;
    if (s?.selectedType === 'terrainPath') s.selectedType = null;
  }

  // ── Property change methods called from EditorController ─────────────────

  changeWidth(val) {
    if (!this.activeFeature) return;
    this.editor.saveSnapshot(true);
    this.activeFeature.width = val;
    this._scheduleTerrainRebuild();
  }

  changeCornerRadius(val) {
    if (!this.activeFeature) return;
    this.editor.saveSnapshot(true);
    this.activeFeature.cornerRadius = val;
    this._rebuildLineForFeature(this.activeFeature);
    this._scheduleTerrainRebuild();
  }

  changeBlendWidth(val) {
    if (!this.activeFeature) return;
    this.editor.saveSnapshot(true);
    this.activeFeature.blendWidth = Math.max(0, val);
    this._scheduleTerrainRebuild();
  }

  changeTerrainType(name) {
    if (!this.activeFeature) return;
    this.editor.saveSnapshot();
    const entry = Object.values(TERRAIN_TYPES).find(t => t.name === name);
    this.activeFeature.terrainType = entry || null;
    // Refresh handle colors
    this._rebuildHandlesForFeature(this.activeFeature);
    this._rebuildLineForFeature(this.activeFeature);
    this._scheduleTerrainRebuild();
  }

  // ── Terrain rebuild helpers ───────────────────────────────────────────────
  
  _scheduleTerrainRebuild() {
    this._debouncedTerrainRebuild();
  }
}
