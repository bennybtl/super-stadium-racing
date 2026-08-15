import { useDebugStore } from "../vue/store.js";
import { TerrainQuery } from "../managers/TerrainQuery.js";
import { DEFAULT_HANDLING, resolveHandling } from "../truck/DriftTuning.js";
import { clamp } from "../math-utils.js";
import { AIBoostController, DEFAULT_BOOST_CONFIG } from "./controllers/AIBoostController.js";
import { AIStuckRecoveryController, DEFAULT_STUCK_CONFIG } from "./controllers/AIStuckRecoveryController.js";
import { AIPathPlanner } from "./controllers/AIPathPlanner.js";
import { AISteeringController, DEFAULT_STEERING_CONFIG } from "./controllers/AISteeringController.js";
import { AIThrottleController, DEFAULT_THROTTLE_CONFIG } from "./controllers/AIThrottleController.js";
import { AISpawnRecoveryController, DEFAULT_SPAWN_RECOVERY_CONFIG } from "./controllers/AISpawnRecoveryController.js";
import { AICheckpointGuidanceController } from "./controllers/AICheckpointGuidanceController.js";
import { AIDebugRenderer } from "./controllers/AIDebugRenderer.js";

/**
 * AIDriver - Autonomous driver that navigates through checkpoints
 * 
 * Skill level parameters:
 * - stats: Multipliers on the truck's base vehicle stats (see setTruck). Every
 *   AI starts from whatever vehicle (and upgrades) it was given; skill scales it.
 *   `stats.lateralBias` scales the drift knob instead of a state value — raise it
 *   to make a driver hang the tail out, lower it to keep the truck planted.
 * - lookAheadDistance: How far ahead the AI looks (higher = better planning)
 * - pace: How hard the driver pushes — scales path target speeds (not a vehicle stat)
 * - steeringPrecision: How accurately the AI steers (0-1, higher = better control)
 * - steering* params: Avoidance and turn smoothing behavior
 * - throttle* params: Speed-target lookahead and tolerance
 * - boost* params: Nitro decision tuning for personality (aggression, safety, and cadence)
 */
