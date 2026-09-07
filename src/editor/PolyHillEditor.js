import rebuild, { REBUILD_DEBOUNCE_MS } from './editor-rebuild.js';
import { LINE_COLOR_POLY_HILL } from './EditorMaterials.js';
import { TERRAIN_TYPES } from "../world/terrain.js";
import { gizmoY } from './gizmo-height.js';
import { clampEdgeShape, EDGE_SHAPE_DEFAULT } from '../world/feature-geometry.js';
import { DEFAULT_CORNER_RADIUS } from '../utils/polyline-utils.js';
import { PolyPointEditor } from './PolyPointEditor.js';

/**
 * PolyHillEditor — place and edit polyHill features (raised / dug landforms
 * along a polyline). Shared control-point machinery lives in PolyPointEditor;
 * this class adds the hill-specific handle datum (a dug hill's handles must
 * clear the trench rim), the terrain + water rebuild set, and the panel setters.
 *
 * Unlike polyWall / polyCurb, a hill is seeded with four points on "Add" rather
 * than drawn point-by-point.
 */
export class PolyHillEditor extends PolyPointEditor {
  constructor(ec) {
    super(ec, {
      featureType: 'polyHill',
      lineColor: LINE_COLOR_POLY_HILL,
      materials: { normal: 'polyHillNode', active: 'polyHillNodeActive', selected: 'polyHillNodeSelected' },
      spherePrefix: 'phPt_',
      linePrefix: 'phLines_',
    });
    this._waterRebuildTimer = null;
  }

  _newFeature() {
    const { x: cx, z: cz } = this.ec.viewCenterXZ();
    return {
      type: 'polyHill',
      points: [
        { x: cx - 10, z: cz - 10, radius: DEFAULT_CORNER_RADIUS },
        { x: cx + 10, z: cz - 10, radius: DEFAULT_CORNER_RADIUS },
        { x: cx + 10, z: cz + 10, radius: DEFAULT_CORNER_RADIUS },
        { x: cx - 10, z: cz + 10, radius: DEFAULT_CORNER_RADIUS },
      ],
      height: 3,
      width: 5,
      terrainType: null,
      closed: false,
      filled: false,
      endTaper: false,
    };
  }

  /**
   * Handle Y. The analytic terrain already carries the hill's own rise, so only
   * a dug hill (negative height) needs a lift: its sampled point sits at the
   * trench floor, below the rim the handle must clear. The preview line stays on
   * the raw ground (base `_lineY`).
   */
  _pointY(feature, pt) {
    const terrainY = this.track?.getHeightAt(pt.x, pt.z) ?? 0;
    return gizmoY(this.track, pt.x, pt.z, terrainY + Math.max(0, -(feature?.height ?? 0)));
  }

  _rebuildGeometry(feature) {
    rebuild.polyHill?.(feature ?? null);
    rebuild.terrainGrid?.();
    rebuild.terrainTexture?.();
    rebuild.normalMap?.();
    rebuild.water?.();
  }

  /** Water-only deferred rebuild — the level slider moves just the waterline. */
  _rebuildWaterDeferred(feature) {
    clearTimeout(this._waterRebuildTimer);
    this._waterRebuildTimer = setTimeout(() => {
      this._waterRebuildTimer = null;
      if (!this.scene || !this.track?.features?.includes(feature)) return;
      rebuild.water?.();
    }, REBUILD_DEBOUNCE_MS);
  }

  dispose() {
    clearTimeout(this._waterRebuildTimer);
    this._waterRebuildTimer = null;
    super.dispose();
  }

  _canHaveRadius(feature, idx) {
    if (feature.closed) return true;
    return idx > 0 && idx < feature.points.length - 1;
  }

  _syncStoreExtra(s, feature, idx) {
    s.canDeletePoint = idx !== null && feature.points.length > this._minPoints;
    s.height = feature.height ?? 3;
    s.width = feature.width ?? feature.slope ?? 5;
    s.terrainType = feature.terrainType?.name || 'none';
    s.blendWidth = feature.blendWidth ?? 0;
    s.edgeShape = feature.edgeShape ?? EDGE_SHAPE_DEFAULT;
    s.closed = feature.closed ?? false;
    s.filled = feature.filled ?? false;
    s.endTaper = feature.endTaper ?? false;
    s.waterLevelOffset = feature.waterLevelOffset ?? 2;
    s.canHaveWater = !!feature.closed && !!feature.filled
      && (feature.height ?? 0) < 0
      && (feature.terrainType?.name === 'water');
  }

  // ── Public API expected by EditorController ──────────────────────────────

  addPolyHillFeature() { this._addFeature(); }
  insertPointAfter() { this.insertPointAfterSelected(); }
  deletePolyHill() { this.deleteActiveFeature(); }
  duplicatePolyHill() { this.duplicateActiveFeature(); }

  // ── Panel property setters ───────────────────────────────────────────────

  setPointRadius(radius) {
    if (!this.selectedPoint) return;
    this.ec.saveSnapshot(true);
    this.selectedPoint.gz.feature.points[this.selectedPoint.idx].radius = radius;
    this._rebuildDeferred(this.selectedPoint.gz);
  }

  setHeight(height) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature.height = height;
    this._updatePositions(this._active); // dug-hill datum moved
    this._syncStore(this._active.feature, this.selectedPoint?.idx ?? null);
    this._rebuildDeferred(this._active);
  }

  setWidth(width) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature.width = width;
    this._rebuildDeferred(this._active);
  }

  setEdgeShape(val) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature.edgeShape = clampEdgeShape(val);
    this._rebuildDeferred(this._active);
  }

  setBlendWidth(val) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature.blendWidth = Math.max(0, val);
    this._rebuildDeferred(this._active);
  }

  setWaterLevelOffset(offset) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    const f = this._active.feature;
    const maxOffset = Math.max(0, -(f.height ?? 0)); // can't sit above the rim
    f.waterLevelOffset = Math.max(0, Math.min(offset, maxOffset));
    if (this.ec._editorStore) this.ec._editorStore.polyHill.waterLevelOffset = f.waterLevelOffset;
    this._rebuildWaterDeferred(f);
  }

  setTerrainType(name) {
    if (!this._active) return;
    this.ec.saveSnapshot();
    this._active.feature.terrainType = name === 'none'
      ? null
      : (Object.values(TERRAIN_TYPES).find((t) => t.name === name) || null);
    this._syncStore(this._active.feature, this.selectedPoint?.idx ?? null);
    this._rebuildNow(this._active.feature);
  }

  setClosed(closed) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature.closed = closed;
    this._refreshGizmos(this._active);
    this._syncStore(this._active.feature, this.selectedPoint?.idx ?? null);
    this._rebuildNow(this._active.feature);
  }

  setFilled(filled) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature.filled = filled;
    this._syncStore(this._active.feature, this.selectedPoint?.idx ?? null);
    this._rebuildNow(this._active.feature);
  }

  /** Open hills only: fade the ends down to the ground (see polylineEndTaper). */
  setEndTaper(endTaper) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature.endTaper = endTaper;
    this._syncStore(this._active.feature, this.selectedPoint?.idx ?? null);
    this._rebuildNow(this._active.feature);
  }
}
