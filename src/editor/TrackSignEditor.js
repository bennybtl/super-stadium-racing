import { Vector3 } from "@babylonjs/core";
import { TrackSign } from "../objects/TrackSign.js";
import { GizmoHandle } from "./GizmoHandle.js";
import { TRACK_SIGN_BRANDS } from "../constants.js";

const HANDLE_GAP_Y = 1.0; // handle sphere floats this far above the top of the sign

export class TrackSignEditor {
  constructor(editor) {
    this.editor    = editor;
    this._signs    = [];
    this._handles  = new Map(); // TrackSign -> GizmoHandle
    this._selected = null;
    this._scene    = null;
    this._track    = null;
  }

  get selected() { return this._selected; }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  activate(scene, track) {
    this._scene = scene;
    this._track = track;
    this.createVisualsForTrack(track);
  }

  /** Dispose all meshes but keep the editor alive — used by _applySnapshot. */
  clearMeshes() {
    for (const s of this._signs) s.dispose();
    for (const h of this._handles.values()) h.dispose();
    this._handles.clear();
    this._signs    = [];
    this._selected = null;
  }

  /** Full cleanup — used by EditorController.deactivate(). */
  dispose() {
    this.clearMeshes();
    this._scene = null;
    this._track = null;
  }

  // ── Visual creation ────────────────────────────────────────────────────────

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'trackSign') this.createVisual(feature);
    }
  }

  createVisual(feature) {
    const groundY = this._track.getHeightAt(feature.x, feature.z);
    const sign = new TrackSign(feature, groundY, this._scene);
    this._signs.push(sign);

    const handle = new GizmoHandle(this._scene, 'sign');
    this._handles.set(sign, handle);
    this._positionHandle(sign);
    return sign;
  }

  /** Park the handle just above the sign's top, tracking scale / height offset. */
  _positionHandle(sign) {
    const { x, z } = sign.feature;
    this._handles.get(sign)?.setPosition(x, sign.topY + HANDLE_GAP_Y, z);
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  /** Global gizmo-visibility toggle (EditorController.setGizmosVisible). */
  setHandlesVisible(visible) {
    for (const h of this._handles.values()) h.setVisible(visible);
  }

  findByMesh(mesh) {
    return this._signs.find(s => s.containsMesh(mesh) || this._handles.get(s)?.mesh === mesh) ?? null;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  select(signObj) {
    this._selected = signObj;
    this._handles.get(signObj)?.setSelected(true);
    this.editor._rawDragPos = { x: signObj.feature.x, z: signObj.feature.z };
    const s = this.editor._editorStore;
    if (!s) return;
    s.trackSign.name     = signObj.feature.name ?? 'Track Name';
    s.trackSign.rotation = Math.round((signObj.feature.rotation ?? 0) * (180 / Math.PI));
    s.trackSign.contentType = signObj.feature.contentType ?? 'text';
    s.trackSign.brandImage = signObj.feature.brandImage ?? TRACK_SIGN_BRANDS[0].value;
    s.trackSign.background = signObj.feature.background ?? 'black';
    s.trackSign.primaryColor = signObj.feature.primaryColor ?? 'red';
    s.trackSign.scale = signObj.feature.scale ?? 1;
    s.trackSign.heightOffset = signObj.feature.heightOffset ?? 0;
    s.trackSign.width = signObj.feature.width ?? 10;
    s.selectedType = 'trackSign';
  }

  deselect() {
    if (this._selected) this._handles.get(this._selected)?.setSelected(false);
    this._selected = null;
    this.editor._rawDragPos = null;
    this.hideProperties();
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'trackSign')
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
    const prevX   = feature.x;
    const prevZ   = feature.z;
    const newX    = e._snap(e._rawDragPos.x);
    const newZ    = e._snap(e._rawDragPos.z);
    const groundY = this._track.getHeightAt(newX, newZ);
    this._selected.moveTo(newX, newZ, groundY);
    this._positionHandle(this._selected);
    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  addEntity() {
    const e         = this.editor;
    const camTarget = e.camera.getTarget();
    const newX      = camTarget.x;
    const newZ      = camTarget.z;
    const feature   = {
      type: 'trackSign',
      x: newX,
      z: newZ,
      name: 'Track Name',
      rotation: 0,
      contentType: 'text',
      brandImage: TRACK_SIGN_BRANDS[0].value,
      background: 'black',
      primaryColor: 'red',
      scale: 1,
      heightOffset: 0,
      width: 10,
    };
    e.currentTrack.features.push(feature);
    const sign = this.createVisual(feature);
    e.saveSnapshot();
    e.deselectAll();
    this.select(sign);
    e.hideAddMenu();
  }

  deleteSelected() {
    if (!this._selected) return;
    this.editor.saveSnapshot();
    const idx = this.editor.currentTrack.features.indexOf(this._selected.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    this._selected.dispose();
    this._handles.get(this._selected)?.dispose();
    this._handles.delete(this._selected);
    const si = this._signs.indexOf(this._selected);
    if (si > -1) this._signs.splice(si, 1);
    this._selected = null;
    this.hideProperties();
  }

  duplicateSelected() {
    if (!this._selected) return;
    this.editor.saveSnapshot();
    const src = this._selected.feature;
    const newFeature = { ...src, x: src.x + 3, z: src.z + 3 };
    this.editor.currentTrack.features.push(newFeature);
    const sign = this.createVisual(newFeature);
    this.deselect();
    this.select(sign);
  }

  // ── Property changes ────────────────────────────────────────────────────────

  changeName(val) {
    if (!this._selected) return;
    this._selected.setName(val);
    this.editor._editorStore.trackSign.name = val;
    this.editor.saveSnapshot(true);
  }

  changeContentType(val) {
    if (!this._selected) return;
    const next = val === 'brand' ? 'brand' : 'text';
    this._selected.setContentType(next);
    this.editor._editorStore.trackSign.contentType = next;
    this.editor.saveSnapshot(true);
  }

  changeBrandImage(val) {
    if (!this._selected) return;
    this._selected.setBrandImage(val);
    this.editor._editorStore.trackSign.brandImage = val;
    this.editor.saveSnapshot(true);
  }

  changeBackground(val) {
    if (!this._selected) return;
    this._selected.setBackground(val);
    this.editor._editorStore.trackSign.background = val;
    this.editor.saveSnapshot(true);
  }

  changePrimaryColor(val) {
    if (!this._selected) return;
    this._selected.setPrimaryColor(val);
    this.editor._editorStore.trackSign.primaryColor = val;
    this.editor.saveSnapshot(true);
  }

  changeScale(val) {
    if (!this._selected) return;
    this._selected.setScale(val);
    this._positionHandle(this._selected);
    this.editor._editorStore.trackSign.scale = val;
    this.editor.saveSnapshot(true);
  }

  changeHeightOffset(val) {
    if (!this._selected) return;
    const g = this.editor.terrainQuery.heightAt(this._selected.feature.x, this._selected.feature.z);
    this._selected.setHeightOffset(val, g);
    this._positionHandle(this._selected);
    this.editor._editorStore.trackSign.heightOffset = val;
    this.editor.saveSnapshot(true);
  }

  changeWidth(val) {
    if (!this._selected) return;
    this._selected.setWidth(val);
    this.editor._editorStore.trackSign.width = val;
    this.editor.saveSnapshot(true);
  }

  changeRotation(degrees) {
    if (!this._selected) return;
    this._selected.setRotation(degrees * (Math.PI / 180));
    this.editor._editorStore.trackSign.rotation = degrees;
    this.editor.saveSnapshot(true);
  }

  rotate(rotStep) {
    if (!this._selected) return;
    const currentDeg = this.editor._editorStore.trackSign.rotation ?? 0;
    const newDeg     = ((currentDeg + rotStep * 180 / Math.PI) % 360 + 360) % 360;
    this.changeRotation(newDeg);
  }
}