export class AIDriver {
  constructor(track, checkpointManager, wallManager, scene, skillConfig = {}) {
    this.track = track;
    this.checkpointManager = checkpointManager;
    this.wallManager = wallManager;
    this.scene = scene;
    this._terrainQuery = new TerrainQuery(scene);
    
    // Skill-based parameters (can be customized per AI)
    const {
      stats = {},              // Multipliers on the truck's base vehicle stats
      lookAheadDistance = 20,  // Good: 20, OK: 15, Bad: 12
      pace = 0.8,              // Good: 1.0, OK: 0.8, Bad: 0.7
      steeringPrecision = 1.0, // Good: 1.0, OK: 0.85, Bad: 0.7
      // Boost personality tuning (override per AI for different nitro behavior)
      boostMinSpeed = DEFAULT_BOOST_CONFIG.minSpeed,
      boostStraightMaxAngle = DEFAULT_BOOST_CONFIG.straightMaxAngle,
      boostSlipSettledFactor = DEFAULT_BOOST_CONFIG.slipSettledFactor,
      boostDriftExitSlipRate = DEFAULT_BOOST_CONFIG.driftExitSlipRate,
      boostMaxSlipAngle = DEFAULT_BOOST_CONFIG.maxBoostSlipAngle,
      boostClearAheadDist = DEFAULT_BOOST_CONFIG.clearAheadDist,
      boostClearLateralDist = DEFAULT_BOOST_CONFIG.clearLateralDist,
      boostDecisionCooldownMs = DEFAULT_BOOST_CONFIG.decisionCooldownMs,
      boostBaseChance = DEFAULT_BOOST_CONFIG.baseChance,
      boostBehindWeight = DEFAULT_BOOST_CONFIG.behindWeight,
      boostStockWeight = DEFAULT_BOOST_CONFIG.stockWeight,
      boostMaxChance = DEFAULT_BOOST_CONFIG.maxChance,
      boostStockRef = DEFAULT_BOOST_CONFIG.stockRef,

      // Stuck recovery tuning
      stuckThreshold = DEFAULT_STUCK_CONFIG.stuckThreshold,
      positionCheckInterval = DEFAULT_STUCK_CONFIG.positionCheckInterval,
      positionStuckThreshold = DEFAULT_STUCK_CONFIG.positionStuckThreshold,
      positionStuckMinDist = DEFAULT_STUCK_CONFIG.positionStuckMinDist,
      wallPressMaxSpeed = DEFAULT_STUCK_CONFIG.wallPressMaxSpeed,

      // Steering + throttle tuning
      avoidanceRadius = DEFAULT_STEERING_CONFIG.avoidanceRadius,
      avoidanceMaxPush = DEFAULT_STEERING_CONFIG.avoidanceMaxPush,
      avoidanceIgnoreBehind = DEFAULT_STEERING_CONFIG.avoidanceIgnoreBehind,
      collisionProbeStart = DEFAULT_STEERING_CONFIG.collisionProbeStart,
      collisionProbeEnd = DEFAULT_STEERING_CONFIG.collisionProbeEnd,
      collisionProbeStep = DEFAULT_STEERING_CONFIG.collisionProbeStep,
      collisionProbeLateral = DEFAULT_STEERING_CONFIG.collisionProbeLateral,
      collisionAvoidanceMaxPush = DEFAULT_STEERING_CONFIG.collisionAvoidanceMaxPush,
      steeringSmooth = DEFAULT_STEERING_CONFIG.steeringSmooth,
      steeringThreshold = DEFAULT_STEERING_CONFIG.steeringThreshold,
      speedTolerance = DEFAULT_THROTTLE_CONFIG.speedTolerance,
      telemetryLookWaypoints = DEFAULT_THROTTLE_CONFIG.telemetryLookWaypoints,
      pathLookWaypoints = DEFAULT_THROTTLE_CONFIG.pathLookWaypoints,

      // Spawn recovery tuning
      pathAdvance = DEFAULT_SPAWN_RECOVERY_CONFIG.pathAdvance,
    } = skillConfig;
    
    // Path-following state
    this.path = [];
    this.currentPathIndex = 0;
    this.currentCheckpointTarget = 0;
    this.lastCheckpointPassed = 0;

    // Telemetry-driven path — when set, this replaces the authored/checkpoint path.
    // Each entry is { x, z, speed } where speed is the target forward speed.
    this._usingTelemetry = false;
    
    // Lightweight occupancy grid used for wall/curb blocked checks.
    // Keep independent X/Z extents so blocked probes stay aligned on
    // rectangular tracks (for example 320x160).
    this.gridWidth = Math.max(1, track.width ?? 160);
    this.gridDepth = Math.max(1, track.depth ?? 160);
    this.gridResolution = 2; // 2 units per cell
    this.gridCellsX = Math.max(1, Math.floor(this.gridWidth / this.gridResolution));
    this.gridCellsZ = Math.max(1, Math.floor(this.gridDepth / this.gridResolution));
    // Cached wall/curb occupancy grid, built lazily on first isBlocked() query.
    this._blockedGrid = null;

    // Legacy aliases retained for older debug tooling that expects these fields.
    this.gridSize = Math.max(this.gridWidth, this.gridDepth);
    
    // Steering parameters (skill-based)
    this.lookAheadDistance = lookAheadDistance;
    this.pace = pace;

    // Vehicle-stat multipliers, applied to the truck's stats in setTruck().
    this.statMultipliers = stats;
    this._statsApplied = false;

    this.truckMesh = null; // Will be set after truck creation
    
    // Pause flag — when true, getInput returns all-false
    this.paused = false;

    // Input throttling — recalculate steering at a fixed real-time cadence
    // so AI behavior remains stable when frame rate changes.
    this._inputUpdateIntervalMs = 100;
    this._inputElapsedMs = 0;
    this._cachedInput = { forward: true, back: false, left: false, right: false };

    // Other truck instances used for vehicle-to-vehicle avoidance.
    // Set via setOtherTrucks() once all trucks have been created.
    this.otherTrucks = [];

    // Static body collision manager — set via setStaticBodyCollisionManager()
    // so respawnFacingTarget can flush prevPos after teleporting.
    this._staticBodyCollisionManager = null;

    // Race context for AI nitro decisions
    this.gameState = null;

    this._boostController = new AIBoostController(this, {
      minSpeed: boostMinSpeed,
      straightMaxAngle: boostStraightMaxAngle,
      slipSettledFactor: boostSlipSettledFactor,
      driftExitSlipRate: boostDriftExitSlipRate,
      maxBoostSlipAngle: boostMaxSlipAngle,
      clearAheadDist: boostClearAheadDist,
      clearLateralDist: boostClearLateralDist,
      decisionCooldownMs: boostDecisionCooldownMs,
      baseChance: boostBaseChance,
      behindWeight: boostBehindWeight,
      stockWeight: boostStockWeight,
      maxChance: boostMaxChance,
      stockRef: boostStockRef,
      debug: false,
    });

    this._stuckRecovery = new AIStuckRecoveryController(this, {
      stuckThreshold,
      positionCheckInterval,
      positionStuckThreshold,
      positionStuckMinDist,
      wallPressMaxSpeed,
    });

    this._pathPlanner = new AIPathPlanner(this);
    this._steeringController = new AISteeringController(this, {
      avoidanceRadius,
      avoidanceMaxPush,
      avoidanceIgnoreBehind,
      collisionProbeStart,
      collisionProbeEnd,
      collisionProbeStep,
      collisionProbeLateral,
      collisionAvoidanceMaxPush,
      steeringSmooth,
      steeringThreshold,
    });
    this._throttleController = new AIThrottleController(this, {
      speedTolerance,
      telemetryLookWaypoints,
      pathLookWaypoints,
    });
    this._spawnRecovery = new AISpawnRecoveryController(this, {
      pathAdvance,
    });
    this._checkpointGuidance = new AICheckpointGuidanceController(this);
    this._debugRenderer = new AIDebugRenderer(this);

    // Debug visualization — enabled state is driven by the global DebugManager store
    this._debugStore = useDebugStore();
    
    // Get all checkpoints for reference
    this.checkpoints = this.getCheckpointPositions();
    
    // Pre-calculate full path through all checkpoints once at race start
    this.calculateFullPath();
    
    if (this.debugEnabled && this.scene) {
      this.updateDebugVisualization();
    }
  }

