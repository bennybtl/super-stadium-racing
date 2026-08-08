import { Vector3 } from "@babylonjs/core";
import { GizmoHandle } from "./GizmoHandle.js";
import {
  modelIdForFeature,
  defForFeature,
  getDecorationLoader,
  createDecoration,
  controlsFor,
  readDecorationProp,
  applyDecorationProp,
} from "../decorations-registry.js";
import { gizmoY } from './gizmo-height.js';

// Assumed prop height for decorations that don't report their own topY, so the
// handle still clears a typical model instead of sitting inside it.
const ASSUMED_TOP_Y = 1.5;

/**
 * DecorationsEditor — editing for every decoration in /decorations/.
 *
 * There are no per-type branches: a feature resolves to a definition, the
 * definition's optional controller supplies geometry / editable controls, and
 * everything else (select, move, rotate, duplicate, delete) is generic. Flags
 * and banner strings are just decorations whose controller builds procedural
 * geometry — see decorations/flag.js and decorations/bannerString.js.
 */
export class DecorationsEditor {
  constructor(editor) {
    this.editor = editor;
    this.scene = null;
    this.track = null;
    this.decorations = [];
    this._handles = new Map(); // decoration -> GizmoHandle
    this._selected = null;
  }

  get selected() { return this._selected; }

  /** True when a feature is handled by the decoration system. */
  isModelFeature(feature) {
    return modelIdForFeature(feature) !== null;
  }

  activate(scene, track) {
    this.scene = scene;
    this.track = track;
    this.createVisualsForTrack(track);
  }

  clearMeshes() {
    for (const d of this.decorations) d.dispose();
    for (const h of this._handles.values()) h.dispose();
    this.decorations = [];
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
    const def = defForFeature(feature);
    if (!def) return null;
    const { x, z } = feature;
    const groundY = this.track.getHeightAt(x, z);
    // Decorations are solid props, so let them cast shadows in the editor too.
    const decoration = createDecoration(feature, def, groundY, this.scene, this.editor._shadows ?? null);
    if (!decoration) return null;
    this.decorations.push(decoration);
    this._attachHandle(decoration);
    return decoration;
  }

  /** Give a decoration its pickable handle sphere. */
  _attachHandle(decoration) {
    this._handles.set(decoration, new GizmoHandle(this.scene, 'decoration'));
    this._positionHandle(decoration);
  }

  /**
   * Park the handle above the decoration. Types that know their own height
   * (banner strings) report topY; the rest assume a typical prop height so the
   * handle still clears the model.
   */
  _positionHandle(decoration) {
    const { x, z } = decoration.feature;
    const topY = typeof decoration.topY === 'number'
      ? decoration.topY
      : (this.track?.getHeightAt(x, z) ?? 0) + ASSUMED_TOP_Y;
    this._handles.get(decoration)?.setPosition(x, gizmoY(this.track, x, z, topY), z);
  }

  /** Re-sample handle heights after a terrain rebuild (EditorController sweep). */
  refreshGizmoHeights() {
    for (const decoration of this.decorations) this._positionHandle(decoration);
  }

  /** Dispose a decoration's meshes and drop it from the list. */
  _removeVisual(decoration) {
    decoration.dispose();
    this._handles.get(decoration)?.dispose();
    this._handles.delete(decoration);
    const idx = this.decorations.indexOf(decoration);
    if (idx > -1) this.decorations.splice(idx, 1);
  }

  /** Global gizmo-visibility toggle (EditorController.setGizmosVisible). */
  setHandlesVisible(visible) {
    for (const h of this._handles.values()) h.setVisible(visible);
  }

  findByMesh(mesh) {
    for (const [decoration, handle] of this._handles) {
      if (handle.mesh === mesh) return decoration;
    }
    return this.decorations.find(d => d.containsMesh(mesh)) ?? null;
  }

  // ─── Selection ──────────────────────────────────────────────────────────────

  select(featureData) {
    if (!featureData) return;
    this._selected = featureData;
    this._handles.get(featureData)?.setSelected(true);
    this.editor._rawDragPos = { x: featureData.feature.x, z: featureData.feature.z };

    const s = this.editor._editorStore;
    if (!s) return;
    this.syncStore();
    s.selectedType = 'decoration';
  }

