import { Vector3, MeshBuilder, TransformNode } from "@babylonjs/core";
import { EditorMaterials } from './EditorMaterials.js';

/**
 * BridgeEditor – manages bridge feature gizmos in the editor.
 *
 * A bridge is a solid elevated platform (flat box) that vehicles can drive
 * over or pass beneath.  It does NOT deform the terrain — ramps must be built
 * separately using squareHill features.
 *
 * Feature data shape:
 *   { type:'bridge', centerX, centerZ, width, depth, height, thickness, angle }
 */
export class BridgeEditor {
  constructor(editor) {
    /** @type {import('./EditorController.js').EditorController} */
    this.editor = editor;

    this.meshes   = [];    // { feature, node, mesh, sphere }
    this.selected = null;

    this.material          = null;
    this.highlightMaterial = null;
    this.sphereMaterial    = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  createMaterials() {
    const m = EditorMaterials.for(this.editor.scene);
    this.material          = m.bridgeBox;
    this.highlightMaterial = m.bridgeBoxHighlight;
    this.sphereMaterial    = m.handleSphere;
  }

  activate(scene, track) {
    this.createMaterials();
    this.createVisualsForTrack(track);
  }

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'bridge') this.createVisual(feature);
    }
  }

  clearMeshes() {
    for (const d of this.meshes) {
      d.mesh.dispose();
      d.node.dispose();
      d.sphere?.dispose();
    }
    this.meshes   = [];
    this.selected = null;
  }

  dispose() {
    this.clearMeshes();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /** Build a box gizmo at the correct elevated position for a bridge feature. */
  createVisual(feature) {
    const scene    = this.editor.scene;
    const track    = this.editor.currentTrack;
    const terrainY = this.editor.terrainQuery.heightAt(feature.centerX, feature.centerZ);
    const thickness = feature.thickness ?? 0.4;
    const deckY    = terrainY + (feature.height ?? 5) + thickness / 2;

    // Box node positioned at the actual deck height
    const node = new TransformNode('bridgeNode', scene);
    node.position = new Vector3(feature.centerX, deckY, feature.centerZ);
    node.scaling  = new Vector3(feature.width ?? 20, thickness, feature.depth ?? 8);
    node.rotation.y = -(feature.angle ?? 0) * Math.PI / 180;

    const mesh = MeshBuilder.CreateBox('bridgeMesh', { size: 1 }, scene);
    mesh.parent   = node;
    mesh.material = this.material;
    mesh.isPickable = false;

    // Sphere at terrain level — the always-visible click target
    const sphere = MeshBuilder.CreateSphere('bridgeSphere', { diameter: 1.5, segments: 8 }, scene);
    sphere.position = new Vector3(feature.centerX, terrainY, feature.centerZ);
    sphere.material = this.sphereMaterial;
    sphere.isPickable = true;

    const bridgeData = { feature, node, mesh, sphere };
    this.meshes.push(bridgeData);
    return bridgeData;
  }

  /** Sync the box gizmo transform to the feature's current values. */
  updateVisual(bridgeData) {
    const { feature, node, sphere } = bridgeData;
    const track    = this.editor.currentTrack;
    const terrainY = this.editor.terrainQuery.heightAt(feature.centerX, feature.centerZ);
    const thickness = feature.thickness ?? 0.4;
    const deckY    = terrainY + (feature.height ?? 5) + thickness / 2;

    node.position.x = feature.centerX;
    node.position.y = deckY;
    node.position.z = feature.centerZ;
    node.scaling.x  = feature.width ?? 20;
    node.scaling.y  = thickness;
    node.scaling.z  = feature.depth ?? 8;
    node.rotation.y = -(feature.angle ?? 0) * Math.PI / 180;

    if (sphere) {
      sphere.position.x = feature.centerX;
      sphere.position.y = terrainY;
      sphere.position.z = feature.centerZ;
    }
  }

  addEntity() {
    const { camera } = this.editor;
    const camPos    = camera.position;
    const camTarget = camera.target;
    const direction = camTarget.subtract(camPos).normalize();

    const newX = camPos.x + direction.x * 20;
    const newZ = camPos.z + direction.z * 50;

    const newFeature = {
      type:      'bridge',
      centerX:   newX,
      centerZ:   newZ,
      width:     20,
      depth:     8,
      height:    5,
      thickness: 0.4,
      angle:     0,
    };

    this.editor.saveSnapshot();
    this.editor.currentTrack.features.push(newFeature);
    const bridgeData = this.createVisual(newFeature);

    this.editor.deselectAll();
    this.select(bridgeData);
    this.editor.hideAddMenu();
    console.log('[BridgeEditor] Added bridge at', newX.toFixed(1), newZ.toFixed(1));
  }

  // ── Click test ────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    for (const d of this.meshes) {
      if (mesh === d.sphere || mesh === d.mesh) return d;
    }
    return null;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  select(bridgeData) {
    if (this.selected) this.deselect();
    this.selected = bridgeData;
    bridgeData.mesh.material = this.highlightMaterial;
    this.showProperties(bridgeData);
    console.log('[BridgeEditor] Selected bridge at',
      bridgeData.feature.centerX.toFixed(1), bridgeData.feature.centerZ.toFixed(1));
  }

  deselect() {
    if (!this.selected) return;
    this.selected.mesh.material = this.material;
    this.hideProperties();
    this.selected = null;
    console.log('[BridgeEditor] Deselected bridge');
  }

  // ── Movement / rotation ───────────────────────────────────────────────────

  move(movement) {
    if (!this.selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    this.editor.saveSnapshot(true);
    const { feature } = this.selected;
    if (!this.editor._rawDragPos) this.editor._rawDragPos = { x: feature.centerX, z: feature.centerZ };
    this.editor._rawDragPos.x += movement.x;
    this.editor._rawDragPos.z += movement.z;
    const prevX = feature.centerX, prevZ = feature.centerZ;
    feature.centerX = this.editor._snap(this.editor._rawDragPos.x, 'x');
    feature.centerZ = this.editor._snap(this.editor._rawDragPos.z, 'z');
    this.updateVisual(this.selected);
    return new Vector3(feature.centerX - prevX, 0, feature.centerZ - prevZ);
  }

  rotate(rotStep) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    const f = this.selected.feature;
    f.angle = ((f.angle ?? 0) + rotStep * 180 / Math.PI + 360) % 360;
    const s = this.editor._editorStore;
    if (s) s.bridge.angle = Math.round(f.angle);
    this.updateVisual(this.selected);
  }

  // ── Delete / Duplicate ────────────────────────────────────────────────────

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const d   = this.selected;
    const idx = this.editor.currentTrack.features.indexOf(d.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);

    d.mesh.dispose();
    d.node.dispose();
    d.sphere?.dispose();
    const mi = this.meshes.indexOf(d);
    if (mi > -1) this.meshes.splice(mi, 1);

    this.hideProperties();
    this.selected = null;
    console.log('[BridgeEditor] Deleted bridge');
  }

  duplicateSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const src  = this.selected.feature;
    const copy = { ...src, centerX: src.centerX + 3, centerZ: src.centerZ + 3 };
    this.editor.currentTrack.features.push(copy);
    const newData = this.createVisual(copy);
    this.deselect();
    this.select(newData);
  }

  // ── Properties (Vue store bridge) ─────────────────────────────────────────

  showProperties(bridgeData) {
    const s = this.editor._editorStore;
    if (!s) return;
    const { feature } = bridgeData;
    s.bridge.width     = feature.width     ?? 20;
    s.bridge.depth     = feature.depth     ?? 8;
    s.bridge.height    = feature.height    ?? 5;
    s.bridge.thickness = feature.thickness ?? 0.4;
    s.bridge.angle     = feature.angle     ?? 0;
    s.selectedType = 'bridge';
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'bridge')
      this.editor._editorStore.selectedType = null;
  }

  // ── Vue Bridge — called by Pinia store actions ────────────────────────────

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

  changeHeight(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.height = val;
    this.updateVisual(this.selected);
  }

  changeThickness(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.thickness = val;
    this.updateVisual(this.selected);
  }

  changeAngle(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.angle = val;
    this.updateVisual(this.selected);
  }
}