  /** Mirrors the global debug panel toggle (\\ key). */
  get debugEnabled() { return this._debugStore?.visible ?? false; }

  /**
  * Pre-calculate the full path through every checkpoint once at race start.
   * The result is stored in this.path and never changes during the race.
   * this.checkpointPathIndices[i] records the path index where segment i begins,
   * allowing onCheckpointPassed to quickly advance currentPathIndex.
   */
  calculateFullPath(startPosition = { x: 0, z: 0 }) {
    this._pathPlanner.calculateFullPath(startPosition);
  }

  /**
   * Called when AI passes a checkpoint.
   * Path is precomputed — just advance the checkpoint target counter.
   */
  onCheckpointPassed(checkpointIndex, currentPosition) {
    this._pathPlanner.onCheckpointPassed(checkpointIndex, currentPosition);
  }

  /**
   * Set truck reference for respawning
   */
  setTruck(truck) {
    this.truck = truck;
    this.truckMesh = truck.mesh;
    this._applyStatMultipliers(truck);
  }

  /**
   * Scale the truck's base vehicle stats by this driver's skill multipliers.
   * A skill level is therefore a modifier on whatever vehicle (and upgrades)
   * the AI was handed, not a fixed stat block — a fast truck driven badly is
   * still fast. Runs once per driver; unknown or non-numeric keys are ignored.
   */
  _applyStatMultipliers(truck) {
    const state = truck?.state;
    if (!state || this._statsApplied) return;
    this._statsApplied = true;

    for (const [key, multiplier] of Object.entries(this.statMultipliers)) {
      if (typeof multiplier !== 'number') continue;
      if (key === 'lateralBias') {
        this._applyLateralBiasMultiplier(state, multiplier);
        continue;
      }
      if (typeof state[key] !== 'number') continue;
      state[key] *= multiplier;
    }
  }

