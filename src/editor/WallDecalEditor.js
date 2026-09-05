import { Vector3 } from "@babylonjs/core";
import {
  DECAL_SHAPES,
  COUNTED_SHAPES,
  OUTLINE_SHAPES,
  TEXT_SHAPES,
  DECAL_COLORS,
  DECAL_BRANDS,
  DEFAULT_BRAND,
  MIN_COUNT,
  MAX_COUNT,
} from "../managers/decalShapes.js";
import { GizmoHandle } from "./GizmoHandle.js";

// Wall decals can't use the ground-only polyline shape.
const WALL_DECAL_SHAPES = DECAL_SHAPES.filter((s) => s !== "polyline");

// Normalize degrees into [-180, 180) — roll is signed.
const norm180 = (deg) => (((deg % 360) + 540) % 360) - 180;

const SIZE_MIN = 0.5;
const SIZE_MAX = 30;
const clampSize = (v) => Math.max(SIZE_MIN, Math.min(SIZE_MAX, v));

/**
 * WallDecalEditor — stamp-mode editor for decals on walls / arbitrary surfaces.
 *
 * Mirrors SurfaceDecalEditor but placement is surface-relative: a click ray-hits
 * any `metadata.decalTarget` mesh and the decal stores that hit point + normal.
 * Moving a placed decal re-picks under the cursor, so it can slide along a wall
 * and around corners. Rotation is roll about the stored normal.
 *
 * Controls:
 *   - Click a wall  : stamp the current decal there
 *   - Click a decal : select it for editing
 *   - Drag          : slide the selected decal across the surface
 *   - Q / E         : roll by 15°
 *   - Mouse wheel   : scale
 */
