import { Vector3, MeshBuilder, TransformNode } from '@babylonjs/core';
import { EditorMaterials } from './EditorMaterials.js';

/**
 * NormalMapDecalEditor — encapsulates all normal-map decal editing logic.
 */
export class NormalMapDecalEditor {
  constructor(editor) {
    this.editor = editor;

    this.meshes   = [];   // { feature, node, mesh }[]
    this.selected = null;

    this.material          = null;
    this.highlightMaterial = null;
  }

  // ── Materials ───────────────────────────────────────────────────────────────

  createMaterials() {
    const m = EditorMaterials.for(this.editor.scene);
    this.material          = m.normalMapDecal;
    this.highlightMaterial = m.normalMapDecalHighlight;
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

  // ── Visuals ─────────────────────────────────────────────────────────────────

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'normalMapDecal') this.createVisual(feature);
    }
  }

  createVisual(feature) {
    const { scene, currentTrack } = this.editor;
    const terrainH = currentTrack ? currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;
    const node = new TransformNode('normalMapDecalNode', scene);
    node.position  = new Vector3(feature.centerX, terrainH + 0.1, feature.centerZ);
    node.scaling   = new Vector3(feature.width, 0.1, feature.depth);
    node.rotation.y = -(feature.angle ?? 0) * Math.PI / 180;

    const mesh = MeshBuilder.CreateBox('normalMapDecalMesh', { size: 1 }, scene);
    mesh.parent = node;
    mesh.material  = this.material;
    mesh.isPickable = true;

    const data = { feature, node, mesh };
    this.meshes.push(data);
    return data;
  }

  updateVisual(data) {
    const { feature, node } = data;
    const terrainH = this.editor.currentTrack
      ? this.editor.currentTrack.getHeightAt(feature.centerX, feature.centerZ) : 0;
    node.position.x  = feature.centerX;
    node.position.z  = feature.centerZ;
    node.position.y  = terrainH + 0.1;
    node.scaling.x   = feature.width;
    node.scaling.z   = feature.depth;
    node.rotation.y  = -(feature.angle ?? 0) * Math.PI / 180;
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
    this.selected.mesh.material = this.material;
    this.selected = null;
    this.editor._rawDragPos = null;
    this.hideProperties();
    window.rebuildNormalMap?.();
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
    this.updateVisual(this.selected);
    return new Vector3(feature.centerX - prevX, 0, feature.centerZ - prevZ);
  }

  rotate(deltaRad) {
    if (!this.selected) return;
    const f = this.selected.feature;
    f.angle = ((f.angle ?? 0) + deltaRad * 180 / Math.PI + 360) % 360;
    this.updateVisual(this.selected);
    if (this.editor._editorStore?.selectedType === 'normalMapDecal')
      this.editor._editorStore.normalMapDecal.angle = f.angle;
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────────

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const data   = this.selected;
    const idx    = this.editor.currentTrack.features.indexOf(data.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    data.mesh.dispose();
    data.node.dispose();
    const meshIdx = this.meshes.indexOf(data);
    if (meshIdx > -1) this.meshes.splice(meshIdx, 1);
    this.selected = null;
    this.editor._rawDragPos = null;
    this.hideProperties();
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
  }

  addEntity() {
    const cam       = this.editor.camera;
    const camTarget = cam.getTarget();
    const newFeature = {
      type:      'normalMapDecal',
      centerX:   camTarget.x,
      centerZ:   camTarget.z,
      width:     10,
      depth:     10,
      angle:     0,
      normalMap: '6481-normal.jpg',
      repeatU:   1,
      repeatV:   1,
      intensity: 0.5,
    };
    this.editor.saveSnapshot();
    this.editor.currentTrack.features.push(newFeature);
    const data = this.createVisual(newFeature);
    this.editor.deselectCheckpoint?.();
    this.editor.deselectHill?.();
    this.editor.squareHillEditor.deselect();
    this.editor.terrainShapeEditor.deselect();
    this.select(data);
    this.editor.hideAddMenu();
  }

  // ── Properties panel ─────────────────────────────────────────────────────────

  showProperties(data) {
    const s = this.editor._editorStore;
    if (!s) return;
    const { feature } = data;
    s.normalMapDecal.width     = feature.width;
    s.normalMapDecal.depth     = feature.depth;
    s.normalMapDecal.angle     = feature.angle ?? 0;
    s.normalMapDecal.normalMap = feature.normalMap || '6481-normal.jpg';
    s.normalMapDecal.repeatU   = feature.repeatU ?? 1;
    s.normalMapDecal.repeatV   = feature.repeatV ?? 1;
    s.normalMapDecal.intensity = feature.intensity ?? 0.5;
    s.selectedType             = 'normalMapDecal';
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'normalMapDecal')
      this.editor._editorStore.selectedType = null;
  }

  // ── Dispose ──────────────────────────────────────────────────────────────────

  dispose() {
    for (const d of this.meshes) { d.mesh.dispose(); d.node.dispose(); }
    this.meshes   = [];
    this.selected = null;
  }

  // ── Vue Bridge ───────────────────────────────────────────────────────────────

  changeWidth(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.width = val;
    this.updateVisual(this.selected);
  }

  changeDepth(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.depth = val;
    this.updateVisual(this.selected);
  }

  changeAngle(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.angle = val;
    this.updateVisual(this.selected);
  }

  changeNormalMap(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    this.selected.feature.normalMap = val;
    window.rebuildNormalMap?.();
  }

  changeRepeatU(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.repeatU = val;
    window.rebuildNormalMap?.();
  }

  changeRepeatV(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.repeatV = val;
    window.rebuildNormalMap?.();
  }

  changeIntensity(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.intensity = val;
    window.rebuildNormalMap?.();
  }
}
