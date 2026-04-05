import { StandardMaterial, Color3, Vector3, MeshBuilder, TransformNode } from "@babylonjs/core";

export class TireStackEditor {
  constructor(editor) {
    this.editor = editor;
    this.meshes   = [];
    this.selected = null;
    this.material          = null;
    this.highlightMaterial = null;
  }

  get scene() { return this.editor.scene; }

  // ── Materials ──────────────────────────────────────────────────────────────

  createMaterials() {
    if (this.material) return;

    this.material = new StandardMaterial('tireStackMat', this.scene);
    this.material.diffuseColor  = new Color3(0.2, 0.2, 0.2);
    this.material.emissiveColor = new Color3(0.05, 0.05, 0.05);
    this.material.alpha = 0.50;
    this.material.backFaceCulling = false;

    this.highlightMaterial = new StandardMaterial('tireStackHighlightMat', this.scene);
    this.highlightMaterial.diffuseColor  = new Color3(0.4, 0.4, 0.4);
    this.highlightMaterial.emissiveColor = new Color3(0.15, 0.15, 0.15);
    this.highlightMaterial.alpha = 0.60;
    this.highlightMaterial.backFaceCulling = false;
  }

  // ── Visual creation ────────────────────────────────────────────────────────

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'tireStack') this.createVisual(feature);
    }
  }

  createVisual(feature) {
    const terrainH = this.editor.currentTrack
      ? this.editor.currentTrack.getHeightAt(feature.x, feature.z)
      : 0;
    const node = new TransformNode('tireStackNode', this.scene);
    node.position = new Vector3(feature.x, terrainH + 0.5, feature.z);

    const mesh = MeshBuilder.CreateCylinder('tireStackMesh', {
      diameter:    0.84,
      height:      1.12,
      tessellation: 12,
    }, this.scene);
    mesh.parent   = node;
    mesh.material = this.material;
    mesh.isPickable = true;

    const stackData = { feature, node, mesh };
    this.meshes.push(stackData);
    return stackData;
  }

  updateVisual(stackData) {
    const { feature, node } = stackData;
    const terrainH = this.editor.currentTrack.getHeightAt(feature.x, feature.z);
    node.position.x = feature.x;
    node.position.y = terrainH + 0.5;
    node.position.z = feature.z;
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    return this.meshes.find(d => d.mesh === mesh) ?? null;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  select(stackData) {
    this.deselect();
    this.selected = stackData;
    this.editor._rawDragPos = { x: stackData.feature.x, z: stackData.feature.z };
    stackData.mesh.material = this.highlightMaterial;
  }

  deselect() {
    if (!this.selected) return;
    this.selected.mesh.material = this.material;
    this.selected = null;
    this.editor._rawDragPos = null;
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  move(movement) {
    const e = this.editor;
    if (!this.selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    e.saveSnapshot(true);
    const { feature } = this.selected;
    if (!e._rawDragPos) e._rawDragPos = { x: feature.x, z: feature.z };
    e._rawDragPos.x += movement.x;
    e._rawDragPos.z += movement.z;
    const prevX = feature.x, prevZ = feature.z;
    feature.x = e._snap(e._rawDragPos.x);
    feature.z = e._snap(e._rawDragPos.z);
    this.updateVisual(this.selected);
    return new Vector3(feature.x - prevX, 0, feature.z - prevZ);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const stackData = this.selected;
    const idx = this.editor.currentTrack.features.indexOf(stackData.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    stackData.mesh.dispose();
    stackData.node.dispose();
    const meshIdx = this.meshes.indexOf(stackData);
    if (meshIdx > -1) this.meshes.splice(meshIdx, 1);
    this.selected = null;
  }

  duplicateSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const src = this.selected.feature;
    const newFeature = { ...src, x: src.x + 3, z: src.z + 3 };
    this.editor.currentTrack.features.push(newFeature);
    const stackData = this.createVisual(newFeature);
    this.deselect();
    this.select(stackData);
  }

  addEntity() {
    const e = this.editor;
    const camPos    = e.camera.position;
    const camTarget = e.camera.target;
    const direction = camTarget.subtract(camPos).normalize();
    const newFeature = {
      type: 'tireStack',
      x: camPos.x + direction.x * 20,
      z: camPos.z + direction.z * 50,
    };
    e.saveSnapshot();
    e.currentTrack.features.push(newFeature);
    const stackData = this.createVisual(newFeature);
    e.deselectCheckpoint();
    e.deselectHill();
    e.squareHillEditor.deselect();
    e.terrainShapeEditor.deselect();
    e.normalMapDecalEditor.deselect();
    this.select(stackData);
    e.hideAddMenu();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  dispose() {
    this.deselect();
    for (const d of this.meshes) {
      d.mesh.dispose();
      d.node.dispose();
    }
    this.meshes = [];
  }
}