  /**
   * Scale the vehicle's lateralBias drift knob (how slidey vs planted it is).
   * Unlike the other stats this is not a raw state value — it is a high-level
   * handling knob, so the drift-grip params it expands into have to be
   * re-resolved. Only the two params bias actually drives are written back, so
   * upgrade deltas on the others (driftThreshold) survive.
   *
   * >1 slides more, <1 plants harder, relative to whatever the vehicle authored.
   */
  _applyLateralBiasMultiplier(state, multiplier) {
    const handling = { ...DEFAULT_HANDLING, ...(state.handling ?? {}) };
    handling.lateralBias = clamp(handling.lateralBias * multiplier, -1, 1);
    state.handling = handling;

    const resolved = resolveHandling(handling);
    state.lateralRetention = resolved.lateralRetention;
    state.gripZoneCorrection = resolved.gripZoneCorrection;
  }

  /**
   * Provide the list of all OTHER truck instances so this driver can
   * steer around them.  Call this once after all trucks are created.
   * @param {Truck[]} trucks  — array of Truck objects (NOT including this driver's own truck)
   */
  setOtherTrucks(trucks) {
    this.otherTrucks = trucks;
  }

  /**
   * Provide the StaticBodyCollisionManager so respawns flush stale prevPos.
   */
  setStaticBodyCollisionManager(mgr) {
    this._staticBodyCollisionManager = mgr;
  }

  /**
   * Provide this driver's runtime GameState so AI can consume collected boosts.
   */
  setGameState(gameState) {
    this.gameState = gameState;
    this._boostController.setGameState(gameState);
  }

  /**
   * Provide race standings context (self + all trucks) for boost aggressiveness.
   */
  setRaceContext(selfTruckData, allTruckData) {
    this._boostController.setRaceContext(selfTruckData, allTruckData);
  }

  /**
   * Load a pre-built telemetry waypoint array produced by TelemetryPlayer.
  * Replaces the authored/checkpoint path with the player-recorded racing line.
   * Each waypoint must be { x, z, speed }.
   * @param {object[]|null} waypoints
   */
  loadTelemetry(waypoints) {
    this._pathPlanner.loadTelemetry(waypoints);
  }

  /**
   * Get checkpoint positions in order
   */
  getCheckpointPositions() {
    return this._pathPlanner.getCheckpointPositions();
  }

  /**
   * Check if cell is within bounds
   */
  isValidCell(x, z) {
    return x >= 0 && x < this.gridCellsX && z >= 0 && z < this.gridCellsZ;
  }

  /**
   * Check if a grid cell is blocked by a wall or curb segment.
   * Polycurbs mark track limits — the AI should route around them even
   * though trucks can physically drive over them.
   *
   * Walls/curbs are static during a race, so the per-segment test is run once
   * per cell into a cached occupancy grid (built lazily). Subsequent calls — many
   * per AI tick from steering/boost probes — are O(1) lookups.
   */
  isBlocked(gridX, gridZ) {
    if (!this.wallManager) return false;
    if (!this.isValidCell(gridX, gridZ)) return false;
    const grid = this._ensureBlockedGrid();
    return grid[gridZ * this.gridCellsX + gridX] === 1;
  }

  /** Build (once) the occupancy grid by rasterizing wall + curb segments. */
  _ensureBlockedGrid() {
    if (this._blockedGrid) return this._blockedGrid;

    const grid = new Uint8Array(this.gridCellsX * this.gridCellsZ);
    const safetyMargin = 2; // extra clearance around each segment
    const segments = [
      ...this.wallManager.getWallSegments(),
      ...this.wallManager.getCurbSegments(),
    ];

    for (let gz = 0; gz < this.gridCellsZ; gz++) {
      for (let gx = 0; gx < this.gridCellsX; gx++) {
        const worldPos = this.gridToWorld(gx, gz);
        for (const seg of segments) {
          // Transform worldPos into the segment's local space for an AABB test.
          const dx = worldPos.x - seg.x;
          const dz = worldPos.z - seg.z;
          const cos = Math.cos(-seg.heading);
          const sin = Math.sin(-seg.heading);
          const localX = cos * dx - sin * dz;
          const localZ = sin * dx + cos * dz;

          if (Math.abs(localX) < seg.halfLength + safetyMargin &&
              Math.abs(localZ) < seg.halfDepth  + safetyMargin) {
            grid[gz * this.gridCellsX + gx] = 1;
            break;
          }
        }
      }
    }

    this._blockedGrid = grid;
    return grid;
  }

