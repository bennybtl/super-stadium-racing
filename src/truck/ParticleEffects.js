import { Vector3, ParticleSystem, Texture, Color4 } from "@babylonjs/core";
import { TERRAIN_TYPES } from "../terrain.js";
import { SPLASH_MIN_DEPTH, DEEP_SPLASH_DEPTH } from "../constants.js";

import cloudTextureUrl from "../assets/cloud.png";
const CLOUD_TEXTURE_URL = cloudTextureUrl;

const CLOUD_TEXTURES = new WeakMap();

export function getSharedCloudTexture(scene) {
  let texture = CLOUD_TEXTURES.get(scene);
  if (!texture) {
    texture = new Texture(CLOUD_TEXTURE_URL, scene);
    CLOUD_TEXTURES.set(scene, texture);
  }
  return texture;
}

/**
 * Declarative definitions for every particle system the truck emits. Each spec is
 * the full set of tunables for one emitter; _buildEmitter() turns a spec into a
 * live ParticleSystem so the systems stay consistent and easy to compare/tweak.
 *
 * Conventions:
 *  - emitBox x is an OFFSET from the emitter centre; for `paired` systems the
 *    centre is `sideCenter * sideSign` (±), giving a left/right pair. y and z are
 *    absolute in the truck's local frame (local -Z is rearward).
 *  - `tint` marks a terrain-coloured system (alpha derived so it fades out); its
 *    base colour is swapped at runtime as the truck changes surface. `color` is a
 *    fixed palette (c1/c2/dead as RGBA arrays).
 *  - `worldEmitter` emits from a world-space Vector3 the caller repositions each
 *    burst, instead of tracking the mesh.
 */
const EMITTER_SPECS = {
  // Drift smoke + light cruising dust. Terrain-tinted; sits under the truck.
  drift: {
    capacity: 300,
    emitBox: { min: [-0.7, -1, -1], max: [0.7, -1, -1] },
    tint: { a1: 0.5, a2: 0.3 },
    size: [1.5, 3.2], life: [0.5, 2.0],
    gravity: [0, -1, 0], dir1: [-1, 0.5, -0.5], dir2: [1, 0.5, -0.5],
    angular: [0, Math.PI], power: [1, 4], updateSpeed: 0.01, emitRate: 2,
  },
  // Rooster tail: dirt thrown up and back off the rear tires under throttle.
  // Terrain-tinted, denser and longer-lived than drift, launched with force.
  rooster: {
    paired: true, sideCenter: 1.0, capacity: 320, renderingGroupId: 1,
    emitBox: { min: [-0.35, -0.3, -3.0], max: [0.35, 0.2, -1.8] },
    tint: { a1: 0.85, a2: 0.6 },
    size: [0.5, 1.7], life: [0.35, 0.8],
    gravity: [0, -42, 0], dir1: [-0.7, 1.8, -3.2], dir2: [0.7, 3.2, -5.5],
    angular: [0, Math.PI * 2], power: [3, 5], updateSpeed: 0.012,
  },
  // Water spray off the rear sides while wading.
  splash: {
    paired: true, sideCenter: 1.15, capacity: 180, renderingGroupId: 1,
    emitBox: { min: [-0.28, 0.45, -2.9], max: [0.28, 0.9, -1.1] },
    color: { c1: [0.8, 0.9, 1.0, 0.6], c2: [0.6, 0.8, 0.9, 0.4], dead: [0.4, 0.6, 0.8, 0] },
    size: [0.4, 1.2], life: [0.2, 0.5],
    gravity: [0, -5, 0], dir1: [-2, 2, -1], dir2: [2, 3, 1],
    angular: [0, Math.PI * 2], power: [3, 6], updateSpeed: 0.01,
  },
  // Heavy mud spray.
  mud: {
    paired: true, sideCenter: 1.1, capacity: 220, renderingGroupId: 1,
    emitBox: { min: [-0.3, -0.6, -2.8], max: [0.3, 0, -1.0] },
    color: { c1: [0.42, 0.25, 0.10, 0.75], c2: [0.30, 0.18, 0.07, 0.50], dead: [0.18, 0.10, 0.04, 0] },
    size: [0.55, 1.7], life: [0.18, 0.38],
    gravity: [0, -16, 0], dir1: [-1.4, 1.1, -0.8], dir2: [1.4, 1.8, 0.8],
    angular: [0, Math.PI * 1.5], power: [1.8, 4.0], updateSpeed: 0.01,
  },
  // Big white burst pulses when churning through deep water.
  deep: {
    paired: true, sideCenter: 1.35, capacity: 380, renderingGroupId: 1,
    emitBox: { min: [-0.42, 0.55, -2.9], max: [0.42, 1.2, -1.1] },
    color: { c1: [1.0, 1.0, 1.0, 0.95], c2: [1.0, 1.0, 1.0, 0.65], dead: [1.0, 1.0, 1.0, 0] },
    size: [0.9, 2.0], life: [0.22, 0.42],
    gravity: [0, -28, 0], dir1: [-2.8, 2.0, -2.8], dir2: [2.8, 3.1, 2.8],
    angular: [0, Math.PI * 2], power: [1.8, 4.5], updateSpeed: 0.012,
  },
  // Nitro/boost puff. World-space emitter repositioned per burst (see _fireNitroBurst).
  nitro: {
    worldEmitter: true, capacity: 600,
    emitBox: { min: [-0.4, -0.1, -0.4], max: [0.4, 0.2, 0.4] },
    color: { c1: [1.0, 1.0, 1.0, 0.90], c2: [0.88, 0.88, 0.88, 0.70], dead: [0.70, 0.70, 0.70, 0] },
    size: [0.5, 3.0], life: [0.3, 0.8],
    gravity: [0, 1.5, 0], dir1: [0, 0.5, -8], dir2: [0, 2.0, -5],
    angular: [0, Math.PI], power: [1, 3], updateSpeed: 0.02,
  },
};

