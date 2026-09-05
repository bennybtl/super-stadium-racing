import { Vector3, MeshBuilder } from "@babylonjs/core";
import { GizmoHandle } from "./GizmoHandle.js";
import { EditorMaterials } from "./EditorMaterials.js";
import { gizmoY, gizmoLineY } from './gizmo-height.js';
import { TRUCK_WIDTH, TRUCK_DEPTH } from "../constants.js";
import {
  gridSlotXZ,
  startGridLayoutSlot,
  resolvePoleIndex,
  raceIndexFor,
  DEFAULT_START_GRID,
  MAX_GRID_SLOTS,
} from "../utils/start-grid.js";

/**
 * Ghost pads float a truck's body height off the ground rather than hugging it.
 * Hugging the surface made them miserable to click: the pick ray hit the ground
 * mesh first wherever its tessellation rides above the analytic height the pads
 * were placed from (the same burial gizmo-height.js exists to prevent). The lift
 * goes through gizmoY so the pads track terrain edits like every other gizmo.
 */
const SLOT_THICKNESS = 0.2;
const SLOT_CLEARANCE = 0.8;

/**
 * StartPositionEditor — the optional `startPosition` feature: where the field
 * grids up instead of the default two-wide rows behind the start/finish gate.
 *
 * The marker owns a slot layout in one of two modes:
 *   grid   — slots generated from columns + spacings around the marker.
 *   custom — slots are hand-placed positions, each with its own facing; the
 *            marker stays the group handle that drags/turns the whole set.
 *
 * Either way `poleIndex` picks which slot the field's leader starts on, so pole
 * can be the middle of a land-rush row rather than whichever pad the layout
 * happened to emit first.
 *
 * Visuals are editor-only — nothing is built into the raced scene:
 *   • A truck-sized ghost pad per slot, turned to that slot's heading. Pole is
 *     brightest, the selected pad solid.
 *   • An arrow line from the marker showing the grid's facing.
 *   • The shared handle sphere as the marker's own click/drag target.
 *
 * The race spawner reads the same feature through the same slot math
 * (start-grid.js), so the pads are exactly where the trucks will land.
 */
export class StartPositionEditor {
  constructor(editor) {
    /** @type {import('./EditorController.js').EditorController} */
    this.editor    = editor;
    this._markers  = [];   // { feature, handle, slots: Mesh[], arrow: Mesh|null }
    this._selected = null;
    /** Layout index of the selected pad, or -1 when the marker itself is selected. */
    this._selectedSlot = -1;
    this._scene    = null;
    this._track    = null;
  }

  get selected() { return this._selected; }