  /**
   * Convert world coordinates to grid cell
   */
  worldToGrid(worldX, worldZ) {
    const halfWidth = this.gridWidth / 2;
    const halfDepth = this.gridDepth / 2;
    const gridX = Math.floor((worldX + halfWidth) / this.gridResolution);
    const gridZ = Math.floor((worldZ + halfDepth) / this.gridResolution);
    return { 
      x: Math.max(0, Math.min(this.gridCellsX - 1, gridX)),
      z: Math.max(0, Math.min(this.gridCellsZ - 1, gridZ))
    };
  }

  /**
   * Convert grid cell to world coordinates
   */
  gridToWorld(gridX, gridZ) {
    const halfWidth = this.gridWidth / 2;
    const halfDepth = this.gridDepth / 2;
    return {
      x: gridX * this.gridResolution - halfWidth + this.gridResolution / 2,
      z: gridZ * this.gridResolution - halfDepth + this.gridResolution / 2
    };
  }

  /**
   * Get steering input based on current position
   */
  getInput(position, heading, fwdSpeed = 0, dt = 0.01667) {
    // Periodically update debug visualization if enabled
    this._debugRenderer.onFrame();

    if (this.paused) {
      return { forward: false, back: false, left: false, right: false };
    }
    if (this.path.length === 0) {
      console.debug('[AIDriver] No path available');
      return { forward: false, back: false, left: false, right: false };
    }

    // Throttle: only recalculate every N milliseconds. Return cached input between updates.
    this._inputElapsedMs += dt * 1000;
    if (this._inputElapsedMs < this._inputUpdateIntervalMs) {
      return this._cachedInput;
    }
    const aiDt = this._inputElapsedMs / 1000;
    this._inputElapsedMs = 0;
    
    // Find target waypoint ahead
    const targetWaypoint = this.findLookAheadPoint(position);
    if (!targetWaypoint) {
      console.debug('[AIDriver] No target waypoint found');
      return { forward: true, back: false, left: false, right: false };
    }
    
    // When near the next gate, steer through it so the AI doesn't cut around
    // the posts and miss a sequential checkpoint. Falls back to the look-ahead
    // path target when not in a gate approach.
    const gateTarget = this._checkpointGuidance.getApproachTarget(position);
    const steerTarget = gateTarget ?? targetWaypoint;

    const { forward, rightVec, steer } = this._steeringController.compute({
      position,
      heading,
      targetWaypoint: steerTarget,
      dt: aiDt,
    });

    const { shouldMoveForward, shouldReverse } = this._throttleController.compute({
      fwdSpeed,
    });

    // Flip steer when reversing so the truck curves the natural way. `steer` is
    // the analog command the truck actually uses; left/right are kept (from its
    // sign) for consumers that still read booleans (e.g. stuck-recovery logs).
    const isActuallyReversing = fwdSpeed < -0.3;
    const steerCmd = isActuallyReversing ? -steer : steer;
    const input = {
      forward: shouldMoveForward,
      back: shouldReverse,
      left: steerCmd < 0,
      right: steerCmd > 0,
      steer: steerCmd,
    };

    this._boostController.update({ position, forward, rightVec, fwdSpeed, input });

    const currentPos = { x: position.x, z: position.z };
    this._stuckRecovery.update({
      dt: aiDt,
      input,
      fwdSpeed,
      currentPos,
      targetWaypoint,
    });

    // Backup: detect a driven-around gate and respawn through it after a delay.
    this._checkpointGuidance.update({ position, dt: aiDt });
    
    // Update debug visualization
    this._debugRenderer.updateTarget(targetWaypoint);

    this._cachedInput = input;
    return input;
  }

