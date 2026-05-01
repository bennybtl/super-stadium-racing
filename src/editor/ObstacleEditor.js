import { Vector3, MeshBuilder, TransformNode } from "@babylonjs/core";
import { EditorMaterials } from './EditorMaterials.js';
import { Obstacle, getObstacleSpec, normalizeObstacleType } from "../objects/Obstacle.js";

export class ObstacleEditor {
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
    const m = EditorMaterials.for(this.scene);
    this.material          = m.obstacleHandle;
    this.highlightMaterial = m.obstacleHandleHighlight;
    this.tireMat           = m.obstacleTire;
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
      if (feature.type === 'tireStack' || feature.type === 'obstacle') this.createVisual(feature);
    }
  }

  _featureObstacleType(feature) {
    // Legacy tracks only have type='tireStack' and no subtype.
    if (feature.type === 'tireStack') return 'tireStack';
    return normalizeObstacleType(feature.obstacleType);
  }

  _ensureObstacleDefaults(feature) {
    const type = this._featureObstacleType(feature);
    const spec = getObstacleSpec(type);
    if (feature.type === 'obstacle') {
      // Migration: earlier editor builds defaulted obstacles to 0.1, which is too tiny.
      if (feature.scale === 0.1) feature.scale = 1;
      if (feature.scale == null) feature.scale = 1;
      if (feature.weight == null) feature.weight = spec.mass;
      if (feature.angle == null) feature.angle = 0;
    }
    return { type, spec };
  }

  _syncStoreFromFeature(feature) {
    const s = this.editor._editorStore;
    if (!s) return;
    const { type, spec } = this._ensureObstacleDefaults(feature);
    s.obstacle.type = type;
    s.obstacle.scale = feature.scale ?? 1;
    s.obstacle.rotation = ((feature.angle ?? 0) * 180) / Math.PI;
    s.obstacle.weight = feature.weight ?? spec.mass;
    s.selectedType = 'obstacle';
  }

  _hideProperties() {
    const s = this.editor._editorStore;
    if (!s) return;
    if (s.selectedType === 'obstacle' && !s.obstacle.placementActive) {
      s.selectedType = null;
    }
  }

  _rebuildNodeVisual(stackData) {
    const { feature } = stackData;
    const { type, spec } = this._ensureObstacleDefaults(feature);
    const terrainH = this.editor.terrainQuery.heightAt(feature.x, feature.z);

    stackData.node?.dispose();

    const node = new TransformNode('tireStackNode', this.scene);
    node.position = new Vector3(feature.x, terrainH, feature.z);
    node.rotation.x = spec.modelRotationX ?? 0;
    node.rotation.y = feature.angle ?? 0;
    node.scaling.setAll((spec.modelScale ?? 1) * (feature.scale ?? 1));
    stackData.node = node;
    stackData.handleYOffset = (spec.halfExtents.y * (feature.scale ?? 1)) + 1.2;

    Obstacle._getSourceMeshes(this.scene, type)
      .then(sourceMeshes => {
        for (const src of sourceMeshes) {
          const m = src.clone('obstacleEditorMesh', node);
          m.isVisible  = true;
          m.isPickable = false;
          if (type === 'tireStack') m.material = this.tireMat;
        }
      })
      .catch(err => console.warn(`[ObstacleEditor] Failed to clone obstacle '${type}':`, err));
  }

  createVisual(feature) {
    const { type, spec } = this._ensureObstacleDefaults(feature);
    const SPHERE_Y_ABOVE = (spec.halfExtents.y * (feature.scale ?? 1)) + 1.2;

    const terrainH = this.editor.terrainQuery.heightAt(feature.x, feature.z);

    // TransformNode holds the OBJ visual at ground level.
    const node = new TransformNode('tireStackNode', this.scene);
    node.position   = new Vector3(feature.x, terrainH, feature.z);
    node.rotation.x = spec.modelRotationX ?? 0;
    node.rotation.y = feature.angle ?? 0;
    node.scaling.setAll((spec.modelScale ?? 1) * (feature.scale ?? 1));

    // Clone from shared cache — no extra network request
    Obstacle._getSourceMeshes(this.scene, type)
      .then(sourceMeshes => {
        for (const src of sourceMeshes) {
          const m = src.clone('obstacleEditorMesh', node);
          m.isVisible  = true;
          m.isPickable = false;
          if (type === 'tireStack') m.material = this.tireMat;
        }
      })
      .catch(err => console.warn(`[ObstacleEditor] Failed to clone obstacle '${type}':`, err));

    // Sphere floating above — sole pickable click/drag target
    const mesh = MeshBuilder.CreateSphere('tireStackSphere', { diameter: 1.2, segments: 8 }, this.scene);
    mesh.position   = new Vector3(feature.x, terrainH + SPHERE_Y_ABOVE, feature.z);
    mesh.material   = this.material;
    mesh.isPickable = true;

    const stackData = { feature, node, mesh, handleYOffset: SPHERE_Y_ABOVE };
    this.meshes.push(stackData);
    return stackData;
  }

  updateVisual(stackData) {
    const { feature, node, mesh } = stackData;
    const terrainH = this.editor.terrainQuery.heightAt(feature.x, feature.z);
    const { type, spec } = this._ensureObstacleDefaults(feature);
    const SPHERE_Y_ABOVE = stackData.handleYOffset ?? (spec.halfExtents.y + 1.2);

    node.position.x = feature.x;
    node.position.y = terrainH;
    node.position.z = feature.z;
    node.rotation.y = feature.angle ?? 0;
    node.scaling.setAll((spec.modelScale ?? 1) * (feature.scale ?? 1));

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
    this._syncStoreFromFeature(stackData.feature);
  }

  deselect() {
    if (!this.selected) return;
    this.selected.mesh.material = this.material;
    this.selected = null;
    this.editor._rawDragPos = null;
    this._hideProperties();
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

  rotate(delta) {
    if (!this.selected || delta === 0) return;
    const { feature } = this.selected;
    if (this._featureObstacleType(feature) !== 'hayBale') return;
    this.editor.saveSnapshot(true);
    feature.angle = (feature.angle ?? 0) + delta;
    this.updateVisual(this.selected);
    if (this.editor._editorStore?.selectedType === 'obstacle') {
      this.editor._editorStore.obstacle.rotation = (feature.angle * 180) / Math.PI;
    }
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
    this._hideProperties();
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

  addEntityAt(x, z) {
    const e = this.editor;
    const selectedType = normalizeObstacleType(e._editorStore?.obstacle?.type ?? 'barrel');
    const selectedScale = e._editorStore?.obstacle?.scale ?? 1;
    const selectedWeight = e._editorStore?.obstacle?.weight ?? getObstacleSpec(selectedType).mass;
    const selectedRotationDeg = e._editorStore?.obstacle?.rotation ?? 0;
    const newFeature = {
      type: 'obstacle',
      obstacleType: selectedType,
      x: e._snap(x, 'x'),
      z: e._snap(z, 'z'),
      angle: selectedRotationDeg * Math.PI / 180,
      scale: selectedScale,
      weight: selectedWeight,
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
    return stackData;
  }

  addEntity() {
    const e = this.editor;
    const camPos    = e.camera.position;
    const camTarget = e.camera.target;
    const direction = camTarget.subtract(camPos).normalize();
    this.addEntityAt(
      camPos.x + direction.x * 20,
      camPos.z + direction.z * 50
    );
    e.hideAddMenu();
  }

  changeType(val) {
    const normalized = normalizeObstacleType(val);
    const s = this.editor._editorStore;
    if (s) s.obstacle.type = normalized;
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.type = 'obstacle';
    this.selected.feature.obstacleType = normalized;
    if (this.selected.feature.weight == null) {
      this.selected.feature.weight = getObstacleSpec(normalized).mass;
    }
    this._rebuildNodeVisual(this.selected);
    this.updateVisual(this.selected);
  }

  changeScale(val) {
    const scale = Math.max(0.05, Number(val) || 1);
    const s = this.editor._editorStore;
    if (s) s.obstacle.scale = scale;
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.scale = scale;
    this._rebuildNodeVisual(this.selected);
    this.updateVisual(this.selected);
  }

  changeRotation(degrees) {
    const angle = (Number(degrees) || 0) * Math.PI / 180;
    const s = this.editor._editorStore;
    if (s) s.obstacle.rotation = Number(degrees) || 0;
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.angle = angle;
    this.updateVisual(this.selected);
  }

  changeWeight(val) {
    const weight = Math.max(0.1, Number(val) || 1);
    const s = this.editor._editorStore;
    if (s) s.obstacle.weight = weight;
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.weight = weight;
  }

  setPlacementActive(active) {
    const s = this.editor._editorStore;
    if (!s) return;
    s.obstacle.placementActive = !!active;
    s.selectedType = 'obstacle';
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