  get selectedSlot() { return this._selectedSlot; }

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
    this._markers      = [];
    this._selected     = null;
    this._selectedSlot = -1;
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
    feature.mode       = feature.mode === 'custom' ? 'custom' : 'grid';
    feature.columns    = feature.columns    ?? DEFAULT_START_GRID.columns;
    feature.colSpacing = feature.colSpacing ?? DEFAULT_START_GRID.colSpacing;
    feature.rowSpacing = feature.rowSpacing ?? DEFAULT_START_GRID.rowSpacing;
    feature.poleIndex  = resolvePoleIndex(feature);
    if (feature.mode === 'custom') this._ensurePositions(feature);
  }

  /**
   * Materialise the hand-placed layout from wherever the grid currently sits.
   * Custom mode always carries a full field's worth of slots, so there is no
   * add/remove to manage and no race index that can fall off the end.
   */
  _ensurePositions(feature, { reset = false } = {}) {
    if (!reset && Array.isArray(feature.positions) && feature.positions.length === MAX_GRID_SLOTS) return;
    feature.positions = Array.from({ length: MAX_GRID_SLOTS }, (_, i) => {
      const { x, z } = gridSlotXZ(i, feature);
      return { x, z, heading: feature.heading };
    });
  }

  _disposeMarkerMeshes(marker) {
    marker.handle?.dispose();
    for (const s of marker.slots) s.dispose();
    marker.slots = [];
    marker.arrow?.dispose();
    marker.arrow = null;
  }

  /**
   * (Re)build the ghost pads + facing arrow. Nearly every edit moves every pad,
   * so edits rebuild the set wholesale rather than patching it.
   */
  _buildSlots(marker) {
    for (const s of marker.slots) s.dispose();
    marker.slots = [];
    marker.arrow?.dispose();

    const { feature } = marker;
    for (let i = 0; i < MAX_GRID_SLOTS; i++) {
      const slot = startGridLayoutSlot(feature, i);
      const pad = MeshBuilder.CreateBox(`edStartSlot_${i}`, {
        width: TRUCK_WIDTH, depth: TRUCK_DEPTH, height: SLOT_THICKNESS,
      }, this._scene);
      pad.position.set(slot.x, this._padY(slot), slot.z);
      pad.rotation.y = slot.heading;
      pad.isPickable = true;
      marker.slots.push(pad);
    }

    marker.arrow = this._buildArrow(feature);
    this._applySlotVisualState(marker);
  }

  /** Pole brightest, the selected pad solid, everything else faint. */
  _applySlotVisualState(marker) {
    const mats = EditorMaterials.for(this._scene);
    const pole = resolvePoleIndex(marker.feature);
    const markerSelected = this._selected === marker;

    marker.slots.forEach((pad, i) => {
      const isSelected = markerSelected && i === this._selectedSlot;
      pad.material = isSelected ? mats.startGridSelected
        : i === pole ? mats.startGridPole
        : mats.startGridSlot;
      pad.visibility = markerSelected ? 1 : 0.6;
    });
  }

  /** Flat arrow line from the marker pointing the way the grid faces. */
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

  _padY(slot) {
    return gizmoY(this._track, slot.x, slot.z, null, SLOT_CLEARANCE);
  }

  _positionHandle(marker) {
    const { x, z } = marker.feature;
    marker.handle.setPosition(x, gizmoY(this._track, x, z), z);
  }

  /** Re-sample gizmo heights after a terrain rebuild (EditorController sweep). */
  refreshGizmoHeights() {
    for (const marker of this._markers) {
      this._positionHandle(marker);
      marker.slots.forEach((pad, i) => {
        const slot = startGridLayoutSlot(marker.feature, i);
        pad.position.y = this._padY(slot);
      });
      marker.arrow?.dispose();
      marker.arrow = this._buildArrow(marker.feature);
    }
  }

  /** Global gizmo-visibility toggle (EditorController.setGizmosVisible). */
  setHandlesVisible(visible) {
    for (const marker of this._markers) {
      marker.handle.setVisible(visible);
      for (const pad of marker.slots) {
        pad.isVisible  = visible;
        pad.isPickable = visible;
      }
      if (marker.arrow) marker.arrow.isVisible = visible;
    }
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  /** The marker a mesh belongs to — its handle or any of its pads. */
  findByMesh(mesh) {
    return this._markers.find(m => m.handle?.mesh === mesh || m.slots.includes(mesh)) ?? null;
  }

  /** Layout index of the pad `mesh`, or -1 when it is the marker's own handle. */
  _slotIndexForMesh(marker, mesh) {
    return marker.slots.indexOf(mesh);
  }

  /**
   * Pointer selection for the marker handle and its pads. Routed through
   * EditorController._selectViaPointEditor (like the action-zone point handles)
   * so clicking a second pad of an already-selected marker re-selects rather
   * than being swallowed as "already selected".
   *
   * Returns true when the click was consumed by this editor.
   */
  onPointerDown(mesh) {
    const marker = this.findByMesh(mesh);
    if (!marker) return false;

    const slotIndex  = this._slotIndexForMesh(marker, mesh);
    const sameMarker = this._selected === marker;
    if (sameMarker && this._selectedSlot === slotIndex) return true;

    if (!sameMarker) this.editor.deselectAll();
    this.select(marker, slotIndex);
    return true;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  select(marker, slotIndex = -1) {
    this._selected     = marker;
    this._selectedSlot = slotIndex;
    marker.handle.setSelected(true);
    this._applySlotVisualState(marker);
    this.editor._rawDragPos = { ...this._dragOrigin(marker) };
    this._showProperties(marker);
  }

  /** What WASD / a drag moves: the picked pad in custom mode, else the marker. */
  _dragOrigin(marker) {
    if (this._isSlotDrag(marker)) {
      const pos = marker.feature.positions[this._selectedSlot];
      return { x: pos.x, z: pos.z };
    }
    return { x: marker.feature.x, z: marker.feature.z };
  }

  _isSlotDrag(marker = this._selected) {
    return !!marker
      && this._selectedSlot >= 0
      && marker.feature.mode === 'custom'
      && !!marker.feature.positions?.[this._selectedSlot];
  }

  deselect() {
    if (this._selected) {
      this._selected.handle.setSelected(false);
      const marker = this._selected;
      this._selected     = null;
      this._selectedSlot = -1;
      this._applySlotVisualState(marker);
      this.editor._rawDragPos = null;
    }
    this.hideProperties();
  }

  _showProperties(marker) {
    const s = this.editor._editorStore;
    if (!s) return;
    const f = marker.feature;
    const pole = resolvePoleIndex(f);
    s.startPosition.mode         = f.mode;
    s.startPosition.rotation     = Math.round((f.heading ?? 0) * (180 / Math.PI));
    s.startPosition.columns      = f.columns;
    s.startPosition.colSpacing   = f.colSpacing;
    s.startPosition.rowSpacing   = f.rowSpacing;
    s.startPosition.poleIndex    = pole;
    s.startPosition.selectedSlot = this._selectedSlot;
    // 1-based so the panel can say "starts 3rd" instead of leaking the index.
    s.startPosition.slotOrder    = this._selectedSlot >= 0 ? raceIndexFor(this._selectedSlot, pole, f.columns) + 1 : 0;
    s.startPosition.slotRotation = this._selectedSlot >= 0
      ? Math.round((startGridLayoutSlot(f, this._selectedSlot).heading ?? 0) * (180 / Math.PI))
      : 0;
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
    const newX = e._snap(e._rawDragPos.x);
    const newZ = e._snap(e._rawDragPos.z);

    // A picked pad in custom mode moves alone; anything else drags the whole
    // grid — in custom mode that carries the hand-placed slots along with it,
    // so the marker stays the group handle for the layout.
    let prevX, prevZ;
    if (this._isSlotDrag()) {
      const pos = feature.positions[this._selectedSlot];
      prevX = pos.x;
      prevZ = pos.z;
      pos.x = newX;
      pos.z = newZ;
    } else {
      prevX = feature.x;
      prevZ = feature.z;
      const dx = newX - prevX;
      const dz = newZ - prevZ;
      feature.x = newX;
      feature.z = newZ;
      if (feature.mode === 'custom') {
        for (const pos of feature.positions ?? []) { pos.x += dx; pos.z += dz; }
      }
      this._positionHandle(this._selected);
    }

    this._buildSlots(this._selected);
    return new Vector3(newX - prevX, 0, newZ - prevZ);
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
      mode: 'grid',
      poleIndex: 0,
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
    this._selected     = null;
    this._selectedSlot = -1;
    this.hideProperties();
  }

  // ── Property changes ───────────────────────────────────────────────────────

  /** Redraw + resync the panel after any layout change. */
  _applyChange(debounced = true) {
    this._buildSlots(this._selected);
    // A layout change can move whatever the next drag grabs — a mode switch
    // flips it between the pad and the marker, a rotation walks the pads — so
    // the drag origin is re-read rather than left pointing at the old spot.
    this.editor._rawDragPos = { ...this._dragOrigin(this._selected) };
    this._showProperties(this._selected);
    this.editor.saveSnapshot(debounced);
  }

  /**
   * Switch between the generated grid and a hand-placed layout. Going custom
   * seeds the positions from wherever the grid currently sits; coming back to
   * grid keeps them on the feature, so a round trip doesn't throw the hand
   * placement away (Reset Layout is the explicit way to lose it).
   */
  changeMode(val) {
    if (!this._selected) return;
    const mode = val === 'custom' ? 'custom' : 'grid';
    const { feature } = this._selected;
    if (feature.mode === mode) return;

    this.editor.saveSnapshot();
    feature.mode = mode;
    if (mode === 'custom') this._ensurePositions(feature);
    this._applyChange(false);
  }

  /** Re-seed the hand-placed slots from the current grid settings. */
  resetLayout() {
    if (!this._selected || this._selected.feature.mode !== 'custom') return;
    this.editor.saveSnapshot();
    this._ensurePositions(this._selected.feature, { reset: true });
    this._applyChange(false);
  }

  /** Make the selected pad the one the field's leader starts on. */
  setPole() {
    if (!this._selected || this._selectedSlot < 0) return;
    this.editor.saveSnapshot();
    this._selected.feature.poleIndex = this._selectedSlot;
    this._applyChange(false);
  }

  _setGridProp(prop, val) {
    if (!this._selected) return;
    this._selected.feature[prop] = val;
    this._applyChange();
  }

  changeColumns(val)    { this._setGridProp('columns', Math.max(1, Math.round(val))); }
  changeColSpacing(val) { this._setGridProp('colSpacing', val); }
  changeRowSpacing(val) { this._setGridProp('rowSpacing', val); }

  /**
   * Turn the whole grid. In custom mode the hand-placed slots orbit the marker
   * and turn with it, so the layout keeps its shape.
   */
  changeRotation(degrees) {
    if (!this._selected) return;
    const { feature } = this._selected;
    const next  = degrees * (Math.PI / 180);
    const delta = next - feature.heading;
    feature.heading = next;

    if (feature.mode === 'custom') {
      const cos = Math.cos(delta), sin = Math.sin(delta);
      for (const pos of feature.positions ?? []) {
        const dx = pos.x - feature.x;
        const dz = pos.z - feature.z;
        // Rotate about the marker in the same sense as a heading increase.
        pos.x = feature.x + dx * cos + dz * sin;
        pos.z = feature.z - dx * sin + dz * cos;
        pos.heading = (pos.heading ?? 0) + delta;
      }
    }
    this._applyChange();
  }

  /** Turn just the selected pad (custom mode only). */
  changeSlotRotation(degrees) {
    if (!this._isSlotDrag()) return;
    this._selected.feature.positions[this._selectedSlot].heading = degrees * (Math.PI / 180);
    this._applyChange();
  }

  /** Q/E: turns the picked pad in custom mode, otherwise the whole grid. */
  rotate(rotStep) {
    if (!this._selected) return;
    const s = this.editor._editorStore.startPosition;
    const step = rotStep * 180 / Math.PI;
    const wrap = (deg) => ((deg % 360) + 360) % 360;
    if (this._isSlotDrag()) this.changeSlotRotation(wrap((s.slotRotation ?? 0) + step));
    else this.changeRotation(wrap((s.rotation ?? 0) + step));
  }
}
