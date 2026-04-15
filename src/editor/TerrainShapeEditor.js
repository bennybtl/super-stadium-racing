import { Vector3, MeshBuilder, TransformNode } from '@babylonjs/core';
import { EditorMaterials, FALLBACK_GREY, Color3 } from './EditorMaterials.js';
import { TERRAIN_TYPES } from '../terrain.js';

const NODE_POS_Y = 0.15; // height above terrain to place the node (prevents z-fighting)
/**
 * TerrainShapeEditor — handles terrain shape features (type: 'terrain').
 * Each feature carries a `shape` property ('rect' | 'circle') that controls
 * its geometry. All shapes live in a single `meshes` array.
 * A shape-dropdown in the Vue panel lets the user convert between them.
 */
export class TerrainShapeEditor {
  constructor(editor) {
    this.editor = editor;

    this.meshes   = [];   // { feature, node, mesh, mat }[]
    this.selected = null; // the currently-selected entry

    this.material          = null;
    this.highlightMaterial = null;
  }

  // ── Materials ───────────────────────────────────────────────────────────────

  createMaterials() {
    const m = EditorMaterials.for(this.editor.scene);
    this.material          = m.terrainShape;
    this.highlightMaterial = m.terrainShapeHighlight;
  }

  /** Called when editor mode activates — creates materials and initial visuals. */
  activate(scene, track) {
    this.createMaterials();
    this.createVisualsForTrack(track);
  }

