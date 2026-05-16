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
import { UPGRADES } from "../managers/UpgradeStorage.js";

/**
 * Main Truck class that coordinates all truck subsystems
 */
export class Truck {
  constructor(scene, shadows, diffuseColor = null, driver = null, vehicleDef = null, upgrades = null) {
    this.scene = scene;
    this.shadows = shadows;
    this.driver = driver; // Optional AI driver
    this.vehicleDef = vehicleDef; // Optional vehicle definition from VehicleLoader
    this.vehicleName = vehicleDef?.name ?? 'Truck';
    this.upgrades = upgrades ?? {}; // Player upgrades that modify truck stats

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
    this.particles = new ParticleEffects(this.mesh, scene, {
      qualityScale: this.driver ? 0.45 : 1,
    });
    this.audioController = null;
    const terrainQuery = new TerrainQuery(scene);
    const terrainPhysicsOptions = this.driver
      ? { normalSampleInterval: 1 / 20 }
      : { normalSampleInterval: 0 };
    this.terrainPhysics = new TerrainPhysics(this.state, this.halfHeight, terrainQuery, terrainPhysicsOptions);
    this.driftPhysics = new DriftPhysics(this.state);
    this.controls = new Controls(this.state);

    // Reused hot-path temporaries (avoid per-frame allocations)
    this._forward = new Vector3();
    this._surfaceSampleTrack = null;
    this._surfaceSampleFallback = 0;
    this._surfaceSampler = (x, z, fromY, fallback = this._surfaceSampleFallback) =>
      this.terrainPhysics.sampleSurfaceYFastAt(x, z, fromY, this._surfaceSampleTrack, fallback);

    // AI trucks can run particle effect updates at a lower cadence.
    this._particleUpdateInterval = this.driver ? (1 / 30) : 0;
    this._particleUpdateAccumulator = 0;

    // AI visual puppet updates can run at a lower cadence with minimal gameplay impact.
    this._bodyUpdateInterval = this.driver ? (1 / 30) : 0;
    this._bodyUpdateIntervalMid = this.driver ? (1 / 20) : 0;
    this._bodyUpdateIntervalFar = this.driver ? (1 / 12) : 0;
    this._bodyUpdateAccumulator = 0;

    // Terrain physics LOD: far AI trucks can use a cheaper suspension path.
    this._terrainPhysicsLodFarDistanceSq = 55 * 55;

    // Reused debug payload to avoid per-frame object allocation.
    this._debugInfo = {
      compression: 0,
      groundedness: 0,
      penetration: 0,
      verticalVelocity: 0,
      speed: 0,
      effectiveGrip: 0,
      slipAngle: 0,
      terrainGripMultiplier: 1,
      x: 0,
      y: 0,
      z: 0,
    };

    // Visual puppet — sits on top of the invisible physics box
    this.body = new TruckBody(this.mesh, scene, shadows, {
      body:   this.diffuseColor,
    }, vehicleDef ?? null, {
      disableDynamicShadows: !!this.driver,
    });
  }

  setAudioController(audioController) {
    this.audioController = audioController;
  }

  /**
   * Apply stored upgrades to the truck's state.
   * Called during construction and can be called again if upgrades change.
   */
  _applyUpgradesToState(state) {
    for (const upgrade of UPGRADES) {
      const level = this.upgrades[upgrade.id] ?? 0;
      if (level === 0) continue;
      if (upgrade.id === 'suspension') {
        // Suspension upgrades both spring strength and damping
        state.springStrength += 20 * level;
        state.damping        += 1.5 * level;
        state.turnSpeed       += 0.3 * level;
        state.weightTransfer    -= 0.05 * level;
      } else if (upgrade.id === 'grip') {
        // Grip upgrades add a flat multiplier to the grip stat rather than scaling it,
        // so that it remains effective even with terrain modifiers and at high speeds.
        state.grip += upgrade.statDelta * level;
        state.turnSpeed       += 0.15 * level;
        state.driftThreshold  -= 0.01 * level;
      } else if (upgrade.statKey) {
        state[upgrade.statKey] += upgrade.statDelta * level;
      }
    }
    // Apply persistent nitro pool
    state.boostCount = this.upgrades.nitroCount ?? state.boostCount;
    state.maxBoosts  = this.upgrades.nitroCount ?? state.maxBoosts;
  }

