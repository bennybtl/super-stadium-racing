import { Vector3, MeshBuilder, StandardMaterial, Color3 } from "@babylonjs/core";
import { useDebugStore } from "../vue/store.js";
import { TerrainQuery } from "../managers/TerrainQuery.js";

// ─── Vehicle avoidance ────────────────────────────────────────────────────────

/** Radius (world units) within which another truck triggers avoidance steering. */
const AVOIDANCE_RADIUS = 10;

/** Maximum lateral distance (world units) the virtual target is nudged sideways. */
const AVOIDANCE_MAX_PUSH = 6;

/** Trucks further than this behind us are ignored (no need to avoid what we've passed). */
const AVOIDANCE_IGNORE_BEHIND = 3;

/**
 * AIDriver - Autonomous driver that navigates through checkpoints
 * Uses A* pathfinding to calculate optimal route avoiding obstacles
 * 
 * Skill level parameters:
 * - lookAheadDistance: How far ahead the AI looks (higher = better planning)
 * - maxSpeed: Speed multiplier (0-1, higher = faster driving)
 * - steeringPrecision: How accurately the AI steers (0-1, higher = better control)
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
      maxSpeed = 0.8,          // Good: 0.8, OK: 0.65, Bad: 0.5
      steeringPrecision = 1.0, // Good: 1.0, OK: 0.85, Bad: 0.7
    } = skillConfig;
    
    // Pathfinding state
    this.path = [];
    this.currentPathIndex = 0;
    this.currentCheckpointTarget = 0;
    this.lastCheckpointPassed = 0;
    
    // Time-sliced pathfinding state
    this._pathfindingInProgress = false;
    this._pathfindingContext = null;
    this._pathfindingMaxMsPerFrame = 1.0; // max milliseconds per frame for pathfinding
    
    // Grid for pathfinding (simplified world representation)
    this.gridSize = 160; // Match terrain size
    this.gridResolution = 2; // 2 units per cell
    this.gridCells = Math.floor(this.gridSize / this.gridResolution);
    
    // Steering parameters (skill-based)
    this.lookAheadDistance = lookAheadDistance;
    this.steeringStrength = steeringPrecision;
    this.maxSpeed = maxSpeed;
    
    // Stuck detection
    this.stuckTimer = 0;
    this.stuckThreshold = 3000; // 3 seconds in milliseconds
    this.lastPosition = null;
    this.truckMesh = null; // Will be set after truck creation
    // Position-based stuck detection: sample every second, trigger if barely moved
    this.positionCheckTimer = 0;
    this.positionCheckInterval = 1000; // check every 1 second
    this.lastCheckedPosition = null;
    this.positionStuckTimer = 0;
    this.positionStuckThreshold = 3000; // 3 seconds without movement
    this.positionStuckMinDist = 1.0;   // must move at least 1 unit per second
    
    // Pause flag — when true, getInput returns all-false
    this.paused = false;

    // Other truck instances used for vehicle-to-vehicle avoidance.
    // Set via setOtherTrucks() once all trucks have been created.
    this.otherTrucks = [];

    // Debug visualization — enabled state is driven by the global DebugManager store
    this._debugStore = useDebugStore();
    this.debugLines = [];
    
    // Get all checkpoints for reference
    this.checkpoints = this.getCheckpointPositions();
    
    // Calculate path to first checkpoint
    this.calculatePathToNextCheckpoint();
    
    if (this.debugEnabled && this.scene) {
      this.updateDebugVisualization();
    }
  }

  /** Mirrors the global debug panel toggle (\\ key). */
  get debugEnabled() { return this._debugStore?.visible ?? false; }

  /**
   * Calculate path to next checkpoint from current position
   */
  calculatePathToNextCheckpoint(currentPosition = { x: 0, z: 0 }) {
    if (this.checkpoints.length === 0) {
      return;
    }
    
    // Determine next checkpoint index
    const nextCheckpointIndex = this.lastCheckpointPassed % this.checkpoints.length;
    const targetCheckpoint = this.checkpoints[nextCheckpointIndex];
    
    // Approach point: a point before the checkpoint aligned with its heading
    const approachDistance = 10;
    const approachPoint = {
      x: targetCheckpoint.x - Math.sin(targetCheckpoint.heading) * approachDistance,
      z: targetCheckpoint.z - Math.cos(targetCheckpoint.heading) * approachDistance
    };
    
    // Use async pathfinding to avoid frame hiccups
    this.calculatePathAsync(currentPosition, approachPoint);
    
    this.currentCheckpointTarget = nextCheckpointIndex;
        
    if (this.debugEnabled && this.scene) {
      this.updateDebugVisualization();
    }
  }

  /**
   * Called when AI passes a checkpoint - recalculate path to next
   */
  onCheckpointPassed(checkpointIndex, currentPosition) {
    // Grab the gate we just passed before updating lastCheckpointPassed
    const passedCheckpoint = this.checkpoints[this.currentCheckpointTarget];

    this.lastCheckpointPassed = checkpointIndex;

    // Use the exit point as the start of the next path so A* routes
    // forward from where the truck is actually heading, not backward to
    // the approach side of the next checkpoint.
    let pathStartPosition = currentPosition;
    let exitPoint = null;
    if (passedCheckpoint) {
      const exitDistance = 10;
      exitPoint = {
        x: passedCheckpoint.x + Math.sin(passedCheckpoint.heading) * exitDistance,
        z: passedCheckpoint.z + Math.cos(passedCheckpoint.heading) * exitDistance,
      };
      pathStartPosition = exitPoint;
    }

    // Start async pathfinding (non-blocking)
    this.calculatePathToNextCheckpoint(pathStartPosition);

    // Immediately inject exit blend waypoints while async pathfinding runs
    // in the background. When pathfinding completes, it will prepend the full path.
    if (exitPoint) {
      const exitWaypoints = [exitPoint];
      const numBlendPoints = 4;
      for (let i = numBlendPoints; i >= 1; i--) {
        const t = i / (numBlendPoints + 1);
        exitWaypoints.push({
          x: exitPoint.x * t + currentPosition.x * (1 - t),
          z: exitPoint.z * t + currentPosition.z * (1 - t),
        });
      }
      // Start with exit waypoints while pathfinding computes in background
      this.path = exitWaypoints;
      this.currentPathIndex = 0;
    }

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
   * Get checkpoint positions in order
   */
  getCheckpointPositions() {
    const checkpoints = [];
    
    for (const feature of this.track.features) {
      if (feature.type === "checkpoint") {
        checkpoints.push({
          x: feature.centerX,
          z: feature.centerZ,
          index: feature.checkpointNumber || 0,
          heading: feature.heading
        });
      }
    }
    
    // Sort by checkpoint number
    checkpoints.sort((a, b) => a.index - b.index);
        
    return checkpoints;
  }

  /**
   * A* pathfinding from start to goal
   */
  findPath(start, goal) {
    const startCell = this.worldToGrid(start.x, start.z);
    const goalCell = this.worldToGrid(goal.x, goal.z);
    
    // If start cell is blocked, fall back to grid centre
    if (this.isBlocked(startCell.x, startCell.z)) {
      startCell.x = this.gridCells / 2;
      startCell.z = this.gridCells / 2;
    }
    
    const openSet = [startCell];
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    const closedSet = new Set();
    
    const key = (x, z) => `${x},${z}`;
    
    gScore.set(key(startCell.x, startCell.z), 0);
    fScore.set(key(startCell.x, startCell.z), this.heuristic(startCell, goalCell));
    
    let iterations = 0;
    
    while (openSet.length > 0) {
      iterations++;
      // Find node with lowest fScore
      let current = openSet[0];
      let currentIndex = 0;
      for (let i = 1; i < openSet.length; i++) {
        const currentF = fScore.get(key(current.x, current.z));
        const nodeF = fScore.get(key(openSet[i].x, openSet[i].z));
        if (nodeF !== undefined && (currentF === undefined || nodeF < currentF)) {
          current = openSet[i];
          currentIndex = i;
        }
      }
      
      // Check if reached goal
      if (Math.abs(current.x - goalCell.x) <= 1 && Math.abs(current.z - goalCell.z) <= 1) {
        return this.reconstructPath(cameFrom, current, goal);
      }
      
      // Remove current from openSet and add to closed
      openSet.splice(currentIndex, 1);
      closedSet.add(key(current.x, current.z));
      
      // Check neighbors
      const neighbors = this.getNeighbors(current.x, current.z);
      for (const neighbor of neighbors) {
        const neighborKey = key(neighbor.x, neighbor.z);
        
        // Skip if already evaluated
        if (closedSet.has(neighborKey)) {
          continue;
        }
        
        const currentG = gScore.get(key(current.x, current.z));
        if (currentG === undefined) {
          continue;
        }
        
        const tentativeG = currentG + this.distance(current, neighbor);
        const existingG = gScore.get(neighborKey);
        
        if (existingG === undefined || tentativeG < existingG) {
          cameFrom.set(neighborKey, current);
          gScore.set(neighborKey, tentativeG);
          fScore.set(neighborKey, tentativeG + this.heuristic(neighbor, goalCell));
          
          if (!openSet.some(n => n.x === neighbor.x && n.z === neighbor.z)) {
            openSet.push(neighbor);
          }
        }
      }
      
      // Safety check: if openSet gets too large, bail out
      if (openSet.length > 1000) {
        console.warn('[AIDriver] Pathfinding exceeded limit, using direct path');
        return [start, goal];
      }
    }
    
    // No path found, return direct line
    console.warn('[AIDriver] No path found, using direct path');
    return [start, goal];
  }

  /**
   * Reconstruct path from A* came-from map
   */
  reconstructPath(cameFrom, current, goal) {
    const path = [goal];
    const key = (x, z) => `${x},${z}`;
    
    while (cameFrom.has(key(current.x, current.z))) {
      const worldPos = this.gridToWorld(current.x, current.z);
      path.unshift(worldPos);
      current = cameFrom.get(key(current.x, current.z));
    }
    
    return path;
  }

  /**
   * Time-sliced pathfinding that runs iteratively over multiple frames
   * to avoid framerate hiccups on checkpoint passes.
   * Starts computation and tracks progress via _pathfindingInProgress.
   */
  calculatePathAsync(start, goal) {
    if (this._pathfindingInProgress) {
      console.warn('[AIDriver] Pathfinding already in progress');
      return;
    }

    const startCell = this.worldToGrid(start.x, start.z);
    const goalCell = this.worldToGrid(goal.x, goal.z);

    if (this.isBlocked(startCell.x, startCell.z)) {
      startCell.x = this.gridCells / 2;
      startCell.z = this.gridCells / 2;
    }

    this._pathfindingContext = {
      start,
      goal,
      startCell,
      goalCell,
      openSet: [startCell],
      cameFrom: new Map(),
      gScore: new Map(),
      fScore: new Map(),
      closedSet: new Set(),
      key: (x, z) => `${x},${z}`,
      done: false,
      resultPath: null,
    };

    const key = this._pathfindingContext.key;
    this._pathfindingContext.gScore.set(key(startCell.x, startCell.z), 0);
    this._pathfindingContext.fScore.set(
      key(startCell.x, startCell.z),
      this.heuristic(startCell, goalCell)
    );

    this._pathfindingInProgress = true;
  }

  /**
   * Step through time-sliced pathfinding computation.
   * Call this every frame while pathfinding is active.
   */
  updatePathfinding() {
    if (!this._pathfindingInProgress || !this._pathfindingContext) {
      return;
    }

    const ctx = this._pathfindingContext;
    const startTime = performance.now();

    // Process up to _pathfindingMaxMsPerFrame milliseconds worth of iterations
    while (performance.now() - startTime < this._pathfindingMaxMsPerFrame) {
      if (ctx.openSet.length === 0) {
        // No path found
        ctx.resultPath = [ctx.start, ctx.goal];
        ctx.done = true;
        break;
      }

      // Find node with lowest fScore
      let current = ctx.openSet[0];
      let currentIndex = 0;
      for (let i = 1; i < ctx.openSet.length; i++) {
        const currentF = ctx.fScore.get(ctx.key(current.x, current.z));
        const nodeF = ctx.fScore.get(ctx.key(ctx.openSet[i].x, ctx.openSet[i].z));
        if (nodeF !== undefined && (currentF === undefined || nodeF < currentF)) {
          current = ctx.openSet[i];
          currentIndex = i;
        }
      }

      // Check if reached goal
      if (Math.abs(current.x - ctx.goalCell.x) <= 1 && Math.abs(current.z - ctx.goalCell.z) <= 1) {
        ctx.resultPath = this.reconstructPath(ctx.cameFrom, current, ctx.goal);
        ctx.done = true;
        break;
      }

      // Remove current from openSet and add to closed
      ctx.openSet.splice(currentIndex, 1);
      ctx.closedSet.add(ctx.key(current.x, current.z));

      // Check neighbors
      const neighbors = this.getNeighbors(current.x, current.z);
      for (const neighbor of neighbors) {
        const neighborKey = ctx.key(neighbor.x, neighbor.z);

        if (ctx.closedSet.has(neighborKey)) {
          continue;
        }

        const currentG = ctx.gScore.get(ctx.key(current.x, current.z));
        if (currentG === undefined) {
          continue;
        }

        const tentativeG = currentG + this.distance(current, neighbor);
        const existingG = ctx.gScore.get(neighborKey);

        if (existingG === undefined || tentativeG < existingG) {
          ctx.cameFrom.set(neighborKey, current);
          ctx.gScore.set(neighborKey, tentativeG);
          ctx.fScore.set(
            neighborKey,
            tentativeG + this.heuristic(neighbor, ctx.goalCell)
          );

          if (!ctx.openSet.some(n => n.x === neighbor.x && n.z === neighbor.z)) {
            ctx.openSet.push(neighbor);
          }
        }
      }

      // Safety check
      if (ctx.openSet.length > 1000) {
        ctx.resultPath = [ctx.start, ctx.goal];
        ctx.done = true;
        break;
      }
    }

    // If pathfinding completed, finalize and reset state
    if (ctx.done) {
      const newPath = ctx.resultPath || [ctx.start, ctx.goal];
      
      // If we have exit waypoints (path already has entries), append the new path
      if (this.path.length > 0) {
        // Append the computed path to existing exit waypoints
        this.path.push(...newPath);
      } else {
        this.path = newPath;
      }
      
      this.currentPathIndex = 0;
      this._pathfindingInProgress = false;
      this._pathfindingContext = null;
      // console.log(`[AIDriver] Pathfinding completed: ${this.path.length} total waypoints`);
      
      // Update debug visualization when pathfinding completes
      if (this.debugEnabled && this.scene) {
        this.updateDebugVisualization();
      }
    }
  }

  /**
   * Get valid neighboring cells
   */
  getNeighbors(x, z) {
    const neighbors = [];
    const directions = [
      { x: 0, z: 1 },   // Forward
      { x: 0, z: -1 },  // Back
      { x: 1, z: 0 },   // Right
      { x: -1, z: 0 },  // Left
      { x: 1, z: 1 },   // Diagonal
      { x: -1, z: 1 },
      { x: 1, z: -1 },
      { x: -1, z: -1 }
    ];
    
    for (const dir of directions) {
      const nx = x + dir.x;
      const nz = z + dir.z;
      
      if (this.isValidCell(nx, nz) && !this.isBlocked(nx, nz)) {
        neighbors.push({ x: nx, z: nz });
      }
    }
    
    return neighbors;
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
   * Heuristic for A* (Euclidean distance)
   */
  heuristic(a, b) {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.z - b.z, 2));
  }

  /**
   * Distance between adjacent cells
   */
  distance(a, b) {
    // Diagonal moves cost more
    const dx = Math.abs(a.x - b.x);
    const dz = Math.abs(a.z - b.z);
    return (dx + dz === 2) ? 1.414 : 1.0;
  }

  /**
   * Get steering input based on current position
   */
  getInput(position, heading, fwdSpeed = 0) {
    // Continue time-sliced pathfinding computation if active
    this.updatePathfinding();

    // Periodically update debug visualization if enabled
    if (this.debugEnabled && this.scene) {
      if (!this._debugUpdateTimer) this._debugUpdateTimer = 0;
      this._debugUpdateTimer++;
      if (this._debugUpdateTimer >= 10) { // Every 10 frames
        this.updateDebugVisualization();
        this._debugUpdateTimer = 0;
      }
    }

    if (this.paused) {
      return { forward: false, back: false, left: false, right: false };
    }
    if (this.path.length === 0) {
      console.log('[AIDriver] No path available');
      return { forward: false, back: false, left: false, right: false };
    }
    
    // Find target waypoint ahead
    const targetWaypoint = this.findLookAheadPoint(position);
    if (!targetWaypoint) {
      console.log('[AIDriver] No target waypoint found');
      return { forward: true, back: false, left: false, right: false };
    }
    
    // Calculate desired direction
    const toTarget = new Vector3(
      targetWaypoint.x - position.x,
      0,
      targetWaypoint.z - position.z
    );
    const targetDist = toTarget.length();
    toTarget.normalize();
    
    // Current heading vector
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
    // Right vector — XZ perpendicular to heading
    const rightVec = new Vector3(forward.z, 0, -forward.x);

    // ── Vehicle avoidance ──────────────────────────────────────────────────
    // For each nearby truck, nudge the virtual look-ahead target laterally
    // away from that truck. The existing steering logic then aims at the
    // adjusted target, naturally steering around the obstacle.
    let lateralOffset = 0;
    for (const other of this.otherTrucks) {
      if (!other.mesh) continue;
      const odx = other.mesh.position.x - position.x;
      const odz = other.mesh.position.z - position.z;
      const dist = Math.sqrt(odx * odx + odz * odz);
      if (dist < 0.5 || dist > AVOIDANCE_RADIUS) continue;
      // Ignore trucks that are clearly behind us
      const fwdDist = odx * forward.x + odz * forward.z;
      if (fwdDist < -AVOIDANCE_IGNORE_BEHIND) continue;
      // Lateral position of the other truck (+ = they are to our right)
      const latDist = odx * rightVec.x + odz * rightVec.z;
      // Quadratic fall-off: strongest when very close, zero at AVOIDANCE_RADIUS
      const weight = Math.pow(1 - dist / AVOIDANCE_RADIUS, 2);
      lateralOffset -= Math.sign(latDist) * weight * AVOIDANCE_MAX_PUSH;
    }
    lateralOffset = Math.max(-AVOIDANCE_MAX_PUSH, Math.min(AVOIDANCE_MAX_PUSH, lateralOffset));

    // Build a virtual target that incorporates the avoidance offset
    const virtualTarget = {
      x: targetWaypoint.x + rightVec.x * lateralOffset,
      z: targetWaypoint.z + rightVec.z * lateralOffset,
    };

    // Recompute toTarget toward the avoidance-adjusted virtual target
    const toVirtual = new Vector3(virtualTarget.x - position.x, 0, virtualTarget.z - position.z);
    toVirtual.normalize();
    
    // Calculate steering angle using cross product
    const cross = Vector3.Cross(forward, toVirtual);
    const dot = Vector3.Dot(forward, toVirtual);
    
    // Determine turn direction
    const turnStrength = cross.y;
    
    // Always steer towards target
    const steeringThreshold = 0.05;
    
    // Always move forward - never brake or coast, let physics handle the turns
    // This prevents getting stuck on tight turns where the AI would otherwise stop
    const shouldMoveForward = true;
    const shouldReverse = false;
    
    const isActuallyReversing = fwdSpeed < -0.3;
    const input = {
      forward: shouldMoveForward,
      back: shouldReverse,
      // When actually moving backward, steering physics is inverted — flip to compensate
      left: isActuallyReversing ? turnStrength > steeringThreshold : turnStrength < -steeringThreshold,
      right: isActuallyReversing ? turnStrength < -steeringThreshold : turnStrength > steeringThreshold
    };
    
    // Stuck detection — no-throttle case
    const currentPos = { x: position.x, z: position.z };
    if (!input.forward && !input.back) {
      this.stuckTimer += 16.67;
      if (this.stuckTimer >= this.stuckThreshold && this.truckMesh) {
        this.respawnFacingTarget(targetWaypoint);
        this.stuckTimer = 0;
        this.positionStuckTimer = 0;
        this.lastCheckedPosition = currentPos;
      }
    } else {
      this.stuckTimer = 0;
    }

    // Stuck detection — position hasn't changed in 3 seconds
    this.positionCheckTimer += 16.67;
    if (this.positionCheckTimer >= this.positionCheckInterval) {
      this.positionCheckTimer = 0;
      if (this.lastCheckedPosition) {
        const dx = currentPos.x - this.lastCheckedPosition.x;
        const dz = currentPos.z - this.lastCheckedPosition.z;
        const moved = Math.sqrt(dx * dx + dz * dz);
        if (moved < this.positionStuckMinDist) {
          this.positionStuckTimer += this.positionCheckInterval;
          if (this.positionStuckTimer >= this.positionStuckThreshold && this.truckMesh) {
            this.respawnFacingTarget(targetWaypoint);
            this.positionStuckTimer = 0;
            this.stuckTimer = 0;
          }
        } else {
          this.positionStuckTimer = 0;
        }
      }
      this.lastCheckedPosition = currentPos;
    }

    this.lastPosition = currentPos;
    
    // Update debug visualization
    if (this.debugEnabled && this.debugTarget) {
      this.debugTarget.position.x = targetWaypoint.x;
      this.debugTarget.position.z = targetWaypoint.z;
      this.debugTarget.position.y = this._terrainQuery.heightAt(targetWaypoint.x, targetWaypoint.z) + 2;
    }
    
    return input;
  }

  /**
   * Find waypoint at look-ahead distance
   */
  findLookAheadPoint(position) {
    if (this.path.length === 0) return null;
    
    // Find closest point on path
    let closestIndex = 0;
    let closestDist = Infinity;
    
    for (let i = this.currentPathIndex; i < this.path.length; i++) {
      const waypoint = this.path[i];
      const dist = Math.sqrt(
        Math.pow(position.x - waypoint.x, 2) + 
        Math.pow(position.z - waypoint.z, 2)
      );
      
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = i;
      }
    }
    
    this.currentPathIndex = closestIndex;
    
    // Adaptive look-ahead: use closer waypoints when the path ahead is curved
    // This prevents targeting waypoints that are too far to the side on tight turns
    let adaptiveLookAhead = this.lookAheadDistance;
    
    // Check path curvature by looking at the next few waypoints
    if (closestIndex + 3 < this.path.length) {
      const p0 = this.path[closestIndex];
      const p1 = this.path[closestIndex + 1];
      const p2 = this.path[closestIndex + 2];
      const p3 = this.path[closestIndex + 3];
      
      // Calculate turn angle over next 3 segments
      const dx1 = p1.x - p0.x;
      const dz1 = p1.z - p0.z;
      const dx2 = p3.x - p2.x;
      const dz2 = p3.z - p2.z;
      
      const angle1 = Math.atan2(dx1, dz1);
      const angle2 = Math.atan2(dx2, dz2);
      let angleDiff = Math.abs(angle2 - angle1);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      
      // If path curves sharply (> 45 degrees), reduce look-ahead proportionally
      const sharpTurnAngle = Math.PI / 4; // 45 degrees
      if (angleDiff > sharpTurnAngle) {
        const curveFactor = Math.min(angleDiff / Math.PI, 1.0); // 0 to 1
        adaptiveLookAhead = this.lookAheadDistance * (1.0 - curveFactor * 0.6); // Reduce up to 60%
        // console.debug(`[AIDriver] Sharp path ahead (${(angleDiff * 180 / Math.PI).toFixed(0)}°), look-ahead: ${adaptiveLookAhead.toFixed(1)}`);
      }
    }
    
    // Find point at adaptive look-ahead distance
    let accumulatedDist = 0;
    for (let i = closestIndex; i < this.path.length - 1; i++) {
      const p1 = this.path[i];
      const p2 = this.path[i + 1];
      const segmentDist = Math.sqrt(
        Math.pow(p2.x - p1.x, 2) + 
        Math.pow(p2.z - p1.z, 2)
      );
      
      if (accumulatedDist + segmentDist >= adaptiveLookAhead) {
        // Interpolate along this segment
        const t = (adaptiveLookAhead - accumulatedDist) / segmentDist;
        return {
          x: p1.x + (p2.x - p1.x) * t,
          z: p1.z + (p2.z - p1.z) * t
        };
      }
      
      accumulatedDist += segmentDist;
    }
    
    // If we're near the end of the path, wrap around to the beginning for continuous laps
    if (this.currentPathIndex >= this.path.length - 10) {
      this.currentPathIndex = 0;
    }
    
    // Return last waypoint if we're near the end
    return this.path[this.path.length - 1];
  }

  /**
   * Reset path following (e.g., when passing a checkpoint)
   */
  reset() {
    this.currentPathIndex = 0;
    this.stuckTimer = 0;
    this.lastPosition = null;
  }

  /**
   * Respawn truck facing target waypoint, moving it clear of any nearby walls first.
   */
  respawnFacingTarget(targetWaypoint) {
    if (!this.truck || !this.truckMesh || !targetWaypoint) return;
    
    const currentPos = this.truckMesh.position;

    // Find a clear spawn position by scanning outward from the current position.
    // First try the nearest unblocked path waypoint behind the truck, then
    // fall back to a radial sweep if none is found.
    const spawnPos = this._findClearPosition(currentPos, targetWaypoint);

    // Move the truck to the clear position
    this.truckMesh.position.x = spawnPos.x;
    this.truckMesh.position.z = spawnPos.z;
    this.truckMesh.position.y = this._terrainQuery.heightAt(spawnPos.x, spawnPos.z) + 0.6;

    const dx = targetWaypoint.x - spawnPos.x;
    const dz = targetWaypoint.z - spawnPos.z;
    const targetHeading = Math.atan2(dx, dz);
    
    this.truckMesh.rotation.y = targetHeading;
    this.truck.state.heading = targetHeading;
    
    // Reset velocities
    this.truck.state.velocity.set(0, 0, 0);
    this.truck.state.verticalVelocity = 0;
    
    if (this.truck.physics && this.truck.physics.body) {
      this.truck.physics.body.setLinearVelocity(new Vector3(0, 0, 0));
      this.truck.physics.body.setAngularVelocity(new Vector3(0, 0, 0));
    }
    
    // console.log(`[AIDriver] Respawned at (${spawnPos.x.toFixed(1)}, ${spawnPos.z.toFixed(1)}) facing ${(targetHeading * 180 / Math.PI).toFixed(1)}°`);
  }

  /**
   * Find the nearest position clear of walls.
   * Prefers a recent path waypoint; falls back to a radial sweep.
   */
  _findClearPosition(currentPos, targetWaypoint) {
    // 1. Walk back along the recorded path to find the nearest unblocked waypoint
    for (let i = Math.max(0, this.currentPathIndex - 1); i >= 0; i--) {
      const wp = this.path[i];
      const cell = this.worldToGrid(wp.x, wp.z);
      if (!this.isBlocked(cell.x, cell.z)) {
        // Also verify it's not too far away (don't teleport across the map)
        const dx = wp.x - currentPos.x;
        const dz = wp.z - currentPos.z;
        if (Math.sqrt(dx * dx + dz * dz) < 30) {
          return { x: wp.x, z: wp.z };
        }
      }
    }

    // 2. Radial sweep: try increasingly large distances in 16 directions
    const angles = 16;
    for (let radius = 2; radius <= 12; radius += 2) {
      for (let a = 0; a < angles; a++) {
        const angle = (a / angles) * Math.PI * 2;
        const candidateX = currentPos.x + Math.cos(angle) * radius;
        const candidateZ = currentPos.z + Math.sin(angle) * radius;
        const cell = this.worldToGrid(candidateX, candidateZ);
        if (this.isValidCell(cell.x, cell.z) && !this.isBlocked(cell.x, cell.z)) {
          return { x: candidateX, z: candidateZ };
        }
      }
    }

    // 3. Last resort: stay put
    return { x: currentPos.x, z: currentPos.z };
  }

  /**
   * Update visual debug representation of path
   */
  updateDebugVisualization() {
    if (!this.scene || !this.track || !this.debugEnabled) return;
    
    // Clean up old debug markers
    this.debugLines.forEach(mesh => mesh.dispose());
    this.debugLines = [];
    
    // Create spheres along the path
    for (let i = 0; i < this.path.length; i += 5) { // Every 5th waypoint to reduce clutter
      const wp = this.path[i];
      const sphere = MeshBuilder.CreateSphere(`pathDebug${i}`, { diameter: 0.5 }, this.scene);
      sphere.position.x = wp.x;
      sphere.position.y = this._terrainQuery.heightAt(wp.x, wp.z) + 1;
      sphere.position.z = wp.z;
      
      const mat = new StandardMaterial(`pathDebugMat${i}`, this.scene);
      mat.diffuseColor = new Color3(1, 1, 0);
      mat.emissiveColor = new Color3(0.5, 0.5, 0);
      sphere.material = mat;
      
      this.debugLines.push(sphere);
    }
    
    // Create target marker if it doesn't exist
    if (!this.debugTarget) {
      this.debugTarget = MeshBuilder.CreateSphere('aiTarget', { diameter: 1 }, this.scene);
      const targetMat = new StandardMaterial('aiTargetMat', this.scene);
      targetMat.diffuseColor = new Color3(0, 1, 0);
      targetMat.emissiveColor = new Color3(0, 0.5, 0);
      this.debugTarget.material = targetMat;
    }
  }
}

// Static factory methods for creating AI drivers with preset skill levels
AIDriver.createGoodDriver = function(track, checkpointManager, wallManager, scene) {
  return new AIDriver(track, checkpointManager, wallManager, scene, {
    lookAheadDistance: 20,
    maxSpeed: 0.8,
    steeringPrecision: 1.0
  });
};

AIDriver.createOkDriver = function(track, checkpointManager, wallManager, scene) {
  return new AIDriver(track, checkpointManager, wallManager, scene, {
    lookAheadDistance: 15,
    maxSpeed: 0.65,
    steeringPrecision: 0.85
  });
};

AIDriver.createBadDriver = function(track, checkpointManager, wallManager, scene) {
  return new AIDriver(track, checkpointManager, wallManager, scene, {
    lookAheadDistance: 12,
    maxSpeed: 0.5,
    steeringPrecision: 0.7
  });
};