/**
 * Manages particle effects for the truck: drift smoke, cruising dust, dirt
 * rooster tails, water/mud/deep-water spray, and nitro bursts.
 */
export class ParticleEffects {
  constructor(mesh, scene, options = null) {
    this.mesh = mesh;
    this.scene = scene;
    this._qualityScale = Math.max(0.1, Math.min(1, options?.qualityScale ?? 1));

    this.driftParticles = this._buildEmitter("drift", EMITTER_SPECS.drift);
    this.roosterParticles = [
      this._buildEmitter("roosterL", EMITTER_SPECS.rooster, -1),
      this._buildEmitter("roosterR", EMITTER_SPECS.rooster, 1),
    ];
    this.splashParticles = [
      this._buildEmitter("splashL", EMITTER_SPECS.splash, -1),
      this._buildEmitter("splashR", EMITTER_SPECS.splash, 1),
    ];
    this.mudSplashParticles = [
      this._buildEmitter("mudSplashL", EMITTER_SPECS.mud, -1),
      this._buildEmitter("mudSplashR", EMITTER_SPECS.mud, 1),
    ];
    this.deepSplashParticles = [
      this._buildEmitter("deepSplashL", EMITTER_SPECS.deep, -1),
      this._buildEmitter("deepSplashR", EMITTER_SPECS.deep, 1),
    ];
    this.nitroParticles = this._buildEmitter("nitro", EMITTER_SPECS.nitro);

    this._currentTerrainName = null;
    this._wasInDeepWater = false;
    this._deepSplashPulseTimer = 0;
    this._deepSplashPulseCooldown = 0;
    this._nitroTimer = 0;
    this._wasBoostActive = false;
    this._nitroEmitter = new Vector3();
    this._nitroDir1 = new Vector3();
    this._nitroDir2 = new Vector3();
  }

  /**
   * Turn an EMITTER_SPECS entry into a started ParticleSystem. `sideSign` is -1/+1
   * for the two halves of a `paired` system, 0 (default) for single emitters.
   */
  _buildEmitter(name, spec, sideSign = 0) {
    const ps = new ParticleSystem(name, Math.round(spec.capacity * this._qualityScale), this.scene);
    ps.particleTexture = getSharedCloudTexture(this.scene);
    ps.emitter = spec.worldEmitter ? Vector3.Zero() : this.mesh;

    const cx = (spec.sideCenter ?? 0) * sideSign;
    const { min, max } = spec.emitBox;
    ps.minEmitBox = new Vector3(cx + min[0], min[1], min[2]);
    ps.maxEmitBox = new Vector3(cx + max[0], max[1], max[2]);

    if (spec.renderingGroupId) ps.renderingGroupId = spec.renderingGroupId;

    if (spec.color) {
      ps.color1 = new Color4(...spec.color.c1);
      ps.color2 = new Color4(...spec.color.c2);
      ps.colorDead = new Color4(...spec.color.dead);
    } else if (spec.tint) {
      this._applyTint(ps, TERRAIN_TYPES.PACKED_DIRT.color, spec.tint);
    }

    ps.minSize = spec.size[0];
    ps.maxSize = spec.size[1];
    ps.minLifeTime = spec.life[0];
    ps.maxLifeTime = spec.life[1];
    ps.gravity = new Vector3(...spec.gravity);
    ps.direction1 = new Vector3(...spec.dir1);
    ps.direction2 = new Vector3(...spec.dir2);
    ps.minAngularSpeed = spec.angular[0];
    ps.maxAngularSpeed = spec.angular[1];
    ps.minEmitPower = spec.power[0];
    ps.maxEmitPower = spec.power[1];
    ps.updateSpeed = spec.updateSpeed;
    ps.emitRate = spec.emitRate ?? 0;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    ps.start();
    return ps;
  }

