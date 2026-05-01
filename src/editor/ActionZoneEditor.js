import { Vector3, MeshBuilder, Color3 } from "@babylonjs/core";
import { EditorMaterials } from './EditorMaterials.js';

/** Height of the zone cylinder gizmo in world units. */
const CYLINDER_HEIGHT = 8;
const HANDLE_HEIGHT = 0.75;
const POLY_POINT_HEIGHT = 0.9;
const POLY_POINT_MIN = 3;

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

    /** @type {{ feature: object, cyl: import('@babylonjs/core').Mesh|null, handle: import('@babylonjs/core').Mesh|null, pointHandles: import('@babylonjs/core').Mesh[], lineSystem: import('@babylonjs/core').Mesh|null }[]} */
    this.zones = [];

    /** @type {{ feature: object, cyl: import('@babylonjs/core').Mesh|null, handle: import('@babylonjs/core').Mesh|null, pointHandles: import('@babylonjs/core').Mesh[], lineSystem: import('@babylonjs/core').Mesh|null } | null} */
    this._selected = null;
    this._selectedPointIndex = -1;

    // Materials — created once, reused (per zone type)
    this.cylMat          = null; // pickupSpawn
    this.cylMatHighlight = null;
    this.handleMat       = null;
    this.slowCylMat          = null; // slowZone
    this.slowCylMatHighlight = null;
    this.slowHandleMat       = null;
    this.oobCylMat           = null; // outOfBounds
    this.oobCylMatHighlight  = null;
    this.oobHandleMat        = null;

    this._polyLineColor = {
      pickupSpawn: {
        normal: new Color3(1.0, 0.45, 0.75),
        highlight: new Color3(1.0, 0.75, 0.9),
      },
      slowZone: {
        normal: new Color3(1.0, 0.65, 0.15),
        highlight: new Color3(1.0, 0.85, 0.3),
      },
      outOfBounds: {
        normal: new Color3(0.95, 0.2, 0.2),
        highlight: new Color3(1.0, 0.45, 0.45),
      },
    };
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
    const m = EditorMaterials.for(this.scene);
    this.cylMat              = m.zoneCyl;
    this.cylMatHighlight     = m.zoneCylHighlight;
    this.handleMat           = m.zoneHandle;
    this.slowCylMat          = m.slowZoneCyl;
    this.slowCylMatHighlight = m.slowZoneCylHighlight;
    this.slowHandleMat       = m.slowZoneHandle;
    this.oobCylMat           = m.outOfBoundsZoneCyl;
    this.oobCylMatHighlight  = m.outOfBoundsZoneCylHighlight;
    this.oobHandleMat        = m.outOfBoundsZoneHandle;
  }

  /** Returns the { cyl, highlight, handle } material set for a given zone type. */
  _getMaterialsForZoneType(zoneType) {
    if (zoneType === 'outOfBounds') {
      return { cyl: this.oobCylMat, highlight: this.oobCylMatHighlight, handle: this.oobHandleMat };
    }
    if (zoneType === 'slowZone') {
      return { cyl: this.slowCylMat, highlight: this.slowCylMatHighlight, handle: this.slowHandleMat };
    }
    // Default: pickupSpawn (pink)
    return { cyl: this.cylMat, highlight: this.cylMatHighlight, handle: this.handleMat };
  }

  /** Remove all zone meshes without destroying materials (used on snapshot restore). */
  clearMeshes() {
    for (const z of this.zones) {
      z.cyl?.dispose();
      z.handle?.dispose();
      for (const p of z.pointHandles) p.dispose();
      z.lineSystem?.dispose();
    }
    this.zones     = [];
    this._selected = null;
    this._selectedPointIndex = -1;
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
    this._normaliseFeature(feature);
    const zoneData = {
      feature,
      cyl: null,
      handle: null,
      pointHandles: [],
      lineSystem: null,
    };

    if (feature.shape === 'polygon') {
      this._buildPolygonMeshes(zoneData);
    } else {
      this._buildCircleMeshes(zoneData);
    }

    this.zones.push(zoneData);
    return zoneData;
  }

  _normaliseFeature(feature) {
    if (feature.shape !== 'polygon' && feature.shape !== 'circle') {
      feature.shape = 'circle';
    }

    if (feature.shape === 'polygon') {
      if (!Array.isArray(feature.points) || feature.points.length < POLY_POINT_MIN) {
        const cx = feature.x ?? 0;
        const cz = feature.z ?? 0;
        const r = Math.max(4, feature.radius ?? 12);
        feature.points = [
          { x: cx - r, z: cz - r * 0.8 },
          { x: cx + r, z: cz - r * 0.8 },
          { x: cx + r * 0.85, z: cz + r },
          { x: cx - r * 0.85, z: cz + r },
        ];
      }
      const c = this._getPolygonCenter(feature.points);
      feature.x = c.x;
      feature.z = c.z;
      feature.radius = feature.radius ?? 15;
      return;
    }

    feature.x = feature.x ?? 0;
    feature.z = feature.z ?? 0;
    feature.radius = Math.max(1, feature.radius ?? 15);
  }

  _buildCircleMeshes(zoneData) {
    const { feature } = zoneData;
    const { x, z, radius } = feature;
    const groundY = this.track.getHeightAt(x, z);

    const cyl = MeshBuilder.CreateCylinder('azCyl', {
      height: 1,
      diameter: 2,
      tessellation: 48,
      cap: 0,
    }, this.scene);
    cyl.position = new Vector3(x, groundY + CYLINDER_HEIGHT / 2, z);
    cyl.scaling = new Vector3(radius, CYLINDER_HEIGHT, radius);
    cyl.isPickable = false;

    const handle = MeshBuilder.CreateSphere('azHandle', { diameter: 1.5, segments: 8 }, this.scene);
    handle.position = new Vector3(x, groundY + HANDLE_HEIGHT, z);
    handle.isPickable = true;

    zoneData.cyl = cyl;
    zoneData.handle = handle;
    this._applyZoneVisualState(zoneData, false);
  }

  _buildPolygonMeshes(zoneData) {
    const { feature } = zoneData;
    const mats = this._getMaterialsForZoneType(feature.zoneType);

    const center = this._getPolygonCenter(feature.points);
    const centerY = this.track.getHeightAt(center.x, center.z);
    const handle = MeshBuilder.CreateSphere('azPolyHandle', { diameter: 1.7, segments: 10 }, this.scene);
    handle.position = new Vector3(center.x, centerY + HANDLE_HEIGHT, center.z);
    handle.material = mats.handle;
    handle.isPickable = true;
    zoneData.handle = handle;

    zoneData.pointHandles = feature.points.map((pt, idx) => {
      const y = this.track.getHeightAt(pt.x, pt.z);
      const p = MeshBuilder.CreateSphere(`azPolyPt_${idx}`, { diameter: 1.2, segments: 8 }, this.scene);
      p.position = new Vector3(pt.x, y + POLY_POINT_HEIGHT, pt.z);
      p.material = mats.handle;
      p.isPickable = true;
      return p;
    });

    zoneData.lineSystem = this._buildPolygonLine(feature.points, feature.zoneType);
    this._applyZoneVisualState(zoneData, false);
  }

  _buildPolygonLine(points, zoneType) {
    if (!points || points.length < POLY_POINT_MIN) return null;
    const linePoints = points.map(pt => new Vector3(pt.x, this.track.getHeightAt(pt.x, pt.z) + 0.25, pt.z));
    linePoints.push(linePoints[0].clone());
    const ls = MeshBuilder.CreateLineSystem('azPolyLine', { lines: [linePoints] }, this.scene);
    ls.color = this._getLineColor(zoneType, false);
    ls.isPickable = false;
    return ls;
  }

  _getLineColor(zoneType, selected) {
    const entry = this._polyLineColor[zoneType] ?? this._polyLineColor.pickupSpawn;
    return selected ? entry.highlight : entry.normal;
  }

  _applyZoneVisualState(zoneData, selected) {
    const mats = this._getMaterialsForZoneType(zoneData.feature.zoneType);

    if (zoneData.cyl) {
      zoneData.cyl.material = selected ? mats.highlight : mats.cyl;
    }

    if (zoneData.handle) {
      zoneData.handle.material = mats.handle;
    }

    if (zoneData.lineSystem) {
      zoneData.lineSystem.color = this._getLineColor(zoneData.feature.zoneType, selected);
    }

    for (let i = 0; i < zoneData.pointHandles.length; i++) {
      const pointMesh = zoneData.pointHandles[i];
      const isActivePoint = selected && i === this._selectedPointIndex;
      pointMesh.material = isActivePoint ? EditorMaterials.for(this.scene).nodeHighlight : mats.handle;
    }
  }

  _rebuildZoneVisual(zoneData) {
    const keepSelected = this._selected === zoneData;
    const oldSelectedPoint = this._selectedPointIndex;

    zoneData.cyl?.dispose();
    zoneData.cyl = null;
    zoneData.handle?.dispose();
    zoneData.handle = null;
    for (const p of zoneData.pointHandles) p.dispose();
    zoneData.pointHandles = [];
    zoneData.lineSystem?.dispose();
    zoneData.lineSystem = null;

    this._normaliseFeature(zoneData.feature);
    if (zoneData.feature.shape === 'polygon') this._buildPolygonMeshes(zoneData);
    else this._buildCircleMeshes(zoneData);

    if (keepSelected) {
      if (zoneData.feature.shape !== 'polygon') this._selectedPointIndex = -1;
      else this._selectedPointIndex = Math.max(-1, Math.min(oldSelectedPoint, zoneData.feature.points.length - 1));
      this._applyZoneVisualState(zoneData, true);
      this._showProperties(zoneData);
    }
  }

  _getPolygonCenter(points) {
    if (!points?.length) return { x: 0, z: 0 };
    let sx = 0;
    let sz = 0;
    for (const p of points) {
      sx += p.x;
      sz += p.z;
    }
    return { x: sx / points.length, z: sz / points.length };
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    for (const zoneData of this.zones) {
      if (zoneData.handle === mesh) {
        zoneData._pendingPointIndex = -1;
        return zoneData;
      }
      const idx = zoneData.pointHandles.indexOf(mesh);
      if (idx !== -1) {
        zoneData._pendingPointIndex = idx;
        return zoneData;
      }
    }
    return null;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  select(zoneData) {
    if (this._selected && this._selected !== zoneData) this._applyZoneVisualState(this._selected, false);
    this._selected = zoneData;
    this._selectedPointIndex = zoneData._pendingPointIndex ?? -1;
    delete zoneData._pendingPointIndex;

    if (zoneData.feature.shape === 'polygon' && this._selectedPointIndex >= 0) {
      const pt = zoneData.feature.points[this._selectedPointIndex];
      this.editor._rawDragPos = { x: pt.x, z: pt.z };
    } else {
      this.editor._rawDragPos = { x: zoneData.feature.x, z: zoneData.feature.z };
    }

    this._applyZoneVisualState(zoneData, true);
    this._showProperties(zoneData);
  }

  deselect() {
    if (this._selected) {
      this._applyZoneVisualState(this._selected, false);
      this._selected = null;
    }
    this._selectedPointIndex = -1;
    this._hideProperties();
    this.editor._rawDragPos = null;
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  move(movement) {
    if (!this._selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);

    const e = this.editor;
    e.saveSnapshot(true);

    const { feature } = this._selected;

    if (feature.shape === 'polygon' && this._selectedPointIndex >= 0) {
      const pt = feature.points[this._selectedPointIndex];
      e._rawDragPos.x += movement.x;
      e._rawDragPos.z += movement.z;
      const prevX = pt.x;
      const prevZ = pt.z;
      pt.x = e._snap(e._rawDragPos.x, 'x');
      pt.z = e._snap(e._rawDragPos.z, 'z');

      const c = this._getPolygonCenter(feature.points);
      feature.x = c.x;
      feature.z = c.z;

      this._rebuildZoneVisual(this._selected);
      return new Vector3(pt.x - prevX, 0, pt.z - prevZ);
    }

    const prevX = feature.x;
    const prevZ = feature.z;
    e._rawDragPos.x += movement.x;
    e._rawDragPos.z += movement.z;
    const newX = e._snap(e._rawDragPos.x, 'x');
    const newZ = e._snap(e._rawDragPos.z, 'z');

    if (feature.shape === 'polygon') {
      const dx = newX - feature.x;
      const dz = newZ - feature.z;
      feature.points = feature.points.map(p => ({ x: p.x + dx, z: p.z + dz }));
      feature.x = newX;
      feature.z = newZ;
      this._rebuildZoneVisual(this._selected);
      return new Vector3(dx, 0, dz);
    }

    feature.x = newX;
    feature.z = newZ;
    const groundY = this.track.getHeightAt(newX, newZ);
    this._selected.cyl.position.set(newX, groundY + CYLINDER_HEIGHT / 2, newZ);
    this._selected.handle.position.set(newX, groundY + HANDLE_HEIGHT, newZ);
    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  addEntity() {
    const e        = this.editor;
    const camTarget = e.camera.getTarget();
    const newX     = e._snap(camTarget.x);
    const newZ     = e._snap(camTarget.z);

    const feature = {
      type: 'actionZone',
      zoneType: 'pickupSpawn',
      shape: 'circle',
      x: newX,
      z: newZ,
      radius: 15,
    };
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

    if (this._selected.feature.shape === 'polygon' && this._selectedPointIndex >= 0) {
      this.deletePoint();
      return;
    }

    this.editor.saveSnapshot();
    const idx = this.editor.currentTrack.features.indexOf(this._selected.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    this._selected.cyl?.dispose();
    this._selected.handle?.dispose();
    for (const p of this._selected.pointHandles) p.dispose();
    this._selected.lineSystem?.dispose();
    const zi = this.zones.indexOf(this._selected);
    if (zi > -1) this.zones.splice(zi, 1);
    this._selected = null;
    this._selectedPointIndex = -1;
    this._hideProperties();
  }

  duplicateSelected() {
    if (!this._selected) return;
    this.editor.saveSnapshot();
    const src = this._selected.feature;
    const feature = JSON.parse(JSON.stringify(src));
    if (feature.shape === 'polygon' && Array.isArray(feature.points)) {
      feature.points = feature.points.map(p => ({ x: p.x + 5, z: p.z + 5 }));
      feature.x = (feature.x ?? 0) + 5;
      feature.z = (feature.z ?? 0) + 5;
    } else {
      feature.x = (feature.x ?? 0) + 5;
      feature.z = (feature.z ?? 0) + 5;
    }
    this.editor.currentTrack.features.push(feature);
    const zoneData = this._createZoneMeshes(feature);
    this.deselect();
    this.select(zoneData);
  }

  insertPoint() {
    if (!this._selected || this._selected.feature.shape !== 'polygon') return;
    const feature = this._selected.feature;
    if (!Array.isArray(feature.points) || feature.points.length < POLY_POINT_MIN) return;

    this.editor.saveSnapshot();

    const fromIdx = this._selectedPointIndex >= 0 ? this._selectedPointIndex : feature.points.length - 1;
    const toIdx = (fromIdx + 1) % feature.points.length;
    const a = feature.points[fromIdx];
    const b = feature.points[toIdx];
    const next = {
      x: this.editor._snap((a.x + b.x) * 0.5, 'x'),
      z: this.editor._snap((a.z + b.z) * 0.5, 'z'),
    };

    feature.points.splice(fromIdx + 1, 0, next);
    this._selectedPointIndex = fromIdx + 1;
    this.editor._rawDragPos = { x: next.x, z: next.z };

    const c = this._getPolygonCenter(feature.points);
    feature.x = c.x;
    feature.z = c.z;

    this._rebuildZoneVisual(this._selected);
    this._showProperties(this._selected);
  }

  deletePoint() {
    if (!this._selected || this._selected.feature.shape !== 'polygon') return;
    const feature = this._selected.feature;
    if (this._selectedPointIndex < 0) return;
    if (!Array.isArray(feature.points) || feature.points.length <= POLY_POINT_MIN) return;

    this.editor.saveSnapshot();
    feature.points.splice(this._selectedPointIndex, 1);
    this._selectedPointIndex = Math.min(this._selectedPointIndex, feature.points.length - 1);

    const c = this._getPolygonCenter(feature.points);
    feature.x = c.x;
    feature.z = c.z;

    if (this._selectedPointIndex >= 0) {
      const pt = feature.points[this._selectedPointIndex];
      this.editor._rawDragPos = { x: pt.x, z: pt.z };
    } else {
      this.editor._rawDragPos = { x: feature.x, z: feature.z };
    }

    this._rebuildZoneVisual(this._selected);
    this._showProperties(this._selected);
  }

  // ── Properties (Vue store bridge) ──────────────────────────────────────────

  _showProperties(zoneData) {
    const s = this.editor._editorStore;
    if (!s) return;
    s.actionZone.zoneType = zoneData.feature.zoneType;
    s.actionZone.shape = zoneData.feature.shape ?? 'circle';
    s.actionZone.radius = zoneData.feature.radius ?? 15;
    s.actionZone.pointCount = zoneData.feature.shape === 'polygon' ? (zoneData.feature.points?.length ?? 0) : 0;
    s.actionZone.selectedPointIndex = zoneData.feature.shape === 'polygon' ? this._selectedPointIndex : -1;
    s.selectedType = 'actionZone';
  }

  _hideProperties() {
    const s = this.editor._editorStore;
    if (s?.selectedType === 'actionZone') s.selectedType = null;
  }

  changeRadius(val) {
    if (!this._selected || this._selected.feature.shape !== 'circle') return;
    this._selected.feature.radius = val;
    this._selected.cyl.scaling.x = val;
    this._selected.cyl.scaling.z = val;
    this._showProperties(this._selected);
    this.editor.saveSnapshot(true);
  }

  changeZoneType(val) {
    if (!this._selected) return;
    this._selected.feature.zoneType = val;
    this._applyZoneVisualState(this._selected, true);
    this._showProperties(this._selected);
    this.editor.saveSnapshot();
  }

  changeShape(val) {
    if (!this._selected || (val !== 'circle' && val !== 'polygon')) return;
    const feature = this._selected.feature;
    if (feature.shape === val) return;

    this.editor.saveSnapshot();

    if (val === 'polygon') {
      const cx = feature.x ?? 0;
      const cz = feature.z ?? 0;
      const r = Math.max(4, feature.radius ?? 12);
      feature.shape = 'polygon';
      feature.points = [
        { x: cx - r, z: cz - r * 0.8 },
        { x: cx + r, z: cz - r * 0.8 },
        { x: cx + r * 0.85, z: cz + r },
        { x: cx - r * 0.85, z: cz + r },
      ];
      this._selectedPointIndex = -1;
      this.editor._rawDragPos = { x: cx, z: cz };
    } else {
      const pts = feature.points ?? [];
      const c = this._getPolygonCenter(pts);
      let avgDist = 15;
      if (pts.length) {
        let sum = 0;
        for (const p of pts) {
          const dx = p.x - c.x;
          const dz = p.z - c.z;
          sum += Math.sqrt(dx * dx + dz * dz);
        }
        avgDist = Math.max(4, sum / pts.length);
      }
      feature.shape = 'circle';
      feature.x = c.x;
      feature.z = c.z;
      feature.radius = avgDist;
      delete feature.points;
      this._selectedPointIndex = -1;
      this.editor._rawDragPos = { x: c.x, z: c.z };
    }

    this._rebuildZoneVisual(this._selected);
    this._showProperties(this._selected);
  }
}
