import { Vector3, StandardMaterial, Color3, MeshBuilder } from "@babylonjs/core";

/**
 * MeshGridTool – terrain mesh deformation via a grid of selectable control points.
 *
 * A single `meshGrid` feature is stored in the track's features array.  Each
 * grid intersection is represented by a pickable sphere gizmo; clicking one
 * selects it and the user can then raise/lower it with the mouse wheel or the
 * [ / ] keys.  Grid density (cols × rows) and bounds (width × depth) are
 * configurable from the panel and take effect when "Apply Grid Changes" is
 * pressed, resampling existing heights into the new resolution.
 *
 * Height values are stored row-major in `feature.heights[]` and are bilinearly
 * interpolated in `Track.getHeightAt`.
 */
export class MeshGridTool {
  constructor(editorController) {
    this.ec           = editorController;   // EditorController reference
    this.scene        = null;
    this.track        = null;
    this.activeFeature = null;

    // Gizmo state
    this.pointMeshes   = [];   // [{ mesh, r, c }]
    this.selectedPoint = null; // one of pointMeshes entries
    this.lineSystem    = null;

    // Materials (created in activate)
    this.normalMat    = null;
    this.highlightMat = null;

    // UI
    this.propertiesPanel = null;
    this.stepSize        = 0.5;

    this._boundWheel = this._onWheel.bind(this);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  activate(scene, track) {
    this.scene = scene;
    this.track = track;

    this.normalMat = new StandardMaterial('mgNormal', scene);
    this.normalMat.diffuseColor  = new Color3(0.15, 0.75, 0.75);
    this.normalMat.emissiveColor = new Color3(0.03, 0.25, 0.25);
    this.normalMat.alpha = 0.90;

    this.highlightMat = new StandardMaterial('mgHighlight', scene);
    this.highlightMat.diffuseColor  = new Color3(1.0, 0.85, 0.0);
    this.highlightMat.emissiveColor = new Color3(0.55, 0.42, 0.0);

    this.createPanel();
    document.addEventListener('wheel', this._boundWheel, { passive: false });

    // Build gizmos for a meshGrid that already exists in the track (e.g. loaded file)
    const existing = track.features.find(f => f.type === 'meshGrid');
    if (existing) {
      this.activeFeature = existing;
      this.createGizmos(existing);
      this.showPanel(existing);
    }
  }

  deactivate() {
    document.removeEventListener('wheel', this._boundWheel);
    this.destroyGizmos();
    this.hidePanel();
    if (this.propertiesPanel) {
      document.body.removeChild(this.propertiesPanel);
      this.propertiesPanel = null;
    }
    if (this.normalMat)    { this.normalMat.dispose();    this.normalMat    = null; }
    if (this.highlightMat) { this.highlightMat.dispose(); this.highlightMat = null; }
    this.activeFeature = null;
    this.selectedPoint = null;
    this.scene = null;
    this.track = null;
  }

  // ─── Feature management ───────────────────────────────────────────────────

  /** Called from EditorController "Add Entity → Mesh Grid" */
  addMeshGridFeature() {
    if (this.activeFeature) {
      // Already exists – just ensure the panel is visible
      this.showPanel(this.activeFeature);
      return;
    }

    const cols = 9, rows = 9;
    const feature = {
      type:    'meshGrid',
      centerX: 0,
      centerZ: 0,
      width:   160,
      depth:   160,
      cols,
      rows,
      heights: new Array(cols * rows).fill(0),
    };

    this.ec.saveSnapshot();
    this.track.features.push(feature);
    this.activeFeature = feature;
    this.createGizmos(feature);
    this.showPanel(feature);
    window.rebuildTerrain?.();
  }

  deleteMeshGrid() {
    if (!this.activeFeature) return;
    this.ec.saveSnapshot();
    const idx = this.track.features.indexOf(this.activeFeature);
    if (idx > -1) this.track.features.splice(idx, 1);
    this.destroyGizmos();
    this.deselectPoint();
    this.activeFeature = null;
    this.hidePanel();
    window.rebuildTerrain?.();
    window.rebuildTerrainTexture?.();
  }

  flattenGrid() {
    if (!this.activeFeature) return;
    this.ec.saveSnapshot();
    this.activeFeature.heights.fill(0);
    this._updateGizmoPositions();
    window.rebuildTerrain?.();
  }

  /**
   * Resample the grid to new density + bounds in a single undo step.
   * Heights are bilinearly interpolated from the old grid into the new one.
   */
  applyGridChanges(newCols, newRows, newWidth, newDepth) {
    if (!this.activeFeature) return;
    this.ec.saveSnapshot();

    const f = this.activeFeature;
    const oldCols = f.cols, oldRows = f.rows, oldH = f.heights;

    // Resample heights
    const newH = [];
    for (let r = 0; r < newRows; r++) {
      for (let c = 0; c < newCols; c++) {
        const fc = (newCols > 1) ? c * (oldCols - 1) / (newCols - 1) : 0;
        const fr = (newRows > 1) ? r * (oldRows - 1) / (newRows - 1) : 0;
        const c0 = Math.max(0, Math.min(Math.floor(fc), oldCols - 2));
        const r0 = Math.max(0, Math.min(Math.floor(fr), oldRows - 2));
        const c1 = c0 + 1, r1 = r0 + 1;
        const tc = fc - c0, tr = fr - r0;
        newH.push(
          (oldH[r0 * oldCols + c0] ?? 0) * (1 - tc) * (1 - tr) +
          (oldH[r0 * oldCols + c1] ?? 0) *      tc  * (1 - tr) +
          (oldH[r1 * oldCols + c0] ?? 0) * (1 - tc) *      tr  +
          (oldH[r1 * oldCols + c1] ?? 0) *      tc  *      tr
        );
      }
    }

    f.cols   = newCols;
    f.rows   = newRows;
    f.width  = newWidth;
    f.depth  = newDepth;
    f.heights = newH;

    this.destroyGizmos();
    this.createGizmos(f);
    window.rebuildTerrain?.();
  }

  // ─── Gizmo creation / teardown ────────────────────────────────────────────

  createGizmos(feature) {
    this.destroyGizmos();

    const { cols, rows, centerX, centerZ, width, depth } = feature;
    const halfW  = width  / 2, halfD  = depth  / 2;
    const stepX  = cols > 1 ? width  / (cols - 1) : 0;
    const stepZ  = rows > 1 ? depth  / (rows - 1) : 0;
    const radius = Math.max(0.35, Math.min(1.4, Math.min(stepX, stepZ) * 0.09));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const worldX = centerX - halfW + c * stepX;
        const worldZ = centerZ - halfD + r * stepZ;
        const worldY = this.track.getHeightAt(worldX, worldZ);

        const mesh = MeshBuilder.CreateSphere(`mgPt_${r}_${c}`, {
          diameter: radius * 2,
          segments: 6,
        }, this.scene);
        mesh.position  = new Vector3(worldX, worldY, worldZ);
        mesh.material  = this.normalMat;
        mesh.isPickable = true;

        this.pointMeshes.push({ mesh, r, c });
      }
    }

