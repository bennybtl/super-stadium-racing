import { Vector3, StandardMaterial, Color3, MeshBuilder } from "@babylonjs/core";

/** Height of the zone cylinder gizmo in world units. */
const CYLINDER_HEIGHT = 8;

/**
 * ActionZoneEditor – editor gizmos for circular "action zone" features.
 *
 * An action zone is a named circular region on the track that drives gameplay
 * behaviours (e.g. zoneType="pickupSpawn" tells PickupManager to restrict
 * spawns to these circles instead of the whole map).
 *
 * Visuals:
 *   • A translucent vertical cylinder marks the zone boundary.
 *   • A small sphere at the base is the click / drag handle.
 */
export class ActionZoneEditor {
  constructor(editor) {
    /** @type {import('./EditorController.js').EditorController} */
    this.editor = editor;

    this.scene = null;
    this.track = null;

    /** @type {{ feature: object, cyl: import('@babylonjs/core').Mesh, handle: import('@babylonjs/core').Mesh }[]} */
    this.zones = [];

    /** @type {{ feature: object, cyl: import('@babylonjs/core').Mesh, handle: import('@babylonjs/core').Mesh } | null} */
    this._selected = null;

    // Materials — created once, reused (per zone type)
    this.cylMat          = null; // pickupSpawn
    this.cylMatHighlight = null;
    this.handleMat       = null;
    this.slowCylMat          = null; // slowZone
    this.slowCylMatHighlight = null;
    this.slowHandleMat       = null;
  }

