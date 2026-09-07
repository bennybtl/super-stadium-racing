import {
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Quaternion,
  TransformNode,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { basicColors } from "../../constants.js";

export const POLE_HEIGHT = 7.5;
export const POLE_RADIUS = 0.1;
export const FLAG_WIDTH  = 2.5;
export const FLAG_HEIGHT = 2.0;
export const POLE_MASS   = 0.5;

/** Collision cylinder radius — wider than the pole for easier truck hits */
export const COLLISION_RADIUS = POLE_RADIUS * 20;

// ─── Cantilever bending modes ─────────────────────────────────────────────
//
// The pole is a clamped-free (cantilever) beam. Rather than simulate a chain
// of segments — which is stiff near the tip and either explodes or turns into
// a wet noodle — we project the motion onto the beam's first two bending mode
// shapes and simulate one damped oscillator per mode per axis. Four scalar
// ODEs total, same stability as a single spring, but the pole draws a real
// curve instead of pivoting rigidly at its base.

/** Number of straight segments the drawn centreline is built from. */
const N_SEG = 10;

/** Eigenvalues / shape coefficients for cantilever modes 1 and 2. */
const MODE_BETA  = [1.8751040687, 4.6940911330];
const MODE_SIGMA = [0.7340955114, 1.0184673933];

function rawPhi(m, s) {
  const b = MODE_BETA[m] * s;
  return Math.cosh(b) - Math.cos(b) - MODE_SIGMA[m] * (Math.sinh(b) - Math.sin(b));
}

function rawPhiPrime(m, s) {
  const B = MODE_BETA[m];
  const b = B * s;
  return B * (Math.sinh(b) + Math.sin(b) - MODE_SIGMA[m] * (Math.cosh(b) - Math.cos(b)));
}

// Normalize each shape so φ(tip) = 1 — mode amplitudes are then plain metres
// of tip deflection, which makes every constant below easy to reason about.
const PHI_TIP = [rawPhi(0, 1), rawPhi(1, 1)]; // ≈ ±2

/** Normalized mode shape: lateral offset at height fraction s, per unit tip amplitude. */
const phi = (m, s) => rawPhi(m, s) / PHI_TIP[m];

/** dφ/ds — slope of the normalized mode shape (divide by pole length for du/dy). */
const phiPrime = (m, s) => rawPhiPrime(m, s) / PHI_TIP[m];

/** Mode slope sampled at each segment midpoint, precomputed once. */
const SLOPE = [0, 1].map((m) =>
  Array.from({ length: N_SEG }, (_, i) => phiPrime(m, (i + 0.5) / N_SEG)),
);

/**
 * Modal mass. With φ mass-normalized (∫φ²ds = 1) the classic shape has
 * φ(1) = 2, so our tip-normalized φ̂ = φ/2 gives ∫φ̂²ds = 1/4.
 */
const MODAL_MASS = POLE_MASS * 0.25;

/** Fundamental bending frequency at POLE_HEIGHT. Beam frequency ∝ 1/L², so a
 *  taller pole automatically sways slower. */
const FREQ1_HZ = 0.75;
const OMEGA1   = 2 * Math.PI * FREQ1_HZ;

/** ω₂/ω₁ for a cantilever = (β₂/β₁)² ≈ 6.27. */
const FREQ_RATIO = (MODE_BETA[1] / MODE_BETA[0]) ** 2;

/** Damping ratio of mode 1. Rayleigh (stiffness-proportional) damping makes
 *  ζ ∝ ω, so mode 2 damps ~6× harder — the whip is a fast transient over a
 *  slow sway, which is what a real pole does. */
const ZETA1 = 0.10;

/**
 * Effective duration (s) of a truck sweeping past the pole. A real hit is a
 * short push, not a delta impulse — and a force pulse of duration τ only
 * excites modes with ω·τ ≲ 1. That barely touches the slow fundamental
 * (ω₁τ ≈ 0.4) but strongly attenuates mode 2 (ω₂τ ≈ 2.7), which is what stops
 * the pole kinking sharply at the contact point. Raise it for a stiffer,
 * smoother bend; drop it toward 0 for a whippy impulse-like snap.
 */
const CONTACT_TIME = 0.09;

/** Per-mode tip-deflection clamp, as a fraction of pole length. */
const MAX_AMP_FRAC = [0.35, 0.18];

/** Below this (metres / metres-per-second) the pole is considered at rest. */
const REST_EPS = 1e-3;

/** Longest integration substep — protects the stiff mode 2 from frame hitches. */
const MAX_STEP = 1 / 120;

/**
 * Flag — a flexible pole that bends like a cantilever beam, plus a banner.
 *
 * State is four damped oscillators (2 modes × 2 world axes) holding tip
 * deflection in metres:
 *
 *   ä + 2ζωȧ + ω²a = F·φ̂(s_hit) / m_modal
 *
 * Each frame the mode slopes are summed and the centreline is walked segment by
 * segment along the resulting tangent, so the drawn pole keeps its arc length
 * at any bend angle. The banner rides the tip frame.
 */
export class Flag {
  constructor(x, z, color, groundY, scene, shadows, opts = {}) {
    this.scene   = scene;
    this.x       = x;
    this.z       = z;
    this.color   = color;
    this.groundY = groundY;

    // ── Editable transform ────────────────────────────────────────────
    // Heading spins the whole flag (root.rotation.y). Scale is a uniform
    // multiplier on the root. heightM sets the pole length in metres (base
    // POLE_HEIGHT) — it stretches only the pole, not the banner.
    this._heading = opts.heading ?? 0;
    this._scale   = opts.scale   ?? 1;
    this._heightM = opts.height  ?? POLE_HEIGHT;

    // ── Modal state ───────────────────────────────────────────────────
    // Layout: [mode1·X, mode1·Z, mode2·X, mode2·Z], tip deflection in metres.
    this._amp   = [0, 0, 0, 0];
    this._vel   = [0, 0, 0, 0];
    this._awake = true;

    // ── Root transform ────────────────────────────────────────────────
    // Origin sits at the base on the ground. The root never tilts any more —
    // all bending lives in the pole geometry — so rotation.y is pure heading.
    this.root = new TransformNode(`flag_${x}_${z}`, scene);
    this.root.position.set(x, groundY, z);

    // ── Pole centreline ───────────────────────────────────────────────
    this._path   = Array.from({ length: N_SEG + 1 }, () => new Vector3(0, 0, 0));
    this._tipDir = new Vector3(0, 1, 0);
    this._writePath();

    this.pole = MeshBuilder.CreateTube(`pole_${x}_${z}`, {
      path: this._path,
      radius: POLE_RADIUS,
      tessellation: 8,
      cap: Mesh.CAP_ALL,
      updatable: true,
    }, scene);
    this.pole.parent = this.root;
    this.pole.isPickable = true;

    const poleMat = new StandardMaterial(`poleMat_${x}_${z}`, scene);
    poleMat.diffuseColor  = basicColors.white.diffuse;
    poleMat.specularColor = basicColors.white.emissive;
    this.pole.material = poleMat;

    // ── Flag banner — child of root, parked on the pole tip frame ──────
    this.flag = this._createBanner(x, z, color, scene);
    this.flag.parent = this.root;

    if (shadows) {
      shadows.addShadowCaster(this.pole);
      shadows.addShadowCaster(this.flag);
      this.flag.receiveShadows = true;
    }

    this._applyTransform();
  }

  // ─── Editable transform ─────────────────────────────────────────────────

  /**
   * Push heading/scale onto the root and rebuild the pole at the current
   * height. Height is baked into the centreline path, not a mesh scale, so the
   * banner (a sibling, not a child) is never stretched by it.
   */
  _applyTransform() {
    this.root.scaling.setAll(this._scale);
    this.root.rotation.y = this._heading;
    this._updateShape();
  }

  setHeading(rad) {
    this._heading = rad;
    this.root.rotation.y = rad;
  }

  setScale(scale) {
    this._scale = scale;
    this._applyTransform();
  }

  setHeight(heightM) {
    this._heightM = heightM;
    this._applyTransform();
  }

  get height() {
    return this._heightM;
  }

  // ─── Per-frame update ─────────────────────────────────────────────────

  /** Angular frequency of mode m at the current pole length (beam ω ∝ 1/L²). */
  _omega(m) {
    const r = m === 0 ? 1 : FREQ_RATIO;
    return OMEGA1 * (POLE_HEIGHT / this._heightM) ** 2 * r;
  }

  /**
   * Advance each modal oscillator and redraw the bent pole.
   * Sleeps (and skips the geometry rebuild) once everything has settled.
   */
  update(dt) {
    if (!(dt > 0)) return;
    if (!this._awake) return;

    const steps = Math.min(4, Math.max(1, Math.ceil(dt / MAX_STEP)));
    const h     = dt / steps;
    const L     = this._heightM;

    let active = false;

    for (let m = 0; m < 2; m++) {
      const r  = m === 0 ? 1 : FREQ_RATIO;
      const w  = this._omega(m);
      const w2 = w * w;
      const c  = 2 * ZETA1 * r * w; // ζ_m = ζ₁·(ω_m/ω₁)
      const lim = MAX_AMP_FRAC[m] * L;

      for (let axis = 0; axis < 2; axis++) {
        const i = m * 2 + axis;
        let a = this._amp[i];
        let v = this._vel[i];

        for (let s = 0; s < steps; s++) {
          v += (-w2 * a - c * v) * h;
          a += v * h;
        }

        // Clamp deflection, killing only the outward velocity so the restoring
        // force still pulls it straight back without a pause at the limit.
        if (a > lim)       { a = lim;  if (v > 0) v = 0; }
        else if (a < -lim) { a = -lim; if (v < 0) v = 0; }

        this._amp[i] = a;
        this._vel[i] = v;
        if (Math.abs(a) > REST_EPS || Math.abs(v) > REST_EPS) active = true;
      }
    }

    if (!active) {
      this._amp.fill(0);
      this._vel.fill(0);
      this._awake = false;
    }

    this._updateShape();
  }

  /**
   * Kick the pole with a lateral impulse (world X/Z) applied at `hitHeight`
   * metres above the base. Modal force is F·φ̂(s) — a low hit favours the
   * higher mode — rolled off by CONTACT_TIME so the pole bends as a whole
   * instead of kinking at the contact point.
   */
  applyBendImpulse(ix, iz, hitHeight = POLE_HEIGHT * 0.15) {
    const L = this._heightM;
    // hitHeight arrives in world metres; the root's uniform scale sits between
    // world space and the local metres the modal maths works in.
    const s = Math.min(1, Math.max(0.02, hitHeight / this._scale / L));

    for (let m = 0; m < 2; m++) {
      // Single-pole roll-off of a finite-duration push: modes far above 1/τ
      // barely respond.
      const soften = 1 / (1 + (this._omega(m) * CONTACT_TIME / 2) ** 2);
      const g = phi(m, s) * soften / MODAL_MASS;
      this._vel[m * 2]     += ix * g;
      this._vel[m * 2 + 1] += iz * g;
    }
    this._awake = true;
  }

  // ─── Geometry ─────────────────────────────────────────────────────────

  /**
   * Walk the centreline from the base, stepping one segment along the local
   * tangent implied by the summed mode slopes. Because every step has the same
   * length, arc length is preserved exactly however far the pole is bent —
   * offsetting vertices sideways by φ̂(s) instead would visibly stretch it.
   */
  _writePath() {
    const L   = this._heightM;
    const seg = L / N_SEG;
    const [a1x, a1z, a2x, a2z] = this._amp;

    let x = 0, y = 0, z = 0;
    this._path[0].set(0, 0, 0);

    for (let i = 0; i < N_SEG; i++) {
      // du/dy at this segment's midpoint, per axis.
      const sx = (a1x * SLOPE[0][i] + a2x * SLOPE[1][i]) / L;
      const sz = (a1z * SLOPE[0][i] + a2z * SLOPE[1][i]) / L;
      const step = seg / Math.sqrt(sx * sx + sz * sz + 1);

      x += sx * step;
      y += step;
      z += sz * step;
      this._path[i + 1].set(x, y, z);

      if (i === N_SEG - 1) {
        const inv = 1 / Math.sqrt(sx * sx + sz * sz + 1);
        this._tipDir.set(sx * inv, inv, sz * inv);
      }
    }
  }

  /** Rebuild the pole tube from the current modal state and re-seat the banner. */
  _updateShape() {
    this._writePath();

    if (this.pole) {
      this.pole = MeshBuilder.CreateTube(this.pole.name, {
        path: this._path,
        instance: this.pole,
      }, this.scene);
    }

    if (this.flag) {
      const tip = this._path[N_SEG];
      this.flag.position.copyFrom(tip);

      // Rotate the banner's local +Y onto the pole's tip tangent.
      const t   = this._tipDir;
      const len = Math.hypot(t.z, t.x);
      if (len < 1e-6) {
        this.flag.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
      } else {
        const angle = Math.acos(Math.min(1, Math.max(-1, t.y)));
        Quaternion.RotationAxisToRef(
          new Vector3(t.z / len, 0, -t.x / len),
          angle,
          this.flag.rotationQuaternion,
        );
      }
    }
  }

  // ─── Editor helpers ───────────────────────────────────────────────────

  containsMesh(mesh) {
    return mesh === this.pole || mesh === this.flag;
  }

  moveTo(x, z, groundY) {
    this.x = x;
    this.z = z;
    this.groundY = groundY;
    // Root origin is the base, so it sits directly on the ground.
    this.root.position.set(x, groundY, z);
  }

  // ─── Banner mesh ──────────────────────────────────────────────────────

  _createBanner(x, z, color, scene) {
    const mesh = new Mesh(`flag_${x}_${z}`, scene);
    const vd   = new VertexData();

    // Banner-local space: the attach point (pole tip) is the origin and the
    // cloth hangs downward. The mesh is parked on the tip frame each frame, so
    // its size is independent of the pole's length.
    const p0 = [0,          0,             0];
    const p1 = [FLAG_WIDTH, -FLAG_HEIGHT / 2, 0];
    const p2 = [0,          -FLAG_HEIGHT,     0];

    vd.positions = [...p0, ...p1, ...p2, ...p0, ...p2, ...p1];
    vd.indices   = [0, 1, 2, 3, 4, 5];
    vd.normals   = [0,0,1, 0,0,1, 0,0,1, 0,0,-1, 0,0,-1, 0,0,-1];
    vd.applyToMesh(mesh);

    mesh.rotationQuaternion = Quaternion.Identity();
    mesh.isPickable = true;
    const mat = new StandardMaterial(`flagMat_${x}_${z}`, scene);
    mat.diffuseColor    = basicColors[color]?.diffuse || basicColors.white.diffuse;
    mat.specularColor   = basicColors[color]?.emissive || basicColors.gray.emissive;
    mat.backFaceCulling = false;
    mesh.material = mat;
    return mesh;
  }

  // ─── Accessors ────────────────────────────────────────────────────────

  get position() {
    return this.root.position.clone();
  }

  setColor(color) {
    this.color = color;
    this.flag.material.diffuseColor = basicColors[color]?.diffuse || basicColors.white.diffuse;
    this.flag.material.specularColor = basicColors[color]?.emissive || basicColors.gray.emissive;
  }

  dispose() {
    this.flag?.dispose();
    this.pole?.dispose();
    this.root?.dispose();
  }
}
