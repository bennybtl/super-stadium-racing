import { Vector3, MeshBuilder } from "@babylonjs/core";
import { GizmoHandle } from "./GizmoHandle.js";
import { EditorMaterials } from "./EditorMaterials.js";
import { gizmoY, gizmoLineY } from './gizmo-height.js';
import { TRUCK_WIDTH, TRUCK_DEPTH } from "../constants.js";
import { gridSlotXZ, DEFAULT_START_GRID, MAX_GRID_SLOTS } from "../start-grid.js";

/** Thickness of a ghost slot pad, and how far it floats to clear the ground. */
const SLOT_THICKNESS = 0.12;
const SLOT_LIFT = 0.08;

/**
 * StartPositionEditor — the optional `startPosition` feature: where the field
 * grids up instead of the default two-wide rows behind the start/finish gate.
 *
 * The feature carries the anchor (x/z + heading) and the grid shape (columns
 * and spacings), so one wide row makes a land-rush start. Slot 0 (pole) sits on
 * the marker; the rest fill left-to-right, then step back a row.
 *
 * Visuals are editor-only — nothing is built into the raced scene:
 *   • Ghost pads for every slot of the biggest field the race config offers,
 *     truck-sized and turned to the marker's heading, pole brightest.
 *   • An arrow line from the marker showing which way the trucks face.
 *   • The shared handle sphere as the click/drag target.
 *
 * DriveMode.getStartGridAnchor reads the same feature through the same slot
 * math (start-grid.js), so the pads are exactly where the trucks will land.
 */
export class StartPositionEditor {
  constructor(editor) {
    /** @type {import('./EditorController.js').EditorController} */
    this.editor    = editor;
    this._markers  = [];   // { feature, handle, slots: Mesh[], arrow: Mesh|null }
    this._selected = null;
    this._scene    = null;
    this._track    = null;
  }

  get selected() { return this._selected; }

  /** The track's start marker feature, if it has one. */
  get feature() { return this._markers[0]?.feature ?? null; }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  activate(scene, track) {
    this._scene = scene;
    this._track = track;
    for (const feature of track.features) {
      if (feature.type === 'startPosition') this.createVisual(feature);
    }
  }

  /** Dispose all meshes but keep the editor alive — used by _applySnapshot. */
  clearMeshes() {
    for (const m of this._markers) this._disposeMarkerMeshes(m);
    this._markers  = [];
    this._selected = null;
  }

  /** Full cleanup — used by EditorController.deactivate(). */
  dispose() {
    this.clearMeshes();
    this._scene = null;
    this._track = null;
  }

  // ── Visual creation ────────────────────────────────────────────────────────

  createVisual(feature) {
    this._normaliseFeature(feature);
    const marker = { feature, handle: new GizmoHandle(this._scene, 'start'), slots: [], arrow: null };
    this._markers.push(marker);
    this._buildSlots(marker);
    this._positionHandle(marker);
    return marker;
  }

  _normaliseFeature(feature) {
    feature.x          = feature.x ?? 0;
    feature.z          = feature.z ?? 0;
    feature.heading    = feature.heading ?? 0;
    feature.columns    = feature.columns    ?? DEFAULT_START_GRID.columns;
    feature.colSpacing = feature.colSpacing ?? DEFAULT_START_GRID.colSpacing;
    feature.rowSpacing = feature.rowSpacing ?? DEFAULT_START_GRID.rowSpacing;
  }

  _disposeMarkerMeshes(marker) {
    marker.handle?.dispose();
    for (const s of marker.slots) s.dispose();
    marker.slots = [];
    marker.arrow?.dispose();
    marker.arrow = null;
  }

  /**
   * (Re)build the ghost pads + facing arrow. Every property of the feature moves
   * every pad, so edits rebuild the set wholesale rather than patching it.
   */
  _buildSlots(marker) {
    for (const s of marker.slots) s.dispose();
    marker.slots = [];
    marker.arrow?.dispose();

    const mats = EditorMaterials.for(this._scene);
    const { feature } = marker;
    const selected = this._selected === marker;

    for (let i = 0; i < MAX_GRID_SLOTS; i++) {
      const { x, z } = gridSlotXZ(i, feature);
      const pad = MeshBuilder.CreateBox(`edStartSlot_${i}`, {
        width: TRUCK_WIDTH, depth: TRUCK_DEPTH, height: SLOT_THICKNESS,
      }, this._scene);
      pad.position.set(x, this._track.getHeightAt(x, z) + SLOT_LIFT, z);
      pad.rotation.y = feature.heading;
      pad.material = i === 0 ? mats.startGridPole : mats.startGridSlot;
      pad.visibility = selected ? 1 : 0.6;
      pad.isPickable = false;
      marker.slots.push(pad);
    }

    marker.arrow = this._buildArrow(feature);
  }

  /** Flat arrow line from the marker pointing the way the trucks face. */
  _buildArrow(feature) {
    const h = feature.heading;
    const fwdX = Math.sin(h), fwdZ = Math.cos(h);
    const rightX = Math.cos(h), rightZ = -Math.sin(h);
    const len  = TRUCK_DEPTH * 2;
    const barb = TRUCK_DEPTH * 0.5;

    const at = (fwd, side) => {
      const x = feature.x + fwdX * fwd + rightX * side;
      const z = feature.z + fwdZ * fwd + rightZ * side;
      return new Vector3(x, gizmoLineY(this._track, x, z), z);
    };

    const tip = at(len, 0);
    const arrow = MeshBuilder.CreateLineSystem('edStartArrow', {
      lines: [
        [at(0, 0), tip],
        [at(len - barb, -barb * 0.6), tip, at(len - barb, barb * 0.6)],
      ],
    }, this._scene);
    arrow.color = EditorMaterials.for(this._scene).startGridPole.diffuseColor;
    arrow.isPickable = false;
    return arrow;
  }

