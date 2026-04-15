import { Vector3, Color3 } from "@babylonjs/core";
import { Flag } from "../objects/Flag.js";

export class FlagEditor {
  constructor(editor) {
    this.editor = editor;
    this.scene = null;
    this.track = null;

    this.flags = [];
    this._selected = null;
  }

  get selected() { return this._selected; }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  activate(scene, track) {
    this.scene = scene;
    this.track = track;
    this.createVisualsForTrack(track);
  }

  /** Clear all flag meshes but keep scene/track alive — used by _applySnapshot. */
  clearMeshes() {
    for (const flag of this.flags) {
      flag.dispose();
    }
    this.flags = [];
    this._selected = null;
  }

  /** Full cleanup — used by EditorController.deactivate(). */
  dispose() {
    this.clearMeshes();
    this.scene = null;
    this.track = null;
  }

  // ── Visual creation ────────────────────────────────────────────────────────

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'flag') this._createFlagMesh(feature);
    }
  }

  createVisual(feature) {
    this._createFlagMesh(feature);
  }

  _createFlagMesh(feature) {
    const { x, z, color } = feature;
    const groundY = this.track.getHeightAt(x, z);
    const flag = new Flag(x, z, color, groundY, this.scene, null);
    flag.feature = feature;
    this.flags.push(flag);
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    return this.flags.find(f => f.containsMesh(mesh)) ?? null;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  select(mesh) {
    const flagData = this.flags.find(f => f.containsMesh(mesh));
    if (!flagData) return;

    if (this._selected && this._selected !== flagData) {
      this._selected.flag.material.emissiveColor = EMISSIVE_BLACK;
    }

    this._selected = flagData;
    this.editor._rawDragPos = { x: flagData.feature.x, z: flagData.feature.z };
    this._selected.flag.material.emissiveColor = EMISSIVE_GREY;
    this.showProperties(flagData);
  }

  deselect() {
    if (this._selected) {
      this._selected.flag.material.emissiveColor = EMISSIVE_BLACK;
      this._selected = null;
    }
    this.hideProperties();
    this.editor._rawDragPos = null;
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  move(movement) {
    if (!this._selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    const e = this.editor;
    e.saveSnapshot(true);
    const { feature } = this._selected;
    e._rawDragPos.x += movement.x;
    e._rawDragPos.z += movement.z;
    const prevX = feature.x, prevZ = feature.z;
    const newX = e._snap(e._rawDragPos.x);
    const newZ = e._snap(e._rawDragPos.z);
    this._moveSelectedFlag(newX, newZ);
    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  _moveSelectedFlag(x, z) {
    if (!this._selected) return;
    this._selected.feature.x = x;
    this._selected.feature.z = z;
    const groundY = this.track.getHeightAt(x, z);
    this._selected.moveTo(x, z, groundY);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  deleteSelected() {
    if (!this._selected) return;
    this.editor.saveSnapshot();

    const index = this.track.features.indexOf(this._selected.feature);
    if (index > -1) {
      this.track.features.splice(index, 1);
    }

    this._selected.dispose();
    const flagIndex = this.flags.indexOf(this._selected);
    if (flagIndex > -1) {
      this.flags.splice(flagIndex, 1);
    }

    this._selected = null;
    this.hideProperties();
  }

  duplicateSelected() {
    if (!this._selected) return;
    this.editor.saveSnapshot();
    const src = this._selected.feature;
    const newFeature = { ...src, x: src.x + 3, z: src.z + 3 };
    this.track.features.push(newFeature);
    this._createFlagMesh(newFeature);
    const newFlagData = this.flags[this.flags.length - 1];
    this.deselect();
    if (newFlagData?.flag) this.select(newFlagData.flag);
  }

  addEntity() {
    const e = this.editor;
    const camPos    = e.camera.position;
    const camTarget = e.camera.target;
    const direction = camTarget.subtract(camPos).normalize();
    const newX = camPos.x + direction.x * 20;
    const newZ = camPos.z + direction.z * 50;
    e.saveSnapshot();
    this._addFlag(e._snap(newX), e._snap(newZ));
    e.deselectAll();
    e.hideAddMenu();
  }

  _addFlag(x, z) {
    const color = this.editor._editorStore?.flag?.color || 'red';
    const feature = { type: "flag", x, z, color };
    this.track.features.push(feature);
    this._createFlagMesh(feature);
    this.editor.saveSnapshot();
  }

  // ── Properties (Vue store bridge) ──────────────────────────────────────────

  showProperties(flagData) {
    const s = this.editor._editorStore;
    if (!s) return;
    s.flag.color = flagData.feature.color;
    s.selectedType = 'flag';
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'flag')
      this.editor._editorStore.selectedType = null;
  }

  changeColor(val) {
    if (!this._selected) return;
    this._selected.feature.color = val;
    this._selected.setColor(val);
    this.editor.saveSnapshot();
  }
}
