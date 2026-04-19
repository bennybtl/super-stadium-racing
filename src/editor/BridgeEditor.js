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
 *   {
 *     type:'bridge', centerX, centerZ, width, depth, height, thickness, angle,
 *     level?,
 *     collision?: { width?, depth?, thickness?, yOffset? }
 *   }
 */
export class BridgeEditor {
  constructor(editor) {
    /** @type {import('./EditorController.js').EditorController} */
    this.editor = editor;

    this.meshes   = [];    // { feature, node, sphere }
    this.selected = null;

    this.material          = null;
    this.highlightMaterial = null;
    this.sphereMaterial    = null;
    this._pendingRuntimeSync = null;
    this._pendingFeature = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  createMaterials() {
    const m = EditorMaterials.for(this.editor.scene);
    this.material          = m.bridgeBox;
    this.highlightMaterial = m.nodeHighlight;
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
      d.node.dispose();
      d.sphere?.dispose();
    }
    this.meshes   = [];
    this.selected = null;
  }

  dispose() {
    if (this._pendingRuntimeSync !== null) {
      cancelAnimationFrame(this._pendingRuntimeSync);
      this._pendingRuntimeSync = null;
      this._pendingFeature = null;
    }
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

    // Sphere at terrain level — the always-visible click target
    const sphere = MeshBuilder.CreateSphere('bridgeSphere', { diameter: 1.5, segments: 8 }, scene);
    sphere.position = new Vector3(feature.centerX, terrainY, feature.centerZ);
    sphere.material = this.sphereMaterial;
    sphere.isPickable = true;

    const bridgeData = { feature, node, sphere };
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
      materialType: 'packed_dirt',
    };

    this.editor.saveSnapshot();
    this.editor.currentTrack.features.push(newFeature);
    const bridgeData = this.createVisual(newFeature);
    this._scheduleRuntimeSync(null);

    this.editor.deselectAll();
    this.select(bridgeData);
    this.editor.hideAddMenu();
    console.log('[BridgeEditor] Added bridge at', newX.toFixed(1), newZ.toFixed(1));
  }

  // ── Click test ────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    for (const d of this.meshes) {
      if (mesh === d.sphere) return d;
    }
    return null;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  select(bridgeData) {
    if (this.selected) this.deselect();
    this.selected = bridgeData;
    if (bridgeData.sphere) {
      // set color to nodeHighlight
      bridgeData.sphere.material = this.highlightMaterial;

    }
    this.showProperties(bridgeData);
    console.log('[BridgeEditor] Selected bridge at',
      bridgeData.feature.centerX.toFixed(1), bridgeData.feature.centerZ.toFixed(1));
  }

  deselect() {
    if (!this.selected) return;
    if (this.selected.sphere) {
      this.selected.sphere.material = this.handleSphere;
    }
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

    d.node.dispose();
    d.sphere?.dispose();
    const mi = this.meshes.indexOf(d);
    if (mi > -1) this.meshes.splice(mi, 1);
    this._scheduleRuntimeSync(null);

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
    this._scheduleRuntimeSync(null);
    this.deselect();
    this.select(newData);
  }

  // ── Properties (Vue store bridge) ─────────────────────────────────────────

  showProperties(bridgeData) {
    const s = this.editor._editorStore;
    if (!s) return;
    const { feature } = bridgeData;
    const c = feature.collision ?? {};
    s.bridge.width     = feature.width     ?? 20;
    s.bridge.depth     = feature.depth     ?? 8;
    s.bridge.height    = feature.height    ?? 5;
    s.bridge.thickness = feature.thickness ?? 0.4;
    s.bridge.angle     = feature.angle     ?? 0;
    s.bridge.materialType = feature.materialType ?? 'packed_dirt';
    s.bridge.collisionEndCaps         = c.endCaps ?? false;
    s.bridge.collisionEndCapsOnDepth  = c.endCapsOnDepth ?? true;
    s.bridge.collisionEndCapsOnWidth  = c.endCapsOnWidth ?? false;
    s.bridge.collisionEndCapThickness = c.endCapThickness ?? 1.2;
    s.bridge.collisionEndCapDrop      = c.endCapDrop ?? 30;
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
    this._scheduleRuntimeSync(this.selected.feature);
  }

  changeDepth(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.depth = val;
    this.updateVisual(this.selected);
    this._scheduleRuntimeSync(this.selected.feature);
  }

  changeHeight(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.height = val;
    this.updateVisual(this.selected);
    this._scheduleRuntimeSync(this.selected.feature);
  }

  changeThickness(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.thickness = val;
    this.updateVisual(this.selected);
    this._scheduleRuntimeSync(this.selected.feature);
  }

  changeAngle(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.angle = val;
    this.updateVisual(this.selected);
    this._scheduleRuntimeSync(this.selected.feature);
  }

  changeMaterialType(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.materialType = val;
    this._scheduleRuntimeSync(this.selected.feature);
  }

  _ensureCollision() {
    if (!this.selected) return null;
    const f = this.selected.feature;
    if (!f.collision) f.collision = {};
    return f.collision;
  }

  _scheduleRuntimeSync(feature = null) {
    this._pendingFeature = feature ?? this.selected?.feature ?? null;
    if (this._pendingRuntimeSync !== null) return;

    this._pendingRuntimeSync = requestAnimationFrame(() => {
      this._pendingRuntimeSync = null;
      window.rebuildBridge?.(this._pendingFeature ?? null);
      this._pendingFeature = null;
    });
  }

  changeCollisionEndCaps(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this._ensureCollision().endCaps = !!val;
    this._scheduleRuntimeSync(this.selected.feature);
  }

  changeCollisionEndCapsOnDepth(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this._ensureCollision().endCapsOnDepth = !!val;
    this._scheduleRuntimeSync(this.selected.feature);
  }

  changeCollisionEndCapsOnWidth(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this._ensureCollision().endCapsOnWidth = !!val;
    this._scheduleRuntimeSync(this.selected.feature);
  }

  changeCollisionEndCapThickness(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this._ensureCollision().endCapThickness = val;
    this._scheduleRuntimeSync(this.selected.feature);
  }

  changeCollisionEndCapDrop(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this._ensureCollision().endCapDrop = val;
    this._scheduleRuntimeSync(this.selected.feature);
  }
}
