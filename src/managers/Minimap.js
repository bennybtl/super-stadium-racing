/**
 * Minimap — a small north-up track overview with a dot per truck.
 *
 * The track (AI racing line as the road, walls, checkpoint gates, the
 * start/finish line) is drawn once into an offscreen canvas; each frame only
 * blits that and draws the dots, so it costs next to nothing.
 *
 * It is a plain DOM canvas layered over the Babylon canvas but under the Vue
 * UI root (z-900), so pause/results overlays cover it without extra wiring.
 * World +X is canvas right and world +Z is canvas up, matching the default
 * 'fixed' camera, which looks down +Z.
 */

import { loadDisplaySettings } from "../settingsStorage.js";

const SIZE_PX = 190;
const PAD_PX = 12;
const ROAD_WIDTH_M = 9;  // drawn width of the racing line, world metres
const ROAD_MIN_PX = 5;
const BG = 'rgba(12, 12, 12, 0.6)';
const ROAD = 'rgba(200, 196, 188, 0.55)';
const WALL = 'rgba(20, 20, 20, 0.9)';
const GATE = 'rgba(255, 255, 255, 0.35)';
const FINISH = 'rgba(255, 255, 255, 0.95)';

/** Chaikin corner-cutting, so the coarse authored AI path reads as a road. */
function smooth(points, closed, iterations = 2) {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const out = [];
    const n = pts.length;
    const last = closed ? n : n - 1;
    if (!closed) out.push(pts[0]);
    for (let i = 0; i < last; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

export class Minimap {
  /**
   * @param {object} track  Track (features: aiPath, polyWall, checkpoint)
   * @param {object} [startFinish]  checkpoint feature to mark as the finish line
   */
  constructor(track, startFinish = null) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this._dpr = dpr;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = Math.round(SIZE_PX * dpr);
    Object.assign(this.canvas.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      width: `${SIZE_PX}px`,
      height: `${SIZE_PX}px`,
      borderRadius: '14px',
      boxShadow: '0 10px 12px rgba(0,0,0,0.55)',
      pointerEvents: 'none',
      zIndex: '800',
    });
    document.body.appendChild(this.canvas);
    this._ctx = this.canvas.getContext('2d');

    this._bg = document.createElement('canvas');
    this._bg.width = this._bg.height = this.canvas.width;
    this._drawTrack(track, startFinish);

    // Shown only while the Display setting is on and photo mode is off.
    this._enabled = loadDisplaySettings().minimap !== false;
    this._hidden = false;
    this._onDisplaySettingsChanged = (event) => {
      this._enabled = (event?.detail ?? loadDisplaySettings()).minimap !== false;
      this._applyVisibility();
    };
    window.addEventListener('offroad:display-settings-changed', this._onDisplaySettingsChanged);
    this._applyVisibility();
  }

  _applyVisibility() {
    this.canvas.style.display = this._enabled && !this._hidden ? '' : 'none';
  }

  _drawTrack(track, startFinish) {
    const features = track?.features ?? [];
    const aiPath = features.find(f => f.type === 'aiPath');
    const lines = [];
    if (aiPath?.points?.length >= 2) {
      lines.push({ pts: smooth(aiPath.points, true), closed: true });
      for (const b of aiPath.branches ?? []) {
        const from = aiPath.points[b.fromMainIndex];
        const to = aiPath.points[b.toMainIndex % aiPath.points.length];
        const pts = [from, ...(b.points ?? []), to].filter(Boolean);
        if (pts.length >= 2) lines.push({ pts: smooth(pts, false), closed: false });
      }
    }
    const walls = features.filter(f => f.type === 'polyWall' && f.points?.length >= 2);
    const gates = features.filter(f => f.type === 'checkpoint');

    // Fit the racing line + gates (not the whole ground plane) into the square.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const grow = (x, z, r = 0) => {
      minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r);
      minZ = Math.min(minZ, z - r); maxZ = Math.max(maxZ, z + r);
    };
    for (const l of lines) for (const p of l.pts) grow(p.x, p.z, ROAD_WIDTH_M);
    for (const g of gates) grow(g.centerX, g.centerZ, (g.width ?? 20) / 2);
    if (!Number.isFinite(minX)) {
      const hw = (track?.width ?? 160) / 2, hd = (track?.depth ?? 160) / 2;
      minX = -hw; maxX = hw; minZ = -hd; maxZ = hd;
    }
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    const px = this.canvas.width;
    const pad = PAD_PX * this._dpr;
    const scale = (px - pad * 2) / span;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    this._toCanvas = (x, z) => [px / 2 + (x - cx) * scale, px / 2 - (z - cz) * scale];
    this._scale = scale;

    const ctx = this._bg.getContext('2d');
    ctx.fillStyle = BG;
    ctx.beginPath();
    ctx.roundRect(0, 0, px, px, 14 * this._dpr);
    ctx.fill();

    const path = (pts, closed) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = this._toCanvas(p.x, p.z);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      if (closed) ctx.closePath();
    };
    ctx.lineJoin = ctx.lineCap = 'round';

    ctx.strokeStyle = ROAD;
    ctx.lineWidth = Math.max(ROAD_MIN_PX * this._dpr, ROAD_WIDTH_M * scale);
    for (const l of lines) { path(l.pts, l.closed); ctx.stroke(); }

    ctx.strokeStyle = WALL;
    ctx.lineWidth = Math.max(1.5 * this._dpr, 0.8 * scale);
    for (const w of walls) { path(w.points, !!w.closed); ctx.stroke(); }

    for (const g of gates) {
      const half = (g.width ?? 20) / 2;
      // Gates span perpendicular to their heading (see CheckpointManager).
      const ex = Math.cos(g.heading) * half, ez = -Math.sin(g.heading) * half;
      const [x0, y0] = this._toCanvas(g.centerX - ex, g.centerZ - ez);
      const [x1, y1] = this._toCanvas(g.centerX + ex, g.centerZ + ez);
      // By position: reverse races hand back a flipped copy of the feature.
      const finish = !!startFinish && g.centerX === startFinish.centerX && g.centerZ === startFinish.centerZ;
      ctx.strokeStyle = finish ? FINISH : GATE;
      ctx.lineWidth = (finish ? 3 : 1.5) * this._dpr;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }

  /**
   * Redraw with the current truck positions. Call once per render frame.
   * @param {{x:number, z:number, color:string, isPlayer?:boolean}[]} dots
   */
  update(dots) {
    if (!this._enabled) return;
    const ctx = this._ctx;
    const px = this.canvas.width;
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(this._bg, 0, 0);
    const r = 3.5 * this._dpr;
    // Player last, so it's never hidden under a pack of AI dots.
    for (const pass of [false, true]) {
      for (const d of dots) {
        if (!!d.isPlayer !== pass) continue;
        const [x, y] = this._toCanvas(d.x, d.z);
        ctx.beginPath();
        ctx.arc(x, y, d.isPlayer ? r * 1.45 : r, 0, Math.PI * 2);
        ctx.fillStyle = d.color;
        ctx.fill();
        ctx.lineWidth = (d.isPlayer ? 2 : 1) * this._dpr;
        ctx.strokeStyle = d.isPlayer ? '#fff' : 'rgba(0,0,0,0.7)';
        ctx.stroke();
      }
    }
  }

  /** Photo mode hides the map without touching the user's setting. */
  setVisible(visible) {
    this._hidden = !visible;
    this._applyVisibility();
  }

  dispose() {
    window.removeEventListener('offroad:display-settings-changed', this._onDisplaySettingsChanged);
    this.canvas.remove();
  }
}