  _positionHandle(marker) {
    const { x, z } = marker.feature;
    marker.handle.setPosition(x, gizmoY(this._track, x, z), z);
  }

  /** Re-sample gizmo heights after a terrain rebuild (EditorController sweep). */
  refreshGizmoHeights() {
    for (const marker of this._markers) {
      this._positionHandle(marker);
      for (let i = 0; i < marker.slots.length; i++) {
        const { x, z } = gridSlotXZ(i, marker.feature);
        marker.slots[i].position.y = this._track.getHeightAt(x, z) + SLOT_LIFT;
      }
      marker.arrow?.dispose();
      marker.arrow = this._buildArrow(marker.feature);
    }
  }

  /** Global gizmo-visibility toggle (EditorController.setGizmosVisible). */
  setHandlesVisible(visible) {
    for (const marker of this._markers) {
      marker.handle.setVisible(visible);
      for (const s of marker.slots) s.isVisible = visible;
      if (marker.arrow) marker.arrow.isVisible = visible;
    }
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    return this._markers.find(m => m.handle?.mesh === mesh) ?? null;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  select(marker) {
    this._selected = marker;
    marker.handle.setSelected(true);
    for (const s of marker.slots) s.visibility = 1;
    this.editor._rawDragPos = { x: marker.feature.x, z: marker.feature.z };
    this._showProperties(marker);
  }

  deselect() {
    if (this._selected) {
      this._selected.handle.setSelected(false);
      for (const s of this._selected.slots) s.visibility = 0.6;
      this._selected = null;
      this.editor._rawDragPos = null;
    }
    this.hideProperties();
  }

  _showProperties(marker) {
    const s = this.editor._editorStore;
    if (!s) return;
    s.startPosition.rotation   = Math.round((marker.feature.heading ?? 0) * (180 / Math.PI));
    s.startPosition.columns    = marker.feature.columns;
    s.startPosition.colSpacing = marker.feature.colSpacing;
    s.startPosition.rowSpacing = marker.feature.rowSpacing;
    s.selectedType = 'startPosition';
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'startPosition')
      this.editor._editorStore.selectedType = null;
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  move(movement) {
    if (!this._selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    const e = this.editor;
    e.saveSnapshot(true);
    const { feature } = this._selected;
    e._rawDragPos.x += movement.x;
    e._rawDragPos.z += movement.z;
    const prevX = feature.x;
    const prevZ = feature.z;
    feature.x = e._snap(e._rawDragPos.x);
    feature.z = e._snap(e._rawDragPos.z);
    this._buildSlots(this._selected);
    this._positionHandle(this._selected);
    return new Vector3(feature.x - prevX, 0, feature.z - prevZ);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /**
   * A track grids up in exactly one place, so a second marker would be dead
   * weight the race spawner ignores — asking for one selects the existing one.
   */
  addEntity() {
    const e = this.editor;
    e.hideAddMenu();

    if (this._markers.length > 0) {
      e.deselectAll();
      this.select(this._markers[0]);
      console.debug('[StartPositionEditor] Track already has a start position — selected it');
      return;
    }

    const center  = e.viewCenterXZ();
    const feature = {
      type: 'startPosition',
      x: e._snap(center.x),
      z: e._snap(center.z),
      heading: 0,
      ...DEFAULT_START_GRID,
    };
    e.currentTrack.features.push(feature);
    const marker = this.createVisual(feature);
    e.saveSnapshot();
    e.deselectAll();
    this.select(marker);
  }

  deleteSelected() {
    if (!this._selected) return;
    this.editor.saveSnapshot();
    const idx = this.editor.currentTrack.features.indexOf(this._selected.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    this._disposeMarkerMeshes(this._selected);
    const mi = this._markers.indexOf(this._selected);
    if (mi > -1) this._markers.splice(mi, 1);
    this._selected = null;
    this.hideProperties();
  }

  // ── Property changes ───────────────────────────────────────────────────────

  /** Apply a grid-shape change and redraw the pads. */
  _setGridProp(prop, val) {
    if (!this._selected) return;
    this._selected.feature[prop] = val;
    this._buildSlots(this._selected);
    this.editor._editorStore.startPosition[prop] = val;
    this.editor.saveSnapshot(true);
  }

  changeColumns(val)    { this._setGridProp('columns', Math.max(1, Math.round(val))); }
  changeColSpacing(val) { this._setGridProp('colSpacing', val); }
  changeRowSpacing(val) { this._setGridProp('rowSpacing', val); }

  changeRotation(degrees) {
    if (!this._selected) return;
    this._selected.feature.heading = degrees * (Math.PI / 180);
    this._buildSlots(this._selected);
    this.editor._editorStore.startPosition.rotation = degrees;
    this.editor.saveSnapshot(true);
  }

  rotate(rotStep) {
    if (!this._selected) return;
    const currentDeg = this.editor._editorStore.startPosition.rotation ?? 0;
    const newDeg     = ((currentDeg + rotStep * 180 / Math.PI) % 360 + 360) % 360;
    this.changeRotation(newDeg);
  }
}
