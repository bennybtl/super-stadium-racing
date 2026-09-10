import { Vector3 } from "@babylonjs/core";
import { TrackLight, TRACK_LIGHT_DEFAULTS, MAX_TRACK_LIGHTS } from "../objects/TrackLight.js";
import { GizmoHandle } from "./GizmoHandle.js";

const HANDLE_GAP_Y = 1.0; // handle sphere floats this far above the light head

export class TrackLightEditor {
  constructor(editor) {
    this.editor = editor;
    this._lights = [];
    this._handles = new Map(); // TrackLight -> GizmoHandle
    this._selected = null;
    this._scene = null;
    this._track = null;
  }

  get selected() { return this._selected; }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  activate(scene, track) {
    this._scene = scene;
    this._track = track;
    this.createVisualsForTrack(track);
  }

  clearMeshes() {
    for (const l of this._lights) l.dispose();
    for (const h of this._handles.values()) h.dispose();
    this._handles.clear();
    this._lights = [];
    this._selected = null;
    this._syncCount();
  }

  /** Mirror the placed-light count into the panel (drives the "N / max" hint
   *  and disables Duplicate at the cap). */
  _syncCount() {
    const s = this.editor._editorStore;
    if (s) s.trackLight.count = this._lights.length;
  }

  dispose() {
    this.clearMeshes();
    this._scene = null;
    this._track = null;
  }

  // ── Visual creation ────────────────────────────────────────────────────────

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'trackLight') this.createVisual(feature);
    }
  }

  createVisual(feature) {
    const groundY = this._track.getHeightAt(feature.x, feature.z);
    const light = new TrackLight(feature, groundY, this._scene, this.editor._shadows);
    this._lights.push(light);

    const handle = new GizmoHandle(this._scene, 'decoration');
    this._handles.set(light, handle);
    this._positionHandle(light);
    this._syncCount();
    return light;
  }

  _positionHandle(light) {
    const { x, z } = light.feature;
    this._handles.get(light)?.setPosition(x, light.topY + HANDLE_GAP_Y, z);
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  setHandlesVisible(visible) {
    for (const h of this._handles.values()) h.setVisible(visible);
  }

  /** Mirror the editor's night-preview toggle onto every placed light. */
  setNight(on) {
    for (const l of this._lights) l.setNight(on);
  }

  findByMesh(mesh) {
    return this._lights.find(l => l.containsMesh(mesh) || this._handles.get(l)?.mesh === mesh) ?? null;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  select(lightObj) {
    this._selected = lightObj;
    this._handles.get(lightObj)?.setSelected(true);
    this.editor._rawDragPos = { x: lightObj.feature.x, z: lightObj.feature.z };
    const s = this.editor._editorStore;
    if (!s) return;
    s.trackLight.height    = lightObj.feature.height    ?? TRACK_LIGHT_DEFAULTS.height;
    s.trackLight.spread    = lightObj.feature.spread    ?? TRACK_LIGHT_DEFAULTS.spread;
    s.trackLight.intensity = lightObj.feature.intensity ?? TRACK_LIGHT_DEFAULTS.intensity;
    s.trackLight.color     = lightObj.feature.color     ?? TRACK_LIGHT_DEFAULTS.color;
    s.trackLight.tilt      = lightObj.feature.tilt      ?? TRACK_LIGHT_DEFAULTS.tilt;
    s.trackLight.rotation  = lightObj.feature.rotation  ?? TRACK_LIGHT_DEFAULTS.rotation;
    s.trackLight.count     = this._lights.length;
    s.selectedType = 'trackLight';
  }

  deselect() {
    if (this._selected) {
      this._handles.get(this._selected)?.setSelected(false);
      this._selected = null;
      this.editor._rawDragPos = null;
    }
    this.hideProperties();
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'trackLight')
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
    const newX = e._snap(e._rawDragPos.x);
    const newZ = e._snap(e._rawDragPos.z);
    const groundY = this._track.getHeightAt(newX, newZ);
    this._selected.moveTo(newX, newZ, groundY);
    this._positionHandle(this._selected);
    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /** True once the track is at the per-track light cap (see MAX_TRACK_LIGHTS). */
  get atLimit() { return this._lights.length >= MAX_TRACK_LIGHTS; }

  addEntity() {
    const e = this.editor;
    if (this.atLimit) {
      console.warn(`[TrackLight] limit reached — ${MAX_TRACK_LIGHTS} track lights per track.`);
      e.hideAddMenu();
      return;
    }
    const camTarget = e.camera.getTarget();
    const feature = {
      type: 'trackLight',
      x: camTarget.x,
      z: camTarget.z,
      ...TRACK_LIGHT_DEFAULTS,
    };
    e.currentTrack.features.push(feature);
    const light = this.createVisual(feature);
    e.saveSnapshot();
    e.deselectAll();
    this.select(light);
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
    const li = this._lights.indexOf(this._selected);
    if (li > -1) this._lights.splice(li, 1);
    this._selected = null;
    this._syncCount();
    this.hideProperties();
  }

  duplicateSelected() {
    if (!this._selected) return;
    if (this.atLimit) {
      console.warn(`[TrackLight] limit reached — ${MAX_TRACK_LIGHTS} track lights per track.`);
      return;
    }
    this.editor.saveSnapshot();
    const src = this._selected.feature;
    const newFeature = { ...src, x: src.x + 3, z: src.z + 3 };
    this.editor.currentTrack.features.push(newFeature);
    const light = this.createVisual(newFeature);
    this.deselect();
    this.select(light);
  }

  // ── Property changes ─────────────────────────────────────────────────────────

  changeHeight(val) {
    if (!this._selected) return;
    this._selected.setHeight(val);
    this._positionHandle(this._selected);
    this.editor._editorStore.trackLight.height = val;
    this.editor.saveSnapshot(true);
  }

  changeSpread(val) {
    if (!this._selected) return;
    this._selected.setSpread(val);
    this.editor._editorStore.trackLight.spread = val;
    this.editor.saveSnapshot(true);
  }

  changeTilt(val) {
    if (!this._selected) return;
    this._selected.setTilt(val);
    this.editor._editorStore.trackLight.tilt = val;
    this.editor.saveSnapshot(true);
  }

  changeRotation(degrees) {
    if (!this._selected) return;
    const deg = ((degrees % 360) + 360) % 360;
    this._selected.setRotation(deg);
    this.editor._editorStore.trackLight.rotation = deg;
    this.editor.saveSnapshot(true);
  }

  /** Q/E nudge while selected — rotStep is in radians (see EditorController). */
  rotate(rotStep) {
    if (!this._selected) return;
    const cur = this.editor._editorStore.trackLight.rotation ?? 0;
    this.changeRotation(cur + rotStep * 180 / Math.PI);
  }

  changeIntensity(val) {
    if (!this._selected) return;
    this._selected.setIntensity(val);
    this.editor._editorStore.trackLight.intensity = val;
    this.editor.saveSnapshot(true);
  }

  changeColor(val) {
    if (!this._selected) return;
    this._selected.setColor(val);
    this.editor._editorStore.trackLight.color = val;
    this.editor.saveSnapshot(true);
  }
}
