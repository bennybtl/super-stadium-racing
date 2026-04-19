import {
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { basicColors } from "../constants";

export const POLE_HEIGHT = 8.5;
export const POLE_RADIUS = 0.1;
export const FLAG_WIDTH  = 1.5;
export const FLAG_HEIGHT = 1.6;
export const POLE_MASS   = 0.5;

/** Collision cylinder radius — wider than the pole for easier truck hits */
export const COLLISION_RADIUS = POLE_RADIUS * 20;

// ─── Pendulum constants ───────────────────────────────────────────────────

/** Moment of inertia of a uniform rod about its base: I = (1/3)·m·L² */
const I = (1 / 3) * POLE_MASS * POLE_HEIGHT * POLE_HEIGHT; // ≈ 12.04 kg·m²

/**
 * Spring stiffness (Nm/rad). Controls how fast the pole returns to vertical
 * and the oscillation period: T = 2π / √(K/I).
 * K=25 → T ≈ 4.4 s (slow, tall-flag feel).
 */
const K = 50;

/**
 * Angular damping (Nms/rad). Damping ratio ζ = D / (2·√(K·I)).
 * D=5 → ζ ≈ 0.14 → ~5–6 visible swings before settling.
 */
const D = 10;

/** Maximum tilt in radians (~75°). Clamp only prevents extreme positions. */
const MAX_TILT = 1;

/**
 * Flag — a rigid pole that pivots at its base like an inverted pendulum.
 *
 * No Havok physics — the pendulum is simulated directly by integrating
 * the equation of motion each frame:
 *
 *   I·α = −K·θ − D·ω
 *
 * Two independent axes (world X and Z) share the same spring-damper.
 * The tilt is applied to the pole mesh via rotation with the pivot set
 * at the base, so the top swings freely while the base stays fixed.
 */
export class Flag {
  constructor(x, z, color, groundY, scene, shadows) {
    this.scene   = scene;
    this.x       = x;
    this.z       = z;
    this.color   = color;
    this.groundY = groundY;

    // ── Pendulum state ────────────────────────────────────────────────
    this.bendX = 0;  // tilt angle toward +X (rad)
    this.bendZ = 0;  // tilt angle toward +Z (rad)
    this.velX  = 0;  // angular velocity X component (rad/s)
    this.velZ  = 0;  // angular velocity Z component (rad/s)

    // ── Pole cylinder ────────────────────────────────────────────────
    this.pole = MeshBuilder.CreateCylinder(`pole_${x}_${z}`, {
      height: POLE_HEIGHT,
      diameter: POLE_RADIUS * 2,
      tessellation: 8,
    }, scene);
    this.pole.position.set(x, groundY + POLE_HEIGHT / 2, z);
    // Pivot at the base so rotations swing from the ground
    this.pole.setPivotPoint(new Vector3(0, -POLE_HEIGHT / 2, 0));
    this.pole.isPickable = true;

    const poleMat = new StandardMaterial(`poleMat_${x}_${z}`, scene);
    poleMat.diffuseColor  = basicColors.gray.diffuse;
    poleMat.specularColor = basicColors.gray.emissive;
    this.pole.material = poleMat;

    // ── Flag banner parented to pole ─────────────────────────────────
    this.flag = this._createBanner(x, z, color, scene);
    this.flag.parent = this.pole;

    if (shadows) {
      shadows.addShadowCaster(this.pole);
      shadows.addShadowCaster(this.flag);
      this.flag.receiveShadows = true;
    }
  }

  // ─── Per-frame update ─────────────────────────────────────────────────

  /**
   * Integrate the pendulum ODE one step and apply the result to the pole.
   * I·α = −K·θ − D·ω  →  α = −(K/I)·θ − (D/I)·ω
   */
  update(dt) {
    const kI = K / I;
    const dI = D / I;

    this.velX += (-kI * this.bendX - dI * this.velX) * dt;
    this.velZ += (-kI * this.bendZ - dI * this.velZ) * dt;
    this.bendX += this.velX * dt;
    this.bendZ += this.velZ * dt;

    // Radial clamp: snap position to the boundary, but only remove the
    // outward velocity component. Return velocity is left intact so the
    // spring pulls it back immediately without a pause.
    const tilt = Math.sqrt(this.bendX * this.bendX + this.bendZ * this.bendZ);
    if (tilt > MAX_TILT) {
      const s = MAX_TILT / tilt;
      this.bendX *= s;
      this.bendZ *= s;
      // Unit vector pointing outward along the tilt direction
      const nx = this.bendX / MAX_TILT;
      const nz = this.bendZ / MAX_TILT;
      // Remove any remaining outward velocity; leave return velocity alone
      const outward = this.velX * nx + this.velZ * nz;
      if (outward > 0) {
        this.velX -= outward * nx;
        this.velZ -= outward * nz;
      }
    }

    // Apply to mesh: rotation.z tilts the top toward −X; rotation.x toward +Z
    this.pole.rotation.z = -this.bendX;
    this.pole.rotation.x =  this.bendZ;
  }

  /**
   * Apply a lateral impulse (world X/Z force, from FlagManager).
   * Converts to angular velocity via moment arm at 60% of pole height.
   */
  applyBendImpulse(ix, iz) {
    const h = POLE_HEIGHT * 0.6;
    this.velX += (ix * h) / I;
    this.velZ += (iz * h) / I;
  }

  // ─── Editor helpers ───────────────────────────────────────────────────

  containsMesh(mesh) {
    return mesh === this.pole || mesh === this.flag;
  }

  moveTo(x, z, groundY) {
    this.x = x;
    this.z = z;
    this.groundY = groundY;
    this.pole.position.set(x, groundY + POLE_HEIGHT / 2, z);
  }

  // ─── Banner mesh ──────────────────────────────────────────────────────

  _createBanner(x, z, color, scene) {
    const mesh = new Mesh(`flag_${x}_${z}`, scene);
    const vd   = new VertexData();

    // In pole local space the top is at +POLE_HEIGHT/2
    const topY = POLE_HEIGHT / 2;
    const p0 = [0,          topY,                  0];
    const p1 = [FLAG_WIDTH, topY - FLAG_HEIGHT / 2, 0];
    const p2 = [0,          topY - FLAG_HEIGHT,     0];

    vd.positions = [...p0, ...p1, ...p2, ...p0, ...p2, ...p1];
    vd.indices   = [0, 1, 2, 3, 4, 5];
    vd.normals   = [0,0,1, 0,0,1, 0,0,1, 0,0,-1, 0,0,-1, 0,0,-1];
    vd.applyToMesh(mesh);

    mesh.isPickable = true;
    const mat = new StandardMaterial(`flagMat_${x}_${z}`, scene);
    mat.diffuseColor    = color === 'red' ? basicColors.red.diffuse : basicColors.blue.diffuse;
    mat.specularColor   = basicColors.gray.emissive;
    mat.backFaceCulling = false;
    mesh.material = mat;
    return mesh;
  }

  // ─── Accessors ────────────────────────────────────────────────────────

  get position() {
    return this.pole.position.clone();
  }

  setColor(color) {
    this.color = color;
    this.flag.material.diffuseColor = color === 'red'
      ? basicColors.red.diffuse
      : basicColors.blue.diffuse;
  }

  dispose() {
    this.flag?.dispose();
    this.pole?.dispose();
  }
}