export class WallDecalEditor {
  constructor(editor) {
    this.editor = editor;
    this._scene = null;
    this._track = null;

    // Current stamp state
    this._shape = WALL_DECAL_SHAPES[0];
    this._color = "white";
    this._count = 3;
    this._outline = false;
    this._text = "TEXT";
    this._brand = DEFAULT_BRAND;
    this._roll = 0;
    this._width = 4;
    this._height = 4;
    this._opacity = 1;
    // When true, width/height resize together (aspect preserved); the panel
    // collapses to one "Scale" slider.
    this._linkScale = true;

    // Live WallDecalManager, set by EditorController.setWallDecalManager.
    this._decalManager = null;

    // Selection — a { feature, mesh } entry owned by the manager.
    this.selected = null;
    this._handles = new Map(); // entry -> GizmoHandle

    this._boundWheel = this._onWheel.bind(this);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  activate(scene, track) {
    this._scene = scene;
    this._track = track;
    this._syncHandles();
  }

  setDecalManager(manager) {
    this._decalManager = manager;
    this._syncHandles();
  }

  /** Reconcile one gizmo handle per manager entry. */
  _syncHandles() {
    const entries = this._decalManager?.entries;
    if (!entries || !this._scene) return;

    for (const [entry, handle] of this._handles) {
      if (!entries.includes(entry)) {
        handle.dispose();
        this._handles.delete(entry);
      }
    }

    const visible = this.editor.gizmosVisible !== false;
    for (const entry of entries) {
      let handle = this._handles.get(entry);
      if (!handle) {
        handle = new GizmoHandle(this._scene, "decal");
        handle.setVisible(visible); // respect the global toggle for fresh handles
        this._handles.set(entry, handle);
      }
      const p = entry.feature.position ?? [0, 0, 0];
      handle.setPosition(p[0], p[1], p[2]);
      handle.setSelected(entry === this.selected);
    }
  }

  open() {
    this._scene
      .getEngine()
      .getRenderingCanvas()
      ?.addEventListener("wheel", this._boundWheel, { passive: false });
    if (this.editor._editorStore) {
      this.editor._editorStore.selectedType = "wallDecal";
      this._syncStore();
    }
  }

  close() {
    this._scene
      .getEngine()
      .getRenderingCanvas()
      ?.removeEventListener("wheel", this._boundWheel);
    if (this.editor._editorStore?.selectedType === "wallDecal") {
      this.editor._editorStore.selectedType = null;
    }
  }

  get isOpen() {
    return this.editor._editorStore?.selectedType === "wallDecal";
  }

  dispose() {
    this.close();
    this.deselect();
    for (const handle of this._handles.values()) handle.dispose();
    this._handles.clear();
  }

  setHandlesVisible(visible) {
    for (const handle of this._handles.values()) handle.setVisible(visible);
  }

  refreshGizmoHeights() {
    // Wall decal handles sit at the stored 3D point, not on the terrain — no
    // terrain-relative height to re-sample.
    this._syncHandles();
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    if (this._handles.size !== (this._decalManager?.entries?.length ?? 0)) {
      this._syncHandles();
    }
    for (const [entry, handle] of this._handles) {
      if (handle.mesh === mesh) return entry;
    }
    return this._decalManager?.findByMesh(mesh) ?? null;
  }

  /** Returns true when the click was consumed (mirrors the other point editors). */
  onPointerDown(mesh) {
    const entry = this.findByMesh(mesh);
    if (!entry) return false;
    if (this.selected !== entry) {
      this.editor.deselectAll();
      this.select(entry);
    }
    return true;
  }

  clearMeshes() {
    this.deselect();
    this._syncHandles();
  }

  select(entry) {
    if (!entry) return;
    this.deselect();
    this.selected = entry;
    const handle = this._handles.get(entry);
    handle?.setSelected(true);
    this._showProperties();
  }

  deselect() {
    if (!this.selected) return;
    this._handles.get(this.selected)?.setSelected(false);
    this.selected = null;
    this._hideProperties();
  }

  // ── Move / rotate (via EditorController selection interaction) ─────────────

  /**
   * Slide the selected decal across whatever decal-target surface is under the
   * cursor. `movement` (an XZ delta) is ignored — we re-pick instead, which lets
   * a decal travel around corners onto a different wall face.
   */
  move() {
    if (!this.selected) return new Vector3(0, 0, 0);

    const hit = this._pickTargetSurface();
    if (!hit) return new Vector3(0, 0, 0);

    this.editor.saveSnapshot(true);
    const f = this.selected.feature;
    const prev = f.position ?? [0, 0, 0];
    f.position = [hit.point.x, hit.point.y, hit.point.z];
    f.normal = [hit.normal.x, hit.normal.y, hit.normal.z];
    this._rebuildSelected();
    return new Vector3(
      f.position[0] - prev[0],
      f.position[1] - prev[1],
      f.position[2] - prev[2],
    );
  }

  rotate(deltaRad) {
    if (!this.selected) return;
    const f = this.selected.feature;
    f.roll = norm180((f.roll ?? 0) + (deltaRad * 180) / Math.PI);
    this._rebuildSelected();
    this._syncEditPanel();
  }

  _rebuildSelected() {
    if (!this.selected) return;
    this._decalManager.rebuild(this.selected);
    this._syncHandles();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  duplicateSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const src = this.selected.feature;
    // Nudge along the surface normal's biggest tangent so the copy is visible.
    const n = src.normal ?? [0, 1, 0];
    const off = Math.abs(n[1]) > 0.7 ? [3, 0, 0] : [0, 0, 3];
    const newFeature = {
      ...src,
      position: [
        (src.position?.[0] ?? 0) + off[0],
        (src.position?.[1] ?? 0) + off[1],
        (src.position?.[2] ?? 0) + off[2],
      ],
    };
    this.editor.currentTrack.features.push(newFeature);
    const mesh = this._decalManager.createDecal(newFeature);
    this._syncHandles();
    if (mesh) this.select(this._decalManager.findByMesh(mesh));
  }

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const { feature } = this.selected;
    const idx = this.editor.currentTrack.features.indexOf(feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    this._decalManager.removeByFeature(feature);
    this.selected = null;
    this._syncHandles();
    this._hideProperties();
  }

  // ── Property edits (from the edit panel) ──────────────────────────────────

  changeWidth(val) { this._changeSize("width", val); }
  changeHeight(val) { this._changeSize("height", val); }
  changeRoll(val) { this._changeProp("roll", norm180(val)); }
  changeOpacity(val) { this._changeProp("opacity", val); }
  changeCount(val) { this._changeProp("count", Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(val)))); }
  changeOutline(val) { this._changeProp("outline", !!val); }
  changeColor(val) { if (DECAL_COLORS.includes(val)) this._changeProp("color", val); }
  changeText(val) { this._changeProp("text", String(val ?? "")); }
  changeBrand(val) { this._changeProp("brand", val); }

  _changeProp(prop, val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature[prop] = val;
    this._rebuildSelected();
  }

  /** Resize a placed decal. In linked mode the other dimension scales with it. */
  _changeSize(dim, val) {
    if (!this.selected) return;
    val = clampSize(val);
    this.editor.saveSnapshot(true);
    const f = this.selected.feature;
    const other = dim === "width" ? "height" : "width";
    if (this._linkScale) {
      const cur = f[dim] ?? 4;
      const factor = val / (cur || val);
      f[other] = clampSize((f[other] ?? 4) * factor);
    }
    f[dim] = val;
    this._rebuildSelected();
  }

  // ── Stamp on click ───────────────────────────────────────────────────────

  /**
   * Called by EditorController when selectedType === 'wallDecal' and the click
   * didn't land on an already-placed decal. Does its own pick so it can also
   * reach surfaces the shared editor pick skips (non-pickable poly-wall ribbons).
   * Places one decal, then leaves placement mode and selects it for editing.
   */
  stamp() {
    if (!this._decalManager) return;
    const hit = this._pickTargetSurface();
    if (!hit) return;

    const point = hit.point;
    const normal = hit.normal;

    const feature = {
      type: "wallDecal",
      position: [point.x, point.y, point.z],
      normal: [normal.x, normal.y, normal.z],
      roll: this._roll,
      shape: this._shape,
      color: this._color,
      count: this._count,
      outline: this._outline,
      text: this._text,
      brand: this._brand,
      width: this._width,
      height: this._height,
      opacity: this._opacity,
    };

    this.editor.saveSnapshot();
    this._track.features.push(feature);
    const mesh = this._decalManager.createDecal(feature);
    this._syncHandles();

    // Leave placement mode and edit the decal we just placed.
    this.close();
    const entry = this._decalManager.findByMesh(mesh);
    if (entry) this.select(entry);
  }

  /** Pointer pick restricted to decal-target surfaces. */
  _pickTargetSurface() {
    const pick = this._scene.pick(
      this._scene.pointerX,
      this._scene.pointerY,
      (m) => m?.metadata?.decalTarget === true,
    );
    if (!pick?.hit || !pick.pickedPoint) return null;
    return { point: pick.pickedPoint, normal: pick.getNormal(true) ?? Vector3.Up() };
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────

  onKeyDown(event) {
    if (!this.isOpen) return false;
    const key = event.key.toLowerCase();
    if (key === "q") { this.setRoll(this._roll - 15); return true; }
    if (key === "e") { this.setRoll(this._roll + 15); return true; }
    return false;
  }

  _onWheel(event) {
    if (!this.isOpen) return;
    event.preventDefault();
    if (this._linkScale) {
      // Multiplicative so the aspect ratio holds through the zoom.
      const factor = event.deltaY > 0 ? 1 / 1.1 : 1.1;
      this._width = clampSize(this._width * factor);
      this._height = clampSize(this._height * factor);
    } else {
      const delta = event.deltaY > 0 ? -0.5 : 0.5;
      this._width = clampSize(this._width + delta);
      this._height = clampSize(this._height + delta);
    }
    this._syncStore();
  }

  // ── Panel actions (stamp mode) ───────────────────────────────────────────

  setShape(shape) {
    if (!WALL_DECAL_SHAPES.includes(shape)) return;
    this._shape = shape;
    this._syncStore();
  }
  setCount(val) { this._count = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(val))); this._syncStore(); }
  setColor(val) { if (DECAL_COLORS.includes(val)) { this._color = val; this._syncStore(); } }
  setText(val) { this._text = String(val ?? ""); this._syncStore(); }
  setBrand(val) { this._brand = val; this._syncStore(); }
  setOutline(val) { this._outline = !!val; this._syncStore(); }
  setRoll(val) { this._roll = norm180(val); this._syncStore(); }
  setOpacity(val) { this._opacity = val; this._syncStore(); }
  setLinkScale(val) { this._linkScale = !!val; this._syncStore(); }
  setWidth(val) { this._applySize("width", val); }
  setHeight(val) { this._applySize("height", val); }

  /** Stamp-mode resize; in linked mode the other dimension tracks the change. */
  _applySize(dim, val) {
    val = clampSize(val);
    if (this._linkScale) {
      const cur = dim === "width" ? this._width : this._height;
      const factor = val / (cur || val);
      if (dim === "width") { this._width = val; this._height = clampSize(this._height * factor); }
      else { this._height = val; this._width = clampSize(this._width * factor); }
    } else if (dim === "width") {
      this._width = val;
    } else {
      this._height = val;
    }
    this._syncStore();
  }

  // ── Store sync ───────────────────────────────────────────────────────────

  _showProperties() {
    const s = this.editor._editorStore;
    if (!s || !this.selected) return;
    s.selectedType = "wallDecalEdit";
    this._syncEditPanel();
  }

  _hideProperties() {
    if (this.editor._editorStore?.selectedType === "wallDecalEdit") {
      this.editor._editorStore.selectedType = null;
    }
  }

  _syncEditPanel() {
    const s = this.editor._editorStore?.wallDecal;
    if (!s || !this.selected) return;
    const f = this.selected.feature;
    s.shape = f.shape ?? "arrow";
    s.shapes = WALL_DECAL_SHAPES;
    s.hasCount = COUNTED_SHAPES.includes(s.shape);
    s.count = f.count ?? 1;
    s.outline = !!f.outline;
    s.hasOutline = OUTLINE_SHAPES.includes(s.shape);
    s.color = f.color ?? "white";
    s.colors = DECAL_COLORS;
    s.text = f.text ?? "";
    s.hasText = TEXT_SHAPES.includes(s.shape);
    s.brand = f.brand ?? DEFAULT_BRAND;
    s.brands = DECAL_BRANDS;
    s.hasBrand = s.shape === "brand";
    s.roll = Math.round(f.roll ?? 0);
    s.width = +(f.width ?? 4).toFixed(1);
    s.height = +(f.height ?? 4).toFixed(1);
    s.linkScale = this._linkScale;
    s.opacity = +(f.opacity ?? 1).toFixed(2);
  }

  _syncStore() {
    const s = this.editor._editorStore?.wallDecal;
    if (!s) return;
    s.shape = this._shape;
    s.shapes = WALL_DECAL_SHAPES;
    s.count = this._count;
    s.hasCount = COUNTED_SHAPES.includes(this._shape);
    s.outline = this._outline;
    s.hasOutline = OUTLINE_SHAPES.includes(this._shape);
    s.color = this._color;
    s.colors = DECAL_COLORS;
    s.text = this._text;
    s.hasText = TEXT_SHAPES.includes(this._shape);
    s.brand = this._brand;
    s.brands = DECAL_BRANDS;
    s.hasBrand = this._shape === "brand";
    s.roll = Math.round(this._roll);
    s.width = +this._width.toFixed(1);
    s.height = +this._height.toFixed(1);
    s.linkScale = this._linkScale;
    s.opacity = +this._opacity.toFixed(2);
  }
}