  createMesh() {
    const mesh = MeshBuilder.CreateBox("truck", { width: this.width, height: this.height, depth: this.depth }, this.scene);
    mesh.position.y = this.halfHeight;
    // Force Euler rotation path. If a quaternion is present, Babylon ignores mesh.rotation.
    mesh.rotationQuaternion = null;
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

    // Apply upgrades to base stats
    this._applyUpgradesToState(base);

    return base;
  }



  update(input, deltaTime, terrainManager = null, track = null, collectDebugInfo = true, effectsFocusPosition = null, profiler = null) {
    const profile = (label, fn) => {
      if (!profiler) return fn();
      return profiler.measure(label, fn);
    };

    // If AI driver, get input from driver
    if (this.driver) {
      profile('truck.aiInput', () => {
        this._forward.set(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
        const fwdSpeed = this.state.velocity.dot(this._forward);
        input = this.driver.getInput(this.mesh.position, this.state.heading, fwdSpeed, deltaTime);
      });
    }
    
    // Update boost timer
    profile('truck.controls.boost', () => this.controls.updateBoost(deltaTime));
    
    // Terrain physics (gravity, suspension, slopes)
    let terrainLowDetail = false;
    let terrainDistance = 0;
    if (this.driver && effectsFocusPosition) {
      const dx = this.mesh.position.x - effectsFocusPosition.x;
      const dz = this.mesh.position.z - effectsFocusPosition.z;
      const distSq = dx * dx + dz * dz;
      terrainDistance = Math.sqrt(distSq);
      terrainLowDetail = distSq > this._terrainPhysicsLodFarDistanceSq;
    }

    const { groundedness, penetration } = profile(
      'truck.terrainPhysics',
      () => this.terrainPhysics.update(this.mesh, deltaTime, track, {
        lowDetail: terrainLowDetail,
      })
    );
    
    // Get terrain modifiers — only apply when wheels are actually on or near the ground
    let terrainGripMultiplier = 1.0;
    let terrainDragMultiplier = 1.0;
    let terrainRoughness = 0;
    let terrain = null;
    const isGrounded = penetration > -0.3;
    profile('truck.terrainSample', () => {
      if (terrainManager && isGrounded) {
        terrain = terrainManager.getTerrainAt(this.mesh.position);
        terrainGripMultiplier = terrain.gripMultiplier;
        terrainDragMultiplier = terrain.dragMultiplier;
        terrainRoughness = terrain.roughness ?? 0;
      }
    });

    const speed = this.state.velocity.length();
    // Horizontal (XZ) speed for steering/grip calculations — excludes velocity.y
    // so that airborne Y velocity doesn't inflate speedRatio and cause extra understeer.
    const hSpeed = Math.sqrt(
      this.state.velocity.x * this.state.velocity.x +
      this.state.velocity.z * this.state.velocity.z
    );

    // Apply roughness bumps — vertical impulses + pitch/roll jitter scaled by terrain and speed
    profile('truck.roughnessBumps', () =>
      this.terrainPhysics.applyRoughnessBumps(terrainRoughness, hSpeed, groundedness, deltaTime)
    );
    this._forward.set(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
    
    // Calculate speed-based factors (use hSpeed so velocity.y doesn't inflate understeer)
    const { speedRatio, effectiveTurnSpeed, effectiveGrip, rearTractionFactor } = profile(
      'truck.controls.speedFactors',
      () => this.controls.calculateSpeedFactors(
        hSpeed, terrainGripMultiplier, groundedness, input
      )
    );
    
    // Handle input
    profile('truck.controls.steering', () =>
      this.controls.updateSteering(input, effectiveTurnSpeed, speedRatio, groundedness, deltaTime)
    );
    profile('truck.controls.acceleration', () =>
      this.controls.updateAcceleration(input, this._forward, groundedness, deltaTime)
    );

    // Apply drag
    profile('truck.drag', () =>
      this.driftPhysics.applyDrag(speed, input, deltaTime, terrainDragMultiplier, groundedness)
    );

    // Apply grip and drift physics — rearTractionFactor encodes weight transfer:
    // throttle loosens rear (mild), braking unloads rear (significant).
    profile('truck.drift', () =>
      this.driftPhysics.applyGripAndDrift(hSpeed, this._forward, effectiveGrip, rearTractionFactor)
    );
    
    // Movement - apply full 3D velocity (Y integration now handled here, not in TerrainPhysics)
    profile('truck.integrate', () => {
      this.mesh.position.x += this.state.velocity.x * deltaTime;
      this.mesh.position.y += this.state.velocity.y * deltaTime;
      this.mesh.position.z += this.state.velocity.z * deltaTime;
    });

    // Update rotation
    profile('truck.rotate', () => {
      this.mesh.rotation.y = this.state.heading;
    });

    // Update roll before syncing the physics body so visual lean is live this frame.
    profile('truck.roll', () =>
      this.driftPhysics.updateRoll(this.mesh, hSpeed, groundedness, input, effectiveTurnSpeed, speedRatio, deltaTime)
    );

    // Animate visual puppet — use the floor Y already resolved by TerrainPhysics this frame.
    // This is the effective surface (bridge deck or ground) rather than just raw terrain.
    const terrainY = track ? this.terrainPhysics.lastFloorY : null;
    this._surfaceSampleTrack = track;
    this._surfaceSampleFallback = terrainY ?? 0;
    let bodyUpdateInterval = this._bodyUpdateInterval;
    if (this.driver && effectsFocusPosition) {
      const dx = this.mesh.position.x - effectsFocusPosition.x;
      const dz = this.mesh.position.z - effectsFocusPosition.z;
      const distSq = dx * dx + dz * dz;
      const near = 35;
      const far = 75;
      if (distSq >= far * far) {
        bodyUpdateInterval = this._bodyUpdateIntervalFar;
      } else if (distSq >= near * near) {
        bodyUpdateInterval = this._bodyUpdateIntervalMid;
      }
    }

    this._bodyUpdateAccumulator += deltaTime;
    if (
      bodyUpdateInterval <= 0 ||
      this._bodyUpdateAccumulator >= bodyUpdateInterval
    ) {
      const bodyDt = this._bodyUpdateAccumulator;
      this._bodyUpdateAccumulator = 0;
      profile('truck.bodyVisual', () =>
        this.body.update(this.state, input, hSpeed, bodyDt, terrainY, groundedness, this._surfaceSampler)
      );
    }

    profile('truck.audio', () => {
      this.audioController?.update({
        state: this.state,
        speed,
        hSpeed,
        groundedness,
        deltaTime,
        maxSpeed: this.state.maxSpeed,
        mesh: this.mesh,
        track,
        currentTerrain: terrain,
        input,
      });
    });

    // Sync physics body
    profile('truck.syncPhysics', () => this.syncPhysicsBody());
    this._particleUpdateAccumulator += deltaTime;
    if (
      this._particleUpdateInterval <= 0 ||
      this._particleUpdateAccumulator >= this._particleUpdateInterval
    ) {
      const particleDt = this._particleUpdateAccumulator;
      this._particleUpdateAccumulator = 0;
      let effectScaleOverride = 1;
      if (this.driver && effectsFocusPosition) {
        // Distance-based AI VFX fade: full nearby, fade out toward far range.
        const dx = this.mesh.position.x - effectsFocusPosition.x;
        const dz = this.mesh.position.z - effectsFocusPosition.z;
        const distSq = dx * dx + dz * dz;
        const near = 45;
        const far = 110;
        if (distSq >= far * far) {
          effectScaleOverride = 0;
        } else if (distSq > near * near) {
          const dist = Math.sqrt(distSq);
          effectScaleOverride = 1 - (dist - near) / (far - near);
        }
      }

      profile('truck.particles', () => this.particles.update(
        this.state,
        hSpeed,
        terrainManager,
        groundedness,
        particleDt,
        terrain,
        track,
        effectScaleOverride
      ));
      this._particleUpdateAccumulator = 0;
    }

    if (!collectDebugInfo) return null;

    // Return debug info
    const debug = profile('truck.debugPayload', () => {
      const payload = this._debugInfo;
      payload.compression = this.state.suspensionCompression;
      payload.groundedness = groundedness;
      payload.penetration = penetration;
      payload.verticalVelocity = this.state.velocity.y;
      payload.speed = speed;
      payload.effectiveGrip = effectiveGrip;
      payload.slipAngle = this.state.slipAngle;
      payload.terrainGripMultiplier = terrainGripMultiplier;
      payload.x = this.mesh.position.x;
      payload.y = this.mesh.position.y;
      payload.z = this.mesh.position.z;
      return payload;
    });
    return debug;
  }

  syncPhysicsBody() {
    if (this.physics) {
      const node = this.physics.body.transformNode;
      node.position.copyFrom(this.mesh.position);

      // Keep physics transform in Euler mode to match `mesh.rotation` driven by heading.
      // Only copy heading for collision orientation; visual roll/pitch is purely cosmetic.
      node.rotationQuaternion = null;
      node.rotation.y = this.mesh.rotation.y;
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
