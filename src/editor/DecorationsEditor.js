import { Vector3, Color3 } from "@babylonjs/core";
import { Flag } from "../objects/Flag.js";
import { BannerString } from "../objects/BannerString.js";
import { ModelDecoration } from "../objects/ModelDecoration.js";
import { modelIdForFeature, defForFeature, getDecorationLoader } from "../decorations-registry.js";
import { GizmoHandle } from "./GizmoHandle.js";

const HANDLE_POS_Y = 3.0; // fallback height above ground for decorations with no known top
const HANDLE_GAP_Y = 1.0; // gap above a decoration that reports its own topY

const EMISSIVE_BLACK = new Color3(0, 0, 0);
const EMISSIVE_GREY  = new Color3(0.4, 0.4, 0.4);

export class DecorationsEditor {
  constructor(editor) {
    this.editor = editor;
    this.scene = null;
    this.track = null;
    this.flags = [];
    this.banners = [];
    this.models = [];
    this._handles = new Map(); // decoration -> GizmoHandle
    this._selected = null;
  }

  get selected() { return this._selected; }

  /** True when a feature is a model decoration (tent/tree/etc, incl. legacy). */
  isModelFeature(feature) {
    return modelIdForFeature(feature) !== null;
  }

  activate(scene, track) {
    this.scene = scene;
    this.track = track;
    this.createVisualsForTrack(track);
  }

  clearMeshes() {
    for (const flag of this.flags) flag.dispose();
    for (const banner of this.banners) banner.dispose();
    for (const model of this.models) model.dispose();
    for (const h of this._handles.values()) h.dispose();
    this.flags = [];
    this.banners = [];
    this.models = [];
    this._handles.clear();
    this._selected = null;
  }

  dispose() {
    this.clearMeshes();
    this.scene = null;
    this.track = null;
  }

  createVisualsForTrack(track) {
    for (const feature of track.features) this.createVisual(feature);
  }

  createVisual(feature) {
    let decoration = null;
    if (feature.type === 'flag') decoration = this._createFlag(feature);
    else if (feature.type === 'bannerString') decoration = this._createBanner(feature);
    else if (this.isModelFeature(feature)) decoration = this._createModel(feature);
    if (decoration) this._attachHandle(decoration);
    return decoration;
  }

  /** Give a decoration its pickable handle sphere. */
  _attachHandle(decoration) {
    this._handles.set(decoration, new GizmoHandle(this.scene, 'decoration'));
    this._positionHandle(decoration);
  }

  /**
   * Park the handle above the decoration. Types that know their own height
   * (banner strings) sit just over the top so the handle clears the rope;
   * flags and models fall back to a fixed offset above the ground.
   */
  _positionHandle(decoration) {
    const { x, z } = decoration.feature;
    const y = typeof decoration.topY === 'number'
      ? decoration.topY + HANDLE_GAP_Y
      : this.track.getHeightAt(x, z) + HANDLE_POS_Y;
    this._handles.get(decoration)?.setPosition(x, y, z);
  }

  _createFlag(feature) {
    const { x, z, color } = feature;
    const groundY = this.track.getHeightAt(x, z);
    const flag = new Flag(x, z, color, groundY, this.scene, null);
    flag.feature = feature;
    this.flags.push(flag);
    return flag;
  }

  _createBanner(feature) {
    const { x, z } = feature;
    const groundY = this.track.getHeightAt(x, z);
    const banner = new BannerString(feature, groundY, this.scene, null);
    banner.feature = feature;
    this.banners.push(banner);
    return banner;
  }

  _createModel(feature) {
    const def = defForFeature(feature);
    if (!def) return null;
    const { x, z } = feature;
    const groundY = this.track.getHeightAt(x, z);
    // Model decorations are solid props, so let them cast shadows in the editor too.
    const model = new ModelDecoration(feature, def, groundY, this.scene, this.editor._shadows ?? null);
    model.feature = feature;
    this.models.push(model);
    return model;
  }

  /** The visual list that owns decorations of the given feature. */
  _listFor(feature) {
    if (feature.type === 'flag') return this.flags;
    if (feature.type === 'bannerString') return this.banners;
    return this.models;
  }

  /** Dispose a decoration's meshes and drop it from its owning list. */
  _removeVisual(decoration) {
    decoration.dispose();
    this._handles.get(decoration)?.dispose();
    this._handles.delete(decoration);
    const list = this._listFor(decoration.feature);
    const idx = list.indexOf(decoration);
    if (idx > -1) list.splice(idx, 1);
  }

