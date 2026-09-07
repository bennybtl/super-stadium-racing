import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  Mesh,
  VertexData,
} from "@babylonjs/core";
import { basicColors } from "../../constants.js";

const DEFAULT_POLE_HEIGHT = 4.2;
const POLE_RADIUS     = 0.16;
const STRING_RADIUS   = 0.05;
// Match the standalone Flag banner dimensions exactly
const FLAG_W          = 1.5;
const FLAG_H          = 1.6;
const FLAG_SPACING    = 1.7;  // slight gap between pennants
const N_ROPE_PTS      = 24;   // resolution of the catenary curve
// Sag: centre drops this fraction of total width
const SAG_FACTOR      = 0.06;

// ─── Wake sway ────────────────────────────────────────────────────────────
//
// A truck rushing underneath drags a slug of air with it. Rather than model
// that, a distance-weighted push is fed into two families of damped
// oscillators: the rope, as its first two lateral string modes sin(nπt), and
// each pennant, as a pendulum hanging off the rope axis. Both are forced along
// local Z — perpendicular to the span, which is the direction you actually
// drive through the banner.

/**
 * Falloff of a truck's wake: GUST_RADIUS across the ground, GUST_HEIGHT
 * vertically. The vertical figure is deliberately generous — banners in real
 * tracks are strung 6–14 m up, so a physically honest wake would never reach
 * them and nothing would ever move. Height still matters (a low banner gets
 * visibly more than a tall one), it just doesn't cut off.
 */
export const GUST_RADIUS = 5.0;
const GUST_HEIGHT = 14.0;
/** Perpendicular truck speed (m/s) at which the wake reaches full strength. */
const GUST_SPEED_REF = 12;
/** Below this the truck is coasting through and stirs nothing. */
const GUST_MIN_SPEED = 0.5;

/** Pennant pendulum: frequency (Hz), damping ratio, gust accel, swing clamp. */
const PENNANT_FREQ = 0.8;
const PENNANT_ZETA = 0.18;
const PENNANT_GUST = 11.0;
const PENNANT_MAX  = 0.8;   // rad (~46°)
/** ±this fraction of spread in per-pennant frequency, so they drift apart. */
const PENNANT_DETUNE = 0.08;

/**
 * Rope: fundamental ∝ 1/span like a plucked string, f1 = ROPE_WAVE_C / width,
 * floored so a 35 m span doesn't drift at 0.16 Hz — that reads as a slow slide
 * rather than a wobble.
 */
const ROPE_WAVE_C   = 5.6;
const ROPE_MIN_FREQ = 0.35;
const ROPE_ZETA     = 0.20;
const ROPE_GUST     = 3.0;
/** Lateral clamp: a fraction of the span, but never more than ROPE_MAX_M. */
const ROPE_MAX_FRAC = 0.02;
const ROPE_MAX_M    = 0.6;

/** Below this (rad / m and their rates) everything is considered at rest. */
const REST_EPS = 1e-3;
/** Longest integration substep — protects against frame hitches. */
const MAX_STEP = 1 / 120;

/**
 * Parabola approximation of a catenary.
 * t = 0..1 along the span; returns downward offset (negative = lower).
 */
function catenaryOffset(t, sag) {
  return -sag * 4 * t * (1 - t); // 0 at ends, -sag at centre
}

// Alternating pennant colours: red, blue, yellow
const FLAG_COLORS = [
  basicColors.red.diffuse,
  basicColors.blue.diffuse,
  basicColors.yellow.diffuse,
];

/**
 * BannerString — a decorative string of triangle pennant flags stretched
 * between two vertical poles.
 *
 * Feature format:
 *   { type: 'bannerString', x, z, heading, width }
 *
 * The container TransformNode is positioned at ground level (x, groundY, z)
 * and rotated to the requested heading.  All child meshes are in local space
 * so move/rotate/setWidth only need to touch the container or rebuild children.
 */
