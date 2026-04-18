import { Vector3, ParticleSystem, Texture, Color4 } from "@babylonjs/core";
import { TERRAIN_TYPES } from "../terrain.js";

const CLOUD_TEXTURE_URL = "https://assets.babylonjs.com/textures/cloud.png";
const CLOUD_TEXTURES = new WeakMap();

function getSharedCloudTexture(scene) {
  let texture = CLOUD_TEXTURES.get(scene);
  if (!texture) {
    texture = new Texture(CLOUD_TEXTURE_URL, scene);
    CLOUD_TEXTURES.set(scene, texture);
  }
  return texture;
}

/**
 * Manages particle effects for the truck (drift smoke and water splash)
 */
export class ParticleEffects {
  constructor(mesh, scene, options = null) {
    this.mesh = mesh;
    this.scene = scene;
    this._qualityScale = Math.max(0.1, Math.min(1, options?.qualityScale ?? 1));
    this.driftParticles = this._createDriftParticles(TERRAIN_TYPES.PACKED_DIRT.color);
    this.splashParticles = this.createSplashParticles();
    this.nitroParticles = this._createNitroParticles();
    this._currentTerrainName = null;
    this._nitroTimer = 0;
    this._wasBoostActive = false;
    this._nitroEmitter = new Vector3();
    this._nitroDir1 = new Vector3();
    this._nitroDir2 = new Vector3();
  }

  /**
   * Create a drift particle system tinted with the given base color { r, g, b }.
   * Alpha is derived automatically so colors always fade to transparent.
   */
  _createDriftParticles(color) {
    const particles = new ParticleSystem("drift", Math.round(300 * this._qualityScale), this.scene);
    particles.particleTexture = getSharedCloudTexture(this.scene);
    particles.emitter = this.mesh;
    particles.minEmitBox = new Vector3(-0.7, 0, -1);
    particles.maxEmitBox = new Vector3(0.7, 0, -1);

    particles.color1    = new Color4(color.r,        color.g,        color.b,        0.5);
    particles.color2    = new Color4(color.r * 0.75, color.g * 0.75, color.b * 0.75, 0.3);
    particles.colorDead = new Color4(color.r * 0.5,  color.g * 0.5,  color.b * 0.5,  0);

    particles.minSize = 1.5;
    particles.maxSize = 3.2;
    particles.minLifeTime = 0.50;
    particles.maxLifeTime = 2.0;

    particles.emitRate = 2;
    particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    particles.gravity = new Vector3(0, -1, 0);
    particles.direction1 = new Vector3(-1, 0.5, -0.5);
    particles.direction2 = new Vector3(1,  0.5, -0.5);
    particles.minAngularSpeed = 0;
    particles.maxAngularSpeed = Math.PI;
    particles.minEmitPower = 1;
    particles.maxEmitPower = 4;
    particles.updateSpeed = 0.01;

    particles.start();
    return particles;
  }

  /**
   * Swap drift particle color to match the current terrain.
   * Updates colors in-place to avoid system churn when terrain changes.
   */
  setDriftColor(color) {
    this.driftParticles.color1    = new Color4(color.r,        color.g,        color.b,        0.5);
    this.driftParticles.color2    = new Color4(color.r * 0.75, color.g * 0.75, color.b * 0.75, 0.3);
    this.driftParticles.colorDead = new Color4(color.r * 0.5,  color.g * 0.5,  color.b * 0.5,  0);
  }
  /**
   * Creates a white smoke burst system for the nitro boost.
   * The emitter is set to a fixed world-space position at fire time so
   * particles stay on the track and don't follow the truck.
   */
  _createNitroParticles() {
    const particles = new ParticleSystem("nitro", Math.round(600 * this._qualityScale), this.scene);
    particles.particleTexture = getSharedCloudTexture(this.scene);
    // Emitter starts as a world-space point; overridden in _fireNitroBurst
    particles.emitter = Vector3.Zero();

    // Small spread around the emitter point (world-space axes, approximate)
    particles.minEmitBox = new Vector3(-0.4, -0.1, -0.4);
    particles.maxEmitBox = new Vector3( 0.4,  0.2,  0.4);

    // Bright white → fading grey
    particles.color1    = new Color4(1.00, 1.00, 1.00, 0.90);
    particles.color2    = new Color4(0.88, 0.88, 0.88, 0.70);
    particles.colorDead = new Color4(0.70, 0.70, 0.70, 0.00);

    particles.minSize = 0.5;
    particles.maxSize = 3.0;
    particles.minLifeTime = 0.3;
    particles.maxLifeTime = 0.8;

    particles.emitRate = 0; // driven manually
    particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    particles.gravity = new Vector3(0, 1.5, 0); // smoke rises

    // Directions are overridden in _fireNitroBurst with world-space vectors
    particles.direction1 = new Vector3(0, 0.5, -8);
    particles.direction2 = new Vector3(0, 2.0, -5);
    particles.minAngularSpeed = 0;
    particles.maxAngularSpeed = Math.PI;
    particles.minEmitPower = 1;
    particles.maxEmitPower = 3;
    particles.updateSpeed = 0.02;

    particles.start();
    return particles;
  }

