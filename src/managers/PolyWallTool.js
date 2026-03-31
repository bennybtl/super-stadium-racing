import { Vector3, StandardMaterial, Color3, MeshBuilder } from "@babylonjs/core";

/**
 * PolyWallTool – place and edit polyWall features in the track editor.
 *
 * Each control point is represented by a pickable sphere. Clicking a sphere
 * selects it; WASD moves it (via EditorController camera logic delegation) or
 * it can be dragged. The panel lets the user:
 *   • adjust the selected point's smoothing (0 = sharp, 10 = full Catmull-Rom)
 *   • insert a point after the selected one
 *   • delete the selected point (minimum 2 kept)
 *   • set global wall height & thickness
 *   • close the panel (gizmos stay visible)
 *
 * Multiple polyWall features can exist; each gets its own PolyWallTool instance.
 * This tool manages ONE feature at a time (the "active" one). Clicking a gizmo
 * from a different feature switches focus.
 */
const POINT_HEIGHT_OFFSET = 0.7
export class PolyWallTool {
  constructor(editorController) {
    this.ec    = editorController;
    this.scene = null;
    this.track = null;

    // All poly wall gizmo sets, keyed by feature
    this._wallGizmos = []; // [{ feature, pointMeshes, lineSystem }]
    this._activeWall = null; // one entry from _wallGizmos

    this.selectedPoint = null; // { wallGizmo, idx, mesh }

    // Materials
    this.normalMat    = null;
    this.activeMat    = null;  // active-wall (not selected) points
    this.highlightMat = null;

    this.propertiesPanel = null;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  activate(scene, track) {
    this.scene = scene;
    this.track = track;

    this.normalMat = new StandardMaterial('pwNormal', scene);
    this.normalMat.diffuseColor  = new Color3(0.9, 0.55, 0.05);
    this.normalMat.emissiveColor = new Color3(0.3, 0.15, 0.0);
    this.normalMat.alpha = 0.90;

    this.activeMat = new StandardMaterial('pwActive', scene);
    this.activeMat.diffuseColor  = new Color3(1.0, 0.7, 0.2);
    this.activeMat.emissiveColor = new Color3(0.4, 0.22, 0.0);
    this.activeMat.alpha = 0.90;

    this.highlightMat = new StandardMaterial('pwHighlight', scene);
    this.highlightMat.diffuseColor  = new Color3(1.0, 1.0, 0.2);
    this.highlightMat.emissiveColor = new Color3(0.6, 0.6, 0.0);

    this.createPanel();

    // Build gizmos for any polyWalls already in the track
    for (const f of track.features) {
      if (f.type === 'polyWall') this._createWallGizmos(f);
    }
  }

  deactivate() {
    this._destroyAllGizmos();
    this.deselectPoint();
    this._activeWall = null;
    this.hidePanel();
    if (this.propertiesPanel) {
      document.body.removeChild(this.propertiesPanel);
      this.propertiesPanel = null;
    }
    if (this.normalMat)    { this.normalMat.dispose();    this.normalMat    = null; }
    if (this.activeMat)    { this.activeMat.dispose();    this.activeMat    = null; }
    if (this.highlightMat) { this.highlightMat.dispose(); this.highlightMat = null; }
    this.scene = null;
    this.track = null;
  }

  // ─── Adding a new poly wall ───────────────────────────────────────────────

  addPolyWallFeature() {
    const cam = this.ec.camera;
    const dir = cam.getTarget().subtract(cam.position).normalize();
    const cx  = cam.position.x + dir.x * 30;
    const cz  = cam.position.z + dir.z * 30;

    const feature = {
      type:      'polyWall',
      points:    [
        { x: cx - 10, z: cz - 5,  smoothing: 0 },
        { x: cx,      z: cz + 5,  smoothing: 0 },
        { x: cx + 10, z: cz - 5,  smoothing: 0 },
        { x: cx + 20, z: cz + 5,  smoothing: 0 },
      ],
      height:    2,
      thickness: 0.5,
      friction:  0.1,
    };

    this.ec.saveSnapshot();
    this.track.features.push(feature);
    const wg = this._createWallGizmos(feature);
    this._setActiveWall(wg);
    this.showPanel(feature);
    this._rebuildWall(feature);
  }

  // ─── Gizmo management ─────────────────────────────────────────────────────

  _createWallGizmos(feature) {
    const pointMeshes = feature.points.map((pt, idx) =>
      this._createPointSphere(feature, idx)
    );
    const lineSystem = this._buildLineSystem(feature);
    const wg = { feature, pointMeshes, lineSystem };
    this._wallGizmos.push(wg);
    return wg;
  }

  _destroyWallGizmos(wg) {
    for (const m of wg.pointMeshes) m.dispose();
    wg.pointMeshes = [];
    if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
    const idx = this._wallGizmos.indexOf(wg);
    if (idx > -1) this._wallGizmos.splice(idx, 1);
    if (this._activeWall === wg) this._activeWall = null;
  }

  _destroyAllGizmos() {
    for (const wg of [...this._wallGizmos]) this._destroyWallGizmos(wg);
    this._wallGizmos = [];
  }

  _createPointSphere(feature, idx) {
    const pt = feature.points[idx];
    const y  = this.track.getHeightAt(pt.x, pt.z) + POINT_HEIGHT_OFFSET + (feature?.height || 0);
    const mesh = MeshBuilder.CreateSphere(`pwPt_${idx}_${Date.now()}`, {
      diameter: 1.4,
      segments: 6,
    }, this.scene);
    mesh.position  = new Vector3(pt.x, y + 0.7, pt.z);
    mesh.material  = this._activeWall?.feature === feature ? this.activeMat : this.normalMat;
    mesh.isPickable = true;
    return mesh;
  }

  _buildLineSystem(feature) {
    if (!feature.points || feature.points.length < 2) return null;

    // Draw the raw (control) polyline
    const ctrlPts = feature.points.map(pt => {
      const y = this.track.getHeightAt(pt.x, pt.z) + (feature?.height || 0);
      return new Vector3(pt.x, y + 0.15, pt.z);
    });

    // Also draw the expanded (smoothed) preview
    const expanded = this._expandPreview(feature.points);
    const smoothPts = expanded.map(pt => {
      const y = this.track.getHeightAt(pt.x, pt.z);
      return new Vector3(pt.x, y + 0.12, pt.z);
    });

    const lines = [ctrlPts, smoothPts];
    const ls = MeshBuilder.CreateLineSystem(`pwLines_${Date.now()}`, { lines }, this.scene);
    ls.color      = new Color3(1.0, 0.65, 0.1);
    ls.isPickable = false;
    return ls;
  }

  /** Lightweight version of expandPolyline for preview purposes */
  _expandPreview(points) {
    if (points.length < 2) return points;
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const smooth = ((p1.smoothing ?? 0) + (p2.smoothing ?? 0)) / 2 / 10;
      if (smooth < 0.01) {
        out.push({ x: p1.x, z: p1.z });
      } else {
        const steps = Math.max(4, Math.round(smooth * 16));
        for (let t = 0; t < steps; t++) {
          const u = t / steps;
          const u2 = u * u, u3 = u2 * u;
          const b0 = -0.5*u3+u2-0.5*u, b1=1.5*u3-2.5*u2+1, b2=-1.5*u3+2*u2+0.5*u, b3=0.5*u3-0.5*u2;
          const cx = b0*p0.x+b1*p1.x+b2*p2.x+b3*p3.x;
          const cz = b0*p0.z+b1*p1.z+b2*p2.z+b3*p3.z;
          const sx = p1.x+(p2.x-p1.x)*u, sz = p1.z+(p2.z-p1.z)*u;
          out.push({ x: sx+(cx-sx)*smooth, z: sz+(cz-sz)*smooth });
        }
      }
    }
    out.push({ x: points[points.length-1].x, z: points[points.length-1].z });
    return out;
  }