  /** Dispose all gizmo meshes and reset state, keeping materials alive (used on snapshot restore). */
  clearMeshes() {
    for (const d of this.meshes) { d.mesh.dispose(); d.node.dispose(); }
    this.meshes   = [];
    this.selected = null;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _terrainColorForType(terrainType) {
    if (!terrainType) return FALLBACK_GREY;
    const c = terrainType.color;
    return (c && typeof c.r === 'number') ? new Color3(c.r, c.g, c.b) : FALLBACK_GREY;
  }

  // ── Visual creation ─────────────────────────────────────────────────────────

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'terrain') this.createVisual(feature);
    }
  }

  /** Create a gizmo mesh for a terrain feature (dispatches on feature.shape). */
  createVisual(feature) {
    const { scene, currentTrack } = this.editor;
    const terrainH = this.editor.terrainQuery.heightAt(feature.centerX, feature.centerZ);

    const node = new TransformNode('terrainShapeNode', scene);
    node.position = new Vector3(feature.centerX, terrainH + NODE_POS_Y, feature.centerZ);

    let mesh;
    if (feature.shape === 'rect') {
      mesh = MeshBuilder.CreateBox('terrainShapeMesh', { size: 1 }, scene);
    } else {
      mesh = MeshBuilder.CreateDisc('terrainShapeMesh',
        { radius: 0.5, tessellation: 48 }, scene);
      mesh.rotation.x = Math.PI / 2;
    }
    
    node.scaling = new Vector3(feature.width, feature.shape === 'rect' ? 0.1 : 1, feature.depth);
    node.rotation.y = -(feature.rotation ?? 0) * Math.PI / 180;
    
    mesh.parent = node;

    const mat = this.material.clone('tsMat_' + Date.now());
    const col = this._terrainColorForType(feature.terrainType);
    mat.diffuseColor  = col;
    mat.emissiveColor = col.scale(0.3);
    mesh.material  = mat;
    mesh.isPickable = true;

    const data = { feature, node, mesh, mat };
    this.meshes.push(data);
    return data;
  }

  // ── Visual update ────────────────────────────────────────────────────────────

  updateVisual(data) {
    const { feature, node, mat } = data;
    const terrainH = this.editor.terrainQuery.heightAt(feature.centerX, feature.centerZ);

    node.position.x = feature.centerX;
    node.position.z = feature.centerZ;
    node.position.y = terrainH + NODE_POS_Y;

    node.scaling.x  = feature.width;
    node.scaling.y  = feature.shape === 'rect' ? 0.1 : 1;
    node.scaling.z  = feature.depth;
    node.rotation.y = -(feature.rotation ?? 0) * Math.PI / 180;

    const col = this._terrainColorForType(feature.terrainType);
    mat.diffuseColor  = col;
    mat.emissiveColor = col.scale(0.3);
  }

  // ── Selection ────────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    return this.meshes.find(d => d.mesh === mesh) || null;
  }

  select(data) {
    this.deselect();
    this.selected = data;
    this.editor._rawDragPos = { x: data.feature.centerX, z: data.feature.centerZ };
    data.mesh.material = this.highlightMaterial;
    this.showProperties(data);
  }

  deselect() {
    if (!this.selected) return;
    this.selected.mesh.material = this.selected.mat;
    this.selected = null;
    this.editor._rawDragPos = null;
    this.hideProperties();
  }

  // ── Movement ─────────────────────────────────────────────────────────────────

  move(movement) {
    if (!this.selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    this.editor.saveSnapshot(true);
    const { feature } = this.selected;
    if (!this.editor._rawDragPos)
      this.editor._rawDragPos = { x: feature.centerX, z: feature.centerZ };
    this.editor._rawDragPos.x += movement.x;
    this.editor._rawDragPos.z += movement.z;
    const prevX = feature.centerX, prevZ = feature.centerZ;
    feature.centerX = this.editor._snap(this.editor._rawDragPos.x);
    feature.centerZ = this.editor._snap(this.editor._rawDragPos.z);
    this.rebuildTerrain();
    return new Vector3(feature.centerX - prevX, 0, feature.centerZ - prevZ);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────────

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const data = this.selected;
    const idx  = this.editor.currentTrack.features.indexOf(data.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    data.mesh.dispose();
    data.node.dispose();
    const meshIdx = this.meshes.indexOf(data);
    if (meshIdx > -1) this.meshes.splice(meshIdx, 1);
    this.selected = null;
    this.editor._rawDragPos = null;
    this.hideProperties();
    window.rebuildTerrainGrid?.();
    window.rebuildTerrainTexture?.();
    window.rebuildNormalMap?.();
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
    const direction = cam.getTarget().subtract(cam.position).normalize();
    const base = {
      type:        'terrain',
      shape,
      centerX:     cam.position.x + direction.x * 20,
      centerZ:     cam.position.z + direction.z * 50,
      terrainType: TERRAIN_TYPES.MUD,
    };
    const newFeature = { ...base, width: 10, depth: 10, rotation: 0 };
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
   * Convert the currently-selected entity between rect ↔ circle.
   * The feature data is mutated in-place; the old mesh is disposed and a new
   * one created so the visual matches the new shape immediately.
   */
  changeShape(newShape) {
    if (!this.selected) return;
    const feature = this.selected.feature;
    if (feature.shape === newShape) return;

    this.editor.saveSnapshot();

    // Remove old visual without going through deselect() (that would hide the panel).
    const idx = this.meshes.indexOf(this.selected);
    if (idx > -1) this.meshes.splice(idx, 1);
    this.selected.mesh.dispose();
    this.selected.node.dispose();
    this.selected = null;
    this.editor._rawDragPos = null;

    // Mutate shape in-place (type stays 'terrain')
    feature.shape = newShape;

    // Recreate visual and re-select (updates properties panel automatically)
    const newData = this.createVisual(feature);
    this.select(newData);
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
    s.selectedType = 'terrainShape';
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'terrainShape')
      this.editor._editorStore.selectedType = null;
  }

  // ── Dispose ──────────────────────────────────────────────────────────────────

  dispose() {
    for (const d of this.meshes) { d.mesh.dispose(); d.node.dispose(); }
    this.meshes   = [];
    this.selected = null;
  }

  // ── Vue Bridge ───────────────────────────────────────────────────────────────

  rebuildTerrain() {
    window.rebuildTerrainGrid?.();
    window.rebuildTerrainTexture?.();
    window.rebuildNormalMap?.();
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
}