  /**
   * Snapshot the truck's current rear world position and heading into the
   * nitro particle system so emitted particles stay on the track.
   */
  _fireNitroBurst(heading) {
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);

    // World-space backward and right vectors
    const bx = -sin, bz = -cos; // backward
    const rx =  cos, rz = -sin; // right

    // Place emitter at truck rear (1.4 units behind centre)
    const pos = this.mesh.position;
    this._nitroEmitter.set(pos.x + bx * 1.4, pos.y, pos.z + bz * 1.4);
    this.nitroParticles.emitter = this._nitroEmitter;

    // Transform local directions to world space:
    //   local (-2, 0.5, -8) → world backward*8 - right*2 + up*0.5
    //   local ( 2, 2.0, -5) → world backward*5 + right*2 + up*2.0
    this._nitroDir1.set(bx * 8 - rx * 2, 0.5, bz * 8 - rz * 2);
    this._nitroDir2.set(bx * 5 + rx * 2, 2.0, bz * 5 + rz * 2);
    this.nitroParticles.direction1 = this._nitroDir1;
    this.nitroParticles.direction2 = this._nitroDir2;

    this.nitroParticles.emitRate = Math.round(600 * this._qualityScale);
    this._nitroTimer = 0.35;
  }

  createSplashParticles() {
    const splashParticles = new ParticleSystem("splash", Math.round(300 * this._qualityScale), this.scene);
    splashParticles.particleTexture = getSharedCloudTexture(this.scene);
    splashParticles.emitter = this.mesh;
    splashParticles.minEmitBox = new Vector3(-0.7, 0, -0.5);
    splashParticles.maxEmitBox = new Vector3(0.7, 0, 0.5);
    
    splashParticles.color1 = new Color4(0.8, 0.9, 1.0, 0.6);
    splashParticles.color2 = new Color4(0.6, 0.8, 0.9, 0.4);
    splashParticles.colorDead = new Color4(0.4, 0.6, 0.8, 0);
    
    splashParticles.minSize = 0.4;
    splashParticles.maxSize = 1.2;
    splashParticles.minLifeTime = 0.2;
    splashParticles.maxLifeTime = 0.5;
    
    splashParticles.emitRate = 0;
    splashParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    splashParticles.gravity = new Vector3(0, -5, 0);
    splashParticles.direction1 = new Vector3(-2, 2, -1);
    splashParticles.direction2 = new Vector3(2, 3, 1);
    splashParticles.minAngularSpeed = 0;
    splashParticles.maxAngularSpeed = Math.PI * 2;
    splashParticles.minEmitPower = 3;
    splashParticles.maxEmitPower = 6;
    splashParticles.updateSpeed = 0.01;
    
    splashParticles.start();
    return splashParticles;
  }

  update(state, speed, terrainManager, isGrounded = true, deltaTime = 0.016, currentTerrain = null) {
    const terrain = currentTerrain ?? (terrainManager ? terrainManager.getTerrainAt(this.mesh.position) : null);
    const terrainName = terrain?.name ?? 'default';

    // Swap drift color when terrain changes — read directly from terrain definition
    if (terrainName !== this._currentTerrainName) {
      this._currentTerrainName = terrainName;

      const color = terrain?.smokeColor ?? terrain?.color ?? TERRAIN_TYPES.PACKED_DIRT.color;
      this.setDriftColor(color);
    }

    // Update drift particles
    if (speed > 0.5) {
      const driftIntensity = Math.max(0, state.slipAngle - state.driftThreshold);
      const spinoutBoost = state.isSpinningOut ? 2.0 : 1.0;
      this.driftParticles.emitRate = driftIntensity * 300 * this._qualityScale * spinoutBoost;
    } else {
      this.driftParticles.emitRate = 0;
    }
    
    // Update splash particles when in water and wheels are on the ground
    const isInWater = terrainName === 'water';
    if (isInWater && isGrounded && speed > 1) {
      this.splashParticles.emitRate = speed * 80 * this._qualityScale;
    } else {
      this.splashParticles.emitRate = 0;
    }

    // Nitro burst: fire a cloud of white smoke the moment boost activates
    const boostJustStarted = state.boostActive && !this._wasBoostActive;
    if (boostJustStarted) {
      this._fireNitroBurst(state.heading);
    }
    if (this._nitroTimer > 0) {
      this._nitroTimer -= deltaTime;
      if (this._nitroTimer <= 0) {
        this.nitroParticles.emitRate = 0;
      }
    }
    this._wasBoostActive = state.boostActive;
  }
}