  get selected() { return this._selected; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  activate(scene, track) {
    this.scene = scene;
    this.track = track;
    this._createMaterials();
    this._createVisualsForTrack(track);
  }

  _createMaterials() {
    const s = this.scene;
    if (!this.cylMat) {
      this.cylMat = new StandardMaterial('azCylMat', s);
      this.cylMat.diffuseColor   = new Color3(1.0, 0.20, 0.60);
      this.cylMat.emissiveColor  = new Color3(0.25, 0.04, 0.15);
      this.cylMat.alpha          = 0.28;
      this.cylMat.backFaceCulling = false;
    }
    if (!this.cylMatHighlight) {
      this.cylMatHighlight = new StandardMaterial('azCylHighMat', s);
      this.cylMatHighlight.diffuseColor   = new Color3(1.0, 0.50, 0.80);
      this.cylMatHighlight.emissiveColor  = new Color3(0.45, 0.15, 0.30);
      this.cylMatHighlight.alpha          = 0.50;
      this.cylMatHighlight.backFaceCulling = false;
    }
    if (!this.handleMat) {
      this.handleMat = new StandardMaterial('azHandleMat', s);
      this.handleMat.diffuseColor  = new Color3(1.0, 0.20, 0.60);
      this.handleMat.emissiveColor = new Color3(0.40, 0.05, 0.20);
    }

    // Slow zone — orange/amber warning colour
    if (!this.slowCylMat) {
      this.slowCylMat = new StandardMaterial('azSlowCylMat', s);
      this.slowCylMat.diffuseColor   = new Color3(1.0, 0.55, 0.0);
      this.slowCylMat.emissiveColor  = new Color3(0.30, 0.12, 0.0);
      this.slowCylMat.alpha          = 0.28;
      this.slowCylMat.backFaceCulling = false;
    }
    if (!this.slowCylMatHighlight) {
      this.slowCylMatHighlight = new StandardMaterial('azSlowCylHighMat', s);
      this.slowCylMatHighlight.diffuseColor   = new Color3(1.0, 0.75, 0.2);
      this.slowCylMatHighlight.emissiveColor  = new Color3(0.50, 0.25, 0.05);
      this.slowCylMatHighlight.alpha          = 0.50;
      this.slowCylMatHighlight.backFaceCulling = false;
    }
    if (!this.slowHandleMat) {
      this.slowHandleMat = new StandardMaterial('azSlowHandleMat', s);
      this.slowHandleMat.diffuseColor  = new Color3(1.0, 0.55, 0.0);
      this.slowHandleMat.emissiveColor = new Color3(0.40, 0.18, 0.0);
    }
  }

  /** Returns the { cyl, highlight, handle } material set for a given zone type. */
  _getMaterialsForZoneType(zoneType) {
    if (zoneType === 'slowZone') {
      return { cyl: this.slowCylMat, highlight: this.slowCylMatHighlight, handle: this.slowHandleMat };
    }
    // Default: pickupSpawn (pink)
    return { cyl: this.cylMat, highlight: this.cylMatHighlight, handle: this.handleMat };
  }

  /** Remove all zone meshes without destroying materials (used on snapshot restore). */
  clearMeshes() {
    for (const z of this.zones) {
      z.cyl.dispose();
      z.handle.dispose();
    }
    this.zones     = [];
    this._selected = null;
  }

  /** Full cleanup — used by EditorController.deactivate(). */
  dispose() {
    this.clearMeshes();
    this.scene = null;
    this.track = null;
  }

  // ── Visual creation ────────────────────────────────────────────────────────

  _createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'actionZone') this._createZoneMeshes(feature);
    }
  }

  createVisual(feature) {
    return this._createZoneMeshes(feature);
  }

  _createZoneMeshes(feature) {
    const { x, z, radius } = feature;
    const groundY = this.track.getHeightAt(x, z);

    // Open-ended vertical cylinder — no z-fighting with the ground surface.
    // Unit size: height=1, diameter=2 (radius=1); scaled to world dimensions.
    const cyl = MeshBuilder.CreateCylinder('azCyl', {
      height: 1,
      diameter: 2,
      tessellation: 48,
      cap: 0,  // no end caps
    }, this.scene);
    cyl.position   = new Vector3(x, groundY + CYLINDER_HEIGHT / 2, z);
    cyl.scaling    = new Vector3(radius, CYLINDER_HEIGHT, radius);
    const mats = this._getMaterialsForZoneType(feature.zoneType);
    cyl.material   = mats.cyl;
    cyl.isPickable = false;

    // Small sphere at the base — the click / drag target
    const handle = MeshBuilder.CreateSphere('azHandle', { diameter: 1.5, segments: 8 }, this.scene);
    handle.position  = new Vector3(x, groundY + 0.75, z);
    handle.material  = mats.handle;
    handle.isPickable = true;

    const zoneData = { feature, cyl, handle };
    this.zones.push(zoneData);
    return zoneData;
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    return this.zones.find(z => z.handle === mesh) ?? null;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  select(zoneData) {
    if (this._selected && this._selected !== zoneData) {
      this._selected.cyl.material = this.cylMat;
    }
    this._selected = zoneData;
    zoneData.cyl.material = this._getMaterialsForZoneType(zoneData.feature.zoneType).highlight;
    this.editor._rawDragPos = { x: zoneData.feature.x, z: zoneData.feature.z };
    this._showProperties(zoneData);
  }

  deselect() {
    if (this._selected) {
      this._selected.cyl.material = this._getMaterialsForZoneType(this._selected.feature.zoneType).cyl;
      this._selected = null;
    }
    this._hideProperties();
    this.editor._rawDragPos = null;
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  move(movement) {
    if (!this._selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    const e = this.editor;
    e.saveSnapshot(true);
    const { feature, cyl, handle } = this._selected;
    e._rawDragPos.x += movement.x;
    e._rawDragPos.z += movement.z;
    const prevX  = feature.x;
    const prevZ  = feature.z;
    const newX   = e._snap(e._rawDragPos.x);
    const newZ   = e._snap(e._rawDragPos.z);
    feature.x    = newX;
    feature.z    = newZ;
    const groundY = this.track.getHeightAt(newX, newZ);
    cyl.position.set(newX, groundY + CYLINDER_HEIGHT / 2, newZ);
    handle.position.set(newX, groundY + 0.75, newZ);
    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  addEntity() {
    const e        = this.editor;
    const camPos   = e.camera.position;
    const camTarget = e.camera.target;
    const dir      = camTarget.subtract(camPos).normalize();
    const newX     = e._snap(camPos.x + dir.x * 20);
    const newZ     = e._snap(camPos.z + dir.z * 50);

    const feature = { type: 'actionZone', zoneType: 'pickupSpawn', x: newX, z: newZ, radius: 15 };
    e.saveSnapshot();
    e.currentTrack.features.push(feature);
    const zoneData = this._createZoneMeshes(feature);
    e.deselectAll();
    this.select(zoneData);
    e.hideAddMenu();
    console.log('[ActionZoneEditor] Added action zone at', newX.toFixed(1), newZ.toFixed(1));
  }

  deleteSelected() {
    if (!this._selected) return;
    this.editor.saveSnapshot();
    const idx = this.editor.currentTrack.features.indexOf(this._selected.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    this._selected.cyl.dispose();
    this._selected.handle.dispose();
    const zi = this.zones.indexOf(this._selected);
    if (zi > -1) this.zones.splice(zi, 1);
    this._selected = null;
    this._hideProperties();
  }

  // ── Properties (Vue store bridge) ──────────────────────────────────────────

  _showProperties(zoneData) {
    const s = this.editor._editorStore;
    if (!s) return;
    s.actionZone.zoneType = zoneData.feature.zoneType;
    s.actionZone.radius   = zoneData.feature.radius;
    s.selectedType = 'actionZone';
  }

  _hideProperties() {
    const s = this.editor._editorStore;
    if (s?.selectedType === 'actionZone') s.selectedType = null;
  }

  changeRadius(val) {
    if (!this._selected) return;
    this._selected.feature.radius = val;
    this._selected.cyl.scaling.x = val;
    this._selected.cyl.scaling.z = val;
    this.editor.saveSnapshot(true);
  }

  changeZoneType(val) {
    if (!this._selected) return;
    this._selected.feature.zoneType = val;
    // Swap cylinder and handle materials to match the new zone type
    const mats = this._getMaterialsForZoneType(val);
    this._selected.cyl.material    = mats.highlight; // keep highlighted (still selected)
    this._selected.handle.material = mats.handle;
    this.editor.saveSnapshot();
  }
}
