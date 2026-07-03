import { Vector3, MeshBuilder, TransformNode } from "@babylonjs/core";
import { EditorMaterials } from './EditorMaterials.js';
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
    this.meshes = [];   // { feature, node, sphere }
    this.selected = null;

    // Materials (created lazily in createMaterials)
    this.material = null;
    this.highlightMaterial = null;
    this.sphereMaterial = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Create (or recreate) shared materials for the current scene. */
  createMaterials() {
    const m = EditorMaterials.for(this.editor.scene);
    this.material          = m.squareHillBox;
    this.highlightMaterial = m.squareHillBoxHighlight;
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
      d.node.dispose();
      d.sphere?.dispose();
    }
    this.meshes = [];
    this.selected = null;
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
      d.node.dispose();
      d.sphere?.dispose();
    }
    this.meshes = [];
    this.selected = null;
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /** Build an editor gizmo for a squareHill feature. */
  createVisual(feature) {
    const scene = this.editor.scene;
    const track = this.editor.currentTrack;
    const transition = feature.transition ?? 8;
    const terrainH = track?.getHeightAt?.(feature.centerX, feature.centerZ)
      ?? this.editor.terrainQuery.heightAt(feature.centerX, feature.centerZ)
      ?? 0;
    const absH = feature.heightAtMin !== undefined
      ? Math.max(0.5, Math.abs(feature.heightAtMin ?? 0), Math.abs(feature.heightAtMax ?? 0))
      : Math.max(0.5, Math.abs(feature.height ?? 5));

    const node = new TransformNode('squareHillNode', scene);
    node.position = new Vector3(feature.centerX, terrainH + absH / 2, feature.centerZ);
    node.scaling  = new Vector3(feature.width + transition * 2, absH, (feature.depth ?? feature.width) + transition * 2);
    node.rotation.y = -(feature.angle ?? 0) * Math.PI / 180;

    // Grey sphere: the always-visible click target
    const sphere = MeshBuilder.CreateSphere('squareHillSphere', { diameter: 1.5, segments: 8 }, scene);
    sphere.position = new Vector3(feature.centerX, terrainH > 0 ? terrainH + 0.1 : 0, feature.centerZ);
    sphere.material = this.sphereMaterial;
    sphere.isVisible = true;
    sphere.isPickable = true;

    const hillData = { feature, node, sphere };
    this.meshes.push(hillData);
    return hillData;
  }

  /** Sync the gizmo transform to the feature's current values. */
  updateVisual(hillData) {
    const { feature, node, sphere } = hillData;
    const track = this.editor.currentTrack;
    const transition = feature.transition ?? 8;
    // Mirror createVisual: use the deterministic track.getHeightAt rather than a
    // ground-mesh raycast, which runs before the terrain rebuild and falls back
    // to 0 on a miss — that buried the sphere and made the gizmo vanish on edit.
    const terrainH = track?.getHeightAt?.(feature.centerX, feature.centerZ)
      ?? this.editor.terrainQuery.heightAt(feature.centerX, feature.centerZ)
      ?? 0;
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
    if (sphere) {
      sphere.position.x = feature.centerX;
      sphere.position.y = terrainH > 0 ? terrainH + 0.1 : 0;
      sphere.position.z = feature.centerZ;
    }
  }

  /** Place a new square hill in front of the camera and select it. */
  addEntity() {
    const { camera } = this.editor;
    const camTarget = camera.getTarget();
    const newX = camTarget.x;
    const newZ = camTarget.z;

    const newFeature = {
      type: 'squareHill',
      centerX: newX,
      centerZ: newZ,
      width: 10,
      depth: 10,
      angle: 0,
      height: 3,
      waterLevelOffset: 1,
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
    this.updateVisual(hillData);
    requestAnimationFrame(() => {
      if (this.selected === hillData) this.updateVisual(hillData);
    });

    this.editor.hideAddMenu();
    console.debug('[SquareHillEditor] Added square hill at', newX.toFixed(1), newZ.toFixed(1));
  }

  // ── Click test ────────────────────────────────────────────────────────────

  /** Returns the hillData if `mesh` belongs to a square hill gizmo, else null. */
  findByMesh(mesh) {
    for (const hillData of this.meshes) {
      if (mesh === hillData.sphere) return hillData;
    }
    return null;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  select(hillData) {
    this.deselect();
    this.selected = hillData;
    this.editor._rawDragPos = { x: hillData.feature.centerX, z: hillData.feature.centerZ };
    hillData.sphere.isVisible = true;
    hillData.sphere.isPickable = true;
    this.showProperties(hillData);
    console.debug('[SquareHillEditor] Selected square hill at',
      hillData.feature.centerX.toFixed(1), hillData.feature.centerZ.toFixed(1));
  }

  deselect() {
    if (this.selected) {
      this.selected.sphere.isVisible = true;
      this.selected.sphere.isPickable = true;
      this.hideProperties();
      console.debug('[SquareHillEditor] Deselected square hill');
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

    hillData.node.dispose();
    hillData.sphere?.dispose();

    const meshIdx = this.meshes.indexOf(hillData);
    if (meshIdx > -1) this.meshes.splice(meshIdx, 1);

    this.hideProperties();
    this.selected = null;

    this.rebuildTerrain();
    console.debug('[SquareHillEditor] Deleted square hill');
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
    s.squareHill.waterLevelOffset = feature.waterLevelOffset ?? 1;
    s.squareHill.slopeMode   = sloped;
    s.squareHill.terrainType = feature.terrainType?.name || 'none';
    s.squareHill.blendWidth  = feature.blendWidth ?? 0;
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
    if (this.selected) this.updateVisual(this.selected);
    window.rebuildTerrain?.(this.selected?.feature);
    window.rebuildTerrainGrid?.();
    window.rebuildHillWater?.(this.selected?.feature);
    window.rebuildTerrainTexture?.();
  }

  _maxWaterOffsetForFeature(feature) {
    if (feature.heightAtMin !== undefined && feature.heightAtMax !== undefined) {
      const centerHeight = ((feature.heightAtMin ?? 0) + (feature.heightAtMax ?? 0)) * 0.5;
      return Math.max(0, -centerHeight);
    }
    return Math.max(0, -(feature.height ?? 0));
  }

  _clampSelectedWaterOffsetToDepth() {
    if (!this.selected) return;
    const f = this.selected.feature;
    const max = this._maxWaterOffsetForFeature(f);
    const current = typeof f.waterLevelOffset === 'number' ? f.waterLevelOffset : 1;
    const clamped = Math.min(current, max);
    f.waterLevelOffset = clamped;
    if (this.editor._editorStore) this.editor._editorStore.squareHill.waterLevelOffset = clamped;
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
    this._clampSelectedWaterOffsetToDepth();
    this.rebuildTerrain();
  }

  changeWaterLevelOffset(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    const max = this._maxWaterOffsetForFeature(this.selected.feature);
    const clamped = Math.min(val, max);
    this.selected.feature.waterLevelOffset = clamped;
    if (this.editor._editorStore) this.editor._editorStore.squareHill.waterLevelOffset = clamped;
    this.rebuildTerrain();
  }

  changeHeightMin(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.heightAtMin = val;
    this._clampSelectedWaterOffsetToDepth();
    this.rebuildTerrain();
  }

  changeHeightMax(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.heightAtMax = val;
    this._clampSelectedWaterOffsetToDepth();
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
    this._clampSelectedWaterOffsetToDepth();
    this.rebuildTerrain();
  }

  changeTerrainType(name) {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    this.selected.feature.terrainType = name === 'none' ? null
      : (Object.values(TERRAIN_TYPES).find(t => t.name === name) || null);
    this.rebuildTerrain();
  }

  changeBlendWidth(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.blendWidth = Math.max(0, val);
    this.rebuildTerrain();
  }
}
