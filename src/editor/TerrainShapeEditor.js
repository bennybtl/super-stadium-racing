import { StandardMaterial, Color3, Vector3, MeshBuilder, TransformNode } from '@babylonjs/core';
import { TERRAIN_TYPES } from '../terrain.js';

/**
 * TerrainShapeEditor — handles both terrainRect and terrainCircle features.
 * A single "selected" pointer covers both shape types; a shape-dropdown in the
 * Vue panel lets the user convert between them at any time.
 */
export class TerrainShapeEditor {
  constructor(editor) {
    this.editor = editor;

    this.rectMeshes   = [];   // { feature, node, mesh, mat }[]
    this.circleMeshes = [];   // { feature, node, mesh, mat }[]
    this.selected     = null; // the currently-selected entry (either array)

    this.material          = null;
    this.highlightMaterial = null;
  }

  // ── Materials ───────────────────────────────────────────────────────────────

  createMaterials() {
    const scene = this.editor.scene;

    this.material = new StandardMaterial('terrainShapeMat', scene);
    this.material.diffuseColor = new Color3(0.2, 0.5, 0.9);
    this.material.emissiveColor = new Color3(0.04, 0.1, 0.2);
    this.material.alpha = 0.25;
    this.material.backFaceCulling = false;

    this.highlightMaterial = new StandardMaterial('terrainShapeHighlightMat', scene);
    this.highlightMaterial.diffuseColor = new Color3(0.0, 0.9, 1.0);
    this.highlightMaterial.emissiveColor = new Color3(0.0, 0.3, 0.4);
    this.highlightMaterial.alpha = 0.35;
    this.highlightMaterial.backFaceCulling = false;
  }

  /** Called when editor mode activates — creates materials and initial visuals. */
  activate(scene, track) {
    this.createMaterials();
    this.createVisualsForTrack(track);
  }