  /**
   * Tint a terrain-coloured emitter from a base { r, g, b }. Alpha is derived so
   * the smoke always fades to transparent; the two live colours darken toward the
   * dead colour for depth.
   */
  _applyTint(ps, color, { a1 = 0.5, a2 = 0.3 } = {}) {
    ps.color1    = new Color4(color.r,        color.g,        color.b,        a1);
    ps.color2    = new Color4(color.r * 0.75, color.g * 0.75, color.b * 0.75, a2);
    ps.colorDead = new Color4(color.r * 0.5,  color.g * 0.5,  color.b * 0.5,  0);
  }

  setDriftColor(color) {
    this._applyTint(this.driftParticles, color, EMITTER_SPECS.drift.tint);
  }

  setRoosterColor(color) {
    for (const p of this.roosterParticles) this._applyTint(p, color, EMITTER_SPECS.rooster.tint);
  }

  /**
   * How deep the water is under the truck right now, 0 on dry ground.
   *
   * Read from the scene's shared water-depth query — the same water bodies that
   * are drawn — rather than from the painted terrain type. A body's level is set
   * by the pool that holds it, so deep water routinely spills over ground painted
   * dirt or grass, and its floor can sit well above y=0 when the pool is dug into
   * a hill. Neither is visible to a terrain-type or absolute-height test.
   */
  _waterDepthUnderTruck() {
    const depthAt = this.scene?.metadata?.waterDepthAt;
    if (!depthAt) return 0;
    return depthAt(this.mesh.position.x, this.mesh.position.z);
  }

  /** Reposition and fire the nitro puff behind the truck for the given heading. */
  _fireNitroBurst(heading) {
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);

    const bx = -sin, bz = -cos;
    const rx =  cos, rz = -sin;

    const pos = this.mesh.position;
    this._nitroEmitter.set(pos.x + bx * 1.4, pos.y, pos.z + bz * 1.4);
    this.nitroParticles.emitter = this._nitroEmitter;

    this._nitroDir1.set(bx * 8 - rx * 2, 0.5, bz * 8 - rz * 2);
    this._nitroDir2.set(bx * 5 + rx * 2, 2.0, bz * 5 + rz * 2);
    this.nitroParticles.direction1 = this._nitroDir1;
    this.nitroParticles.direction2 = this._nitroDir2;

