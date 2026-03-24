import { 
  MeshBuilder, 
  StandardMaterial, 
  Color3, 
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
  PhysicsMotionType,
} from "@babylonjs/core";
import { ParticleEffects } from "./ParticleEffects.js";
import { TerrainPhysics } from "./TerrainPhysics.js";
import { DriftPhysics } from "./DriftPhysics.js";
import { Controls } from "./Controls.js";

/**
 * Main Truck class that coordinates all truck subsystems
 */
export class Truck {
  constructor(scene, shadows, driver = null) {
    this.scene = scene;
    this.shadows = shadows;
    this.driver = driver; // Optional AI driver
    
    // Create mesh and physics
    this.mesh = this.createMesh();
    this.physics = this.createPhysics();
    
    // Initialize state
    this.state = this.createState();
    
    // Initialize subsystems
    this.particles = new ParticleEffects(this.mesh, scene);
    this.terrainPhysics = new TerrainPhysics(this.state);
    this.driftPhysics = new DriftPhysics(this.state);
    this.controls = new Controls(this.state);
    
    // If AI driver, make truck visually distinct
    if (this.driver) {
      this.mesh.material.diffuseColor = new Color3(0.2, 0.2, 0.8); // Blue for AI
    }
  }

  createMesh() {
    const mesh = MeshBuilder.CreateBox("truck", { width: 1.5, height: 0.8, depth: 2.2 }, this.scene);
    mesh.position.y = 0.4;

    const mat = new StandardMaterial("truckMat", this.scene);
    mat.diffuseColor = new Color3(0.8, 0.2, 0.1);
    mesh.material = mat;
    this.shadows.addShadowCaster(mesh);
    
    return mesh;
  }

  createPhysics() {
    const physics = new PhysicsAggregate(this.mesh, PhysicsShapeType.BOX, {
      mass: 10,
      restitution: 0.9,
      friction: 0.1
    }, this.scene);
    physics.body.setMotionType(PhysicsMotionType.ANIMATED);
    physics.body.disablePreStep = false;
    
    return physics;
  }

  createState() {
    return {
      heading: 0,
      velocity: Vector3.Zero(),
      verticalVelocity: 0,
      onGround: true,
      suspensionCompression: 0,
      suspensionVelocity: 0,
      targetRoll: 0,
      currentRoll: 0,
      terrainRoll: 0,
      springStrength: 150,
      damping: 7,
      maxSpeed: 25,
      maxReverseSpeed: -10,
      acceleration: 7,
      braking: 18,
      drag: 4,
      turnSpeed: 3.6,
      grip: 0.03,
      driftThreshold: 0.1,
      isDrifting: false,
      isSpinningOut: false,
      slipAngle: 0,
      boostCount: 5,
      boostActive: false,
      boostTimer: 0,
      maxBoosts: 5,
      boostDuration: 3.0,
      boostAccelMult: 2.5,
      boostSpeedMult: 1.8,
    };
  }

  update(input, deltaTime, terrainManager = null, track = null) {
    // If AI driver, get input from driver
    if (this.driver) {
      input = this.driver.getInput(this.mesh.position, this.state.heading);
    }
    
    // Update boost timer
    this.controls.updateBoost(deltaTime);
    
    // Terrain physics (gravity, suspension, slopes)
    const { groundedness, penetration } = this.terrainPhysics.update(this.mesh, deltaTime, track);
    
    // Get terrain modifiers
    let terrainGripMultiplier = 1.0;
    let terrainDragMultiplier = 1.0;
    if (terrainManager) {
      const terrain = terrainManager.getTerrainAt(this.mesh.position);
      terrainGripMultiplier = terrain.gripMultiplier;
      terrainDragMultiplier = terrain.dragMultiplier;
    }

    const speed = this.state.velocity.length();
    const forward = new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
    
    // Calculate speed-based factors
    const { speedRatio, effectiveTurnSpeed, effectiveGrip } = this.controls.calculateSpeedFactors(
      speed, terrainGripMultiplier, groundedness
    );
    
    // Handle input
    this.controls.updateSteering(input, effectiveTurnSpeed, speedRatio, groundedness, deltaTime);
    this.controls.updateAcceleration(input, forward, groundedness, deltaTime);
    
    // Apply drag
    this.driftPhysics.applyDrag(speed, input, deltaTime, terrainDragMultiplier);
    
    // Apply grip and drift physics
    this.driftPhysics.applyGripAndDrift(speed, forward, effectiveGrip);
    
    // Movement - apply velocity to X/Z position (Y is handled by TerrainPhysics)
    const newPosition = this.terrainPhysics.checkSteepSlope(this.mesh, deltaTime, track);
    this.mesh.position.x = newPosition.x;
    this.mesh.position.z = newPosition.z;

    // Update rotation
    this.mesh.rotation.y = this.state.heading;
    
    // Sync physics body
    this.syncPhysicsBody();
    
    // Update roll
    this.driftPhysics.updateRoll(this.mesh, speed, groundedness, input, effectiveTurnSpeed, speedRatio, deltaTime);
    
    // Update particle effects
    this.particles.update(this.state, speed, terrainManager);
    
    // Return debug info
    return {
      compression: this.state.suspensionCompression,
      groundedness,
      penetration,
      verticalVelocity: this.state.verticalVelocity,
      speed,
      effectiveGrip,
      slipAngle: this.state.slipAngle,
      terrainGripMultiplier,
      x: this.mesh.position.x,
      y: this.mesh.position.y,
      z: this.mesh.position.z
    };
  }

  syncPhysicsBody() {
    if (this.physics) {
      this.physics.body.transformNode.position = this.mesh.position.clone();
      this.physics.body.transformNode.rotationQuaternion = this.mesh.rotationQuaternion ? 
        this.mesh.rotationQuaternion.clone() : null;
      this.physics.body.transformNode.rotation = this.mesh.rotation.clone();
    }
  }
}

// Export legacy factory function for backward compatibility
export function createTruck(scene, shadows, driver = null) {
  const truck = new Truck(scene, shadows, driver);
  return {
    mesh: truck.mesh,
    state: truck.state,
    particles: truck.particles.driftParticles,
    splashParticles: truck.particles.splashParticles,
    physics: truck.physics,
    aiDriver: truck.driver, // Expose AI driver reference
    _truckInstance: truck  // Store reference for updateTruck
  };
}

export function updateTruck(truck, input, deltaTime, terrainManager = null, track = null) {
  // If we have the new truck instance, use it
  if (truck._truckInstance) {
    return truck._truckInstance.update(input, deltaTime, terrainManager, track);
  }
  
  // Fallback: shouldn't reach here with new code
  throw new Error("Truck instance not found. Use new Truck class.");
}