  _refreshWallGizmos(wg) {
    // Rebuild point meshes to match current point count
    for (const m of wg.pointMeshes) m.dispose();
    wg.pointMeshes = wg.feature.points.map((_, idx) => {
      const m = this._createPointSphere(wg.feature, idx);
      // Re-apply correct material
      if (this._activeWall === wg) {
        m.material = this.activeMat;
      }
      if (this.selectedPoint && this.selectedPoint.wg === wg && this.selectedPoint.idx === idx) {
        m.material = this.highlightMat;
      }
      return m;
    });
    if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
    wg.lineSystem = this._buildLineSystem(wg.feature);
  }

  _updatePointPositions(wg, { rebuildLines = true } = {}) {
    const { feature, pointMeshes } = wg;
    for (let i = 0; i < pointMeshes.length; i++) {
      const pt = feature.points[i];
      if (!pt) continue;
      const y = this.track.getHeightAt(pt.x, pt.z) + POINT_HEIGHT_OFFSET + (this._activeWall?.feature?.height || 0);
      pointMeshes[i].position.set(pt.x, y + 0.7, pt.z);
    }
    if (rebuildLines) {
      if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
      wg.lineSystem = this._buildLineSystem(feature);
    }
  }

  /**
   * Debounced rebuild of the line system preview + physics wall.
   * Called during continuous movement so we don't thrash WebGL every frame.
   */
  _rebuildDeferred(wg, delayMs = 120) {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      if (!this.scene) return; // tool was deactivated
      if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
      wg.lineSystem = this._buildLineSystem(wg.feature);
      this._rebuildWall(wg.feature);
    }, delayMs);
  }

  _setActiveWall(wg) {
    // Dim the previously active wall
    if (this._activeWall && this._activeWall !== wg) {
      for (const m of this._activeWall.pointMeshes) m.material = this.normalMat;
    }
    this._activeWall = wg;
    if (wg) {
      for (const m of wg.pointMeshes) m.material = this.activeMat;
    }
  }

  // ─── Selection ────────────────────────────────────────────────────────────

  selectPoint(wg, idx) {
    this.deselectPoint();
    this._setActiveWall(wg);
    const mesh = wg.pointMeshes[idx];
    this.selectedPoint = { wg, idx, mesh };
    mesh.material = this.highlightMat;
    this.showPanel(wg.feature);
    this._syncPanelToPoint();
  }

  deselectPoint() {
    if (this.selectedPoint) {
      const { wg, idx, mesh } = this.selectedPoint;
      // Restore material (active or normal depending on whether wall is still active)
      mesh.material = this._activeWall === wg ? this.activeMat : this.normalMat;
      this.selectedPoint = null;
    }
    this._rawDrag = null;  // clear stale drag origin so next selection starts fresh
    this._syncPanelToPoint();
  }

  // ─── Point movement (called from EditorController.update) ─────────────────

  /**
   * Move the selected point by (dx, dz). Returns the actual delta so the
   * camera can pan to follow, mirroring the pattern used for hills etc.
   */
  moveSelectedPoint(dx, dz) {
    if (!this.selectedPoint) return { x: 0, z: 0 };
    this.ec.saveSnapshot(true);
    const { wg, idx } = this.selectedPoint;
    const pt = wg.feature.points[idx];

    // Support raw drag + snap
    if (!this._rawDrag) this._rawDrag = { x: pt.x, z: pt.z };
    this._rawDrag.x += dx;
    this._rawDrag.z += dz;
    const prevX = pt.x, prevZ = pt.z;
    pt.x = this.ec._snap(this._rawDrag.x);
    pt.z = this.ec._snap(this._rawDrag.z);

    // Update sphere positions only — no line system or physics rebuild every frame.
    this._updatePointPositions(wg, { rebuildLines: false });
    // Defer the expensive line + physics rebuild until movement pauses.
    this._rebuildDeferred(wg);
    return { x: pt.x - prevX, z: pt.z - prevZ };
  }

  beginDrag() {
    if (!this.selectedPoint) return;
    const { wg, idx } = this.selectedPoint;
    const pt = wg.feature.points[idx];
    this._rawDrag = { x: pt.x, z: pt.z };
  }

  endDrag() {
    this._rawDrag = null;
    // Flush any pending deferred rebuild immediately now that movement has stopped.
    if (this._rebuildTimer && this.selectedPoint) {
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = null;
      const { wg } = this.selectedPoint;
      if (wg.lineSystem) { wg.lineSystem.dispose(); wg.lineSystem = null; }
      wg.lineSystem = this._buildLineSystem(wg.feature);
      this._rebuildWall(wg.feature);
    }
  }

  // ─── Pointer / key delegation ──────────────────────────────────────────────

  /**
   * Returns true if this tool consumed the click.
   */
  onPointerDown(pickedMesh) {
    for (const wg of this._wallGizmos) {
      for (let idx = 0; idx < wg.pointMeshes.length; idx++) {
        if (pickedMesh === wg.pointMeshes[idx]) {
          if (this.selectedPoint && this.selectedPoint.wg === wg && this.selectedPoint.idx === idx) {
            this.deselectPoint();
          } else {
            this.selectPoint(wg, idx);
          }
          return true;
        }
      }
    }
    this.deselectPoint();
    return false;
  }

  // ─── Wall operations ──────────────────────────────────────────────────────

  _rebuildWall(feature) {
    window.rebuildTerrainGrid?.(); // keep terrain type grid in sync
    // Signal WallManager to rebuild this wall — EditorController exposes this
    window.rebuildPolyWall?.(feature);
  }

  insertPointAfterSelected() {
    if (!this.selectedPoint) return;
    const { wg, idx } = this.selectedPoint;
    const pts = wg.feature.points;
    const p1  = pts[idx];
    const p2  = pts[Math.min(idx + 1, pts.length - 1)];
    const newPt = {
      x: (p1.x + p2.x) / 2,
      z: (p1.z + p2.z) / 2,
      smoothing: p1.smoothing ?? 0,
    };
    this.ec.saveSnapshot();
    pts.splice(idx + 1, 0, newPt);
    this._refreshWallGizmos(wg);
    this.selectPoint(wg, idx + 1);
    this._rebuildWall(wg.feature);
  }

  deleteSelectedPoint() {
    if (!this.selectedPoint) return;
    const { wg, idx } = this.selectedPoint;
    if (wg.feature.points.length <= 2) return; // keep minimum
    this.ec.saveSnapshot();
    wg.feature.points.splice(idx, 1);
    this.deselectPoint();
    this._refreshWallGizmos(wg);
    // Select nearest remaining point
    const newIdx = Math.min(idx, wg.feature.points.length - 1);
    this.selectPoint(wg, newIdx);
    this._rebuildWall(wg.feature);
  }

  deleteActiveWall() {
    if (!this._activeWall) return;
    this.ec.saveSnapshot();
    const wg = this._activeWall;
    const fi = this.track.features.indexOf(wg.feature);
    if (fi > -1) this.track.features.splice(fi, 1);
    this.deselectPoint();
    this._destroyWallGizmos(wg);
    this._activeWall = null;
    this.hidePanel();
    window.rebuildPolyWall?.(null); // signal full rebuild
  }

  // ─── Called after undo / redo ─────────────────────────────────────────────

  onSnapshotRestored() {
    this._destroyAllGizmos();
    this.deselectPoint();
    this._activeWall = null;
    for (const f of this.track.features) {
      if (f.type === 'polyWall') this._createWallGizmos(f);
    }
    this.hidePanel();
  }

  // ─── Panel ────────────────────────────────────────────────────────────────

  createPanel() {
    const panel = document.createElement('div');
    panel.id = 'poly-wall-panel';
    panel.style.cssText = `
      position: fixed;
      top: 80px;
      left: 280px;
      background: rgba(0,0,0,0.88);
      padding: 18px 20px 16px;
      border-radius: 10px;
      border: 2px solid #f5a623;
      display: none;
      z-index: 1000;
      width: 240px;
      font-family: Arial, sans-serif;
      color: white;
      user-select: none;
      pointer-events: auto;
    `;

    const ACCENT = '#f5a623';

    // Title + close
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;';
    const titleEl = Object.assign(document.createElement('div'), { textContent: 'Poly Wall' });
    titleEl.style.cssText = `font-size:13px; font-weight:bold; color:${ACCENT}; text-transform:uppercase; letter-spacing:1px;`;
    const closeBtn = Object.assign(document.createElement('button'), { textContent: '×', title: 'Close panel' });
    closeBtn.style.cssText = 'background:none; border:none; color:#888; font-size:18px; cursor:pointer; padding:0 2px;';
    closeBtn.addEventListener('mouseover', () => closeBtn.style.color = 'white');
    closeBtn.addEventListener('mouseout',  () => closeBtn.style.color = '#888');
    closeBtn.addEventListener('click', () => this.hidePanel());
    titleRow.appendChild(titleEl);
    titleRow.appendChild(closeBtn);
    panel.appendChild(titleRow);

    const mkRow = (labelText) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;';
      row.appendChild(Object.assign(document.createElement('span'), { textContent: labelText }));
      return row;
    };
    const mkVal = (id, text) => {
      const v = Object.assign(document.createElement('span'), { id, textContent: text });
      v.style.color = ACCENT;
      return v;
    };
    const mkSlider = (id, min, max, step, value) => {
      const s = document.createElement('input');
      Object.assign(s, { type: 'range', id, min, max, step, value });
      s.style.cssText = `width:100%; accent-color:${ACCENT}; margin-bottom:14px; cursor:pointer;`;
      panel.appendChild(s);
      return s;
    };
    const mkBtn = (text, bg, fg, mb) => {
      const b = Object.assign(document.createElement('button'), { textContent: text });
      b.style.cssText = `display:block; width:100%; padding:8px; background:${bg}; color:${fg ?? 'white'}; border:none; border-radius:5px; cursor:pointer; font-size:13px; font-family:Arial; margin-bottom:${mb ?? 8}px;`;
      panel.appendChild(b);
      return b;
    };
    const mkSep = () => {
      const hr = document.createElement('hr');
      hr.style.cssText = 'border:none; border-top:1px solid #2a3a3a; margin:2px 0 14px;';
      panel.appendChild(hr);
    };
    const mkSectionTitle = (text) => {
      const d = Object.assign(document.createElement('div'), { textContent: text });
      d.style.cssText = 'font-size:10px; font-weight:bold; color:#666; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px;';
      panel.appendChild(d);
    };

    // ── Selected point ──
    mkSectionTitle('Selected Point');

    const smoothRow = mkRow('Smoothing');
    const smoothVal = mkVal('pw-smooth-val', '0');
    smoothRow.appendChild(smoothVal);
    panel.appendChild(smoothRow);
    const smoothSlider = mkSlider('pw-smooth-slider', '0', '10', '0.5', '0');

    const hint = document.createElement('div');
    hint.textContent = 'WASD to move selected point';
    hint.style.cssText = 'font-size:10px; color:#777; margin-bottom:14px;';
    panel.appendChild(hint);

    const insertBtn = mkBtn('Insert Point After', '#2980b9', 'white', 8);
    const deletePointBtn = mkBtn('Delete Point', '#8e3020', 'white', 0);

    mkSep();

    // ── Wall properties ──
    mkSectionTitle('Wall Properties');

    const heightRow = mkRow('Height');
    const heightVal = mkVal('pw-height-val', '2.0');
    heightRow.appendChild(heightVal);
    panel.appendChild(heightRow);
    const heightSlider = mkSlider('pw-height-slider', '0.5', '8', '0.5', '2');

    const thickRow = mkRow('Thickness');
    const thickVal = mkVal('pw-thick-val', '0.5');
    thickRow.appendChild(thickVal);
    panel.appendChild(thickRow);
    const thickSlider = mkSlider('pw-thick-slider', '0.2', '3', '0.1', '0.5');

    mkSep();
    const deleteWallBtn = mkBtn('Delete Wall', '#c0392b', 'white', 0);

    // ── Event wiring ──
    smoothSlider.addEventListener('input', () => {
      const val = parseFloat(smoothSlider.value);
      document.getElementById('pw-smooth-val').textContent = val.toFixed(1);
      if (!this.selectedPoint) return;
      this.ec.saveSnapshot(true);
      this.selectedPoint.wg.feature.points[this.selectedPoint.idx].smoothing = val;
      this._updatePointPositions(this.selectedPoint.wg);
      this._rebuildWall(this.selectedPoint.wg.feature);
    });

    heightSlider.addEventListener('input', () => {
      const val = parseFloat(heightSlider.value);
      document.getElementById('pw-height-val').textContent = val.toFixed(1);
      if (!this._activeWall) return;
      this.ec.saveSnapshot(true);
      this._activeWall.feature.height = val;
      this._rebuildWall(this._activeWall.feature);
    });

    thickSlider.addEventListener('input', () => {
      const val = parseFloat(thickSlider.value);
      document.getElementById('pw-thick-val').textContent = val.toFixed(1);
      if (!this._activeWall) return;
      this.ec.saveSnapshot(true);
      this._activeWall.feature.thickness = val;
      this._rebuildWall(this._activeWall.feature);
    });

    insertBtn.addEventListener('click',      () => this.insertPointAfterSelected());
    deletePointBtn.addEventListener('click', () => this.deleteSelectedPoint());
    deleteWallBtn.addEventListener('click',  () => this.deleteActiveWall());

    panel.addEventListener('mousedown', e => e.stopPropagation());
    panel.addEventListener('wheel',     e => e.stopPropagation());

    document.body.appendChild(panel);
    this.propertiesPanel = panel;
  }

  showPanel(feature) {
    if (!this.propertiesPanel) return;
    const get = id => document.getElementById(id);
    const hs = get('pw-height-slider'), hv = get('pw-height-val');
    if (hs) { hs.value = feature.height ?? 2; hv.textContent = (feature.height ?? 2).toFixed(1); }
    const ts = get('pw-thick-slider'),  tv = get('pw-thick-val');
    if (ts) { ts.value = feature.thickness ?? 0.5; tv.textContent = (feature.thickness ?? 0.5).toFixed(1); }
    this._syncPanelToPoint();
    this.propertiesPanel.style.display = 'block';
  }

  hidePanel() {
    if (this.propertiesPanel) this.propertiesPanel.style.display = 'none';
  }

  _syncPanelToPoint() {
    const get = id => document.getElementById(id);
    const ss = get('pw-smooth-slider'), sv = get('pw-smooth-val');
    const insertBtn     = this.propertiesPanel?.querySelector('button:nth-of-type(1)');

    if (this.selectedPoint) {
      const smooth = this.selectedPoint.wg.feature.points[this.selectedPoint.idx].smoothing ?? 0;
      if (ss) { ss.value = smooth; ss.disabled = false; }
      if (sv) sv.textContent = smooth.toFixed(1);
    } else {
      if (ss) { ss.value = 0; ss.disabled = true; }
      if (sv) sv.textContent = '—';
    }
  }
}
