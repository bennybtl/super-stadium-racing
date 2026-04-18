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
import { TerrainQuery } from "../managers/TerrainQuery.js";
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
    const terrainQuery = new TerrainQuery(scene);
    this.terrainPhysics = new TerrainPhysics(this.state, this.halfHeight, terrainQuery);
    this.driftPhysics = new DriftPhysics(this.state);
    this.controls = new Controls(this.state);

    // Visual puppet — sits on top of the invisible physics box
    this.body = new TruckBody(this.mesh, scene, shadows, {
      body:   this.diffuseColor,
    }, vehicleDef ?? null);
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
      surfaceNormal: new Vector3(0, 1, 0),
      onGround: true,
      suspensionCompression: 0,
      suspensionVelocity: 0,
      targetRoll: 0,
      currentRoll: 0,
      terrainRoll: 0,
      isDrifting: false,
      isSpinningOut: false,
      slipAngle: 0,
      boostActive: false,
      boostTimer: 0,

      // Control parameters that can be tweaked for different handling characteristics
      springStrength: 150,
      damping: 22,
      maxSpeed: 25,
      maxReverseSpeed: -10,
      acceleration: 13,
      braking: 2,
      drag: 0.2,
      turnSpeed: 8.2,
      grip: 0.03,
      driftThreshold: 0.15,
      // How dramatically weight shifts under acceleration/braking.
      // Higher = more understeer on throttle, more oversteer on brakes.
      // Tune per vehicle: heavy trucks ~1.5, light buggies ~0.6.
      weightTransfer: 1.0,
      // Fraction of turn speed available when stationary (0 = can't spin, 1 = full rate).
      // Gives an arcade feel when > 0. Tune per vehicle.
      stationarySpinRate: 0.35,

      // Boost parameters
      boostCount: 5,
      maxBoosts: 5,
      boostDuration: 1.5,
      boostAccelMult: 2,
      boostSpeedMult: 1.5,

      // Slow zone — set each frame by the game loop when inside a 'slowZone' action zone
      slowZoneActive: false,
      slowZoneMaxSpeed: 5,
    };

    // Overlay any params supplied by the vehicle definition
    if (this.vehicleDef?.params) {
      Object.assign(base, this.vehicleDef.params);
    }

    return base;
  }



  update(input, deltaTime, terrainManager = null, track = null) {
    // If AI driver, get input from driver
    if (this.driver) {
      const forward = new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
      const fwdSpeed = this.state.velocity.dot(forward);
      input = this.driver.getInput(this.mesh.position, this.state.heading, fwdSpeed, deltaTime);
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
    // Horizontal (XZ) speed for steering/grip calculations — excludes velocity.y
    // so that airborne Y velocity doesn't inflate speedRatio and cause extra understeer.
    const hSpeed = Math.sqrt(
      this.state.velocity.x * this.state.velocity.x +
      this.state.velocity.z * this.state.velocity.z
    );

    // Apply roughness bumps — vertical impulses + pitch/roll jitter scaled by terrain and speed
    this.terrainPhysics.applyRoughnessBumps(terrainRoughness, hSpeed, groundedness, deltaTime);
    const forward = new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
    
    // Calculate speed-based factors (use hSpeed so velocity.y doesn't inflate understeer)
    const { speedRatio, effectiveTurnSpeed, effectiveGrip, rearTractionFactor } = this.controls.calculateSpeedFactors(
      hSpeed, terrainGripMultiplier, groundedness, input
    );
    
    // Handle input
    this.controls.updateSteering(input, effectiveTurnSpeed, speedRatio, groundedness, deltaTime);
    this.controls.updateAcceleration(input, forward, groundedness, deltaTime);

    // Apply drag
    this.driftPhysics.applyDrag(speed, input, deltaTime, terrainDragMultiplier, groundedness);

    // Apply grip and drift physics — rearTractionFactor encodes weight transfer:
    // throttle loosens rear (mild), braking unloads rear (significant).
    this.driftPhysics.applyGripAndDrift(hSpeed, forward, effectiveGrip, rearTractionFactor);
    
    // Movement - apply full 3D velocity (Y integration now handled here, not in TerrainPhysics)
    this.mesh.position.addInPlace(this.state.velocity.scale(deltaTime));

    // Update rotation
    this.mesh.rotation.y = this.state.heading;

    // Animate visual puppet — use the floor Y already resolved by TerrainPhysics this frame.
    // This is the effective surface (bridge deck or ground) rather than just raw terrain.
    const terrainY = track ? this.terrainPhysics.lastFloorY : null;
    const sampleSurfaceY = (x, z, fromY, fallback = terrainY ?? 0) =>
      this.terrainPhysics.sampleSurfaceYFastAt(x, z, fromY, track, fallback);
    this.body.update(this.state, input, hSpeed, deltaTime, terrainY, groundedness, sampleSurfaceY);
    
    // Sync physics body
    this.syncPhysicsBody();
    
    // Update roll
    this.driftPhysics.updateRoll(this.mesh, hSpeed, groundedness, input, effectiveTurnSpeed, speedRatio, deltaTime);
    
    // Update particle effects
    this.particles.update(this.state, hSpeed, terrainManager, isGrounded, deltaTime);
    
    // Return debug info
    return {
      compression: this.state.suspensionCompression,
      groundedness,
      penetration,
      verticalVelocity: this.state.velocity.y,
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

  /**
   * Teleport the truck to a position and heading, zeroing all motion.
   * Use this for respawning — no need to destroy and recreate the truck.
   */
  teleportTo(position, heading) {
    this.mesh.position.copyFrom(position);
    this.state.heading = heading;
    this.mesh.rotation.y = heading;
    this.state.velocity.setAll(0);
    this.state.suspensionCompression = 0;
    this.state.suspensionVelocity = 0;
    this.state.boostActive = false;
    this.state.boostTimer = 0;
    const body = this.physics?.body;
    if (body) {
      body.setLinearVelocity(Vector3.Zero());
      body.setAngularVelocity(Vector3.Zero());
    }
    this.syncPhysicsBody();
  }
}