  /**
   * Push the selected decoration's control descriptor and current values into
   * the panel store. The descriptor is what DecorationsPanel renders, so a
   * controller can vary the controls per feature.
   */
  syncStore() {
    const s = this.editor._editorStore;
    if (!s || !this._selected) return;
    const feature = this._selected.feature;
    const def = defForFeature(feature);
    const controls = controlsFor(def, feature);

    s.decoration.model = modelIdForFeature(feature);
    s.decoration.controls = controls;
    for (const prop of Object.keys(controls)) {
      if (prop === 'mirror') {
        s.decoration.mirrorX = !!feature.mirrorX;
        s.decoration.mirrorZ = !!feature.mirrorZ;
      } else {
        s.decoration[prop] = readDecorationProp(feature, def, prop);
      }
    }
  }

  deselect() {
    // Only touch the shared _rawDragPos if this editor actually held the
    // selection — deselectAll sweeps every editor, and clearing it blindly
    // wipes the drag origin of whichever feature was just selected.
    if (this._selected) {
      this._handles.get(this._selected)?.setSelected(false);
      this._selected = null;
      this.editor._rawDragPos = null;
    }
    this.hideProperties();
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'decoration') {
      this.editor._editorStore.selectedType = null;
    }
  }

  // ─── Transform ──────────────────────────────────────────────────────────────

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

    feature.x = newX;
    feature.z = newZ;
    const groundY = this.track.getHeightAt(newX, newZ);
    this._selected.moveTo(newX, newZ, groundY);
    this._positionHandle(this._selected);

    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  rotate(angleDelta) {
    // Decorations that don't turn (a flag stands straight up) omit setHeading.
    if (!this._selected || typeof this._selected.setHeading !== 'function') return;
    this.editor.saveSnapshot(true);
    const newHeading = (this._selected.feature.heading ?? 0) + angleDelta;
    this._selected.feature.heading = newHeading;
    this._selected.setHeading(newHeading);
    const s = this.editor._editorStore;
    if (s) s.decoration.heading = +(newHeading * 180 / Math.PI).toFixed(1);
  }

  /**
   * Apply one panel control value. A controller's `edit.apply` can intercept
   * (return true when it handled the prop); otherwise the shared mapping runs.
   */
  changeProp(prop, value) {
    if (!this._selected) return;
    this.editor.saveSnapshot(true);
    const def = defForFeature(this._selected.feature);
    const handled = def?.controller?.edit?.apply?.(this._selected, prop, value) === true;
    if (!handled) applyDecorationProp(this._selected, prop, value);
    // Height-changing props (pole height) move the top the handle sits above.
    this._positionHandle(this._selected);
  }

  // ─── Type / lifecycle ───────────────────────────────────────────────────────

  /** Swap the selected decoration for a different kind, keeping its position. */
  changeType(id) {
    if (!this._selected || !id) return;
    const feature = this._selected.feature;
    if (modelIdForFeature(feature) === id) return;

    const index = this.track.features.indexOf(feature);
    if (index === -1) return;

    this.editor.saveSnapshot();
    this._removeVisual(this._selected);
    this._selected = null;

    const newFeature = this._defaultFeatureFor(id, feature);
    this.track.features.splice(index, 1, newFeature);
    const created = this.createVisual(newFeature);
    this.deselect();
    if (created) this.select(created);
  }

  /**
   * Build a feature for decoration `id` at the source's position, seeded from
   * the def's defaults and carrying over shared props so a type change is
   * minimally disruptive.
   */
  _defaultFeatureFor(id, src) {
    const def = getDecorationLoader()?.getDecoration(id);
    const feature = { type: 'model', model: id, x: src.x, z: src.z };
    if (def?.defaultColor != null) feature.color = def.defaultColor;
    if (def?.defaultScale != null) feature.scale = def.defaultScale;
    Object.assign(feature, def?.featureDefaults ?? {});

    if (src.heading != null) feature.heading = src.heading;
    if (src.color != null && feature.color !== undefined) feature.color = src.color;
    if (src.scale != null && feature.scale !== undefined) feature.scale = src.scale;
    if (src.mirrorX) feature.mirrorX = true;
    if (src.mirrorZ) feature.mirrorZ = true;
    return feature;
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
    const center = e.viewCenterXZ();
    const x = e._snap(center.x);
    const z = e._snap(center.z);
    const loader = getDecorationLoader();
    // Reuse the last-picked kind, else the first decoration available.
    const id = this.editor._editorStore?.decoration?.model ?? loader?.decorationList?.[0];
    if (!id) return;

    e.saveSnapshot();
    const feature = this._defaultFeatureFor(id, { x, z });
    this.track.features.push(feature);
    const created = this.createVisual(feature);

    e.deselectAll();
    if (created) this.select(created);
    e.hideAddMenu();
  }
}