export class BannerString {
  constructor(feature, groundY, scene, shadows) {
    this.feature  = feature;
    this._scene   = scene;
    this._shadows = shadows ?? null;
    this._meshes  = [];

    this.container = new TransformNode(
      `bannerStr_${feature.x.toFixed(1)}_${feature.z.toFixed(1)}`,
      scene
    );
    this.container.position.copyFromFloats(feature.x, groundY, feature.z);
    this.container.rotation.y = feature.heading ?? 0;

    // ── Sway state ────────────────────────────────────────────────────
    // Rope: lateral amplitude (metres) of string modes 1 and 2.
    this._ropeAmp = [0, 0];
    this._ropeVel = [0, 0];
    /** Per-pennant pendulums: { mesh, t, x, y, w, swing, vel }. */
    this._pennants = [];
    this._awake = false;

    this._buildMeshes(feature.width, feature.poleHeight ?? DEFAULT_POLE_HEIGHT);
  }

  // ─── Private build ────────────────────────────────────────────────────────

  _buildMeshes(width, poleHeight = DEFAULT_POLE_HEIGHT) {
    // Dispose existing children (including their materials)
    for (const m of this._meshes) {
      m.material?.dispose();
      m.dispose();
    }
    this._meshes = [];
    this._pennants = [];
    this._ropeAmp.fill(0);
    this._ropeVel.fill(0);
    this._awake = false;

    const half  = width / 2;
    const scene = this._scene;

    // Shared pole / rope material
    const poleMat = new StandardMaterial("bannerPoleMat", scene);
    poleMat.diffuseColor  = basicColors.brown.diffuse;
    poleMat.specularColor = basicColors.brown.emissive;

    // Two vertical poles
    for (const side of [half, -half]) {
      const pole = MeshBuilder.CreateCylinder("bannerPole", {
        height: poleHeight, diameter: POLE_RADIUS * 2, tessellation: 8,
      }, scene);
      pole.parent     = this.container;
      pole.position   = new Vector3(side, poleHeight / 2, 0);
      pole.material   = poleMat;
      pole.isPickable = true;
      this._meshes.push(pole);
      if (this._shadows) this._shadows.addShadowCaster(pole);
    }

    // Catenary rope as a tube following the parabolic sag curve. The span
    // geometry is kept around so the sway maths can re-evaluate it per frame.
    const sag = width * SAG_FACTOR;
    this._half       = half;
    this._width      = width;
    this._sag        = sag;
    this._poleHeight = poleHeight;

    this._ropePath = [];
    for (let i = 0; i <= N_ROPE_PTS; i++) {
      const t   = i / N_ROPE_PTS;
      const px  = -half + width * t;
      const py  = poleHeight + catenaryOffset(t, sag);
      this._ropePath.push(new Vector3(px, py, 0));
    }
    this.rope = MeshBuilder.CreateTube("bannerRope", {
      path: this._ropePath, radius: STRING_RADIUS, tessellation: 5, cap: 0,
      updatable: true,
    }, scene);
    this.rope.parent     = this.container;
    this.rope.material   = poleMat;
    this.rope.isPickable = true;
    this._meshes.push(this.rope);

    // Triangle pennants hanging from the rope at catenary height
    const count = Math.max(1, Math.floor((width - 0.1) / FLAG_SPACING));
    for (let i = 0; i < count; i++) {
      const px = -half + FLAG_SPACING * (i + 0.5);
      const t  = (px + half) / width;                      // 0..1 along span
      const py = poleHeight + catenaryOffset(t, sag);       // match rope height

      const mat = new StandardMaterial(`bannerFlagMat_${i}`, scene);
      mat.diffuseColor    = FLAG_COLORS[i % FLAG_COLORS.length].clone();
      mat.emissiveColor   = FLAG_COLORS[i % FLAG_COLORS.length].scale(0.15);
      mat.specularColor   = new Color3(0.04, 0.04, 0.04);
      mat.backFaceCulling = false;

      const tri = this._makeTriangle();
      tri.parent     = this.container;
      tri.position   = new Vector3(px, py, 0);
      tri.material   = mat;
      tri.isPickable = true;
      this._meshes.push(tri);
      if (this._shadows) this._shadows.addShadowCaster(tri);

      // Alternate the detune sign so neighbours drift out of step rather than
      // swinging as one rigid comb.
      const detune = 1 + PENNANT_DETUNE * (i % 2 ? 1 : -1) * ((i % 3) / 2);
      this._pennants.push({
        mesh: tri, t, x: px, y: py,
        w: 2 * Math.PI * PENNANT_FREQ * detune,
        swing: 0, vel: 0,
      });
    }
  }

