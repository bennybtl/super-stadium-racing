import { Vector3, ParticleSystem, Texture, Color4 } from "@babylonjs/core";

/**
 * Manages particle effects for the truck (drift smoke and water splash)
 */
export class ParticleEffects {
  constructor(mesh, scene) {
    this.mesh = mesh;
    this.scene = scene;
    this.driftParticles = this.createDriftParticles();
    this.splashParticles = this.createSplashParticles();
  }

  createDriftParticles() {
    const particles = new ParticleSystem("drift", 200, this.scene);
    particles.particleTexture = new Texture("https://assets.babylonjs.com/textures/flare.png", this.scene);
    particles.emitter = this.mesh;
    particles.minEmitBox = new Vector3(-0.7, 0, -1);  // Rear left wheel
    particles.maxEmitBox = new Vector3(0.7, 0, -1);   // Rear right wheel
    
    particles.color1 = new Color4(0.4, 0.3, 0.2, 0.5);
    particles.color2 = new Color4(0.3, 0.25, 0.15, 0.3);
    particles.colorDead = new Color4(0.2, 0.15, 0.1, 0);
    
    particles.minSize = 0.3;
    particles.maxSize = 0.8;
    particles.minLifeTime = 0.3;
    particles.maxLifeTime = 0.6;
    
    particles.emitRate = 0;
    particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    particles.gravity = new Vector3(0, -1, 0);
    particles.direction1 = new Vector3(-1, 0.5, -0.5);
    particles.direction2 = new Vector3(1, 0.5, -0.5);
    particles.minAngularSpeed = 0;
    particles.maxAngularSpeed = Math.PI;
    particles.minEmitPower = 1;
    particles.maxEmitPower = 3;
    particles.updateSpeed = 0.01;
    
    particles.start();
    return particles;
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

  update(state, speed, terrainManager, isGrounded = true) {
    // Update drift particles
    if (speed > 0.5) {
      const driftIntensity = Math.max(0, state.slipAngle - state.driftThreshold);
      const spinoutBoost = state.isSpinningOut ? 2.0 : 1.0;
      this.driftParticles.emitRate = driftIntensity * 300 * spinoutBoost;
    } else {
      this.driftParticles.emitRate = 0;
    }
    
    // Update splash particles when in water and wheels are on the ground
    const isInWater = terrainManager && terrainManager.getTerrainAt(this.mesh.position).name === 'WATER';
    if (isInWater && isGrounded && speed > 1) {
      this.splashParticles.emitRate = speed * 80;
    } else {
      this.splashParticles.emitRate = 0;
    }
  }
}