    this.nitroParticles.emitRate = Math.round(600 * this._qualityScale);
    this._nitroTimer = 0.35;
  }

  update(state, speed, groundedness = 1, deltaTime = 0.016, currentTerrain = null, effectScaleOverride = 1) {
    const effectiveScale = this._qualityScale * Math.max(0, Math.min(1, effectScaleOverride));
    // `currentTerrain` is the terrain the truck is actually standing on: the
    // caller passes null whenever there is no contact with the painted ground —
    // airborne, or riding a bridge deck over it. The terrain grid is XZ-only, so
    // re-deriving it from the position here would resurrect the bug where flying
    // or driving over water still sprayed water.
    const terrain = currentTerrain;
    const terrainName = terrain?.name ?? 'default';

    // Swap terrain-tinted colours when terrain changes — read directly from the
    // terrain definition. Off the ground the last colour is kept, so brief hops
    // don't flicker the smoke back to the default tint.
    if (terrain && terrainName !== this._currentTerrainName) {
      this._currentTerrainName = terrainName;

      const color = terrain?.smokeColor ?? terrain?.color ?? TERRAIN_TYPES.PACKED_DIRT.color;
      this.setDriftColor(color);
      this.setRoosterColor(color);
    }

    // Update drift particles
    const isGrounded = groundedness > 0.2;
    // Wading through deep water keeps groundedness low (~0.3) because the
    // suspension is extended over the submerged bed, so the strict isGrounded
    // test suppresses all spray. Water effects use a looser contact threshold
    // that still excludes a truck fully airborne over the water (groundedness ~0).
    const isSplashGrounded = groundedness > 0.1;

    if (speed > 0.5 && isSplashGrounded) {
      const driftIntensity = Math.max(0, state.slipAngle - state.driftThreshold);
      const spinoutBoost = state.isSpinningOut ? 2.0 : 1.0;
      const driftRate = driftIntensity * 300 * effectiveScale * spinoutBoost;

      // Light dust kicked up just from cruising over loose surfaces — a much
      // gentler version of the drift smoke. Each terrain sets its own
      // dustIntensity (0 = none, e.g. paved asphalt); water and mud lean on
      // their dedicated spray systems instead.
      const dustIntensity = terrain?.dustIntensity ?? 0;
      const cruiseRate = isGrounded
        ? Math.min(speed, 12) * 30 * dustIntensity * effectiveScale
        : 0;

      this.driftParticles.emitRate = Math.max(driftRate, cruiseRate);
    } else {
      this.driftParticles.emitRate = 0;
    }

    // Rooster tail: rear tires throw dirt up and back under throttle. This is
    // driven by the gas (state.throttle), not speed — flooring it digs in and
    // sprays. Speed only ramps the effect in from a crawl so a truck barely
    // rolling doesn't erupt. Per-terrain roosterTail knob (0 = none) scales it.
    const roosterIntensity = terrain?.roosterTail ?? 0;
    const throttle = state.throttle ?? 0;
    if (roosterIntensity > 0 && isGrounded && throttle > 0.05 && speed > 1.5) {
      const speedRamp = Math.min(1, speed / 6);
      const rate = throttle * roosterIntensity * 260 * speedRamp * effectiveScale;
      for (const p of this.roosterParticles) p.emitRate = rate;
    } else {
      for (const p of this.roosterParticles) p.emitRate = 0;
    }

    // Update splash particles when in water and wheels are on the ground.
    //
    // Standing water counts wherever it actually is; terrain painted water still
    // counts too, since some tracks paint a water look onto flat ground that
    // holds no body — that reads as water to the player, so it should spray.
    // Both are gated on `terrain`, which the caller sets only when the truck is
    // riding the painted ground: the depth query is XZ-only, so without that gate
    // a truck jumping over a lake, or crossing a bridge above one, would splash.
    const waterDepth = terrain ? this._waterDepthUnderTruck() : 0;
    const isInWater = !!terrain && (waterDepth > SPLASH_MIN_DEPTH || terrainName === 'water');
    const isInMud = terrainName === 'mud';
    if (isInWater && isSplashGrounded && speed > 1) {
      const rate = speed * 80 * effectiveScale;
      for (const p of this.splashParticles) p.emitRate = rate;
    } else {
      for (const p of this.splashParticles) p.emitRate = 0;
    }

    if (isInMud && isGrounded && speed > 0.75) {
      const rate = speed * 95 * effectiveScale;
      for (const p of this.mudSplashParticles) p.emitRate = rate;
    } else {
      for (const p of this.mudSplashParticles) p.emitRate = 0;
    }

    // Deep-water splash: a strong burst on entry, periodic pulses while driving,
    // and a small steady spray between pulses so the truck visibly churns through.
    const inDeepWater = isInWater && isSplashGrounded && waterDepth >= DEEP_SPLASH_DEPTH;
    if (inDeepWater && !this._wasInDeepWater) {
      this._deepSplashPulseTimer = 0.16;
      this._deepSplashPulseCooldown = 2.5;
    }

    if (inDeepWater && speed > 1.5) {
      this._deepSplashPulseCooldown -= deltaTime;
      if (this._deepSplashPulseCooldown <= 0) {
        this._deepSplashPulseTimer = 0.16;
        this._deepSplashPulseCooldown = Math.max(2.5, 0.45 - speed * 0.012);
      }
    }

    if (this._deepSplashPulseTimer > 0) {
      this._deepSplashPulseTimer -= deltaTime;
      const rate = (450 + speed * 140) * effectiveScale;
      for (const p of this.deepSplashParticles) p.emitRate = rate;
    } else {
      for (const p of this.deepSplashParticles) p.emitRate = 0;
    }
    this._wasInDeepWater = inDeepWater;

    // Nitro burst: fire a cloud of white smoke the moment a boost activates
    // (nitro or a speed-boost zone).
    const boosting = state.boostActive || state.speedBoostActive;
    const boostJustStarted = effectiveScale > 0.05 && boosting && !this._wasBoostActive;
    if (boostJustStarted) {
      this._fireNitroBurst(state.heading);
    }
    if (this._nitroTimer > 0) {
      this._nitroTimer -= deltaTime;
      if (this._nitroTimer <= 0) {
        this.nitroParticles.emitRate = 0;
      }
    }
    this._wasBoostActive = boosting;
  }
}
