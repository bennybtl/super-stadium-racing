import { useDebugStore } from "../vue/store.js";
import { TerrainQuery } from "../managers/TerrainQuery.js";
import { AIBoostController, DEFAULT_BOOST_CONFIG } from "./controllers/AIBoostController.js";
import { AIStuckRecoveryController, DEFAULT_STUCK_CONFIG } from "./controllers/AIStuckRecoveryController.js";
import { AIPathPlanner } from "./controllers/AIPathPlanner.js";
import { AISteeringController, DEFAULT_STEERING_CONFIG } from "./controllers/AISteeringController.js";
import { AIThrottleController, DEFAULT_THROTTLE_CONFIG } from "./controllers/AIThrottleController.js";
import { AISpawnRecoveryController, DEFAULT_SPAWN_RECOVERY_CONFIG } from "./controllers/AISpawnRecoveryController.js";
import { AIDebugRenderer } from "./controllers/AIDebugRenderer.js";

/**
 * AIDriver - Autonomous driver that navigates through checkpoints
 * 
 * Skill level parameters:
 * - lookAheadDistance: How far ahead the AI looks (higher = better planning)
 * - maxSpeed: Speed multiplier (0-1, higher = faster driving)
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
      lookAheadDistance = 20,  // Good: 20, OK: 15, Bad: 12
      maxSpeed = 0.8,          // Good: 1.0, OK: 0.8, Bad: 0.7
      steeringPrecision = 1.0, // Good: 1.0, OK: 0.85, Bad: 0.7
      // Boost personality tuning (override per AI for different nitro behavior)
      boostMinSpeed = DEFAULT_BOOST_CONFIG.minSpeed,
      boostStraightMaxAngle = DEFAULT_BOOST_CONFIG.straightMaxAngle,
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
    this.gridSize = 160; // Match terrain size
    this.gridResolution = 2; // 2 units per cell
    this.gridCells = Math.floor(this.gridSize / this.gridResolution);
    
    // Steering parameters (skill-based)
    this.lookAheadDistance = lookAheadDistance;
    this.steeringStrength = steeringPrecision;
    this.maxSpeed = maxSpeed;

    this.truckMesh = null; // Will be set after truck creation
    
    // Pause flag — when true, getInput returns all-false
    this.paused = false;

    // Input throttling — recalculate steering at ~10 hz instead of every frame.
    // The truck's physics carries the last input between updates imperceptibly.
    this._inputUpdateInterval = 6; // frames between recalculations (6 ≈ 10 hz @ 60 fps)
    this._inputFrameCounter   = 0;
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
    return x >= 0 && x < this.gridCells && z >= 0 && z < this.gridCells;
  }

  /**
   * Check if a grid cell is blocked by a wall or curb segment.
   * Polycurbs mark track limits — the AI should route around them even
   * though trucks can physically drive over them.
   */
  isBlocked(gridX, gridZ) {
    if (!this.wallManager) return false;

    const worldPos = this.gridToWorld(gridX, gridZ);
    const safetyMargin = 2; // extra clearance around each segment

    const segmentBlocks = (segments) => {
      for (const seg of segments) {
        // Transform worldPos into the segment's local space to do AABB test
        const dx = worldPos.x - seg.x;
        const dz = worldPos.z - seg.z;
        const cos = Math.cos(-seg.heading);
        const sin = Math.sin(-seg.heading);
        const localX = cos * dx - sin * dz;
        const localZ = sin * dx + cos * dz;

        if (Math.abs(localX) < seg.halfLength + safetyMargin &&
            Math.abs(localZ) < seg.halfDepth  + safetyMargin) {
          return true;
        }
      }
      return false;
    };

    return segmentBlocks(this.wallManager.getWallSegments()) ||
           segmentBlocks(this.wallManager.getCurbSegments());
  }

  /**
   * Convert world coordinates to grid cell
   */
  worldToGrid(worldX, worldZ) {
    const halfSize = this.gridSize / 2;
    const gridX = Math.floor((worldX + halfSize) / this.gridResolution);
    const gridZ = Math.floor((worldZ + halfSize) / this.gridResolution);
    return { 
      x: Math.max(0, Math.min(this.gridCells - 1, gridX)),
      z: Math.max(0, Math.min(this.gridCells - 1, gridZ))
    };
  }

  /**
   * Convert grid cell to world coordinates
   */
  gridToWorld(gridX, gridZ) {
    const halfSize = this.gridSize / 2;
    return {
      x: gridX * this.gridResolution - halfSize + this.gridResolution / 2,
      z: gridZ * this.gridResolution - halfSize + this.gridResolution / 2
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

    // Throttle: only recalculate every N frames. Return cached input between updates.
    this._inputFrameCounter++;
    if (this._inputFrameCounter < this._inputUpdateInterval) {
      return this._cachedInput;
    }
    this._inputFrameCounter = 0;
    
    // Find target waypoint ahead
    const targetWaypoint = this.findLookAheadPoint(position);
    if (!targetWaypoint) {
      console.debug('[AIDriver] No target waypoint found');
      return { forward: true, back: false, left: false, right: false };
    }
    
    const { forward, rightVec, turnStrength } = this._steeringController.compute({
      position,
      heading,
      targetWaypoint,
    });

    const { shouldMoveForward, shouldReverse } = this._throttleController.compute({
      fwdSpeed,
    });
    
    const isActuallyReversing = fwdSpeed < -0.3;
    const input = {
      forward: shouldMoveForward,
      back: shouldReverse,
      // When actually moving backward, steering physics is inverted — flip to compensate
      left: isActuallyReversing
        ? turnStrength > this._steeringController.steeringThreshold
        : turnStrength < -this._steeringController.steeringThreshold,
      right: isActuallyReversing
        ? turnStrength < -this._steeringController.steeringThreshold
        : turnStrength > this._steeringController.steeringThreshold
    };

    this._boostController.update({ position, forward, rightVec, fwdSpeed, input });

    const currentPos = { x: position.x, z: position.z };
    // Stuck recovery runs on the throttled AI update cadence.
    // Scale dt so timing thresholds remain in real seconds.
    const stuckDt = dt * this._inputUpdateInterval;
    this._stuckRecovery.update({
      dt: stuckDt,
      input,
      fwdSpeed,
      currentPos,
      targetWaypoint,
    });
    
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
    this._steeringController.reset();
    this._stuckRecovery.reset();
    this._boostController.reset();
  }

  /**
   * Snap currentPathIndex to the closest waypoint to `pos`, then advance it
   * by a small look-ahead so the AI immediately drives away from the spawn
   * rather than toward the waypoint it's already sitting on top of.
   */
  _snapPathIndexToPosition(pos) {
    this._spawnRecovery.snapPathIndexToPosition(pos);
  }

  /**
   * Respawn truck facing target waypoint, moving it clear of any nearby walls first.
   */
  respawnFacingTarget(targetWaypoint) {
    this._spawnRecovery.respawnFacingTarget(targetWaypoint);
  }

  /**
   * Find the nearest position clear of walls.
   * Prefers a recent path waypoint; falls back to a radial sweep.
   */
  _findClearPosition(currentPos) {
    return this._spawnRecovery.findClearPosition(currentPos);
  }

  /**
   * Update visual debug representation of path
   */
  updateDebugVisualization() {
    this._debugRenderer.updateVisualization();
  }
}

// Static factory methods for creating AI drivers with preset skill levels
export const AI_SKILL_PRESETS = {
  good: {
    lookAheadDistance: 22,
    maxSpeed: 1.15,
    steeringPrecision: 1.0,
    boostBaseChance: 0.18,
    boostBehindWeight: 0.42,
    boostStockWeight: 0.32,
    boostDecisionCooldownMs: 520,
    boostStraightMaxAngle: Math.PI / 10.5,
  },
  ok: {
    lookAheadDistance: 19,
    maxSpeed: 1.05,
    steeringPrecision: 0.95,
    boostBaseChance: 0.16,
    boostBehindWeight: 0.38,
    boostStockWeight: 0.28,
    boostDecisionCooldownMs: 700,
    boostStraightMaxAngle: Math.PI / 10.5,
  },
  bad: {
    lookAheadDistance: 18,
    maxSpeed: 1.0,
    steeringPrecision: 0.9,
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
