import { 
  MeshBuilder, 
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
  PhysicsMotionType,
  Quaternion,
  StandardMaterial,
} from "@babylonjs/core";
import { ParticleEffects } from "./ParticleEffects.js";
import { RaycastSuspension } from "./RaycastSuspension.js";
import { DriveForces } from "./DriveForces.js";
import { SteeringControl } from "./SteeringControl.js";
import { TruckBody } from "./TruckBody.js";
import { TRUCK_HALF_HEIGHT, TRUCK_HEIGHT, TRUCK_WIDTH, TRUCK_DEPTH } from "../constants.js";
import { Color3 } from "@babylonjs/core";

/**
 * PhysicsTruck - Physics-based truck using Havok DYNAMIC simulations
 * 
 * Uses real physics engine for all movement instead of custom arcade physics.
 * Features raycast suspension, force-based acceleration, and torque-based steering.
 */
export class PhysicsTruck {
  constructor(scene, shadows, diffuseColor = null, driver = null, spawnPos = null) {
    this.scene = scene;
    this.shadows = shadows;
    this.driver = driver;
    this.diffuseColor = diffuseColor || new Color3(0.8, 0.2, 0.1);
    
    // Create mesh and physics
    this.mesh = this.createMesh();
    if (spawnPos) this.mesh.position.copyFrom(spawnPos);
    this.physics = this.createPhysics();
    
    // Initialize state (compatible with arcade truck)
    this.state = this.createState();
    
    // Initialize physics subsystems
    this.suspension = new RaycastSuspension(scene);
    this.driveForces = new DriveForces();
    this.steeringControl = new SteeringControl();
    
    // Visual components (reused from arcade truck)
    this.particles = new ParticleEffects(this.mesh, scene);
    
    // Create visual wheels for debugging
    this.visualWheels = this.createVisualWheels();
    
    // Temporarily disabled for debugging - show physics box instead
    // this.body = new TruckBody(this.mesh, scene, shadows, {
    //   body:   this.diffuseColor,
    //   cabin:  new Color3(0.25, 0.25, 0.3),
    //   wheel:  new Color3(0.12, 0.12, 0.12),
    //   detail: new Color3(0.75, 0.75, 0.75),
    // });
  }

  createMesh() {
    const mesh = MeshBuilder.CreateBox("physicsTruck", { 
      width: TRUCK_WIDTH, 
      height: TRUCK_HEIGHT, 
      depth: TRUCK_DEPTH 
    }, this.scene);
    mesh.position.y = TRUCK_HALF_HEIGHT;
    mesh.isVisible = true;  // Show physics box for debugging
    
    // Add simple material for visibility
    const mat = new StandardMaterial("physicsBoxMat", this.scene);
    mat.diffuseColor = this.diffuseColor;
    mat.specularColor = new Color3(0.2, 0.2, 0.2);
    mesh.material = mat;
    
    return mesh;
  }

  createVisualWheels() {
    const wheels = [];
    const wheelRadius = 0.75;  // Must match RaycastSuspension wheelRadius
    const wheelWidth = 0.3;
    
    // Match the wheel positions from RaycastSuspension
    const wheelPositions = [
      { name: "F", x: 0, z: 1.5 },   // Front wheel
      { name: "R", x: 0, z: -1.5 },  // Rear wheel
    ];
    
    for (const pos of wheelPositions) {
      // Create cylinder for wheel (rotated to be horizontal)
      const wheel = MeshBuilder.CreateCylinder(`wheel_${pos.name}`, {
        diameter: wheelRadius * 2,
        height: wheelWidth,
        tessellation: 16
      }, this.scene);
      
      wheel.rotation.z = Math.PI / 2; // Rotate to be horizontal
      wheel.position.set(pos.x, 0, pos.z); // Y will be updated each frame
      wheel.parent = this.mesh;
      
      // Add material
      const mat = new StandardMaterial(`wheelMat_${pos.name}`, this.scene);
      mat.diffuseColor = new Color3(0.1, 0.1, 0.1); // Dark gray
      mat.specularColor = new Color3(0.3, 0.3, 0.3);
      wheel.material = mat;
      
      wheels.push({ mesh: wheel, name: pos.name });
    }
    
    return wheels;
  }

