import { Color4, MeshBuilder, Vector3 } from "@babylonjs/core";
import rebuild from './editor-rebuild.js';
import { LINE_COLOR_TUNNEL, LINE_COLOR_TUNNEL_WARN, LINE_COLOR_TUNNEL_PORTAL } from './EditorMaterials.js';
import { gizmoY, gizmoLineY } from './gizmo-height.js';
import { PolyPointEditor } from './PolyPointEditor.js';
import { deriveTunnel, TUNNEL_DEFAULTS } from '../world/tunnel-geometry.js';

const toColor4 = (c) => new Color4(c.r, c.g, c.b, 1);
const LINE = toColor4(LINE_COLOR_TUNNEL);
const WARN = toColor4(LINE_COLOR_TUNNEL_WARN);
const PORTAL = toColor4(LINE_COLOR_TUNNEL_PORTAL);

/**
 * TunnelEditor — place and edit tunnel features (see TUNNELS.md). The shared
 * control-point machinery lives in PolyPointEditor; right-click terrain to add
 * centreline points, starting and ending on the floors of the cuttings you
 * shaped leading into the hill.
 *
 * The preview line follows the tunnel's real (corner-rounded) centreline and
 * shows what the geometry derivation found: red where the hill above is less
 * than `cover` over the lining (or everywhere, when the hill never rises above
 * the roof, so there are no portals), and a white post at each portal.
 */
export class TunnelEditor extends PolyPointEditor {
  constructor(ec) {
    super(ec, {
      featureType: 'tunnel',
      lineColor: LINE_COLOR_TUNNEL,
      materials: { normal: 'tunnelNode', active: 'tunnelNodeActive', selected: 'tunnelNodeSelected' },
      spherePrefix: 'tnPt_',
      linePrefix: 'tnLines_',
    });
  }

  _newFeature() {
    return { type: 'tunnel', points: [], ...TUNNEL_DEFAULTS };
  }

  _derive(feature) {
    return deriveTunnel(feature, (x, z) => this.track.getHeightAt(x, z));
  }

  _buildLine(feature) {
    const tunnel = feature.points?.length >= 2 ? this._derive(feature) : null;
    if (!tunnel) return super._buildLine(feature);
    const { stations, portals, lowCover } = tunnel;
    const lines = [], colors = [];
    const lineY = (st) => gizmoLineY(this.track, st.x, st.z);
    for (let k = 1; k < stations.length; k++) {
      const a = stations[k - 1], b = stations[k];
      const c = !portals || lowCover[k - 1] || lowCover[k] ? WARN : LINE;
      lines.push([new Vector3(a.x, lineY(a), a.z), new Vector3(b.x, lineY(b), b.z)]);
      colors.push([c, c]);
    }
    if (portals) {
      for (const k of [portals.in, portals.out]) {
        const st = stations[k];
        lines.push([new Vector3(st.x, st.floorY, st.z), new Vector3(st.x, gizmoY(this.track, st.x, st.z), st.z)]);
        colors.push([PORTAL, PORTAL]);
      }
    }
    const ls = MeshBuilder.CreateLineSystem(`${this._cfg.linePrefix}${Date.now()}`, { lines, colors }, this.scene);
    ls.isPickable = false;
    return ls;
  }

  _rebuildGeometry(feature) {
    rebuild.tunnel?.(feature ?? null);
  }

  /** Portals move with the terrain, so rebuild the tunnels along with the handles. */
  refreshGizmoHeights() {
    super.refreshGizmoHeights();
    if (this._gizmos.length) rebuild.tunnel?.(null);
  }

  _syncStoreExtra(s, feature, idx) {
    s.maxRadius = this._maxRadiusFor(feature, idx);
    s.width = feature.width ?? TUNNEL_DEFAULTS.width;
    s.height = feature.height ?? TUNNEL_DEFAULTS.height;
    s.cover = feature.cover ?? TUNNEL_DEFAULTS.cover;

    const tunnel = feature.points.length >= 2 ? this._derive(feature) : null;
    s.status = !tunnel ? 'Add at least two points.'
      : !tunnel.portals ? 'The hill never rises above the roof: no portals.'
      : tunnel.lowCover.some(Boolean) ? `Less than ${s.cover} m of hill above the lining in places (red).`
      : '';

    const pt = idx !== null ? feature.points[idx] : null;
    s.floorAuto = !Number.isFinite(pt?.floorY);
    s.floorY = pt ? (s.floorAuto ? this._autoFloorAt(tunnel, pt) : pt.floorY) : 0;
  }

  /** The derived floor height nearest a control point (what "auto" gives there). */
  _autoFloorAt(tunnel, pt) {
    if (!tunnel) return this.track.getHeightAt(pt.x, pt.z);
    let best = tunnel.stations[0], bestD = Infinity;
    for (const st of tunnel.stations) {
      const d = (st.x - pt.x) ** 2 + (st.z - pt.z) ** 2;
      if (d < bestD) { bestD = d; best = st; }
    }
    return best.floorY;
  }

  // ── Public API expected by EditorController ──────────────────────────────

  addTunnelFeature() { this._addFeature(); }
  insertTunnelPoint() { this.insertPointAfterSelected(); }
  deleteTunnelPoint() { this.deleteSelectedPoint(); }
  deleteTunnel() { this.deleteActiveFeature(); }
  duplicateTunnel() { this.duplicateActiveFeature(); }

  // ── Panel property setters ───────────────────────────────────────────────

  _changeFeature(prop, val) {
    if (!this._active) return;
    this.ec.saveSnapshot(true);
    this._active.feature[prop] = val;
    this._afterChange(this._active);
  }

  _changePoint(apply) {
    if (!this.selectedPoint) return;
    this.ec.saveSnapshot(true);
    apply(this.selectedPoint.gz.feature.points[this.selectedPoint.idx]);
    this._afterChange(this.selectedPoint.gz);
  }

  _afterChange(gz) {
    this._updatePositions(gz);
    this._syncStore(gz.feature, this.selectedPoint?.gz === gz ? this.selectedPoint.idx : null);
    this._rebuildNow(gz.feature);
  }

  changeTunnelWidth(val) { this._changeFeature('width', val); }
  changeTunnelHeight(val) { this._changeFeature('height', val); }
  changeTunnelCover(val) { this._changeFeature('cover', val); }
  changeTunnelRadius(val) { this._changePoint((pt) => { pt.radius = val; }); }
  changeTunnelFloorY(val) { this._changePoint((pt) => { pt.floorY = val; }); }

  /** Auto: drop the point's pinned floorY. Pinned: start from the auto height there. */
  changeTunnelFloorAuto(auto) {
    this._changePoint((pt) => {
      if (auto) delete pt.floorY;
      else pt.floorY = parseFloat(this._autoFloorAt(this._derive(this._active.feature), pt).toFixed(2));
    });
  }

  // Moving a point changes the derived floor/portals the panel reports.
  _flushRebuild() {
    super._flushRebuild();
    if (this.selectedPoint) this._syncStore(this.selectedPoint.gz.feature, this.selectedPoint.idx);
  }
}
