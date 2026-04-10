import { Vector3 } from "@babylonjs/core";
import { BannerString } from "../objects/BannerString.js";

/**
 * BannerStringEditor — editor tool for placing and editing banner string features.
 * Follows the same pattern as TrackSignEditor / FlagEditor.
 */
export class BannerStringEditor {
  constructor(editor) {
    /** @type {import('./EditorController.js').EditorController} */
    this.editor    = editor;
    this._banners  = [];
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
    for (const b of this._banners) b.dispose();
    this._banners  = [];
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
      if (feature.type === 'bannerString') this.createVisual(feature);
    }
  }

  createVisual(feature) {
    const groundY = this._track.getHeightAt(feature.x, feature.z);
    // No shadows in editor mode
    const banner = new BannerString(feature, groundY, this._scene, null);
    this._banners.push(banner);
    return banner;
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    return this._banners.find(b => b.containsMesh(mesh)) ?? null;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  select(banner) {
    this._selected = banner;
    this.editor._rawDragPos = { x: banner.feature.x, z: banner.feature.z };
    const s = this.editor._editorStore;
    if (!s) return;
    s.bannerString.width      = banner.feature.width;
    s.bannerString.poleHeight = banner.feature.poleHeight ?? 4.2;
    s.bannerString.heading    = +((banner.feature.heading ?? 0) * 180 / Math.PI).toFixed(1);
    s.selectedType = "bannerString";
  }

  deselect() {
    this._selected = null;
    this.editor._rawDragPos = null;
    this.hideProperties();
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === "bannerString")
      this.editor._editorStore.selectedType = null;
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  move(movement) {
    if (!this._selected || (movement.x === 0 && movement.z === 0)) {
      return new Vector3(0, 0, 0);
    }
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

  // ── Rotation (called from EditorController.update() via Q/E keys) ──────────

  rotate(angleDelta) {
    if (!this._selected) return;
    this.editor.saveSnapshot(true);
    const newHeading = (this._selected.feature.heading ?? 0) + angleDelta;
    this._selected.setHeading(newHeading);
    const s = this.editor._editorStore;
    if (s) s.bannerString.heading = +(newHeading * 180 / Math.PI).toFixed(1);
  }

  // ── Property changes ────────────────────────────────────────────────────────

  changeWidth(val) {
    if (!this._selected) return;
    this.editor.saveSnapshot(true);
    this._selected.setWidth(val);
  }

  changePoleHeight(val) {
    if (!this._selected) return;
    this.editor.saveSnapshot(true);
    this._selected.setPoleHeight(val);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  addEntity() {
    const e         = this.editor;
    const camPos    = e.camera.position;
    const camTarget = e.camera.target;
    const direction = camTarget.subtract(camPos).normalize();
    const newX      = camPos.x + direction.x * 20;
    const newZ      = camPos.z + direction.z * 50;
    const feature   = { type: "bannerString", x: newX, z: newZ, heading: 0, width: 8, poleHeight: 4.2 };
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
    const bi = this._banners.indexOf(this._selected);
    if (bi > -1) this._banners.splice(bi, 1);
    this._selected = null;
    this.hideProperties();
  }
}