  /** Global gizmo-visibility toggle (EditorController.setGizmosVisible). */
  setHandlesVisible(visible) {
    for (const h of this._handles.values()) h.setVisible(visible);
  }

  findByMesh(mesh) {
    for (const [decoration, handle] of this._handles) {
      if (handle.mesh === mesh) return decoration;
    }
    return this.flags.find(f => f.containsMesh(mesh))
      ?? this.banners.find(b => b.containsMesh(mesh))
      ?? this.models.find(m => m.containsMesh(mesh))
      ?? null;
  }

  select(featureData) {
    if (!featureData) return;

    if (this._selected && this._selected !== featureData && this._selected.feature.type === 'flag') {
      this._selected.flag.material.emissiveColor = EMISSIVE_BLACK;
    }

    this._selected = featureData;
    this._handles.get(featureData)?.setSelected(true);
    this.editor._rawDragPos = { x: featureData.feature.x, z: featureData.feature.z };

    const s = this.editor._editorStore;
    if (!s) return;

    const feature = featureData.feature;
    if (feature.type === 'flag') {
      s.decoration.type = 'flag';
      s.decoration.model = null;
      s.decoration.color = feature.color;
      featureData.flag.material.emissiveColor = EMISSIVE_GREY;
    } else if (feature.type === 'bannerString') {
      s.decoration.type = 'bannerString';
      s.decoration.model = null;
      s.decoration.width      = feature.width;
      s.decoration.poleHeight = feature.poleHeight ?? 4.2;
      s.decoration.heading    = +((feature.heading ?? 0) * 180 / Math.PI).toFixed(1);
    } else {
      // Model decoration (tent, tree, …).
      const def = defForFeature(feature);
      s.decoration.type    = 'model';
      s.decoration.model   = modelIdForFeature(feature);
      s.decoration.color   = feature.color ?? def?.defaultColor ?? 'white';
      s.decoration.heading = +((feature.heading ?? 0) * 180 / Math.PI).toFixed(1);
      s.decoration.scale   = +(feature.scale ?? def?.defaultScale ?? 1).toFixed(1);
    }
    s.selectedType = 'decoration';
  }