  /** Build a double-sided downward-pointing triangle mesh. */
  _makeTriangle() {
    const mesh = new Mesh("bannerPennant", this._scene);
    const vd   = new VertexData();
    const w    = FLAG_W;
    const h    = FLAG_H;

    // Front face (normal +Z) and back face (normal -Z) as separate vertices
    vd.positions = [
      -w / 2,  0, 0,   // 0 front top-left
       w / 2,  0, 0,   // 1 front top-right
       0,     -h, 0,   // 2 front tip
      -w / 2,  0, 0,   // 3 back top-left
       w / 2,  0, 0,   // 4 back top-right
       0,     -h, 0,   // 5 back tip
    ];
    vd.indices = [0, 1, 2,  3, 5, 4]; // front CW, back CCW
    vd.normals = [
       0, 0,  1,  0, 0,  1,  0, 0,  1,
       0, 0, -1,  0, 0, -1,  0, 0, -1,
    ];
    vd.applyToMesh(mesh);
    return mesh;
  }

  // ─── Wake sway ────────────────────────────────────────────────────────────

  /** Rest height of the rope at span fraction t. */
  _ropeY(t) {
    return this._poleHeight + catenaryOffset(t, this._sag);
  }

  /** Live lateral (local Z) offset of the rope at span fraction t. */
  _ropeZ(t) {
    return this._ropeAmp[0] * Math.sin(Math.PI * t)
         + this._ropeAmp[1] * Math.sin(2 * Math.PI * t);
  }

  /**
   * Push the banner with the wake of a truck at banner-local position
   * (lx, ly, lz) moving at `vz` metres per second across the span.
   *
   * The wake is a soft Gaussian blob, so a truck that clips the end of the
   * string only stirs the pennants near it and a truck that misses entirely
   * does nothing. Force enters as an acceleration integrated over `dt`, which
   * makes a slow crawl underneath a gentle nudge and a fast pass a real gust.
   */
  applyGust(lx, ly, lz, vz, dt) {
    const speed = Math.abs(vz);
    if (speed < GUST_MIN_SPEED) return;

    // Signed strength: direction of travel, magnitude saturating at the ref speed.
    const drive = Math.sign(vz) * Math.min(1, speed / GUST_SPEED_REF) * dt;
    const r2 = GUST_RADIUS * GUST_RADIUS;
    const h2 = GUST_HEIGHT * GUST_HEIGHT;
    const across = (lz * lz) / r2;

    for (const p of this._pennants) {
      const dx = lx - p.x;
      const dy = ly - p.y;
      const f  = Math.exp(-((dx * dx) / r2 + across + (dy * dy) / h2));
      if (f < 0.01) continue;
      p.vel += drive * PENNANT_GUST * f;
      this._awake = true;
    }

    // The rope only takes the part of the gust that its mode shapes can hold,
    // so a truck crossing near a pole (sin ≈ 0) barely moves it.
    const t = (lx + this._half) / this._width;
    if (t < 0 || t > 1) return;
    const dy = ly - this._ropeY(t);
    const f  = Math.exp(-(across + (dy * dy) / h2));
    if (f < 0.01) return;
    this._ropeVel[0] += drive * ROPE_GUST * f * Math.sin(Math.PI * t);
    this._ropeVel[1] += drive * ROPE_GUST * f * Math.sin(2 * Math.PI * t) * 0.5;
    this._awake = true;
  }