  createPhysics() {
    // Create DYNAMIC physics body (key difference from arcade truck!)
    const physics = new PhysicsAggregate(this.mesh, PhysicsShapeType.BOX, {
      mass: 1400,             // Heavier to resist being tossed around
      restitution: 0.1,       // Less bouncy
      friction: 0.9           // Good base grip, allows drift at high speed
    }, this.scene);
    
    physics.body.setMotionType(PhysicsMotionType.DYNAMIC);
    physics.body.disablePreStep = false;
    
    // Configure mass properties for better handling
    physics.body.setMassProperties({
      mass: 1400,
      centerOfMass: new Vector3(0, -0.5, 0),  // Lower center of mass for stability
      inertia: new Vector3(4.0, 1.0, 2.5),    // Very high X inertia to resist roll
    });
    
    // Add significant damping to prevent excessive bouncing and spinning
    physics.body.setLinearDamping(0.2);  // Lower linear damping for more sliding
    physics.body.setAngularDamping(0.9); // Moderate angular damping - allows drifting but prevents rollover
    
    return physics;
  }

  createState() {
    // Maintain compatibility with arcade truck state
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
      terrainPitch: 0,
      isDrifting: false,
      isSpinningOut: false,
      slipAngle: 0,
      boostActive: false,
      boostTimer: 0,

      // Physics truck parameters (different from arcade)
      maxSpeed: 25,
      maxReverseSpeed: -10,
      
      // Boost parameters
      boostCount: 5,
      maxBoosts: 5,
      boostDuration: 1.5,
      boostAccelMult: 2,
      boostSpeedMult: 1.5,
    };
  }

  update(input, deltaTime, terrainManager = null, track = null) {
    // If AI driver, get input from driver
    if (this.driver) {
      const forward = new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
      const fwdSpeed = this.state.velocity.dot(forward);
      input = this.driver.getInput(this.mesh.position, this.state.heading, fwdSpeed);
    }
    
    // Update boost timer
    this.updateBoost(input, deltaTime);
    
    // Get physics state
    const body = this.physics.body;
    const velocity = body.getLinearVelocity();
    
    // Calculate forward direction and speed
    const rotation = this.mesh.rotationQuaternion || Quaternion.FromEulerAngles(this.mesh.rotation.x, this.mesh.rotation.y, this.mesh.rotation.z);
    const forward = new Vector3(0, 0, 1);
    forward.rotateByQuaternionToRef(rotation, forward);
    
    const currentSpeed = velocity.dot(forward);
    const speed = velocity.length();
    
    // Update state for compatibility
    this.state.heading = this.mesh.rotation.y;
    this.state.velocity.copyFrom(velocity);
    this.state.verticalVelocity = velocity.y;
    
    // Convert arcade input format {forward, back, left, right} to physics format {throttle, brake, steering, boost}
    const physicsInput = {
      throttle: input.forward ? 1.0 : (input.back ? -1.0 : 0.0),
      brake: 0.0, // Could add separate brake key later
      steering: input.left ? -1.0 : (input.right ? 1.0 : 0.0),
      boost: input.boost || false
    };
    
    // 1. Suspension system (raycasts + spring forces)
    const wheelContacts = this.suspension.update(body, this.mesh, track, deltaTime);
    const groundedWheelCount = wheelContacts.length;
    this.state.onGround = groundedWheelCount > 0;
    this.state.suspensionCompression = this.suspension.getAverageCompression();
    
    // 2. Get terrain properties
    let terrainFrictionMultiplier = 1.0;
    let terrainDragMultiplier = 1.0;
    if (terrainManager && this.state.onGround) {
      const terrain = terrainManager.getTerrainAt(this.mesh.position);
      terrainFrictionMultiplier = terrain.gripMultiplier / 2.0; // Scale for physics
      terrainDragMultiplier = terrain.dragMultiplier;
    }
    
    // 3. Drive forces (acceleration/braking)
    this.driveForces.update(body, physicsInput, wheelContacts, forward, currentSpeed, deltaTime);
    
    // 4. Steering control (torque-based)
    this.steeringControl.update(body, physicsInput, currentSpeed, groundedWheelCount, deltaTime);
    
    // 5. Apply drag
    this.driveForces.applyDrag(body, currentSpeed, terrainDragMultiplier);
    
    // 6. Apply terrain friction (lateral resistance)
    if (this.state.onGround && speed > 0.1) {
      this.applyLateralFriction(body, forward, velocity, terrainFrictionMultiplier);
    }
    
    // 7. Calculate drift state (for visual effects)
    this.updateDriftState(forward, velocity, speed);
    
    // 8. Visual updates
    this.updateVisualWheels(wheelContacts);
    // this.body.update(this.state, input, speed, deltaTime); // Disabled for debugging
    this.particles.update(this.state, speed, terrainManager, this.state.onGround, deltaTime);
    
    // Return debug info
    return {
      compression: this.state.suspensionCompression,
      groundedness: groundedWheelCount / 4.0,
      penetration: 0, // Not applicable for physics truck
      verticalVelocity: this.state.verticalVelocity,
      speed,
      effectiveGrip: terrainFrictionMultiplier,
      slipAngle: this.state.slipAngle,
      terrainGripMultiplier: terrainFrictionMultiplier,
      x: this.mesh.position.x,
      y: this.mesh.position.y,
      z: this.mesh.position.z
    };
  }

  /**
   * Update visual wheel positions based on suspension
   */
  updateVisualWheels(wheelContacts) {
    const wheelRadius = 0.5;
    const baseY = -TRUCK_HALF_HEIGHT + wheelRadius; // Bottom of box + wheel radius
    
    for (const visualWheel of this.visualWheels) {
      // Find matching contact
      const contact = wheelContacts.find(c => c.wheel.name === visualWheel.name);
      
      if (contact) {
        // Position wheel based on compression (more compression = wheel moves up)
        visualWheel.mesh.position.y = baseY + contact.compression * 0.5;
      } else {
        // No contact - wheel at full droop
        visualWheel.mesh.position.y = baseY;
      }
    }
  }

  /**
   * Apply lateral friction to prevent excessive sliding
   */
  applyLateralFriction(body, forward, velocity, frictionMultiplier) {
    // Get right vector (perpendicular to forward)
    const right = new Vector3(-forward.z, 0, forward.x);
    
    // Calculate lateral velocity component
    const lateralVelocity = right.scale(velocity.dot(right));
    const lateralSpeed = lateralVelocity.length();
    
    // Speed-dependent grip: good grip at normal speeds, can break loose at very high speeds
    const speed = velocity.length();
    const speedGripFactor = Math.max(0.4, 1.0 - (speed / 40)); // Only drops at very high speed
    
    // Increased base friction for better control
    const baseFriction = 1200;
    const frictionStrength = baseFriction * frictionMultiplier * speedGripFactor;
    
    // Apply friction force opposing lateral motion at center to avoid roll moments
    const frictionForce = lateralVelocity.scale(-frictionStrength);
    body.applyForce(frictionForce, body.transformNode.position);
  }

  /**
   * Update drift state for visual effects
   */
  updateDriftState(forward, velocity, speed) {
    if (speed < 0.5) {
      this.state.isDrifting = false;
      this.state.slipAngle = 0;
      return;
    }
    
    const velocityDir = velocity.normalize();
    const forwardDot = forward.dot(velocityDir);
    
    // Calculate slip angle
    this.state.slipAngle = Math.acos(Math.max(-1, Math.min(1, forwardDot)));
    this.state.isDrifting = this.state.slipAngle > 0.2;
  }

  /**
   * Update boost state
   */
  updateBoost(input, deltaTime) {
    if (this.state.boostActive) {
      this.state.boostTimer -= deltaTime;
      if (this.state.boostTimer <= 0) {
        this.state.boostActive = false;
        this.state.boostTimer = 0;
      }
    }
    
    // Activate boost
    if (input.boost && this.state.boostCount > 0 && !this.state.boostActive) {
      this.state.boostActive = true;
      this.state.boostTimer = this.state.boostDuration;
      this.state.boostCount--;
    }
  }
}