  deselect() {
    if (this._selected?.feature.type === 'flag') {
      this._selected.flag.material.emissiveColor = EMISSIVE_BLACK;
    }
    if (this._selected) this._handles.get(this._selected)?.setSelected(false);
    this._selected = null;
    this.editor._rawDragPos = null;
    this.hideProperties();
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'decoration') {
      this.editor._editorStore.selectedType = null;
    }
  }

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

    this._selected.feature.x = newX;
    this._selected.feature.z = newZ;
    const groundY = this.track.getHeightAt(newX, newZ);
    this._selected.moveTo(newX, newZ, groundY);
    this._positionHandle(this._selected);

    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  rotate(angleDelta) {
    // Flags stand straight up; only heading-bearing decorations rotate.
    if (!this._selected || this._selected.feature.type === 'flag') return;
    this.editor.saveSnapshot(true);
    const newHeading = (this._selected.feature.heading ?? 0) + angleDelta;
    this._selected.setHeading(newHeading);
    const s = this.editor._editorStore;
    if (s) s.decoration.heading = +(newHeading * 180 / Math.PI).toFixed(1);
  }

  changeColor(val) {
    // Flags and model decorations carry a color; banner strings do not.
    if (!this._selected || this._selected.feature.type === 'bannerString') return;
    this.editor.saveSnapshot(true);
    this._selected.feature.color = val;
    this._selected.setColor(val);
  }

  changeScale(val) {
    if (!this._selected || this._selected.feature.type !== 'model') return;
    this.editor.saveSnapshot(true);
    this._selected.setScale(val);
  }

  changeWidth(val) {
    if (!this._selected || this._selected.feature.type !== 'bannerString') return;
    this.editor.saveSnapshot(true);
    this._selected.setWidth(val);
  }

  changePoleHeight(val) {
    if (!this._selected || this._selected.feature.type !== 'bannerString') return;
    this.editor.saveSnapshot(true);
    this._selected.setPoleHeight(val);
    this._positionHandle(this._selected);
  }

  changeHeading(val) {
    if (!this._selected || this._selected.feature.type === 'flag') return;
    this.editor.saveSnapshot(true);
    const radians = val * (Math.PI / 180);
    this._selected.setHeading(radians);
  }

  /**
   * Change the selected decoration's kind. `val` is 'flag', 'bannerString', or
   * 'model:<id>' (from the panel's Type dropdown).
   */
  changeType(val) {
    if (!this._selected) return;
    const { type, model } = parseTypeSelection(val);
    const feature = this._selected.feature;
    // No-op if it's already this exact kind.
    if (type === 'model' && feature.type === 'model' && feature.model === model) return;
    if (type !== 'model' && feature.type === type) return;

    const index = this.track.features.indexOf(feature);
    if (index === -1) return;

    this.editor.saveSnapshot();
    this._removeVisual(this._selected);
    this._selected = null;

    const newFeature = this._defaultDecorationFeature(type, model, feature);
    this.track.features.splice(index, 1, newFeature);
    const created = this.createVisual(newFeature);
    this.deselect();
    if (created) this.select(created);
  }

  /** Build a feature of the given kind at the source's position, carrying over
   *  any shared props (color/heading) so a type conversion is minimally disruptive. */
  _defaultDecorationFeature(type, model, src) {
    const color = src.color || this.editor._editorStore?.decoration?.color || 'red';
    const heading = src.heading ?? 0;
    if (type === 'flag') return { type, x: src.x, z: src.z, color };
    if (type === 'model') {
      const def = getDecorationLoader()?.getDecoration(model);
      return {
        type: 'model', model, x: src.x, z: src.z, heading,
        scale: src.scale ?? def?.defaultScale ?? 1,
        color: src.color ?? def?.defaultColor ?? color,
      };
    }
    return { type: 'bannerString', x: src.x, z: src.z, heading, width: src.width ?? 8, poleHeight: src.poleHeight ?? 4.2 };
  }

  deleteSelected() {
    if (!this._selected) return;
    this.editor.saveSnapshot();

    const feature = this._selected.feature;
    const index = this.track.features.indexOf(feature);
    if (index > -1) this.track.features.splice(index, 1);

    this._removeVisual(this._selected);
    this._selected = null;
    this.hideProperties();
  }

  duplicateSelected() {
    if (!this._selected) return;
    this.editor.saveSnapshot();
    const src = this._selected.feature;

    const newFeature = { ...src, x: src.x + 3, z: src.z + 3 };
    this.track.features.push(newFeature);
    const created = this.createVisual(newFeature);

    this.deselect();
    if (created) this.select(created);
  }

  addEntity() {
    const e = this.editor;
    const camTarget = e.camera.getTarget();
    const newX = e._snap(camTarget.x);
    const newZ = e._snap(camTarget.z);
    const s = this.editor._editorStore?.decoration;
    const type = s?.type || 'flag';

    e.saveSnapshot();
    let created = null;
    if (type === 'bannerString') {
      created = this._addBanner(newX, newZ);
    } else if (type === 'model') {
      created = this._addModel(newX, newZ, s?.model);
    } else {
      created = this._addFlag(newX, newZ);
    }
    e.deselectAll();
    if (created) this.select(created);
    e.hideAddMenu();
  }

  _addFlag(x, z) {
    const color = this.editor._editorStore?.decoration?.color || 'red';
    const feature = { type: 'flag', x, z, color };
    this.track.features.push(feature);
    return this._createFlag(feature);
  }

  _addBanner(x, z) {
    const feature = { type: 'bannerString', x, z, heading: 0, width: 8, poleHeight: 4.2 };
    this.track.features.push(feature);
    return this._createBanner(feature);
  }

  _addModel(x, z, model) {
    const loader = getDecorationLoader();
    // Fall back to the first available decoration if none is selected yet.
    const id = model ?? loader?.decorationList?.[0];
    const def = id ? loader?.getDecoration(id) : null;
    if (!def) return this._addFlag(x, z);
    const feature = {
      type: 'model', model: id, x, z, heading: 0,
      scale: def.defaultScale ?? 1,
      color: def.defaultColor ?? 'white',
    };
    this.track.features.push(feature);
    return this._createModel(feature);
  }
}

/** Parse a Type-dropdown value into { type, model }. */
function parseTypeSelection(val) {
  if (typeof val === 'string' && val.startsWith('model:')) {
    return { type: 'model', model: val.slice('model:'.length) };
  }
  return { type: val, model: null };
}
