import { Vector3 } from "@babylonjs/core";
import { FlagTool } from "../managers/FlagTool.js";

export class FlagEditor {
  constructor(editor) {
    this.editor = editor;
    this._tool = null; // created in activate()
  }

  get selected() { return this._tool?.getSelectedFlag() ?? null; }
  get flags()    { return this._tool?.flags ?? []; }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  activate(scene, track) {
    this._tool = new FlagTool(scene, track, this.editor);
  }

  /** Clear all flag meshes but keep the tool alive — used by _applySnapshot. */
  clearMeshes() {
    this._tool?.dispose();
  }

  /** Full cleanup — used by EditorController.deactivate(). */
  dispose() {
    this._tool?.dispose();
    this._tool = null;
  }

  // ── Visual creation ────────────────────────────────────────────────────────

  createVisual(feature) {
    this._tool?._createFlagMesh(feature);
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    return this._tool?.flags.find(f => f.pole === mesh || f.flag === mesh) ?? null;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  select(mesh) { this._tool?.selectFlag(mesh); }

  deselect() {
    this._tool?.deselectFlag();
    this.editor._rawDragPos = null;
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  move(movement) {
    const selectedFlag = this._tool?.getSelectedFlag();
    if (!selectedFlag || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    const e = this.editor;
    e.saveSnapshot(true);
    const { feature } = selectedFlag;
    if (!e._rawDragPos) e._rawDragPos = { x: feature.x, z: feature.z };
    e._rawDragPos.x += movement.x;
    e._rawDragPos.z += movement.z;
    const prevX = feature.x, prevZ = feature.z;
    const newX = e._snap(e._rawDragPos.x);
    const newZ = e._snap(e._rawDragPos.z);
    this._tool.moveSelectedFlag(newX, newZ);
    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  deleteSelected() { this._tool?.removeSelectedFlag(); }

  addEntity() {
    const e = this.editor;
    const camPos    = e.camera.position;
    const camTarget = e.camera.target;
    const direction = camTarget.subtract(camPos).normalize();
    const newX = camPos.x + direction.x * 20;
    const newZ = camPos.z + direction.z * 50;
    e.saveSnapshot();
    this._tool.addFlag(newX, newZ);
    e.deselectAll();
    e.hideAddMenu();
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

  // Vue bridge
  changeColor(val) { this._tool?.updateSelectedFlagColor(val); }
}