  /** Dispose all gizmo meshes and reset state, keeping materials alive (used on snapshot restore). */
  clearMeshes() {
    for (const d of this.rectMeshes)   { d.mesh.dispose(); d.node.dispose(); }
    for (const d of this.circleMeshes) { d.mesh.dispose(); d.node.dispose(); }
    this.rectMeshes   = [];
    this.circleMeshes = [];
    this.selected     = null;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _terrainColorForType(terrainType) {
    if (!terrainType) return new Color3(0.5, 0.5, 0.5);
    const c = terrainType.color;
    return c instanceof Color3 ? c : new Color3(c.r, c.g, c.b);
  }

  // ── Visual creation ─────────────────────────────────────────────────────────

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'terrainRect')   this.createRectVisual(feature);
      else if (feature.type === 'terrainCircle') this.createCircleVisual(feature);
    }
  }

  /** Dispatch to createRectVisual / createCircleVisual by feature.type */
  createVisual(feature) {
    if (feature.type === 'terrainRect')   return this.createRectVisual(feature);
    if (feature.type === 'terrainCircle') return this.createCircleVisual(feature);
  }

  createRectVisual(feature) {
    const { scene, currentTrack } = this.editor;
    const terrainH = currentTrack ? currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;
    const node = new TransformNode('terrainRectNode', scene);
    node.position = new Vector3(feature.centerX, terrainH + 0.05, feature.centerZ);
    node.scaling  = new Vector3(feature.width, 0.1, feature.depth);

    const mesh = MeshBuilder.CreateBox('terrainRectMesh', { size: 1 }, scene);
    mesh.parent = node;
    const mat = this.material.clone('trMat_' + Date.now());
    const col = this._terrainColorForType(feature.terrainType);
    mat.diffuseColor  = col;
    mat.emissiveColor = col.scale(0.3);
    mesh.material  = mat;
    mesh.isPickable = true;

    const data = { feature, node, mesh, mat };
    this.rectMeshes.push(data);
    return data;
  }

  createCircleVisual(feature) {
    const { scene, currentTrack } = this.editor;
    const terrainH = currentTrack ? currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;
    const node = new TransformNode('terrainCircleNode', scene);
    node.position = new Vector3(feature.centerX, terrainH + 0.05, feature.centerZ);

    const mesh = MeshBuilder.CreateDisc('terrainCircleMesh',
      { radius: feature.radius, tessellation: 48 }, scene);
    mesh.rotation.x = Math.PI / 2; // lay flat
    mesh.parent = node;
    const mat = this.material.clone('tcMat_' + Date.now());
    const col = this._terrainColorForType(feature.terrainType);
    mat.diffuseColor  = col;
    mat.emissiveColor = col.scale(0.3);
    mesh.material  = mat;
    mesh.isPickable = true;

    const data = { feature, node, mesh, mat };
    this.circleMeshes.push(data);
    return data;
  }

  // ── Visual update ────────────────────────────────────────────────────────────

  updateRectVisual(data) {
    const { feature, node, mat } = data;
    const terrainH = this.editor.currentTrack
      ? this.editor.currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;
    node.position.x = feature.centerX;
    node.position.z = feature.centerZ;
    node.position.y = terrainH + 0.05;
    node.scaling.x  = feature.width;
    node.scaling.z  = feature.depth;
    const col = this._terrainColorForType(feature.terrainType);
    mat.diffuseColor  = col;
    mat.emissiveColor = col.scale(0.3);
  }

  updateCircleVisual(data) {
    const { feature, node, mesh, mat } = data;
    const terrainH = this.editor.currentTrack
      ? this.editor.currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;
    node.position.x = feature.centerX;
    node.position.z = feature.centerZ;
    node.position.y = terrainH + 0.05;
    // Recreate disc mesh with updated radius
    mesh.dispose();
    const newMesh = MeshBuilder.CreateDisc('terrainCircleMesh',
      { radius: feature.radius, tessellation: 48 }, this.editor.scene);
    newMesh.rotation.x = Math.PI / 2;
    newMesh.parent = node;
    newMesh.material = mat;
    newMesh.isPickable = true;
    data.mesh = newMesh;
    const col = this._terrainColorForType(feature.terrainType);
    mat.diffuseColor  = col;
    mat.emissiveColor = col.scale(0.3);
  }

  // ── Selection ────────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    return this.rectMeshes.find(d => d.mesh === mesh)
        || this.circleMeshes.find(d => d.mesh === mesh)
        || null;
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
    const arr  = data.feature.type === 'terrainRect' ? this.rectMeshes : this.circleMeshes;
    const idx  = this.editor.currentTrack.features.indexOf(data.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    data.mesh.dispose();
    data.node.dispose();
    const meshIdx = arr.indexOf(data);
    if (meshIdx > -1) arr.splice(meshIdx, 1);
    this.selected = null;
    this.editor._rawDragPos = null;
    this.hideProperties();
    this.rebuildTerrain();
  }

  duplicateSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const src        = this.selected.feature;
    const newFeature = { ...src, centerX: src.centerX + 3, centerZ: src.centerZ + 3 };
    this.editor.currentTrack.features.push(newFeature);
    const newData = src.type === 'terrainRect'
      ? this.createRectVisual(newFeature)
      : this.createCircleVisual(newFeature);
    this.deselect();
    this.select(newData);
    this.rebuildTerrain();
  }

  addRectEntity() {
    const cam       = this.editor.camera;
    const direction = cam.getTarget().subtract(cam.position).normalize();
    const newFeature = {
      type:        'terrainRect',
      centerX:     cam.position.x + direction.x * 20,
      centerZ:     cam.position.z + direction.z * 50,
      width:       10,
      depth:       10,
      terrainType: TERRAIN_TYPES.MUD,
    };
    this.editor.saveSnapshot();
    this.editor.currentTrack.features.push(newFeature);
    const data = this.createRectVisual(newFeature);
    this.editor.deselectCheckpoint?.();
    this.editor.deselectHill?.();
    this.editor.squareHillEditor.deselect();
    this.select(data);
    this.rebuildTerrain();
    this.editor.hideAddMenu();
  }

  addCircleEntity() {
    const cam       = this.editor.camera;
    const direction = cam.getTarget().subtract(cam.position).normalize();
    const newFeature = {
      type:        'terrainCircle',
      centerX:     cam.position.x + direction.x * 20,
      centerZ:     cam.position.z + direction.z * 50,
      radius:      8,
      terrainType: TERRAIN_TYPES.MUD,
    };
    this.editor.saveSnapshot();
    this.editor.currentTrack.features.push(newFeature);
    const data = this.createCircleVisual(newFeature);
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
    if ((newShape === 'rect'   && feature.type === 'terrainRect') ||
        (newShape === 'circle' && feature.type === 'terrainCircle')) return;

    this.editor.saveSnapshot();

    // Remove old visual from the correct array without going through deselect()
    // (that would hide the properties panel prematurely).
    const oldArr = feature.type === 'terrainRect' ? this.rectMeshes : this.circleMeshes;
    const oldIdx = oldArr.indexOf(this.selected);
    if (oldIdx > -1) oldArr.splice(oldIdx, 1);
    this.selected.mesh.dispose();
    this.selected.node.dispose();
    this.selected = null;
    this.editor._rawDragPos = null;

    // Mutate feature in-place
    if (newShape === 'rect') {
      const size     = (feature.radius ?? 8) * 2;
      feature.type   = 'terrainRect';
      feature.width  = size;
      feature.depth  = size;
      delete feature.radius;
    } else {
      feature.type   = 'terrainCircle';
      feature.radius = Math.max(feature.width ?? 10, feature.depth ?? 10) / 2;
      delete feature.width;
      delete feature.depth;
    }

    // Recreate visual and re-select (updates properties panel automatically)
    const newData = newShape === 'rect'
      ? this.createRectVisual(feature)
      : this.createCircleVisual(feature);
    this.select(newData);
    this.rebuildTerrain();
  }

  // ── Properties panel ─────────────────────────────────────────────────────────

  showProperties(data) {
    const s = this.editor._editorStore;
    if (!s) return;
    const { feature } = data;
    const ts = s.terrainShape;
    ts.shape       = feature.type === 'terrainRect' ? 'rect' : 'circle';
    ts.terrainType = feature.terrainType?.name || 'mud';
    if (feature.type === 'terrainRect') {
      ts.width = feature.width;
      ts.depth = feature.depth;
    } else {
      ts.radius = feature.radius;
    }
    s.selectedType = 'terrainShape';
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'terrainShape')
      this.editor._editorStore.selectedType = null;
  }

  // ── Dispose ──────────────────────────────────────────────────────────────────

  dispose() {
    for (const d of this.rectMeshes)   { d.mesh.dispose(); d.node.dispose(); }
    for (const d of this.circleMeshes) { d.mesh.dispose(); d.node.dispose(); }
    this.rectMeshes   = [];
    this.circleMeshes = [];
    this.selected     = null;
  }

  // ── Vue Bridge ───────────────────────────────────────────────────────────────

  rebuildTerrain() {
    window.rebuildTerrainGrid?.();
    window.rebuildTerrainTexture?.();
    if (this.selected.feature.type === 'terrainRect') {
      this.updateRectVisual(this.selected);
    } else if (this.selected.feature.type === 'terrainCircle') {
      this.updateCircleVisual(this.selected);
    }
  }

  changeWidth(val) {
    if (!this.selected || this.selected.feature.type !== 'terrainRect') return;
    this.editor.saveSnapshot(true);
    this.selected.feature.width = val;
    this.rebuildTerrain();
  }

  changeDepth(val) {
    if (!this.selected || this.selected.feature.type !== 'terrainRect') return;
    this.editor.saveSnapshot(true);
    this.selected.feature.depth = val;
    this.rebuildTerrain();
  }

  changeRadius(val) {
    if (!this.selected || this.selected.feature.type !== 'terrainCircle') return;
    this.editor.saveSnapshot(true);
    this.selected.feature.radius = val;
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
