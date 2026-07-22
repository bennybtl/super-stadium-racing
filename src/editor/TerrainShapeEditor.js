import { Vector3 } from '@babylonjs/core';
import rebuild from './editor-rebuild.js';
import { GizmoHandle } from './GizmoHandle.js';
import { TERRAIN_TYPES } from '../terrain.js';

const HANDLE_POS_Y = 2.0; // handle sphere floats this far above the terrain
/**
 * TerrainShapeEditor — handles terrain shape features (type: 'terrain').
 * Each feature carries a `shape` property ('rect' | 'circle') that controls
 * its geometry. All shapes live in a single `meshes` array.
 * A shape-dropdown in the Vue panel lets the user convert between them.
 */
export class TerrainShapeEditor {
  constructor(editor) {
    this.editor = editor;

    this.meshes   = [];   // { feature, handle }[]
    this.selected = null; // the currently-selected entry
    this._terrainGridRebuildTimer = null;

    // Cache for terrain heights
    this._terrainHeightCache = new Map();
  }

  /** Called when editor mode activates — creates the gizmo handles. */
  activate(scene, track) {
    this.createVisualsForTrack(track);
  }

  /** Dispose all gizmo meshes and reset state, keeping materials alive (used on snapshot restore). */
  clearMeshes() {
    for (const d of this.meshes) d.handle?.dispose();
    this.meshes   = [];
    this.selected = null;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // ── Visual creation ─────────────────────────────────────────────────────────

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'terrain') this.createVisual(feature);
    }
  }

  /**
   * Create the gizmo for a terrain feature. The patch itself is visible in the
   * baked terrain texture, so the editor only adds a handle sphere — there is
   * no overlay mesh outlining the shape.
   */
  createVisual(feature) {
    const { scene } = this.editor;
    const terrainH = this._getCachedTerrainHeight(feature.centerX, feature.centerZ);

    const handle = new GizmoHandle(scene, 'terrain');
    handle.setPosition(feature.centerX, terrainH + HANDLE_POS_Y, feature.centerZ);

    const data = { feature, handle };
    this.meshes.push(data);
    return data;
  }

  // ── Visual update ────────────────────────────────────────────────────────────

  updateVisual(data) {
    const { feature, handle } = data;
    const terrainH = this._getCachedTerrainHeight(feature.centerX, feature.centerZ);
    handle?.setPosition(feature.centerX, terrainH + HANDLE_POS_Y, feature.centerZ);
  }

  // ── Selection ────────────────────────────────────────────────────────────────

  /** Global gizmo-visibility toggle (EditorController.setGizmosVisible). */
  setHandlesVisible(visible) {
    for (const d of this.meshes) d.handle?.setVisible(visible);
  }

  findByMesh(mesh) {
    return this.meshes.find(d => d.handle?.mesh === mesh) || null;
  }

  select(data) {
    this.deselect();
    this.selected = data;
    this.editor._rawDragPos = { x: data.feature.centerX, z: data.feature.centerZ };
    data.handle?.setSelected(true);
    this.showProperties(data);
  }

  deselect() {
    if (!this.selected) return;
    this.selected.handle?.setSelected(false);
    this.selected = null;
    this.editor._rawDragPos = null;
    this.hideProperties();
  }

  _scheduleTerrainGridRebuild() {
    if (this._terrainGridRebuildTimer) clearTimeout(this._terrainGridRebuildTimer);
    this._terrainGridRebuildTimer = setTimeout(() => {
      this._terrainGridRebuildTimer = null;
      rebuild.terrainGrid?.();
    }, 50);
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
    if (!this.editor._rawDragPos)
      this.editor._rawDragPos = { x: feature.centerX, z: feature.centerZ };

    const nextRawX = this.editor._rawDragPos.x + movement.x;
    const nextRawZ = this.editor._rawDragPos.z + movement.z;
    const nextX = this.editor._snap(nextRawX);
    const nextZ = this.editor._snap(nextRawZ);

    if (nextX === feature.centerX && nextZ === feature.centerZ) {
      this.editor._rawDragPos.x = nextRawX;
      this.editor._rawDragPos.z = nextRawZ;
      return new Vector3(0, 0, 0);
    }

    this.editor.saveSnapshot(true);
    this.editor._rawDragPos.x = nextRawX;
    this.editor._rawDragPos.z = nextRawZ;

    const prevX = feature.centerX, prevZ = feature.centerZ;
    feature.centerX = nextX;
    feature.centerZ = nextZ;

    this.updateVisual(this.selected);
    this._scheduleTerrainGridRebuild();
    rebuild.terrainTexture?.(false, { wear: false, normals: false });
    rebuild.normalMap?.();

    return new Vector3(feature.centerX - prevX, 0, feature.centerZ - prevZ);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────────

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const data = this.selected;
    const idx  = this.editor.currentTrack.features.indexOf(data.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    data.handle?.dispose();
    const meshIdx = this.meshes.indexOf(data);
    if (meshIdx > -1) this.meshes.splice(meshIdx, 1);
    this.selected = null;
    this.editor._rawDragPos = null;
    this.hideProperties();
    rebuild.terrainGrid?.();
    rebuild.terrainTexture?.(false, { wear: false, normals: false });
    rebuild.normalMap?.();
  }

  duplicateSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const src        = this.selected.feature;
    const newFeature = { ...src, centerX: src.centerX + 3, centerZ: src.centerZ + 3 };
    this.editor.currentTrack.features.push(newFeature);
    const newData = this.createVisual(newFeature);
    this.deselect();
    this.select(newData);
    this.rebuildTerrain();
  }

  addEntity(shape = 'circle') {
    const cam       = this.editor.camera;
    const camTarget = cam.getTarget();
    const base = {
      type:        'terrain',
      shape,
      centerX:     camTarget.x,
      centerZ:     camTarget.z,
      terrainType: TERRAIN_TYPES.MUD,
    };
    const newFeature = { ...base, width: 10, depth: 10, rotation: 0 };
    newFeature.blendWidth = 0;
    this.editor.saveSnapshot();
    this.editor.currentTrack.features.push(newFeature);
    const data = this.createVisual(newFeature);
    this.editor.deselectCheckpoint?.();
    this.editor.deselectHill?.();
    this.editor.squareHillEditor.deselect();
    this.select(data);
    this.rebuildTerrain();
    this.editor.hideAddMenu();
  }

  // ── Shape conversion ─────────────────────────────────────────────────────────

  /**
   * Convert the currently-selected entity between rect ↔ circle. Only the baked
   * terrain reflects the shape now (the gizmo is a handle sphere either way), so
   * this just mutates the feature and rebuilds — no visual teardown needed.
   */
  changeShape(newShape) {
    if (!this.selected) return;
    const feature = this.selected.feature;
    if (feature.shape === newShape) return;

    this.editor.saveSnapshot();
    feature.shape = newShape; // type stays 'terrain'
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
    for (const d of this.meshes) d.handle?.dispose();
    this.meshes   = [];
    this.selected = null;
  }

  // ── Vue Bridge ───────────────────────────────────────────────────────────────

  rebuildTerrain() {
    const flushed = this._flushTerrainGridRebuild();
    if (!flushed) rebuild.terrainGrid?.();
    rebuild.terrainTexture?.(false, { wear: false, normals: false });
    rebuild.normalMap?.();
    if (this.selected) this.updateVisual(this.selected);
  }

  changeWidth(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.width = val;
    this.rebuildTerrain();
  }

  changeDepth(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.depth = val;
    this.rebuildTerrain();
  }

  changeRotation(val) {
    if (!this.selected) return;
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
    if (!this.selected) return;
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
    this.rebuildTerrain();
  }

  // Helper to get cached terrain height
  _getCachedTerrainHeight(x, z) {
    const key = `${x},${z}`;
    if (this._terrainHeightCache.has(key)) {
      return this._terrainHeightCache.get(key);
    }

    const height = this.editor.terrainQuery.heightAt(x, z);
    this._terrainHeightCache.set(key, height);
    return height;
  }
}
