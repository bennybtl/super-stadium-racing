import { Vector3, MeshBuilder, TransformNode } from "@babylonjs/core";
import { EditorMaterials } from './EditorMaterials.js';
import { TERRAIN_TYPES } from "../terrain.js";

/**
 * HillEditor – encapsulates all round-hill editing logic that was previously
 * inline in EditorController.  The parent controller is passed as `editor` so
 * we can access shared helpers (scene, camera, track, snap, snapshots, store…).
 */
export class HillEditor {
  constructor(editor) {
    /** @type {import('./EditorController.js').EditorController} */
    this.editor = editor;

    // Gizmo bookkeeping
    this.meshes = [];          // { feature, node, mesh, sphere }
    this.selected = null;
    this._terrainDirty = false;

    // Materials (created lazily in createMaterials)
    this.material = null;
    this.highlightMaterial = null;
    this.sphereMaterial = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Create (or recreate) shared materials for the current scene. */
  createMaterials() {
    const m = EditorMaterials.for(this.editor.scene);
    this.material          = m.hillCone;
    this.highlightMaterial = m.hillConeHighlight;
    this.sphereMaterial    = m.handleSphere;
  }
  /** Called when editor mode activates — creates materials and initial visuals. */
  activate(scene, track) {
    this.createMaterials();
    this.createVisualsForTrack(track);
  }

  /** Dispose all gizmo meshes and reset state, keeping materials alive (used on snapshot restore). */
  clearMeshes() {
    for (const d of this.meshes) {
      d.mesh.dispose();
      d.node.dispose();
      d.sphere?.dispose();
    }
    this.meshes = [];
    this.selected = null;
  }
  /** Build gizmos for every existing hill feature in the track. */
  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'hill') {
        this.createVisual(feature);
      }
    }
  }

  /** Dispose all gizmo meshes and reset state. */
  dispose() {
    for (const d of this.meshes) {
      d.mesh.dispose();
      d.node.dispose();
      d.sphere?.dispose();
    }
    this.meshes = [];
    this.selected = null;
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  _radiusX(feature) {
    return feature.radiusX ?? 10;
  }

  _radiusZ(feature) {
    return feature.radiusZ ?? 10;
  }

  _angleDeg(feature) {
    return feature.angle ?? 0;
  }

  /** Place a new hill in front of the camera and select it. */
  addEntity() {
    const { camera } = this.editor;
    const camTarget = camera.getTarget();
    const newX = camTarget.x;
    const newZ = camTarget.z;

    const newFeature = {
      type: 'hill',
      centerX: newX,
      centerZ: newZ,
      radiusX: 10,
      radiusZ: 10,
      angle: 0,
      height: 5,
      waterLevelOffset: 2,
      terrainType: null,
    };

    this.editor.saveSnapshot();
    this.editor.currentTrack.features.push(newFeature);
    const hillData = this.createVisual(newFeature);

    this.editor.deselectCheckpoint();
    this.select(hillData);

    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();

    this.editor.hideAddMenu();
    console.log('[HillEditor] Added hill at', newX.toFixed(1), newZ.toFixed(1));
  }

  /** Build a cone-shaped editor gizmo for a hill feature. */
  createVisual(feature) {
    const scene = this.editor.scene;
    const track = this.editor.currentTrack;
    const radiusX = this._radiusX(feature);
    const radiusZ = this._radiusZ(feature);
    const angleRad = -(this._angleDeg(feature) * Math.PI / 180);
    const absH = Math.max(0.5, Math.abs(feature.height));
    const terrainH = track ? track.getHeightAt(feature.centerX, feature.centerZ) : 0;

    const node = new TransformNode('hillNode', scene);
    node.position = new Vector3(feature.centerX, terrainH + absH / 2, feature.centerZ);
    node.scaling = new Vector3(radiusX, absH, radiusZ);
    node.rotation.y = angleRad;

    const mesh = MeshBuilder.CreateCylinder('hillMesh', {
      height: 1,
      diameterTop: 0,
      diameterBottom: 2,
      tessellation: 24,
    }, scene);
    mesh.parent = node;
    mesh.material = this.highlightMaterial;
    mesh.isPickable = false;
    mesh.isVisible = false;  // hidden until selected

    // Brown sphere: the always-visible click target
    const sphere = MeshBuilder.CreateSphere('hillSphere', { diameter: 1.5, segments: 8 }, scene);
    sphere.position = new Vector3(feature.centerX, terrainH, feature.centerZ);
    sphere.material = this.sphereMaterial;
    sphere.isPickable = true;

    const hillData = { feature, node, mesh, sphere };
    this.meshes.push(hillData);
    return hillData;
  }

  /** Sync the cone gizmo transform to the feature's current values. */
  updateVisual(hillData) {
    const { feature, node, sphere } = hillData;
    const track = this.editor.currentTrack;
    const radiusX = this._radiusX(feature);
    const radiusZ = this._radiusZ(feature);
    const angleRad = -(this._angleDeg(feature) * Math.PI / 180);
    const absH = Math.max(0.5, Math.abs(feature.height));
    const terrainH = this.editor.terrainQuery.heightAt(feature.centerX, feature.centerZ);
    node.position.x = feature.centerX;
    node.position.z = feature.centerZ;
    node.position.y = terrainH + absH / 2;
    node.scaling.x = radiusX;
    node.scaling.y = absH;
    node.scaling.z = radiusZ;
    node.rotation.y = angleRad;
    if (sphere) {
      sphere.position.x = feature.centerX;
      sphere.position.y = terrainH;
      sphere.position.z = feature.centerZ;
    }
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  select(hillData) {
    this.deselect();
    this.selected = hillData;
    this.editor._rawDragPos = { x: hillData.feature.centerX, z: hillData.feature.centerZ };
    hillData.sphere.isVisible = false;
    hillData.sphere.isPickable = false;
    hillData.mesh.isVisible = this.editor.gizmosVisible;
    hillData.mesh.isPickable = true;
    this.showProperties(hillData);
    console.log('[HillEditor] Selected hill at',
      hillData.feature.centerX.toFixed(1), hillData.feature.centerZ.toFixed(1));
  }

  deselect() {
    if (this.selected) {
      this.selected.mesh.isVisible = false;
      this.selected.mesh.isPickable = false;
      this.selected.sphere.isVisible = true;
      this.selected.sphere.isPickable = true;
      this.hideProperties();
      if (this._terrainDirty) {
        window.rebuildTerrainTexture?.();
        this._terrainDirty = false;
      }
      console.log('[HillEditor] Deselected hill');
      this.selected = null;
      this.editor._rawDragPos = null;
    }
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  move(movement) {
    if (!this.selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    this.editor.saveSnapshot(true);
    const { feature } = this.selected;
    if (!this.editor._rawDragPos) this.editor._rawDragPos = { x: feature.centerX, z: feature.centerZ };
    this.editor._rawDragPos.x += movement.x;
    this.editor._rawDragPos.z += movement.z;
    const prevX = feature.centerX, prevZ = feature.centerZ;
    feature.centerX = this.editor._snap(this.editor._rawDragPos.x);
    feature.centerZ = this.editor._snap(this.editor._rawDragPos.z);
    this.rebuildTerrain();
    return new Vector3(feature.centerX - prevX, 0, feature.centerZ - prevZ);
  }

  // ── Delete / Duplicate ────────────────────────────────────────────────────

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();

    const hillData = this.selected;

    const idx = this.editor.currentTrack.features.indexOf(hillData.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);

    hillData.mesh.dispose();
    hillData.node.dispose();
    hillData.sphere?.dispose();

    const meshIdx = this.meshes.indexOf(hillData);
    if (meshIdx > -1) this.meshes.splice(meshIdx, 1);

    this.hideProperties();
    this.selected = null;

    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
    window.rebuildTerrainTexture?.();
    console.log('[HillEditor] Deleted hill');
  }

  duplicateSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const src = this.selected.feature;
    const newFeature = { ...src, centerX: src.centerX + 3, centerZ: src.centerZ + 3 };
    this.editor.currentTrack.features.push(newFeature);
    const hillData = this.createVisual(newFeature);
    this.deselect();
    this.select(hillData);
    this.rebuildTerrain();
  }

  // ── Properties (Vue store bridge) ─────────────────────────────────────────

  showProperties(hillData) {
    const s = this.editor._editorStore;
    if (!s) return;
    const { feature } = hillData;
    s.hill.radiusX = this._radiusX(feature);
    s.hill.radiusZ = this._radiusZ(feature);
    s.hill.rotation = this._angleDeg(feature);
    s.hill.height = feature.height;
    s.hill.waterLevelOffset = feature.waterLevelOffset ?? 2;
    s.hill.terrainType = feature.terrainType?.name || 'none';
    s.selectedType = 'hill';
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'hill')
      this.editor._editorStore.selectedType = null;
  }

  rebuildTerrain() {
    this._terrainDirty = true;
    if (this.selected) this.updateVisual(this.selected);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
    window.rebuildHillWater?.();
  }

  _maxWaterOffsetForFeature(feature) {
    return Math.max(0, -(feature.height ?? 0));
  }

  _clampSelectedWaterOffsetToDepth() {
    if (!this.selected) return;
    const f = this.selected.feature;
    const max = this._maxWaterOffsetForFeature(f);
    const current = typeof f.waterLevelOffset === 'number' ? f.waterLevelOffset : 2;
    const clamped = Math.min(current, max);
    f.waterLevelOffset = clamped;
    if (this.editor._editorStore) this.editor._editorStore.hill.waterLevelOffset = clamped;
  }

  // ── Vue Bridge — called by Pinia store actions ────────────────────────────

  changeRadius(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.radiusX = val;
    this.selected.feature.radiusZ = val;
    this.rebuildTerrain();
  }

  changeRadiusX(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.radiusX = val;
    this.rebuildTerrain();
  }

  changeRadiusZ(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.radiusZ = val;
    this.rebuildTerrain();
  }

  changeAngle(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.angle = val;
    this.rebuildTerrain();
  }

  rotate(rotStep) {
    if (!this.selected) return;
    const f = this.selected.feature;
    f.angle = ((f.angle ?? 0) + rotStep * 180 / Math.PI + 360) % 360;
    const s = this.editor._editorStore;
    if (s) s.hill.rotation = f.angle;
    this.rebuildTerrain();
  }

  changeHeight(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.height = val;
    this._clampSelectedWaterOffsetToDepth();
    this.rebuildTerrain();
  }

  changeWaterLevelOffset(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    const max = this._maxWaterOffsetForFeature(this.selected.feature);
    const clamped = Math.min(val, max);
    this.selected.feature.waterLevelOffset = clamped;
    if (this.editor._editorStore) this.editor._editorStore.hill.waterLevelOffset = clamped;
    this.rebuildTerrain();
  }

  changeTerrainType(name) {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    this.selected.feature.terrainType = name === 'none' ? null
      : (Object.values(TERRAIN_TYPES).find(t => t.name === name) || null);
    this.rebuildTerrain();
  }

  // ── Click test ────────────────────────────────────────────────────────────

  /** Returns the hillData if `mesh` belongs to a hill gizmo, otherwise null. */
  findByMesh(mesh) {
    for (const hillData of this.meshes) {
      if (mesh === hillData.mesh || mesh === hillData.sphere) return hillData;
    }
    return null;
  }
}