    this._buildLineSystem(feature);
  }

  destroyGizmos() {
    for (const p of this.pointMeshes) p.mesh.dispose();
    this.pointMeshes = [];
    if (this.lineSystem) { this.lineSystem.dispose(); this.lineSystem = null; }
    this.selectedPoint = null;
  }

  _buildLineSystem(feature) {
    if (this.lineSystem) { this.lineSystem.dispose(); this.lineSystem = null; }

    const { cols, rows, centerX, centerZ, width, depth } = feature;
    const halfW = width / 2, halfD = depth / 2;
    const stepX = cols > 1 ? width  / (cols - 1) : 0;
    const stepZ = rows > 1 ? depth  / (rows - 1) : 0;
    const LINE_Y_OFFSET = 0.08;

    const lines = [];

    // Horizontal lines (each row left→right)
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const wx = centerX - halfW + c * stepX;
        const wz = centerZ - halfD + r * stepZ;
        row.push(new Vector3(wx, this.track.getHeightAt(wx, wz) + LINE_Y_OFFSET, wz));
      }
      lines.push(row);
    }

    // Vertical lines (each column top→bottom)
    for (let c = 0; c < cols; c++) {
      const col = [];
      for (let r = 0; r < rows; r++) {
        const wx = centerX - halfW + c * stepX;
        const wz = centerZ - halfD + r * stepZ;
        col.push(new Vector3(wx, this.track.getHeightAt(wx, wz) + LINE_Y_OFFSET, wz));
      }
      lines.push(col);
    }

    this.lineSystem = MeshBuilder.CreateLineSystem('mgLines', { lines }, this.scene);
    this.lineSystem.color       = new Color3(0.15, 0.65, 0.65);
    this.lineSystem.isPickable  = false;
  }

  /**
   * Refresh sphere Y positions and the line grid after height changes.
   * Called after each height adjustment before rebuildTerrain.
   */
  _updateGizmoPositions() {
    if (!this.activeFeature) return;
    const { cols, rows, centerX, centerZ, width, depth } = this.activeFeature;
    const halfW = width / 2, halfD = depth / 2;
    const stepX = cols > 1 ? width  / (cols - 1) : 0;
    const stepZ = rows > 1 ? depth  / (rows - 1) : 0;

    for (const p of this.pointMeshes) {
      const wx = centerX - halfW + p.c * stepX;
      const wz = centerZ - halfD + p.r * stepZ;
      p.mesh.position.y = this.track.getHeightAt(wx, wz);
    }

    this._buildLineSystem(this.activeFeature);
  }

  // ─── Selection ────────────────────────────────────────────────────────────

  selectPoint(pointData) {
    this.deselectPoint();
    this.selectedPoint = pointData;
    pointData.mesh.material = this.highlightMat;
    this._updateHeightDisplay();
    // Bring the panel back if it was closed, then focus the height input
    if (this.activeFeature) this.showPanel(this.activeFeature);
    const el = document.getElementById('mg-height-input');
    if (el) { requestAnimationFrame(() => { el.focus(); el.select(); }); }
  }

  deselectPoint() {
    if (this.selectedPoint) {
      this.selectedPoint.mesh.material = this.normalMat;
      this.selectedPoint = null;
    }
    this._updateHeightDisplay();
  }

  // ─── Height adjustment ────────────────────────────────────────────────────

  adjustHeight(delta) {
    if (!this.selectedPoint || !this.activeFeature) return;
    this.ec.saveSnapshot(true);
    const { r, c } = this.selectedPoint;
    const f = this.activeFeature;
    f.heights[r * f.cols + c] += delta;
    this._updateGizmoPositions();
    this._updateHeightDisplay();
    window.rebuildTerrain?.();
  }

  _onWheel(event) {
    if (!this.selectedPoint) return;
    // Only intercept when over the 3-D canvas, not the UI panel
    if (event.target && event.target.closest('#mesh-grid-panel')) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? this.stepSize : -this.stepSize;
    this.adjustHeight(delta);
  }

  // ─── Pointer / key event delegation ─────────────────────────────────────

  /**
   * Call from EditorController's handlePointerDown BEFORE other entity checks.
   * Returns true if this tool consumed the click.
   */
  onPointerDown(pickedMesh) {
    for (const p of this.pointMeshes) {
      if (pickedMesh === p.mesh) {
        if (this.selectedPoint === p) {
          this.deselectPoint();
        } else {
          this.selectPoint(p);
        }
        return true;
      }
    }
    // Clicked elsewhere – deselect any selected point but don't consume
    this.deselectPoint();
    return false;
  }

  /**
   * Call from EditorController's handleKeyDown.
   * Returns true if this tool consumed the key event.
   */
  onKeyDown(event) {
    if (!this.activeFeature) return false;

    const inputFocused = document.activeElement?.id === 'mg-height-input';

    if (event.key === 'ArrowDown') {
      // If the input is focused its own keydown handler adjusts the height;
      // skip here to avoid a double-step.
      if (inputFocused) return false;
      this.adjustHeight(-this.stepSize);
      return true;
    }
    if (event.key === 'ArrowUp') {
      if (inputFocused) return false;
      this.adjustHeight(this.stepSize);
      return true;
    }
    if (event.key === '[') {
      this.adjustHeight(-this.stepSize);
      return true;
    }
    if (event.key === ']') {
      this.adjustHeight(this.stepSize);
      return true;
    }
    return false;
  }

  // ─── Called by _applySnapshot (undo / redo) ───────────────────────────────

  /**
   * After undo/redo restores features[], tear down old gizmos and rebuild
   * from whatever meshGrid feature (if any) now exists in the track.
   */
  onSnapshotRestored() {
    this.destroyGizmos();
    this.deselectPoint();
    const f = this.track.features.find(f => f.type === 'meshGrid');
    if (f) {
      this.activeFeature = f;
      this.createGizmos(f);
      this.showPanel(f);
    } else {
      this.activeFeature = null;
      this.hidePanel();
    }
  }

  // ─── Properties panel ─────────────────────────────────────────────────────

  createPanel() {
    const panel = document.createElement('div');
    panel.id = 'mesh-grid-panel';
    panel.style.cssText = `
      position: fixed;
      top: 80px;
      left: 20px;
      background: rgba(0, 0, 0, 0.88);
      padding: 18px 20px 16px;
      border-radius: 10px;
      border: 2px solid #1ec8c8;
      display: none;
      z-index: 1000;
      width: 248px;
      font-family: Arial, sans-serif;
      color: white;
      user-select: none;
      pointer-events: auto;
    `;

    const ACCENT = '#1ec8c8';
    const mkRow = (label, id, initVal) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;';
      row.appendChild(Object.assign(document.createElement('span'), { textContent: label }));
      const val = Object.assign(document.createElement('span'), { id, textContent: initVal });
      val.style.color = ACCENT;
      row.appendChild(val);
      panel.appendChild(row);
    };
    const mkSlider = (id, min, max, step, value, accent) => {
      const s = document.createElement('input');
      s.type = 'range'; s.id = id;
      s.min = min; s.max = max; s.step = step; s.value = value;
      s.style.cssText = `width:100%; accent-color:${accent ?? ACCENT}; margin-bottom:14px; cursor:pointer;`;
      panel.appendChild(s);
      return s;
    };
    const mkBtn = (text, bg, fg, mb) => {
      const b = document.createElement('button');
      b.textContent = text;
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
      const d = document.createElement('div');
      d.textContent = text;
      d.style.cssText = 'font-size:10px; font-weight:bold; color:#666; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px;';
      panel.appendChild(d);
    };

    // ── Title + close button ──
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;';
    const title = document.createElement('div');
    title.textContent = 'Mesh Grid';
    title.style.cssText = `font-size:13px; font-weight:bold; color:${ACCENT}; text-transform:uppercase; letter-spacing:1px;`;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.title = 'Close panel';
    closeBtn.style.cssText = `background:none; border:none; color:#888; font-size:18px; line-height:1; cursor:pointer; padding:0 2px; font-family:Arial;`;
    closeBtn.addEventListener('mouseover', () => closeBtn.style.color = 'white');
    closeBtn.addEventListener('mouseout',  () => closeBtn.style.color = '#888');
    closeBtn.addEventListener('click', () => this.hidePanel());
    titleRow.appendChild(title);
    titleRow.appendChild(closeBtn);
    panel.appendChild(titleRow);

    // ── Selected point height (editable) ──
    const heightLabelRow = document.createElement('div');
    heightLabelRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; font-size:12px;';
    heightLabelRow.appendChild(Object.assign(document.createElement('span'), { textContent: 'Point Height' }));
    panel.appendChild(heightLabelRow);

    const heightInput = document.createElement('input');
    heightInput.type = 'number';
    heightInput.id = 'mg-height-input';
    heightInput.step = '0.1';
    heightInput.placeholder = '— select a point —';
    heightInput.disabled = true;
    heightInput.style.cssText = `
      width: 100%; box-sizing: border-box;
      padding: 6px 8px; margin-bottom: 14px;
      background: #1a2a2a; color: ${ACCENT};
      border: 1px solid ${ACCENT}; border-radius: 4px;
      font-size: 14px; font-family: monospace;
      outline: none; cursor: text;
    `;
    panel.appendChild(heightInput);

    // Commit on Enter, revert on Escape, nudge on ArrowUp/Down
    heightInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this._commitHeightInput();
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === 'Escape') {
        this._updateHeightDisplay(); // restore displayed value
        heightInput.blur();
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === 'ArrowUp') {
        this._commitHeightInput();
        this.adjustHeight(this.stepSize);
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === 'ArrowDown') {
        this._commitHeightInput();
        this.adjustHeight(-this.stepSize);
        e.preventDefault();
        e.stopPropagation();
      } else {
        // Prevent other editor hotkeys from firing while typing
        e.stopPropagation();
      }
    });

    // Also commit on blur so clicking away saves the value
    heightInput.addEventListener('blur', () => this._commitHeightInput());

    // Prevent panel mousedown from deselecting the 3-D point while typing
    heightInput.addEventListener('mousedown', e => e.stopPropagation());

    // ── Step size ──
    mkRow('Step Size', 'mg-step-val', '0.5');
    const stepSlider = mkSlider('mg-step-slider', '0.1', '5', '0.1', '0.5');

    const hint = document.createElement('div');
    hint.innerHTML = 'Click a sphere to select it.<br>Type a height &amp; press <strong>Enter</strong>, or<br>scroll wheel &nbsp;·&nbsp; <strong>↑ / ↓</strong> &nbsp;·&nbsp; <strong>[ / ]</strong> to nudge.';
    hint.style.cssText = 'font-size:10px; color:#777; margin-bottom:14px; line-height:1.5;';
    panel.appendChild(hint);

    mkSep();
    mkSectionTitle('Grid Settings');

    // ── Density ──
    mkRow('Density (cols × rows)', 'mg-density-val', '9 × 9');
    const densSlider = mkSlider('mg-density-slider', '3', '25', '2', '9');

    // ── Width ──
    mkRow('Width', 'mg-width-val', '160');
    const widthSlider = mkSlider('mg-width-slider', '20', '160', '10', '160');

    // ── Depth ──
    mkRow('Depth', 'mg-depth-val', '160');
    const depthSlider = mkSlider('mg-depth-slider', '20', '160', '10', '160');

    const applyBtn  = mkBtn('Apply Grid Changes', ACCENT, '#000', 12);
    applyBtn.style.fontWeight = 'bold';

    mkSep();

    const flatBtn   = mkBtn('Flatten Grid', '#2980b9', 'white', 8);
    const deleteBtn = mkBtn('Delete Mesh Grid', '#c0392b', 'white', 0);

    // ── Event wiring ──
    stepSlider.addEventListener('input', () => {
      this.stepSize = parseFloat(stepSlider.value);
      document.getElementById('mg-step-val').textContent = this.stepSize.toFixed(1);
    });

    densSlider.addEventListener('input', () => {
      const v = parseInt(densSlider.value);
      document.getElementById('mg-density-val').textContent = `${v} × ${v}`;
    });

    widthSlider.addEventListener('input', () => {
      document.getElementById('mg-width-val').textContent = widthSlider.value;
    });

    depthSlider.addEventListener('input', () => {
      document.getElementById('mg-depth-val').textContent = depthSlider.value;
    });

    applyBtn.addEventListener('click', () => {
      const dens  = parseInt(densSlider.value);
      const w     = parseFloat(widthSlider.value);
      const d     = parseFloat(depthSlider.value);
      this.applyGridChanges(dens, dens, w, d);
      // Re-sync display labels
      document.getElementById('mg-density-val').textContent = `${dens} × ${dens}`;
    });

    flatBtn.addEventListener('click',   () => this.flattenGrid());
    deleteBtn.addEventListener('click', () => this.deleteMeshGrid());

    // Stop events from bleeding through to the 3-D scene
    panel.addEventListener('mousedown', e => e.stopPropagation());
    panel.addEventListener('wheel',     e => e.stopPropagation());

    document.body.appendChild(panel);
    this.propertiesPanel = panel;
  }

  showPanel(feature) {
    if (!this.propertiesPanel) return;
    const get = id => document.getElementById(id);

    const ds = get('mg-density-slider'), dv = get('mg-density-val');
    if (ds) { ds.value = feature.cols; dv.textContent = `${feature.cols} × ${feature.rows}`; }

    const ws = get('mg-width-slider'),  wv = get('mg-width-val');
    if (ws) { ws.value = feature.width;  wv.textContent = String(feature.width); }

    const ds2 = get('mg-depth-slider'), dv2 = get('mg-depth-val');
    if (ds2) { ds2.value = feature.depth; dv2.textContent = String(feature.depth); }

    this.propertiesPanel.style.display = 'block';
  }

  hidePanel() {
    if (this.propertiesPanel) this.propertiesPanel.style.display = 'none';
  }

  _updateHeightDisplay() {
    const el = document.getElementById('mg-height-input');
    if (!el) return;
    if (this.selectedPoint && this.activeFeature) {
      const { r, c } = this.selectedPoint;
      const h = this.activeFeature.heights[r * this.activeFeature.cols + c];
      el.value = h.toFixed(2);
      el.disabled = false;
    } else {
      el.value = '';
      el.placeholder = '— select a point —';
      el.disabled = true;
    }
  }

  /** Apply whatever is currently typed in the height input to the selected point. */
  _commitHeightInput() {
    if (!this.selectedPoint || !this.activeFeature) return;
    const el = document.getElementById('mg-height-input');
    if (!el) return;
    const parsed = parseFloat(el.value);
    if (isNaN(parsed)) { this._updateHeightDisplay(); return; }
    this.ec.saveSnapshot(true);
    const { r, c } = this.selectedPoint;
    const f = this.activeFeature;
    f.heights[r * f.cols + c] = parsed;
    this._updateGizmoPositions();
    this._updateHeightDisplay();
    window.rebuildTerrain?.();
  }
}
