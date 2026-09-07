import { Vector3, MeshBuilder } from '@babylonjs/core';
import rebuild, { REBUILD_DEBOUNCE_MS } from './editor-rebuild.js';
import { GizmoHandle } from './GizmoHandle.js';
import { EditorMaterials, LINE_COLOR_TERRAIN_SHAPE } from './EditorMaterials.js';
import { TERRAIN_TYPES } from '../world/terrain.js';
import { polylineCentroid } from '../utils/polyline-utils.js';
import { gizmoY, gizmoLineY } from './gizmo-height.js';

const POLY_POINT_MIN = 3;

/**
 * TerrainShapeEditor — handles terrain shape features (type: 'terrain').
 * Each feature carries a `shape` property ('rect' | 'circle' | 'polygon') that
 * controls its geometry. All shapes live in a single `meshes` array.
 * A shape-dropdown in the Vue panel lets the user convert between them.
 */
export class TerrainShapeEditor {
  constructor(editor) {
    this.editor = editor;

    this.meshes   = [];   // { feature, handle, pointHandles, lineSystem }[]
    this.selected = null; // the currently-selected entry
    this._selectedPointIndex = -1; // polygon: index into feature.points, -1 = whole-feature handle
    this._terrainGridRebuildTimer = null;
  }

  /** Called when editor mode activates — creates the gizmo handles. */
  activate(scene, track) {
    this.createVisualsForTrack(track);
  }

