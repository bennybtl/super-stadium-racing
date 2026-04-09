import { Vector3, Color3 } from "@babylonjs/core";
import { Flag } from "../objects/Flag.js";

export class FlagEditor {
  constructor(editor) {
    this.editor = editor;
    this.scene = null;
    this.track = null;

    this.flags = [];
    this.selectedFlag = null;
  }

  get selected() { return this.selectedFlag; }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  activate(scene, track) {
    this.scene = scene;
    this.track = track;
  }

  /** Clear all flag meshes but keep scene/track alive — used by _applySnapshot. */
  clearMeshes() {
    for (const flag of this.flags) {
      flag.dispose();
    }
    this.flags = [];
    this.selectedFlag = null;
  }

  /** Full cleanup — used by EditorController.deactivate(). */
  dispose() {
    this.clearMeshes();
    this.scene = null;
    this.track = null;
  }

  // ── Visual creation ────────────────────────────────────────────────────────

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

    if (this.selectedFlag && this.selectedFlag !== flagData) {
      this.selectedFlag.flag.material.emissiveColor = new Color3(0, 0, 0);
    }

    this.selectedFlag = flagData;
    this.selectedFlag.flag.material.emissiveColor = new Color3(0.5, 0.5, 0.5);
    this.showProperties(flagData);
  }

  deselect() {
    if (this.selectedFlag) {
      this.selectedFlag.flag.material.emissiveColor = new Color3(0, 0, 0);
      this.selectedFlag = null;
    }
    this.hideProperties();
    this.editor._rawDragPos = null;
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  move(movement) {
    if (!this.selectedFlag || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    const e = this.editor;
    e.saveSnapshot(true);
    const { feature } = this.selectedFlag;
    if (!e._rawDragPos) e._rawDragPos = { x: feature.x, z: feature.z };
    e._rawDragPos.x += movement.x;
    e._rawDragPos.z += movement.z;
    const prevX = feature.x, prevZ = feature.z;
    const newX = e._snap(e._rawDragPos.x);
    const newZ = e._snap(e._rawDragPos.z);
    this._moveSelectedFlag(newX, newZ);
    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  _moveSelectedFlag(x, z) {
    if (!this.selectedFlag) return;
    this.selectedFlag.feature.x = x;
    this.selectedFlag.feature.z = z;
    const groundY = this.track.getHeightAt(x, z);
    this.selectedFlag.moveTo(x, z, groundY);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  deleteSelected() {
    if (!this.selectedFlag) return;

    const index = this.track.features.indexOf(this.selectedFlag.feature);
    if (index > -1) {
      this.track.features.splice(index, 1);
    }

    this.selectedFlag.dispose();
    const flagIndex = this.flags.indexOf(this.selectedFlag);
    if (flagIndex > -1) {
      this.flags.splice(flagIndex, 1);
    }

    this.selectedFlag = null;
    this.hideProperties();
    this.editor.saveSnapshot();
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
    if (!this.selectedFlag) return;
    this.selectedFlag.feature.color = val;
    this.selectedFlag.setColor(val);
    this.editor.saveSnapshot();
  }
}
