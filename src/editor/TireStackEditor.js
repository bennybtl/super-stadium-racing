import { StandardMaterial, Color3, Vector3, MeshBuilder, TransformNode } from "@babylonjs/core";
import { TireStack } from "../objects/TireStack.js";

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

    // Normal sphere: neutral grey
    this.material = new StandardMaterial('tireStackSphereMat', this.scene);
    this.material.diffuseColor  = new Color3(0.6, 0.6, 0.6);
    this.material.emissiveColor = new Color3(0.1, 0.1, 0.1);

    // Selected sphere: bright orange-yellow
    this.highlightMaterial = new StandardMaterial('tireStackSphereHighMat', this.scene);
    this.highlightMaterial.diffuseColor  = new Color3(1.0, 0.7, 0.1);
    this.highlightMaterial.emissiveColor = new Color3(0.5, 0.3, 0.0);

    // Rubber tires material (applied to OBJ meshes)
    this.tireMat = new StandardMaterial('tireStackTireMat', this.scene);
    this.tireMat.diffuseColor  = new Color3(0.8, 0.5, 0.1);
    this.tireMat.specularColor = new Color3(0.3, 0.2, 0.05);
    this.tireMat.specularPower = 32;
  }

  /** Called when editor mode activates — creates materials and initial visuals. */
  activate(scene, track) {
    this.createMaterials();
    this.createVisualsForTrack(track);
  }

  /** Dispose all gizmo meshes and reset state, keeping materials alive (used on snapshot restore). */
  clearMeshes() {
    for (const d of this.meshes) {
      d.node.dispose();
      d.mesh.dispose();
    }
    this.meshes = [];
    this.selected = null;
  }

  // ── Visual creation ────────────────────────────────────────────────────────

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'tireStack') this.createVisual(feature);
    }
  }

  createVisual(feature) {
    const SPHERE_Y_ABOVE = 2.2;

    const terrainH = this.editor.currentTrack
      ? this.editor.currentTrack.getHeightAt(feature.x, feature.z)
      : 0;

    // TransformNode holds the OBJ visual at ground level
    const node = new TransformNode('tireStackNode', this.scene);
    node.position   = new Vector3(feature.x, terrainH, feature.z);
    node.rotation.x = -Math.PI / 2;

    // Clone from shared cache — no extra network request
    TireStack._getSourceMeshes(this.scene)
      .then(sourceMeshes => {
        for (const src of sourceMeshes) {
          const m = src.clone('tireStackEditorMesh', node);
          m.isVisible  = true;
          m.isPickable = false;
          m.material   = this.tireMat;
        }
      })
      .catch(err => console.warn('[TireStackEditor] Failed to clone tire-stack.obj:', err));

    // Sphere floating above — sole pickable click/drag target
    const mesh = MeshBuilder.CreateSphere('tireStackSphere', { diameter: 1.2, segments: 8 }, this.scene);
    mesh.position   = new Vector3(feature.x, terrainH + SPHERE_Y_ABOVE, feature.z);
    mesh.material   = this.material;
    mesh.isPickable = true;

    const stackData = { feature, node, mesh };
    this.meshes.push(stackData);
    return stackData;
  }

  updateVisual(stackData) {
    const SPHERE_Y_ABOVE = 2.2;
    const { feature, node, mesh } = stackData;
    const terrainH = this.editor.currentTrack.getHeightAt(feature.x, feature.z);
    node.position.x = feature.x;
    node.position.y = terrainH;
    node.position.z = feature.z;
    mesh.position.x = feature.x;
    mesh.position.y = terrainH + SPHERE_Y_ABOVE;
    mesh.position.z = feature.z;
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
    if (!this.selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    const e = this.editor;
    e.saveSnapshot(true);
    const { feature } = this.selected;
    if (!e._rawDragPos) e._rawDragPos = { x: feature.x, z: feature.z };
    e._rawDragPos.x += movement.x;
    e._rawDragPos.z += movement.z;
    const prevX = feature.x;
    const prevZ = feature.z;
    const newX  = e._snap(e._rawDragPos.x);
    const newZ  = e._snap(e._rawDragPos.z);
    feature.x = newX;
    feature.z = newZ;
    this.updateVisual(this.selected);
    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const stackData = this.selected;
    const idx = this.editor.currentTrack.features.indexOf(stackData.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    stackData.node.dispose();
    stackData.mesh.dispose();
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
      d.node.dispose();
      d.mesh.dispose();
    }
    this.meshes = [];
  }
}