  /**
   * Advance every oscillator and redraw. Sleeps once the motion dies out, so a
   * banner nobody has driven under costs nothing per frame.
   */
  update(dt) {
    if (!(dt > 0) || !this._awake) return;

    const steps = Math.min(4, Math.max(1, Math.ceil(dt / MAX_STEP)));
    const h     = dt / steps;
    const ropeW = 2 * Math.PI * Math.max(ROPE_MIN_FREQ, ROPE_WAVE_C / this._width);
    const ropeLim = Math.min(this._width * ROPE_MAX_FRAC, ROPE_MAX_M);

    let active = false;

    for (let n = 0; n < 2; n++) {
      const w   = ropeW * (n + 1);
      const c   = 2 * ROPE_ZETA * w;
      const lim = ropeLim / (n + 1);
      let a = this._ropeAmp[n];
      let v = this._ropeVel[n];

      for (let s = 0; s < steps; s++) {
        v += (-w * w * a - c * v) * h;
        a += v * h;
      }
      // Clamp, dropping only the outward velocity so the restoring force still
      // pulls it straight back with no pause at the limit.
      if (a > lim)       { a = lim;  if (v > 0) v = 0; }
      else if (a < -lim) { a = -lim; if (v < 0) v = 0; }

      this._ropeAmp[n] = a;
      this._ropeVel[n] = v;
      if (Math.abs(a) > REST_EPS || Math.abs(v) > REST_EPS) active = true;
    }

    for (const p of this._pennants) {
      const c = 2 * PENNANT_ZETA * p.w;
      const k = p.w * p.w;
      for (let s = 0; s < steps; s++) {
        p.vel   += (-k * p.swing - c * p.vel) * h;
        p.swing += p.vel * h;
      }
      if (p.swing > PENNANT_MAX)       { p.swing = PENNANT_MAX;  if (p.vel > 0) p.vel = 0; }
      else if (p.swing < -PENNANT_MAX) { p.swing = -PENNANT_MAX; if (p.vel < 0) p.vel = 0; }
      if (Math.abs(p.swing) > REST_EPS || Math.abs(p.vel) > REST_EPS) active = true;
    }

    if (!active) {
      this._ropeAmp.fill(0);
      this._ropeVel.fill(0);
      for (const p of this._pennants) { p.swing = 0; p.vel = 0; }
      this._awake = false;
    }

    this._writeSway();
  }

  /** Push the current oscillator state onto the rope tube and the pennants. */
  _writeSway() {
    for (let i = 0; i < this._ropePath.length; i++) {
      this._ropePath[i].z = this._ropeZ(i / N_ROPE_PTS);
    }
    this.rope = MeshBuilder.CreateTube("bannerRope", {
      path: this._ropePath, instance: this.rope,
    }, this._scene);

    for (const p of this._pennants) {
      // Ride the rope sideways, then swing about the rope axis. rotation.x is
      // negated because a positive X rotation carries the hanging tip toward −Z.
      p.mesh.position.z = this._ropeZ(p.t);
      p.mesh.rotation.x = -p.swing;
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  containsMesh(mesh) {
    return this._meshes.includes(mesh);
  }

  moveTo(x, z, groundY) {
    this.feature.x = x;
    this.feature.z = z;
    this.container.position.copyFromFloats(x, groundY, z);
  }

  setHeading(radians) {
    this.feature.heading = radians;
    this.container.rotation.y = radians;
  }

  setWidth(newWidth) {
    this.feature.width = newWidth;
    this._buildMeshes(newWidth, this.feature.poleHeight ?? DEFAULT_POLE_HEIGHT);
  }

  setPoleHeight(newHeight) {
    this.feature.poleHeight = newHeight;
    this._buildMeshes(this.feature.width, newHeight);
  }

  /**
   * World-space Y of the top of the string — the pole tops (the rope sags below
   * them). The editor parks its gizmo handle just above this.
   */
  get topY() {
    return this.container.position.y + (this.feature.poleHeight ?? DEFAULT_POLE_HEIGHT);
  }

  dispose() {
    for (const m of this._meshes) {
      m.material?.dispose();
      m.dispose();
    }
    this._meshes = [];
    this.container.dispose();
  }
}
