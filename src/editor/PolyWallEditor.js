import rebuild from './editor-rebuild.js';
import { LINE_COLOR_POLY_WALL } from './EditorMaterials.js';
import { resolveStripeColorNames, normalizeStripeColors } from '../objects/stripeColors.js';
import { gizmoY, gizmoLineY } from './gizmo-height.js';
import { PolyPointEditor } from './PolyPointEditor.js';

// Gap the fence tubing fills when it is switched on and the collision height is
// still level with (or barely above) the wall top.
const DEFAULT_FENCE_HEIGHT = 2.5;

/**
 * PolyWallEditor — place and edit polyWall features. Control-point machinery
 * (gizmos, drag+snap, insert/delete, duplicate, snapshot restore) lives in
 * PolyPointEditor; this class adds the wall-specific geometry datum, rebuild
 * calls, and the panel property setters.
 *
 * Created empty: the user right-clicks terrain to drop points (see
 * EditorController's polyWall placement branch).
 */
export class PolyWallEditor extends PolyPointEditor {
  constructor(ec) {
    super(ec, {
      featureType: 'polyWall',
      lineColor: LINE_COLOR_POLY_WALL,
      materials: { normal: 'polyWallNode', active: 'polyWallNodeActive', selected: 'polyWallNodeSelected' },
      spherePrefix: 'pwPt_',
      linePrefix: 'pwLines_',
    });
  }

  _newFeature() {
    return {
      type: 'polyWall',
      points: [],
      height: 2,
      collisionHeight: 2,
      thickness: 0.5,
      friction: 0.05,
      closed: false,
      fence: false,
    };
  }

  /** World Y of the wall's top edge over (pt.x, pt.z) — the handle/line datum. */
  _wallTopY(feature, pt) {
    return (this.track?.getHeightAt(pt.x, pt.z) ?? 0) + (feature?.height || 0);
  }
  _pointY(feature, pt) { return gizmoY(this.track, pt.x, pt.z, this._wallTopY(feature, pt)); }
  _lineY(feature, pt) { return gizmoLineY(this.track, pt.x, pt.z, this._wallTopY(feature, pt)); }

  _rebuildGeometry(feature) {
    rebuild.terrainGrid?.();            // keep the terrain-type grid in sync
    rebuild.polyWall?.(feature ?? null); // null → full rebuild
  }

  _syncStoreExtra(s, feature, idx) {
    s.maxRadius = this._maxRadiusFor(feature, idx);
    s.smoothing = idx !== null ? (feature.points[idx]?.smoothing ?? 1) : 1;
    s.height = feature.height ?? 2;
    s.collisionHeight = feature.collisionHeight ?? feature.height ?? 2;
    s.thickness = feature.thickness ?? 0.5;
    s.closed = feature.closed ?? false;
    s.fence = feature.fence ?? false;
    s.colors = resolveStripeColorNames(feature);
  }

  // ── Public API expected by EditorController ──────────────────────────────

  addPolyWallFeature() { this._addFeature(); }
  insertPolyWallPoint() { this.insertPointAfterSelected(); }
  deletePolyWall() { this.deleteActiveFeature(); }
  duplicatePolyWall() { this.duplicateActiveFeature(); }

  // ── Panel property setters ───────────────────────────────────────────────

  changePolyWallRadius(val) {
    if (!this.selectedPoint) return;
    this.ec.saveSnapshot(true);
    this.selectedPoint.gz.feature.points[this.selectedPoint.idx].radius = val;
    this._updatePositions(this.selectedPoint.gz);
    this._rebuildNow(this.selectedPoint.gz.feature);
  }

  changePolyWallSmoothing(val) {
    if (!this.selectedPoint) return;
    this.ec.saveSnapshot(true);
    this.selectedPoint.gz.feature.points[this.selectedPoint.idx].smoothing = val;
    this._rebuildNow(this.selectedPoint.gz.feature); // top-profile only, no gizmo move
  }

  changePolyWallHeight(val) {
    if (!this._active) return;
    const feature = this._active.feature;
    const prevHeight = Number(feature.height ?? 2);
    const prevCollision = Number(feature.collisionHeight ?? prevHeight);
    this.ec.saveSnapshot(true);
    feature.height = Number(val);
    if (feature.collisionHeight === undefined || Math.abs(prevCollision - prevHeight) < 1e-6) {
      feature.collisionHeight = Number(val);
    }
    this._rebuildNow(feature);
  }

  changePolyWallCollisionHeight(val) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature.collisionHeight = Number(val);
    this._rebuildNow(this._active.feature);
  }

  changePolyWallThickness(val) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature.thickness = val;
    this._rebuildNow(this._active.feature);
  }

  /**
   * Toggle the chain-link fence. The tubing spans wall top → collision top, so
   * enabling it on a wall whose two heights match would draw nothing; give it
   * the default fence height to stand in rather than leaving the user to
   * discover the coupling.
   */
  changePolyWallFence(val) {
    if (!this._active) return;
    const feature = this._active.feature;
    this.ec.saveSnapshot(true);
    feature.fence = !!val;
    if (feature.fence) {
      const height = Number(feature.height ?? 2);
      const collisionHeight = Number(feature.collisionHeight ?? height);
      if (collisionHeight - height < DEFAULT_FENCE_HEIGHT) {
        feature.collisionHeight = height + DEFAULT_FENCE_HEIGHT;
      }
    }
    this._syncStore(feature, this.selectedPoint?.idx ?? null);
    this._rebuildNow(feature);
  }

  changePolyWallClosed(val) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature.closed = val;
    this._rebuildNow(this._active.feature);
  }

  /** Set the wall's stripe colours (1–3 palette names). */
  changePolyWallColors(colors) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    const feature = this._active.feature;
    feature.colors = normalizeStripeColors(colors);
    this._syncStore(feature, this.selectedPoint?.idx ?? null);
    this._rebuildNow(feature);
  }
}
