import { Vector3 } from "@babylonjs/core";
import { TrackSign, TRACK_SIGN_BRANDS } from "../objects/TrackSign.js";

export class TrackSignEditor {
  constructor(editor) {
    this.editor    = editor;
    this._signs    = [];
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
    return sign;
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    return this._signs.find(s => s.containsMesh(mesh)) ?? null;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  select(signObj) {
    this._selected = signObj;
    this.editor._rawDragPos = { x: signObj.feature.x, z: signObj.feature.z };
    const s = this.editor._editorStore;
    if (!s) return;
    s.trackSign.name     = signObj.feature.name ?? 'Track Name';
    s.trackSign.rotation = Math.round((signObj.feature.rotation ?? 0) * (180 / Math.PI));
    s.trackSign.contentType = signObj.feature.contentType ?? 'text';
    s.trackSign.brandImage = signObj.feature.brandImage ?? TRACK_SIGN_BRANDS[0];
    s.trackSign.background = signObj.feature.background ?? 'black';
    s.trackSign.scale = signObj.feature.scale ?? 1;
    s.trackSign.heightOffset = signObj.feature.heightOffset ?? 0;
    s.trackSign.width = signObj.feature.width ?? 10;
    s.selectedType = 'trackSign';
  }

  deselect() {
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
    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  addEntity() {
    const e         = this.editor;
    const camPos    = e.camera.position;
    const camTarget = e.camera.target;
    const direction = camTarget.subtract(camPos).normalize();
    const newX      = camPos.x + direction.x * 20;
    const newZ      = camPos.z + direction.z * 50;
    const feature   = {
      type: 'trackSign',
      x: newX,
      z: newZ,
      name: 'Track Name',
      rotation: 0,
      contentType: 'text',
      brandImage: TRACK_SIGN_BRANDS[0],
      background: 'black',
      scale: 1,
      heightOffset: 0,
      width: 10,
    };
    e.currentTrack.features.push(feature);
    this.createVisual(feature);
    e.saveSnapshot();
    e.deselectAll();
    e.hideAddMenu();
  }

  deleteSelected() {
    if (!this._selected) return;
    this.editor.saveSnapshot();
    const idx = this.editor.currentTrack.features.indexOf(this._selected.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    this._selected.dispose();
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
    const next = val === 'white' ? 'white' : 'black';
    this._selected.setBackground(next);
    this.editor._editorStore.trackSign.background = next;
    this.editor.saveSnapshot(true);
  }

  changeScale(val) {
    if (!this._selected) return;
    this._selected.setScale(val);
    this.editor._editorStore.trackSign.scale = val;
    this.editor.saveSnapshot(true);
  }

  changeHeightOffset(val) {
    if (!this._selected) return;
    const g = this.editor.terrainQuery.heightAt(this._selected.feature.x, this._selected.feature.z);
    this._selected.setHeightOffset(val, g);
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