  /**
   * Find waypoint at look-ahead distance
   */
  findLookAheadPoint(position) {
    return this._pathPlanner.findLookAheadPoint(position);
  }

  /**
   * Reset path following (e.g., when passing a checkpoint)
   */
  reset() {
    this.currentPathIndex = 0;
    this._inputElapsedMs = 0;
    this._steeringController.reset();
    this._stuckRecovery.reset();
    this._boostController.reset();
    this._checkpointGuidance.reset();
  }

  // /**
  //  * Snap currentPathIndex to the closest waypoint to `pos`, then advance it
  //  * by a small look-ahead so the AI immediately drives away from the spawn
  //  * rather than toward the waypoint it's already sitting on top of.
  //  */
  // _snapPathIndexToPosition(pos) {
  //   this._spawnRecovery.snapPathIndexToPosition(pos);
  // }

  /**
   * Respawn truck facing target waypoint, moving it clear of any nearby walls first.
   */
  respawnFacingTarget(targetWaypoint) {
    this._spawnRecovery.respawnFacingTarget(targetWaypoint);
  }

  // /**
  //  * Find the nearest position clear of walls.
  //  * Prefers a recent path waypoint; falls back to a radial sweep.
  //  */
  // _findClearPosition(currentPos) {
  //   return this._spawnRecovery.findClearPosition(currentPos);
  // }

  /**
   * Update visual debug representation of path
   */
  updateDebugVisualization() {
    this._debugRenderer.updateVisualization();
  }
}

// Static factory methods for creating AI drivers with preset skill levels.
//
// `stats` entries are multipliers on the truck's own vehicle stats (after the
// vehicle definition and any upgrades are applied), so every skill level starts
// from the base vehicle and modifies it — `ok` is the vehicle as authored.
// `lateralBias` is the exception: it scales the vehicle's drift knob of the same
// name (>1 = slides more, <1 = more planted) rather than a raw state value.
// Everything outside `stats` tunes driver behaviour, not the machine.
export const AI_SKILL_PRESETS = {
  good: {
    stats: {
      maxSpeed: 1.0,
      acceleration: 1.0,
      grip: 1.0,
      turnSpeed: 1.0,
      lateralBias: 1,
    },
    lookAheadDistance: 22,
    pace: 1.2,
    steeringPrecision: 1.2,
    boostBaseChance: 0.18,
    boostBehindWeight: 0.42,
    boostStockWeight: 0.32,
    boostDecisionCooldownMs: 520,
    boostStraightMaxAngle: Math.PI / 10.5,
  },
  ok: {
    stats: {
      maxSpeed: 0.96,
      acceleration: 0.96,
      grip: 0.96,
      turnSpeed: 0.96,
      lateralBias: 0.8,
    },
    lookAheadDistance: 20,
    pace: 1.1,
    steeringPrecision: 1.1,
    boostBaseChance: 0.16,
    boostBehindWeight: 0.38,
    boostStockWeight: 0.28,
    boostDecisionCooldownMs: 700,
    boostStraightMaxAngle: Math.PI / 10.5,
  },
  bad: {
    stats: {
      maxSpeed: 0.92,
      acceleration: 0.92,
      grip: 0.92,
      turnSpeed: 0.92,
      lateralBias: 0.9,
    },
    lookAheadDistance: 18,
    pace: 1,
    steeringPrecision: 1.0,
    boostBaseChance: 0.14,
    boostBehindWeight: 0.35,
    boostStockWeight: 0.24,
    boostDecisionCooldownMs: 750,
    boostStraightMaxAngle: Math.PI / 11,
  },
};

AIDriver.createGoodDriver = function(track, checkpointManager, wallManager, scene) {
  return new AIDriver(track, checkpointManager, wallManager, scene, AI_SKILL_PRESETS.good);
};

AIDriver.createOkDriver = function(track, checkpointManager, wallManager, scene) {
  return new AIDriver(track, checkpointManager, wallManager, scene, AI_SKILL_PRESETS.ok);
};

AIDriver.createBadDriver = function(track, checkpointManager, wallManager, scene) {
  return new AIDriver(track, checkpointManager, wallManager, scene, AI_SKILL_PRESETS.bad);
};
