import { Vector3, MeshBuilder } from "@babylonjs/core";
import rebuild from './editor-rebuild.js';
import { EditorMaterials } from './EditorMaterials.js';
import { deriveDriveBoxGrid } from '../objects/DriveBox.js';
import { gizmoY } from './gizmo-height.js';

/**
 * DriveBoxEditor – editing logic for the driveBox feature (parametric drivable
 * box/wedge). Mesh-gizmo style like SquareHillEditor: the real solid mesh is
 * the visual (built by BridgeMeshManager via rebuild.bridgeMesh), and a single
 * pickable sphere floated above the feature is the click target.
 */
export class DriveBoxEditor {
  constructor(editor) {
    /** @type {import('./EditorController.js').EditorController} */
    this.editor = editor;

    // Gizmo bookkeeping
    this.meshes = [];   // { feature, sphere }
    this.selected = null;

    this.sphereMaterial = null;
    this.sphereHighlightMaterial = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  createMaterials() {
    const m = EditorMaterials.for(this.editor.scene);
    this.sphereMaterial          = m.handleSphere;
    this.sphereHighlightMaterial = m.handleSphereHighlight;
  }

  activate(scene, track) {
    this.createMaterials();
    this.createVisualsForTrack(track);
  }

  clearMeshes() {
    for (const d of this.meshes) {
      d.sphere?.dispose();
    }
    this.meshes = [];
    this.selected = null;
  }

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'driveBox') {
        this.createVisual(feature);
      }
    }
  }

  dispose() {
    this.clearMeshes();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /**
   * Y for the handle: clear of the box's own highest corner (taken from the very
   * grid the mesh is built from, so a wedge or a box on a slope can't outgrow
   * it) and of the terrain, for a box sunk below the ground it sits on.
   */
  _handleY(feature) {
    const track = this.editor.currentTrack;
    const heights = deriveDriveBoxGrid(feature, track)?.heights ?? [];
    const topY = heights.length ? Math.max(...heights) : null;
    return gizmoY(track, feature.centerX, feature.centerZ, topY);
  }

  /** Build the sphere gizmo for a driveBox feature. */
  createVisual(feature) {
    const scene = this.editor.scene;

    // Float above the whole feature so the box top can't occlude the pick ray.
    const sphere = MeshBuilder.CreateSphere('driveBoxSphere', { diameter: 1.5, segments: 8 }, scene);
    sphere.position = new Vector3(feature.centerX, this._handleY(feature), feature.centerZ);
    sphere.material = this.sphereMaterial;
    sphere.isVisible = true;
    sphere.isPickable = true;

    const boxData = { feature, sphere };
    this.meshes.push(boxData);
    return boxData;
  }

  updateVisual(boxData) {
    const { feature, sphere } = boxData;
    if (sphere) {
      sphere.position.x = feature.centerX;
      sphere.position.y = this._handleY(feature);
      sphere.position.z = feature.centerZ;
    }
  }

  /** Re-sample handle heights after a terrain rebuild (EditorController sweep). */
  refreshGizmoHeights() {
    for (const boxData of this.meshes) this.updateVisual(boxData);
  }

  /** Place a new drive box in front of the camera and select it. */
  addEntity() {
    const center = this.editor.viewCenterXZ();

    const newFeature = {
      type: 'driveBox',
      centerX: center.x,
      centerZ: center.z,
      width: 10,
      depth: 6,
      rotation: 0,
      height: 2,
      solidBase: true,
      thickness: 0.4,
      layerId: 0,
    };

    this.editor.saveSnapshot();
    this.editor.currentTrack.features.push(newFeature);
    const boxData = this.createVisual(newFeature);

    this.editor.deselectAll();
    this.select(boxData);

    this.rebuildMesh();

    this.editor.hideAddMenu();
    console.debug('[DriveBoxEditor] Added drive box at', center.x.toFixed(1), center.z.toFixed(1));
  }

  // ── Click test ────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    for (const boxData of this.meshes) {
      if (mesh === boxData.sphere) return boxData;
    }
    return null;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  select(boxData) {
    this.deselect();
    this.selected = boxData;
    this.editor._rawDragPos = { x: boxData.feature.centerX, z: boxData.feature.centerZ };
    boxData.sphere.isVisible = true;
    boxData.sphere.isPickable = true;
    boxData.sphere.material = this.sphereHighlightMaterial;
    this.showProperties(boxData);
  }

  deselect() {
    if (this.selected) {
      this.selected.sphere.isVisible = true;
      this.selected.sphere.isPickable = true;
      this.selected.sphere.material = this.sphereMaterial;
      this.hideProperties();
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
    this.rebuildMesh();
    return new Vector3(feature.centerX - prevX, 0, feature.centerZ - prevZ);
  }

  /** Rotate the selected drive box by `rotStep` radians (Q/E keys). */
  rotate(rotStep) {
    if (!this.selected) return;
    const f = this.selected.feature;
    f.rotation = ((f.rotation ?? 0) + rotStep * 180 / Math.PI + 360) % 360;
    const s = this.editor._editorStore;
    if (s) s.driveBox.rotation = f.rotation;
    this.rebuildMesh();
  }

  // ── Delete / Duplicate ────────────────────────────────────────────────────

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const boxData = this.selected;

    const idx = this.editor.currentTrack.features.indexOf(boxData.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);

    boxData.sphere?.dispose();

    const meshIdx = this.meshes.indexOf(boxData);
    if (meshIdx > -1) this.meshes.splice(meshIdx, 1);

    this.hideProperties();
    this.selected = null;

    // Feature is gone from the array; a targeted rebuild would miss it.
    rebuild.bridgeMesh?.(null);
  }

  duplicateSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const src = this.selected.feature;
    const newFeature = { ...src, centerX: src.centerX + 3, centerZ: src.centerZ + 3 };
    this.editor.currentTrack.features.push(newFeature);
    const boxData = this.createVisual(newFeature);
    this.deselect();
    this.select(boxData);
    this.rebuildMesh();
  }

  // ── Properties (Vue store bridge) ─────────────────────────────────────────

  showProperties(boxData) {
    const s = this.editor._editorStore;
    if (!s) return;
    const { feature } = boxData;
    const sloped = feature.heightAtMin !== undefined;
    s.driveBox.width     = feature.width;
    s.driveBox.depth     = feature.depth ?? feature.width;
    s.driveBox.rotation  = feature.rotation ?? 0;
    s.driveBox.slopeMode = sloped;
    s.driveBox.solidBase = feature.solidBase !== false;
    s.driveBox.thickness = feature.thickness ?? 0.4;
    s.driveBox.layerId   = feature.layerId ?? 0;
    s.driveBox.color     = feature.color ?? 'terrain';
    s.driveBox.sideColor = feature.sideColor ?? feature.color ?? 'terrain';
    if (sloped) {
      s.driveBox.heightAtMin = feature.heightAtMin ?? 0;
      s.driveBox.heightAtMax = feature.heightAtMax ?? 2;
    } else {
      s.driveBox.height = feature.height ?? 2;
    }
    s.selectedType = 'driveBox';
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'driveBox')
      this.editor._editorStore.selectedType = null;
  }

  rebuildMesh() {
    if (this.selected) this.updateVisual(this.selected);
    rebuild.bridgeMesh?.(this.selected?.feature ?? null);
  }

  // ── Vue Bridge — called by Pinia store actions ────────────────────────────

  changeWidth(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.width = val;
    this.rebuildMesh();
  }

  changeDepth(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.depth = val;
    this.rebuildMesh();
  }

  changeRotation(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.rotation = val;
    this.rebuildMesh();
  }

  changeHeight(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.height = val;
    this.rebuildMesh();
  }

  changeHeightMin(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.heightAtMin = val;
    this.rebuildMesh();
  }

  changeHeightMax(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.heightAtMax = val;
    this.rebuildMesh();
  }

  changeMode(sloped) {
    if (!this.selected) return;
    const f = this.selected.feature;
    const s = this.editor._editorStore;
    if (sloped) {
      if (f.heightAtMin !== undefined) return; // already wedge
      this.editor.saveSnapshot();
      const prevH = f.height ?? 2;
      f.heightAtMin = 0;
      f.heightAtMax = prevH;
      delete f.height;
      if (s) { s.driveBox.heightAtMin = 0; s.driveBox.heightAtMax = prevH; }
    } else {
      if (f.heightAtMin === undefined) return; // already flat
      this.editor.saveSnapshot();
      const prevH = f.heightAtMax ?? 2;
      f.height = prevH;
      delete f.heightAtMin; delete f.heightAtMax;
      if (s) s.driveBox.height = prevH;
    }
    this.rebuildMesh();
  }

  changeSolidBase(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    this.selected.feature.solidBase = !!val;
    this.rebuildMesh();
  }

  changeThickness(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.thickness = Math.max(0.1, val);
    this.rebuildMesh();
  }

  changeLayerId(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    this.selected.feature.layerId = Math.max(0, Math.round(val));
    this.rebuildMesh();
  }

  /** Top face. 'terrain' clears the color (terrain-blend look); a hex sets flat diffuse. */
  changeColor(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    if (val === 'terrain') delete this.selected.feature.color;
    else this.selected.feature.color = val;
    this.rebuildMesh();
  }

  /**
   * Sides + bottom. Always written explicitly (including the 'terrain' sentinel)
   * so sides can use the terrain look while the top is colored; only a feature
   * that has never set it falls back to the top material.
   */
  changeSideColor(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    this.selected.feature.sideColor = val;
    this.rebuildMesh();
  }
}