  /** Dispose all gizmo meshes and reset state, keeping materials alive (used on snapshot restore). */
  clearMeshes() {
    for (const d of this.meshes) {
      d.handle?.dispose();
      for (const p of d.pointHandles) p.dispose();
      d.lineSystem?.dispose();
    }
    this.meshes   = [];
    this.selected = null;
    this._selectedPointIndex = -1;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Ensure a polygon feature has a valid point list + up-to-date centroid. */
  _normaliseFeature(feature) {
    if (feature.shape !== 'polygon') return;
    if (!Array.isArray(feature.points) || feature.points.length < POLY_POINT_MIN) {
      const cx = feature.centerX ?? 0;
      const cz = feature.centerZ ?? 0;
      const hw = Math.max(2, (feature.width ?? 10) / 2);
      const hd = Math.max(2, (feature.depth ?? 10) / 2);
      feature.points = [
        { x: cx - hw, z: cz - hd },
        { x: cx + hw, z: cz - hd },
        { x: cx + hw, z: cz + hd },
        { x: cx - hw, z: cz + hd },
      ];
    }
    const c = polylineCentroid(feature.points);
    feature.centerX = c.x;
    feature.centerZ = c.z;
  }

  // ── Visual creation ─────────────────────────────────────────────────────────

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'terrain') this.createVisual(feature);
    }
  }

  /**
   * Create the gizmo for a terrain feature. The patch itself is visible in the
   * baked terrain texture, so rect/circle only get a handle sphere. Polygon
   * shapes additionally get a draggable sphere per vertex plus an outline, so
   * the vertices can be edited directly (same convention as action zones).
   */
  createVisual(feature) {
    this._normaliseFeature(feature);
    const data = { feature, handle: null, pointHandles: [], lineSystem: null };
    this._buildMeshes(data);
    this.meshes.push(data);
    return data;
  }

  _buildMeshes(data) {
    const { feature } = data;
    const { scene } = this.editor;

    const handle = new GizmoHandle(scene, 'terrain');
    handle.setPosition(feature.centerX, this._handleY(feature), feature.centerZ);
    data.handle = handle;

    if (feature.shape === 'polygon') {
      const mats = EditorMaterials.for(scene).handleMaterials('terrain');
      const track = this.editor.currentTrack;
      data.pointHandles = feature.points.map((pt, idx) => {
        const p = MeshBuilder.CreateSphere(`tsPolyPt_${idx}`, { diameter: 1.2, segments: 8 }, scene);
        p.position = new Vector3(pt.x, gizmoY(track, pt.x, pt.z), pt.z);
        p.material = mats.handle;
        p.isPickable = true;
        return p;
      });
      data.lineSystem = this._buildLine(feature.points);
    }
  }

  _buildLine(points) {
    if (!points || points.length < POLY_POINT_MIN) return null;
    const { scene } = this.editor;
    const track = this.editor.currentTrack;
    const linePoints = points.map(pt => new Vector3(pt.x, gizmoLineY(track, pt.x, pt.z), pt.z));
    linePoints.push(linePoints[0].clone());
    const ls = MeshBuilder.CreateLineSystem('tsPolyLine', { lines: [linePoints] }, scene);
    ls.color = LINE_COLOR_TERRAIN_SHAPE;
    ls.isPickable = false;
    return ls;
  }

  /** Full dispose + rebuild of a data entry's meshes (point count changed). */
  _rebuildVisual(data) {
    const keepSelected = this.selected === data;

    data.handle?.dispose();
    data.handle = null;
    for (const p of data.pointHandles) p.dispose();
    data.pointHandles = [];
    data.lineSystem?.dispose();
    data.lineSystem = null;

    this._buildMeshes(data);

    if (keepSelected) this._applyVisualState(data, true);
  }

  // ── Visual update ────────────────────────────────────────────────────────────

  /** Re-position existing meshes in place (point count unchanged). */
  updateVisual(data) {
    const { feature, handle, pointHandles } = data;
    handle?.setPosition(feature.centerX, this._handleY(feature), feature.centerZ);

    if (feature.shape === 'polygon') {
      const track = this.editor.currentTrack;
      for (let i = 0; i < pointHandles.length; i++) {
        const pt = feature.points[i];
        if (!pt) continue;
        pointHandles[i].position.set(pt.x, gizmoY(track, pt.x, pt.z), pt.z);
      }
      if (data.lineSystem) {
        data.lineSystem.dispose();
        data.lineSystem = this._buildLine(feature.points);
      }
    }
  }

  /** Terrain patches are flat paint, so the handle only has to clear the ground. */
  _handleY(feature) {
    return gizmoY(this.editor.currentTrack, feature.centerX, feature.centerZ);
  }

  /** Re-sample handle heights after a terrain rebuild (EditorController sweep). */
  refreshGizmoHeights() {
    for (const data of this.meshes) this.updateVisual(data);
  }

  // ── Selection ────────────────────────────────────────────────────────────────

  /** Global gizmo-visibility toggle (EditorController.setGizmosVisible). */
  setHandlesVisible(visible) {
    for (const d of this.meshes) {
      d.handle?.setVisible(visible);
      for (const p of d.pointHandles) {
        p.isVisible = visible;
        p.isPickable = visible;
      }
      if (d.lineSystem) d.lineSystem.isVisible = visible;
    }
  }

  findByMesh(mesh) {
    for (const d of this.meshes) {
      if (d.handle?.mesh === mesh) {
        d._pendingPointIndex = -1;
        return d;
      }
      const idx = d.pointHandles.indexOf(mesh);
      if (idx !== -1) {
        d._pendingPointIndex = idx;
        return d;
      }
    }
    return null;
  }

  /**
   * Handle pointer selection for the center/point handles. Returns true when
   * the click was consumed by this editor (mirrors ActionZoneEditor / PolyHillEditor).
   */
  onPointerDown(mesh) {
    const data = this.findByMesh(mesh);
    if (!data) return false;

    const nextPointIndex = data._pendingPointIndex ?? -1;
    const sameData = this.selected === data;
    const samePoint = sameData && this._selectedPointIndex === nextPointIndex;

    if (samePoint) {
      delete data._pendingPointIndex;
      return true;
    }

    if (!sameData) this.editor.deselectAll();
    this.select(data);
    return true;
  }

  select(data) {
    this.deselect();
    this.selected = data;
    this._selectedPointIndex = data._pendingPointIndex ?? -1;
    delete data._pendingPointIndex;

    const { feature } = data;
    if (feature.shape === 'polygon' && this._selectedPointIndex >= 0) {
      const pt = feature.points[this._selectedPointIndex];
      this.editor._rawDragPos = { x: pt.x, z: pt.z };
    } else {
      this.editor._rawDragPos = { x: feature.centerX, z: feature.centerZ };
    }

    this._applyVisualState(data, true);
    this.showProperties(data);
  }

  deselect() {
    if (!this.selected) return;
    this._applyVisualState(this.selected, false);
    this.selected = null;
    this._selectedPointIndex = -1;
    this.editor._rawDragPos = null;
    this.hideProperties();
  }

  _applyVisualState(data, selected) {
    data.handle?.setSelected(selected);
    if (!data.pointHandles.length) return;
    const mats = EditorMaterials.for(this.editor.scene).handleMaterials('terrain');
    for (let i = 0; i < data.pointHandles.length; i++) {
      const isActive = selected && i === this._selectedPointIndex;
      data.pointHandles[i].material = isActive ? mats.selected : mats.handle;
    }
  }

  _scheduleTerrainGridRebuild() {
    if (this._terrainGridRebuildTimer) clearTimeout(this._terrainGridRebuildTimer);
    this._terrainGridRebuildTimer = setTimeout(() => {
      this._terrainGridRebuildTimer = null;
      rebuild.terrainGrid?.();
    }, REBUILD_DEBOUNCE_MS);
  }

  _flushTerrainGridRebuild() {
    if (!this._terrainGridRebuildTimer) return false;
    clearTimeout(this._terrainGridRebuildTimer);
    this._terrainGridRebuildTimer = null;
    rebuild.terrainGrid?.();
    return true;
  }

  // ── Movement ─────────────────────────────────────────────────────────────────

  move(movement) {
    if (!this.selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    const { feature } = this.selected;
    const isPolyPoint = feature.shape === 'polygon' && this._selectedPointIndex >= 0;

    if (!this.editor._rawDragPos) {
      this.editor._rawDragPos = isPolyPoint
        ? { x: feature.points[this._selectedPointIndex].x, z: feature.points[this._selectedPointIndex].z }
        : { x: feature.centerX, z: feature.centerZ };
    }

    const nextRawX = this.editor._rawDragPos.x + movement.x;
    const nextRawZ = this.editor._rawDragPos.z + movement.z;
    const nextX = this.editor._snap(nextRawX);
    const nextZ = this.editor._snap(nextRawZ);

    if (isPolyPoint) {
      const pt = feature.points[this._selectedPointIndex];
      this.editor._rawDragPos.x = nextRawX;
      this.editor._rawDragPos.z = nextRawZ;

      if (nextX === pt.x && nextZ === pt.z) return new Vector3(0, 0, 0);

      this.editor.saveSnapshot(true);
      const prevX = pt.x, prevZ = pt.z;
      pt.x = nextX;
      pt.z = nextZ;

      const c = polylineCentroid(feature.points);
      feature.centerX = c.x;
      feature.centerZ = c.z;

      this._rebuildVisual(this.selected);
      this._scheduleTerrainGridRebuild();
      rebuild.terrain?.(feature);
      rebuild.terrainTexture?.(false, { wear: false, normals: false });
      rebuild.normalMap?.();

      return new Vector3(pt.x - prevX, 0, pt.z - prevZ);
    }

    if (nextX === feature.centerX && nextZ === feature.centerZ) {
      this.editor._rawDragPos.x = nextRawX;
      this.editor._rawDragPos.z = nextRawZ;
      return new Vector3(0, 0, 0);
    }

    this.editor.saveSnapshot(true);
    this.editor._rawDragPos.x = nextRawX;
    this.editor._rawDragPos.z = nextRawZ;

    const prevX = feature.centerX, prevZ = feature.centerZ;
    const dx = nextX - prevX, dz = nextZ - prevZ;
    feature.centerX = nextX;
    feature.centerZ = nextZ;

    if (feature.shape === 'polygon') {
      feature.points = feature.points.map(p => ({ x: p.x + dx, z: p.z + dz }));
      this._rebuildVisual(this.selected);
    } else {
      this.updateVisual(this.selected);
    }

    this._scheduleTerrainGridRebuild();
    rebuild.terrain?.(feature);
    rebuild.terrainTexture?.(false, { wear: false, normals: false });
    rebuild.normalMap?.();

    return new Vector3(dx, 0, dz);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────────

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const data = this.selected;
    const idx  = this.editor.currentTrack.features.indexOf(data.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    data.handle?.dispose();
    for (const p of data.pointHandles) p.dispose();
    data.lineSystem?.dispose();
    const meshIdx = this.meshes.indexOf(data);
    if (meshIdx > -1) this.meshes.splice(meshIdx, 1);
    this.selected = null;
    this._selectedPointIndex = -1;
    this.editor._rawDragPos = null;
    this.hideProperties();
    rebuild.terrainGrid?.();
    rebuild.terrain?.();
    rebuild.terrainTexture?.(false, { wear: false, normals: false });
    rebuild.normalMap?.();
  }

  duplicateSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const src        = this.selected.feature;
    const newFeature = { ...src, centerX: src.centerX + 3, centerZ: src.centerZ + 3 };
    if (src.shape === 'polygon' && Array.isArray(src.points)) {
      newFeature.points = src.points.map(p => ({ x: p.x + 3, z: p.z + 3 }));
    }
    this.editor.currentTrack.features.push(newFeature);
    const newData = this.createVisual(newFeature);
    this.deselect();
    this.select(newData);
    this.rebuildTerrain();
  }

  addEntity(shape = 'circle') {
    const center = this.editor.viewCenterXZ();
    const base = {
      type:        'terrain',
      shape,
      centerX:     center.x,
      centerZ:     center.z,
      terrainType: TERRAIN_TYPES.MUD,
      roughness:   TERRAIN_TYPES.MUD.roughness,
    };
    const newFeature = { ...base, width: 10, depth: 10, rotation: 0 };
    newFeature.blendWidth = 0;
    this.editor.saveSnapshot();
    this.editor.currentTrack.features.push(newFeature);
    const data = this.createVisual(newFeature);
    this.editor.deselectAll();
    this.select(data);
    this.rebuildTerrain();
    this.editor.hideAddMenu();
  }

  // ── Shape conversion ─────────────────────────────────────────────────────────

  /**
   * Convert the currently-selected entity between rect / circle / polygon.
   * Switching to polygon seeds 4 points from the current width/depth/rotation;
   * switching away derives a bounding width/depth from the point list.
   */
  changeShape(newShape) {
    if (!this.selected) return;
    if (newShape !== 'rect' && newShape !== 'circle' && newShape !== 'polygon') return;
    const feature = this.selected.feature;
    if (feature.shape === newShape) return;

    this.editor.saveSnapshot();

    if (newShape === 'polygon') {
      const cx = feature.centerX ?? 0;
      const cz = feature.centerZ ?? 0;
      const hw = Math.max(2, (feature.width ?? 10) / 2);
      const hd = Math.max(2, (feature.depth ?? 10) / 2);
      const rot = (feature.rotation ?? 0) * Math.PI / 180;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
      feature.points = corners.map(([lx, lz]) => ({
        x: cx + lx * cos - lz * sin,
        z: cz + lx * sin + lz * cos,
      }));
      feature.shape = 'polygon';
      this._selectedPointIndex = -1;
      this.editor._rawDragPos = { x: cx, z: cz };
    } else {
      const pts = feature.points ?? [];
      const c = polylineCentroid(pts);
      feature.centerX = c.x;
      feature.centerZ = c.z;
      if (pts.length) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of pts) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        }
        feature.width = Math.max(1, maxX - minX);
        feature.depth = Math.max(1, maxZ - minZ);
      }
      feature.rotation = 0;
      feature.shape = newShape;
      delete feature.points;
      this._selectedPointIndex = -1;
      this.editor._rawDragPos = { x: feature.centerX, z: feature.centerZ };
    }

    this._rebuildVisual(this.selected);
    this.showProperties(this.selected);
    this.rebuildTerrain();
  }

  // ── Polygon point editing ────────────────────────────────────────────────────

  insertPoint() {
    if (!this.selected || this.selected.feature.shape !== 'polygon') return;
    const feature = this.selected.feature;
    if (!Array.isArray(feature.points) || feature.points.length < POLY_POINT_MIN) return;

    this.editor.saveSnapshot();

    const fromIdx = this._selectedPointIndex >= 0 ? this._selectedPointIndex : feature.points.length - 1;
    const toIdx = (fromIdx + 1) % feature.points.length;
    const a = feature.points[fromIdx];
    const b = feature.points[toIdx];
    const next = {
      x: this.editor._snap((a.x + b.x) * 0.5),
      z: this.editor._snap((a.z + b.z) * 0.5),
    };

    feature.points.splice(fromIdx + 1, 0, next);
    this._selectedPointIndex = fromIdx + 1;
    this.editor._rawDragPos = { x: next.x, z: next.z };

    const c = polylineCentroid(feature.points);
    feature.centerX = c.x;
    feature.centerZ = c.z;

    this._rebuildVisual(this.selected);
    this.showProperties(this.selected);
    this.rebuildTerrain();
  }

  deletePoint() {
    if (!this.selected || this.selected.feature.shape !== 'polygon') return;
    const feature = this.selected.feature;
    if (this._selectedPointIndex < 0) return;
    if (!Array.isArray(feature.points) || feature.points.length <= POLY_POINT_MIN) return;

    this.editor.saveSnapshot();
    feature.points.splice(this._selectedPointIndex, 1);
    this._selectedPointIndex = Math.min(this._selectedPointIndex, feature.points.length - 1);

    const c = polylineCentroid(feature.points);
    feature.centerX = c.x;
    feature.centerZ = c.z;

    if (this._selectedPointIndex >= 0) {
      const pt = feature.points[this._selectedPointIndex];
      this.editor._rawDragPos = { x: pt.x, z: pt.z };
    } else {
      this.editor._rawDragPos = { x: feature.centerX, z: feature.centerZ };
    }

    this._rebuildVisual(this.selected);
    this.showProperties(this.selected);
    this.rebuildTerrain();
  }

  // ── Properties panel ─────────────────────────────────────────────────────────

  showProperties(data) {
    const s = this.editor._editorStore;
    if (!s) return;
    const { feature } = data;
    const ts = s.terrainShape;
    ts.shape       = feature.shape;
    ts.terrainType = feature.terrainType?.name || 'mud';
    ts.width       = feature.width ?? 10;
    ts.depth       = feature.depth ?? 10;
    ts.rotation    = feature.rotation ?? 0;
    ts.blendWidth  = feature.blendWidth ?? 0;
    ts.roughness   = feature.roughness ?? feature.terrainType?.roughness ?? 0;
    ts.pointCount  = feature.shape === 'polygon' ? (feature.points?.length ?? 0) : 0;
    ts.selectedPointIndex = feature.shape === 'polygon' ? this._selectedPointIndex : -1;
    s.selectedType = 'terrainShape';
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'terrainShape')
      this.editor._editorStore.selectedType = null;
  }

  // ── Dispose ──────────────────────────────────────────────────────────────────

  dispose() {
    if (this._terrainGridRebuildTimer) {
      clearTimeout(this._terrainGridRebuildTimer);
      this._terrainGridRebuildTimer = null;
    }
    for (const d of this.meshes) {
      d.handle?.dispose();
      for (const p of d.pointHandles) p.dispose();
      d.lineSystem?.dispose();
    }
    this.meshes   = [];
    this.selected = null;
    this._selectedPointIndex = -1;
  }

  // ── Vue Bridge ───────────────────────────────────────────────────────────────

  rebuildTerrain() {
    const flushed = this._flushTerrainGridRebuild();
    if (!flushed) rebuild.terrainGrid?.();
    rebuild.terrain?.(this.selected?.feature);
    rebuild.terrainTexture?.(false, { wear: false, normals: false });
    rebuild.normalMap?.();
    if (this.selected) this.updateVisual(this.selected);
  }

  changeWidth(val) {
    if (!this.selected || this.selected.feature.shape === 'polygon') return;
    this.editor.saveSnapshot(true);
    this.selected.feature.width = val;
    this.rebuildTerrain();
  }

  changeDepth(val) {
    if (!this.selected || this.selected.feature.shape === 'polygon') return;
    this.editor.saveSnapshot(true);
    this.selected.feature.depth = val;
    this.rebuildTerrain();
  }

  changeRotation(val) {
    if (!this.selected || this.selected.feature.shape === 'polygon') return;
    this.editor.saveSnapshot(true);
    this.selected.feature.rotation = val;
    this.rebuildTerrain();
  }

  changeBlendWidth(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.blendWidth = Math.max(0, val);
    this.rebuildTerrain();
  }

  rotate(rotStep) {
    if (!this.selected || this.selected.feature.shape === 'polygon') return;
    const f = this.selected.feature;
    f.rotation = ((f.rotation ?? 0) + rotStep * 180 / Math.PI + 360) % 360;
    const s = this.editor._editorStore;
    if (s) s.terrainShape.rotation = f.rotation;
    this.rebuildTerrain();
  }

  changeTerrainType(name) {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const entry = Object.values(TERRAIN_TYPES).find(t => t.name === name);
    this.selected.feature.terrainType = entry || null;
    // Follow the new type's own roughness by default; the user can still
    // dial it in independently afterward via changeRoughness.
    this.selected.feature.roughness = entry?.roughness ?? 0;
    this.rebuildTerrain();
  }

  changeRoughness(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.roughness = Math.max(0, Math.min(1, val));
    this.rebuildTerrain();
  }

}
