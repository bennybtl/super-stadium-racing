import rebuild from './editor-rebuild.js';
import { LINE_COLOR_POLY_CURB } from './EditorMaterials.js';
import { resolveStripeColorNames, normalizeStripeColors } from '../objects/stripeColors.js';
import { gizmoY, gizmoLineY } from './gizmo-height.js';
import { PolyPointEditor } from './PolyPointEditor.js';

/**
 * PolyCurbEditor — place and edit polyCurb features. Mirrors PolyWallEditor;
 * the shared control-point machinery lives in PolyPointEditor. Curb gizmo
 * colour is teal / cyan (distinct from the orange polyWall gizmos).
 *
 * Created empty: the user right-clicks terrain to drop points.
 */
export class PolyCurbEditor extends PolyPointEditor {
  constructor(ec) {
    super(ec, {
      featureType: 'polyCurb',
      lineColor: LINE_COLOR_POLY_CURB,
      materials: { normal: 'polyCurbNode', active: 'polyCurbNodeActive', selected: 'polyCurbNodeSelected' },
      spherePrefix: 'pcPt_',
      linePrefix: 'pcLines_',
      sphereDiameter: 1.2,
    });
  }

  _newFeature() {
    return { type: 'polyCurb', points: [], height: 0.22, width: 0.9, closed: false };
  }

  /** World Y of the curb's top face over (pt.x, pt.z) — the handle/line datum. */
  _curbTopY(feature, pt) {
    return (this.track?.getHeightAt(pt.x, pt.z) ?? 0) + (feature?.height ?? 0.22);
  }
  _pointY(feature, pt) { return gizmoY(this.track, pt.x, pt.z, this._curbTopY(feature, pt)); }
  _lineY(feature, pt) { return gizmoLineY(this.track, pt.x, pt.z, this._curbTopY(feature, pt)); }

  _rebuildGeometry(feature) {
    rebuild.polyCurb?.(feature ?? null);
  }

  _syncStoreExtra(s, feature, idx) {
    s.maxRadius = this._maxRadiusFor(feature, idx);
    s.height = feature.height ?? 0.22;
    s.width = feature.width ?? 0.9;
    s.closed = feature.closed ?? false;
    s.colors = resolveStripeColorNames(feature);
  }

  // ── Public API expected by EditorController ──────────────────────────────

  addPolyCurbFeature() { this._addFeature(); }
  insertPolyCurbPoint() { this.insertPointAfterSelected(); }
  deletePolyCurbPoint() { this.deleteSelectedPoint(); }
  deletePolyCurb() { this.deleteActiveFeature(); }
  duplicatePolyCurb() { this.duplicateActiveFeature(); }
  deselectPolyCurb() { this.deselectPoint(); }

  // ── Panel property setters ───────────────────────────────────────────────

  changePolyCurbRadius(val) {
    if (!this.selectedPoint) return;
    this.ec.saveSnapshot(true);
    this.selectedPoint.gz.feature.points[this.selectedPoint.idx].radius = val;
    this._updatePositions(this.selectedPoint.gz);
    this._rebuildNow(this.selectedPoint.gz.feature);
  }

  changePolyCurbHeight(val) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature.height = val;
    this._rebuildNow(this._active.feature);
  }

  changePolyCurbWidth(val) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature.width = val;
    this._rebuildNow(this._active.feature);
  }

  changePolyCurbClosed(val) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature.closed = val;
    this._rebuildNow(this._active.feature);
  }

  /** Set the curb's stripe colours (1–3 palette names). */
  changePolyCurbColors(colors) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    const feature = this._active.feature;
    feature.colors = normalizeStripeColors(colors);
    this._syncStore(feature, this.selectedPoint?.idx ?? null);
    this._rebuildNow(feature);
  }
}
