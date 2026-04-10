import { 
  MeshBuilder, 
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
import { TruckBody } from "./TruckBody.js";
import { TRUCK_HEIGHT, TRUCK_WIDTH, TRUCK_DEPTH } from "../constants.js"; // used as fallback defaults only

/**
 * Main Truck class that coordinates all truck subsystems
 */
export class Truck {
  constructor(scene, shadows, diffuseColor = null, driver = null, vehicleDef = null) {
    this.scene = scene;
    this.shadows = shadows;
    this.driver = driver; // Optional AI driver
    this.vehicleDef = vehicleDef; // Optional vehicle definition from VehicleLoader
    this.vehicleName = vehicleDef?.name ?? 'Truck';

    // Color priority: explicit arg → vehicleDef defaultColor → built-in default
    const defColor = vehicleDef?.defaultColor;
    this.diffuseColor = diffuseColor
      ? diffuseColor
      : defColor
        ? new Color3(defColor[0], defColor[1], defColor[2])
        : new Color3(0.8, 0.2, 0.1);

    // Physics box dimensions — from vehicleDef, falling back to shared constants
    const box = vehicleDef?.physicsBox ?? {};
    this.width      = box.width  ?? TRUCK_WIDTH;
    this.height     = box.height ?? TRUCK_HEIGHT;
    this.depth      = box.depth  ?? TRUCK_DEPTH;
    this.halfHeight = this.height / 2;
    // Half-diagonal of the XZ footprint — used by wall and tire-stack collision
    this.radius     = Math.sqrt((this.width / 2) ** 2 + (this.depth / 2) ** 2);
    
    // Create mesh and physics
    this.mesh = this.createMesh();
    this.physics = this.createPhysics();
    
    // Initialize state
    this.state = this.createState();
    
    // Initialize subsystems
    this.particles = new ParticleEffects(this.mesh, scene);
    this.terrainPhysics = new TerrainPhysics(this.state, this.halfHeight);
    this.driftPhysics = new DriftPhysics(this.state);
    this.controls = new Controls(this.state);

    // Visual puppet — sits on top of the invisible physics box
    this.body = new TruckBody(this.mesh, scene, shadows, {
      body:   this.diffuseColor,
    }, vehicleDef?.wheels ?? null);
  }

  createMesh() {
    const mesh = MeshBuilder.CreateBox("truck", { width: this.width, height: this.height, depth: this.depth }, this.scene);
    mesh.position.y = this.halfHeight;
    mesh.isVisible = false;  // visual puppet replaces this
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
    const base = {
      heading: 0,
      velocity: Vector3.Zero(),
      verticalVelocity: 0,
      onGround: true,
      suspensionCompression: 0,
      suspensionVelocity: 0,
      targetRoll: 0,
      currentRoll: 0,
      terrainRoll: 0,
      terrainPitch: 0,
      isDrifting: false,
      isSpinningOut: false,
      slipAngle: 0,
      boostActive: false,
      boostTimer: 0,

      // Control parameters that can be tweaked for different handling characteristics
      springStrength: 150,
      damping: 7,
      maxSpeed: 25,
      maxReverseSpeed: -10,
      acceleration: 13,
      braking: 2,
      drag: 4,
      turnSpeed: 3.6,
      grip: 0.03,
      driftThreshold: 0.1,

      // Boost parameters
      boostCount: 5,
      maxBoosts: 5,
      boostDuration: 1.5,
      boostAccelMult: 2,
      boostSpeedMult: 1.5,
    };

    // Overlay any params supplied by the vehicle definition
    if (this.vehicleDef?.params) {
      Object.assign(base, this.vehicleDef.params);
      // Keep boostCount in sync with maxBoosts on first load
      base.boostCount = base.maxBoosts;
    }

    return base;
  }



  update(input, deltaTime, terrainManager = null, track = null) {
    // If AI driver, get input from driver
    if (this.driver) {
      const forward = new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
      const fwdSpeed = this.state.velocity.dot(forward);
      input = this.driver.getInput(this.mesh.position, this.state.heading, fwdSpeed);
    }
    
    // Update boost timer
    this.controls.updateBoost(deltaTime);
    
    // Terrain physics (gravity, suspension, slopes)
    const { groundedness, penetration } = this.terrainPhysics.update(this.mesh, deltaTime, track);
    
    // Get terrain modifiers — only apply when wheels are actually on or near the ground
    let terrainGripMultiplier = 1.0;
    let terrainDragMultiplier = 1.0;
    let terrainRoughness = 0;
    const isGrounded = penetration > -0.3;
    if (terrainManager && isGrounded) {
      const terrain = terrainManager.getTerrainAt(this.mesh.position);
      terrainGripMultiplier = terrain.gripMultiplier;
      terrainDragMultiplier = terrain.dragMultiplier;
      terrainRoughness = terrain.roughness ?? 0;
    }

    const speed = this.state.velocity.length();

    // Apply roughness bumps — vertical impulses + pitch/roll jitter scaled by terrain and speed
    this.terrainPhysics.applyRoughnessBumps(terrainRoughness, speed, groundedness, deltaTime);
    const forward = new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
    
    // Calculate speed-based factors
    const { speedRatio, effectiveTurnSpeed, effectiveGrip } = this.controls.calculateSpeedFactors(
      speed, terrainGripMultiplier, groundedness
    );
    
    // Handle input
    this.controls.updateSteering(input, effectiveTurnSpeed, speedRatio, groundedness, deltaTime);
    this.controls.updateAcceleration(input, forward, groundedness, deltaTime);

    // Uphill gravity — decelerate proportional to slope so climbing costs speed
    this.terrainPhysics.applyUphillGravity(this.mesh, deltaTime, track, groundedness);
    
    // Apply drag
    this.driftPhysics.applyDrag(speed, input, deltaTime, terrainDragMultiplier, groundedness);
    
    // Calculate brake grip reduction (weight transfer)
    const brakeGripReduction = this.controls.getBrakeGripReduction(input, speed);
    
    // Apply grip and drift physics with brake weight transfer
    this.driftPhysics.applyGripAndDrift(speed, forward, effectiveGrip, brakeGripReduction);
    
    // Movement - apply velocity to X/Z position (Y is handled by TerrainPhysics)
    const newPosition = this.terrainPhysics.checkSteepSlope(this.mesh, deltaTime, track);
    this.mesh.position.x = newPosition.x;
    this.mesh.position.z = newPosition.z;

    // Update rotation
    this.mesh.rotation.y = this.state.heading;

    // Animate visual puppet — pass terrain height so the puppet stays above ground
    const terrainY = track ? track.getHeightAt(this.mesh.position.x, this.mesh.position.z) : null;
    this.body.update(this.state, input, speed, deltaTime, terrainY);
    
    // Sync physics body
    this.syncPhysicsBody();
    
    // Update roll
    this.driftPhysics.updateRoll(this.mesh, speed, groundedness, input, effectiveTurnSpeed, speedRatio, deltaTime);
    
    // Update particle effects
    this.particles.update(this.state, speed, terrainManager, isGrounded, deltaTime);
    
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
