import { Vector3, StandardMaterial, Color3, MeshBuilder, TransformNode } from "@babylonjs/core";
import { TERRAIN_TYPES } from "../terrain.js";

/**
 * SquareHillEditor – encapsulates all square-hill editing logic that was
 * previously inline in EditorController.  The parent controller is passed as
 * `editor` so we can access shared helpers (scene, camera, track, snap,
 * snapshots, store…).
 */
export class SquareHillEditor {
  constructor(editor) {
    /** @type {import('./EditorController.js').EditorController} */
    this.editor = editor;

    // Gizmo bookkeeping
    this.meshes = [];   // { feature, node, mesh }
    this.selected = null;

    // Materials (created lazily in createMaterials)
    this.material = null;
    this.highlightMaterial = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Create (or recreate) shared materials for the current scene. */
  createMaterials() {
    const scene = this.editor.scene;

    this.material = new StandardMaterial('squareHillMat', scene);
    this.material.diffuseColor = new Color3(0.75, 0.55, 0.1);
    this.material.emissiveColor = new Color3(0.12, 0.08, 0.01);
    this.material.alpha = 0.20;
    this.material.backFaceCulling = false;

    this.highlightMaterial = new StandardMaterial('squareHillHighlightMat', scene);
    this.highlightMaterial.diffuseColor = new Color3(1.0, 0.8, 0.0);
    this.highlightMaterial.emissiveColor = new Color3(0.35, 0.25, 0.0);
    this.highlightMaterial.alpha = 0.20;
    this.highlightMaterial.backFaceCulling = false;
  }

  /** Build gizmos for every existing squareHill feature in the track. */
  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'squareHill') {
        this.createVisual(feature);
      }
    }
  }

  /** Dispose all gizmo meshes and reset state. */
  dispose() {
    for (const d of this.meshes) {
      d.mesh.dispose();
      d.node.dispose();
    }
    this.meshes = [];
    this.selected = null;
  }

  /** Called after undo/redo clears arrays (meshes already disposed by controller). */
  onSnapshotCleared() {
    this.meshes = [];
    this.selected = null;
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /** Build a box-shaped editor gizmo for a squareHill feature. */
  createVisual(feature) {
    const scene = this.editor.scene;
    const track = this.editor.currentTrack;
    const transition = feature.transition ?? 8;
    const terrainH = track ? track.getHeightAt(feature.centerX, feature.centerZ) : 0;
    const absH = feature.heightAtMin !== undefined
      ? Math.max(0.5, Math.abs(feature.heightAtMin ?? 0), Math.abs(feature.heightAtMax ?? 0))
      : Math.max(0.5, Math.abs(feature.height ?? 5));

    const node = new TransformNode('squareHillNode', scene);
    node.position = new Vector3(feature.centerX, terrainH + absH / 2, feature.centerZ);
    node.scaling  = new Vector3(feature.width + transition * 2, absH, (feature.depth ?? feature.width) + transition * 2);
    node.rotation.y = -(feature.angle ?? 0) * Math.PI / 180;

    const mesh = MeshBuilder.CreateBox('squareHillMesh', { size: 1 }, scene);
    mesh.parent = node;
    mesh.material = this.material;
    mesh.isPickable = true;

    const hillData = { feature, node, mesh };
    this.meshes.push(hillData);
    return hillData;
  }

  /** Sync the box gizmo transform to the feature's current values. */
  updateVisual(hillData) {
    const { feature, node } = hillData;
    const track = this.editor.currentTrack;
    const transition = feature.transition ?? 8;
    const terrainH = track ? track.getHeightAt(feature.centerX, feature.centerZ) : 0;
    const absH = feature.heightAtMin !== undefined
      ? Math.max(0.5, Math.abs(feature.heightAtMin ?? 0), Math.abs(feature.heightAtMax ?? 0))
      : Math.max(0.5, Math.abs(feature.height ?? 5));
    node.position.x = feature.centerX;
    node.position.z = feature.centerZ;
    node.position.y = terrainH + absH / 2;
    node.scaling.x  = feature.width + transition * 2;
    node.scaling.y  = absH;
    node.scaling.z  = (feature.depth ?? feature.width) + transition * 2;
    node.rotation.y = -(feature.angle ?? 0) * Math.PI / 180;
  }

  /** Place a new square hill in front of the camera and select it. */
  addEntity() {
    const { camera } = this.editor;
    const camPos = camera.position;
    const camTarget = camera.target;
    const direction = camTarget.subtract(camPos).normalize();

    const newX = camPos.x + direction.x * 20;
    const newZ = camPos.z + direction.z * 50;

    const newFeature = {
      type: 'squareHill',
      centerX: newX,
      centerZ: newZ,
      width: 10,
      depth: 10,
      height: 3,
      transition: 4,
      terrainType: null,
    };

    this.editor.saveSnapshot();
    this.editor.currentTrack.features.push(newFeature);
    const hillData = this.createVisual(newFeature);

    this.editor.checkpointEditor.deselect();
    this.editor.hillEditor.deselect();
    this.select(hillData);

    this.rebuildTerrain();

    this.editor.hideAddMenu();
    console.log('[SquareHillEditor] Added square hill at', newX.toFixed(1), newZ.toFixed(1));
  }

  // ── Click test ────────────────────────────────────────────────────────────

  /** Returns the hillData if `mesh` belongs to a square hill gizmo, else null. */
  findByMesh(mesh) {
    for (const hillData of this.meshes) {
      if (mesh === hillData.mesh) return hillData;
    }
    return null;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  select(hillData) {
    this.deselect();
    this.selected = hillData;
    this.editor._rawDragPos = { x: hillData.feature.centerX, z: hillData.feature.centerZ };
    hillData.mesh.material = this.highlightMaterial;
    this.showProperties(hillData);
    console.log('[SquareHillEditor] Selected square hill at',
      hillData.feature.centerX.toFixed(1), hillData.feature.centerZ.toFixed(1));
  }

  deselect() {
    if (this.selected) {
      this.selected.mesh.material = this.material;
      this.hideProperties();
      window.rebuildTerrainTexture?.();
      console.log('[SquareHillEditor] Deselected square hill');
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

  /** Rotate the selected square hill by `rotStep` radians (Q/E keys). */
  rotate(rotStep) {
    if (!this.selected) return;
    const f = this.selected.feature;
    f.angle = ((f.angle ?? 0) + rotStep * 180 / Math.PI + 360) % 360;
    // Sync the Vue store
    const s = this.editor._editorStore;
    if (s) s.squareHill.angle = f.angle;
    this.rebuildTerrain();
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

    const meshIdx = this.meshes.indexOf(hillData);
    if (meshIdx > -1) this.meshes.splice(meshIdx, 1);

    this.hideProperties();
    this.selected = null;

    this.rebuildTerrain();
    console.log('[SquareHillEditor] Deleted square hill');
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
    const sloped = feature.heightAtMin !== undefined;
    s.squareHill.width       = feature.width;
    s.squareHill.depth       = feature.depth ?? feature.width;
    s.squareHill.transition  = feature.transition ?? 8;
    s.squareHill.angle       = feature.angle ?? 0;
    s.squareHill.slopeMode   = sloped;
    s.squareHill.terrainType = feature.terrainType?.name || 'none';
    if (sloped) {
      s.squareHill.heightAtMin = feature.heightAtMin ?? 0;
      s.squareHill.heightAtMax = feature.heightAtMax ?? 5;
    } else {
      s.squareHill.height = feature.height ?? 5;
    }
    s.selectedType = 'squareHill';
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'squareHill')
      this.editor._editorStore.selectedType = null;
  }

  rebuildTerrain() {
    this.updateVisual(this.selected);
    window.rebuildTerrain?.();
    window.rebuildTerrainGrid?.();
  }

  // ── Vue Bridge — called by Pinia store actions ────────────────────────────

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

  changeTransition(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.transition = val;
    this.rebuildTerrain();
  }

  changeAngle(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.angle = val;
    this.rebuildTerrain();
  }

  changeHeight(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.height = val;
    this.rebuildTerrain();
  }

  changeHeightMin(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.heightAtMin = val;
    this.rebuildTerrain();
  }

  changeHeightMax(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.heightAtMax = val;
    this.rebuildTerrain();
  }

  changeMode(sloped) {
    if (!this.selected) return;
    const f = this.selected.feature;
    const s = this.editor._editorStore;
    if (sloped) {
      if (f.heightAtMin !== undefined) return; // already sloped
      this.editor.saveSnapshot();
      const prevH = f.height ?? 5;
      f.heightAtMin = 0;
      f.heightAtMax = prevH;
      delete f.height;
      if (s) { s.squareHill.heightAtMin = 0; s.squareHill.heightAtMax = prevH; }
    } else {
      if (f.heightAtMin === undefined) return; // already flat
      this.editor.saveSnapshot();
      const prevH = f.heightAtMax ?? 5;
      f.height = prevH;
      delete f.heightAtMin; delete f.heightAtMax;
      if (s) s.squareHill.height = prevH;
    }
    this.rebuildTerrain();
  }

  changeTerrainType(name) {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    this.selected.feature.terrainType = name === 'none' ? null
      : (Object.values(TERRAIN_TYPES).find(t => t.name === name) || null);
    this.rebuildTerrain();
  }
}
