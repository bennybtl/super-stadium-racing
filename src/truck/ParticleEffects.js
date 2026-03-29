import { Vector3, ParticleSystem, Texture, Color4 } from "@babylonjs/core";

// Drift particle color presets keyed by terrain name
const DRIFT_COLORS = {
  default:      { r: 0.40, g: 0.30, b: 0.20 }, // dusty brown (packed dirt)
  packed_dirt:  { r: 0.40, g: 0.30, b: 0.20 },
  loose_dirt:   { r: 0.50, g: 0.35, b: 0.18 }, // lighter tan
  mud:          { r: 0.22, g: 0.16, b: 0.10 }, // dark mud
  asphalt:      { r: 0.25, g: 0.25, b: 0.25 }, // grey tyre smoke
  WebTransportError:        { r: 0.70, g: 0.85, b: 1.00 }, // blue-white spray
};

/**
 * Manages particle effects for the truck (drift smoke and water splash)
 */
export class ParticleEffects {
  constructor(mesh, scene) {
    this.mesh = mesh;
    this.scene = scene;
    this.driftParticles = this._createDriftParticles(DRIFT_COLORS.default);
    this.splashParticles = this.createSplashParticles();
    this.nitroParticles = this._createNitroParticles();
    this._currentTerrainName = null;
    this._nitroTimer = 0;
    this._wasBoostActive = false;
  }

  /**
   * Create a drift particle system tinted with the given base color { r, g, b }.
   * Alpha is derived automatically so colors always fade to transparent.
   */
  _createDriftParticles(color) {
    const particles = new ParticleSystem("drift", 300, this.scene);
    particles.particleTexture = new Texture("https://assets.babylonjs.com/textures/cloud.png", this.scene);
    particles.emitter = this.mesh;
    particles.minEmitBox = new Vector3(-0.7, 0, -1);
    particles.maxEmitBox = new Vector3(0.7, 0, -1);

    particles.color1    = new Color4(color.r,        color.g,        color.b,        0.5);
    particles.color2    = new Color4(color.r * 0.75, color.g * 0.75, color.b * 0.75, 0.3);
    particles.colorDead = new Color4(color.r * 0.5,  color.g * 0.5,  color.b * 0.5,  0);

    particles.minSize = 0.5;
    particles.maxSize = 1.2;
    particles.minLifeTime = 0.5;
    particles.maxLifeTime = 0.8;

    particles.emitRate = 1;
    particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    particles.gravity = new Vector3(0, -1, 0);
    particles.direction1 = new Vector3(-1, 0.5, -0.5);
    particles.direction2 = new Vector3(1,  0.5, -0.5);
    particles.minAngularSpeed = 0;
    particles.maxAngularSpeed = Math.PI;
    particles.minEmitPower = 1;
    particles.maxEmitPower = 3;
    particles.updateSpeed = 0.01;

    particles.start();
    return particles;
  }

  /**
   * Swap drift particle color to match the current terrain.
   * Recreates the particle system only when the terrain actually changes.
   */
  setDriftColor(color) {
    const prevRate = this.driftParticles.emitRate;
    this.driftParticles.stop();
    this.driftParticles.dispose();
    this.driftParticles = this._createDriftParticles(color);
    this.driftParticles.emitRate = prevRate;
  }

  /**
   * Creates a white smoke burst system for the nitro boost.
   * The emitter is set to a fixed world-space position at fire time so
   * particles stay on the track and don't follow the truck.
   */
  _createNitroParticles() {
    const particles = new ParticleSystem("nitro", 600, this.scene);
    particles.particleTexture = new Texture("https://assets.babylonjs.com/textures/cloud.png", this.scene);
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
    this.nitroParticles.emitter = new Vector3(
      pos.x + bx * 1.4,
      pos.y,
      pos.z + bz * 1.4
    );

    // Transform local directions to world space:
    //   local (-2, 0.5, -8) → world backward*8 - right*2 + up*0.5
    //   local ( 2, 2.0, -5) → world backward*5 + right*2 + up*2.0
    this.nitroParticles.direction1 = new Vector3(bx * 8 - rx * 2, 0.5, bz * 8 - rz * 2);
    this.nitroParticles.direction2 = new Vector3(bx * 5 + rx * 2, 2.0, bz * 5 + rz * 2);

    this.nitroParticles.emitRate = 600;
    this._nitroTimer = 0.35;
  }

  createSplashParticles() {
    const splashParticles = new ParticleSystem("splash", 300, this.scene);
    splashParticles.particleTexture = new Texture("https://assets.babylonjs.com/textures/cloud.png", this.scene);
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

  update(state, speed, terrainManager, isGrounded = true, deltaTime = 0.016) {
    const terrain = terrainManager ? terrainManager.getTerrainAt(this.mesh.position) : null;
    const terrainName = terrain?.name ?? 'default';

    // Swap drift color when terrain changes
    if (terrainName !== this._currentTerrainName) {
      this._currentTerrainName = terrainName;
      const color = DRIFT_COLORS[terrainName] ?? DRIFT_COLORS.default;
      this.setDriftColor(color);
    }

    // Update drift particles
    if (speed > 0.5) {
      const driftIntensity = Math.max(0, state.slipAngle - state.driftThreshold);
      const spinoutBoost = state.isSpinningOut ? 2.0 : 1.0;
      this.driftParticles.emitRate = driftIntensity * 300 * spinoutBoost;
    } else {
      this.driftParticles.emitRate = 0;
    }
    
    // Update splash particles when in water and wheels are on the ground
    const isInWater = terrainName === 'water';
    if (isInWater && isGrounded && speed > 1) {
      this.splashParticles.emitRate = speed * 80;
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
