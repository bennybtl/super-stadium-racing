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

const SPEED_TOLERANCE = 0.5;

// Alpha ~0.18 per frame at 60 fps gives a ~3-frame rolling average feel
const STEERING_SMOOTH = 0.18;
// Always steer towards target
const STEERING_THRESHOLD = 0.05;

const PATH_ADVANCE = 5;
const WAYPOINT_LOOK_BACK  = 5;
const WAYPOINT_LOOK_AHEAD = 30;

/**
 * AIDriver - Autonomous driver that navigates through checkpoints
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

    // Telemetry-driven path — when set, this replaces the A* path.
    // Each entry is { x, z, speed } where speed is the target forward speed.
    this._usingTelemetry = false;
    
    // Grid for pathfinding (simplified world representation)
    this.gridSize = 160; // Match terrain size
    this.gridResolution = 2; // 2 units per cell
    this.gridCells = Math.floor(this.gridSize / this.gridResolution);
    
    // Steering parameters (skill-based)
    this.lookAheadDistance = lookAheadDistance;
    this.steeringStrength = steeringPrecision;
    this.maxSpeed = maxSpeed;
    
    // Smoothed steering (low-pass filter to remove rapid left/right jitter)
    this._smoothedTurn = 0;

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

    // Wall-press stuck detection: AI is applying throttle but barely moving (pinned against wall)
    this.wallPressTimer = 0;
    this.wallPressThreshold = 3000;  // 3 seconds
    this.wallPressMaxSpeed = 2.5;    // below this forward speed counts as "pressing a wall"
    
    // Pause flag — when true, getInput returns all-false
    this.paused = false;

    // Input throttling — recalculate steering at ~10 hz instead of every frame.
    // The truck's physics carries the last input between updates imperceptibly.
    this._inputUpdateInterval = 6; // frames between recalculations (6 ≈ 10 hz @ 60 fps)
    this._inputFrameCounter   = 0;
    this._cachedInput = { forward: true, back: false, left: false, right: false };

    // Pre-allocated scratch vectors — reused every frame to avoid GC pressure.
    this._fwd    = new Vector3(0, 0, 1);
    this._right  = new Vector3(1, 0, 0);
    this._toVirt = new Vector3(0, 0, 1);

    // Other truck instances used for vehicle-to-vehicle avoidance.
    // Set via setOtherTrucks() once all trucks have been created.
    this.otherTrucks = [];

    // Static body collision manager — set via setStaticBodyCollisionManager()
    // so respawnFacingTarget can flush prevPos after teleporting.
    this._staticBodyCollisionManager = null;

    // Debug visualization — enabled state is driven by the global DebugManager store
    this._debugStore = useDebugStore();
    this.debugLines = [];
    
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
   * Chains synchronous A* calls: start → cp[0] → cp[1] → … → cp[N-1] → (loop back).
   * The result is stored in this.path and never changes during the race.
   * this.checkpointPathIndices[i] records the path index where segment i begins,
   * allowing onCheckpointPassed to quickly advance currentPathIndex.
   */
  calculateFullPath(startPosition = { x: 0, z: 0 }) {
    if (this.checkpoints.length === 0) return;

    this.path = [];
    this.checkpointPathIndices = [];

    // ── Option B: author-placed AI path waypoints ─────────────────────────
    // If the track JSON contains an `aiPath` feature with ≥ 2 points, use
    // those as the node list instead of checkpoint centres.  This gives the
    // track author fine-grained control over the racing line on new tracks
    // before any telemetry has been recorded.
    const aiPathFeature = this.track.features?.find(f => f.type === 'aiPath');
    const authorNodes   = aiPathFeature?.points?.length >= 2 ? aiPathFeature.points : null;

    // Waypoint spacing: one point every N world units along each segment.
    const STEP = 3;

    // These are calibrated against the truck's actual physics:
    //   maxSpeed = 25 u/s, acceleration = 13 u/s², braking force = 2 u/s²,
    //   DRAG_COASTING = 0.45/frame ≈ 27/s effective decel at speed.
    // At 18 u/s coasting drag stops the truck in ~18/27 ≈ 0.67 s = ~12 u.
    // So BASE_SPEED of 18 gives reasonable stopping distance with coast-only braking.
    const BASE_SPEED = 28 * this.maxSpeed;
    // Tight hairpin speed — must be low enough that the truck can hold the turn.
    const MIN_SPEED  =  14 * this.maxSpeed;
    // Maximum deceleration assumed for backwards-propagation.
    // Higher value = tighter braking zone = AI brakes later and more aggressively.
    const MAX_DECEL  = 22; // u/s²  (aggressive combined drag+brake)

    // Build a closed list of node positions and wrap back to the first.
    const nodes = authorNodes
      ? [...authorNodes.map(p => ({ x: p.x, z: p.z })), { x: authorNodes[0].x, z: authorNodes[0].z }]
      : [...this.checkpoints.map(cp => ({ x: cp.x, z: cp.z })), { x: this.checkpoints[0].x, z: this.checkpoints[0].z }];

    const interpolateSegment = (a, b) => {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.001) return [];
      const steps = Math.max(1, Math.floor(len / STEP));
      const pts = [];
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        pts.push({ x: a.x + dx * t, z: a.z + dz * t });
      }
      return pts;
    };

    const turnAngleAt = (i) => {
      if (i <= 0 || i >= nodes.length - 1) return 0;
      const prev = nodes[i - 1];
      const curr = nodes[i];
      const next = nodes[i + 1];
      const ax = curr.x - prev.x, az = curr.z - prev.z;
      const bx = next.x - curr.x, bz = next.z - curr.z;
      const lenA = Math.sqrt(ax * ax + az * az);
      const lenB = Math.sqrt(bx * bx + bz * bz);
      if (lenA < 0.001 || lenB < 0.001) return 0;
      const dot = (ax * bx + az * bz) / (lenA * lenB);
      return Math.acos(Math.max(-1, Math.min(1, dot)));
    };

    const cpSpeeds = nodes.map((_, i) => {
      const angle = turnAngleAt(i);
      const t = Math.min(angle / Math.PI, 1);
      return BASE_SPEED * (1 - t) + MIN_SPEED * t;
    });

    for (let seg = 0; seg < nodes.length - 1; seg++) {
      const a = nodes[seg];
      const b = nodes[seg + 1];
      const speedA = cpSpeeds[seg];
      const speedB = cpSpeeds[seg + 1];

      this.checkpointPathIndices.push(this.path.length);

      const pts = interpolateSegment(a, b);
      const n = pts.length;
      for (let k = 0; k < n; k++) {
        const t = n > 1 ? k / (n - 1) : 0;
        pts[k].speed = speedA + (speedB - speedA) * t;
      }
      this.path.push(...pts);
    }
    this.path.push({ ...nodes[0], speed: cpSpeeds[0] });

    // ── Backwards speed-propagation pass ─────────────────────────────────
    // Walk the path in reverse.  If a waypoint's target speed is lower than
    // what the truck could physically reach from the previous waypoint given
    // MAX_DECEL, reduce the earlier waypoint's speed so the AI starts
    // slowing down in time rather than arriving at full speed.
    // v_prev_max² = v_next² + 2 * MAX_DECEL * dist
    for (let i = this.path.length - 2; i >= 0; i--) {
      const curr = this.path[i];
      const next = this.path[i + 1];
      const dx = next.x - curr.x;
      const dz = next.z - curr.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const maxAllowed = Math.sqrt(next.speed * next.speed + 2 * MAX_DECEL * dist);
      if (curr.speed > maxAllowed) curr.speed = maxAllowed;
    }

    // ── Precompute per-waypoint segment length and heading ──────────────
    // segLen: used by findLookAheadPoint's distance walk (avoids per-frame sqrt).
    // heading: used by the curvature check (avoids per-frame atan2).
    for (let i = 0; i < this.path.length - 1; i++) {
      const a = this.path[i];
      const b = this.path[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      a.segLen   = Math.sqrt(dx * dx + dz * dz);
      a.heading  = Math.atan2(dx, dz);
    }
    this.path[this.path.length - 1].segLen  = 0;
    this.path[this.path.length - 1].heading = this.path[this.path.length - 2]?.heading ?? 0;

    this.currentPathIndex = 0;
    this.currentCheckpointTarget = 0;

    const sourceLabel = authorNodes ? `author aiPath (${authorNodes.length} nodes)` : `checkpoints (${this.checkpoints.length} nodes)`;
    console.debug(`[AIDriver] Path built from ${sourceLabel}: ${this.path.length} waypoints.`);

    if (this.debugEnabled && this.scene) {
      this.updateDebugVisualization();
    }
  }

  /**
   * Called when AI passes a checkpoint.
   * Path is precomputed — just advance the checkpoint target counter.
   */
  onCheckpointPassed(checkpointIndex, currentPosition) {
    this.lastCheckpointPassed = checkpointIndex;
    this.currentCheckpointTarget = checkpointIndex % this.checkpoints.length;
    // currentPathIndex is advanced naturally by findLookAheadPoint every frame
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
   * Load a pre-built telemetry waypoint array produced by TelemetryPlayer.
   * Replaces the A*-generated path with the player-recorded racing line.
   * Each waypoint must be { x, z, speed }.
   * @param {object[]|null} waypoints
   */
  loadTelemetry(waypoints) {
    if (!waypoints || waypoints.length === 0) {
      this._usingTelemetry = false;
      console.debug('[AIDriver] No telemetry; using A* path.');
      return;
    }
    this.path = waypoints; // { x, z, speed }
    // Precompute segLen and heading so findLookAheadPoint avoids per-frame sqrt/atan2
    for (let i = 0; i < this.path.length - 1; i++) {
      const a = this.path[i], b = this.path[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      a.segLen  = Math.sqrt(dx * dx + dz * dz);
      a.heading = Math.atan2(dx, dz);
    }
    this.path[this.path.length - 1].segLen  = 0;
    this.path[this.path.length - 1].heading = this.path[this.path.length - 2]?.heading ?? 0;
    this.currentPathIndex = 0;
    this._usingTelemetry = true;
    console.debug(`[AIDriver] Telemetry path loaded: ${waypoints.length} waypoints.`);
    if (this.debugEnabled && this.scene) {
      this.updateDebugVisualization();
    }
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
  getInput(position, heading, fwdSpeed = 0, dt = 16.67) {
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
    
    // Current heading vector (scratch — no allocation)
    this._fwd.copyFromFloats(Math.sin(heading), 0, Math.cos(heading));
    const forward = this._fwd;
    // Right vector — XZ perpendicular to heading
    this._right.copyFromFloats(forward.z, 0, -forward.x);
    const rightVec = this._right;

    // ── Vehicle avoidance ──────────────────────────────────────────────────
    // For each nearby truck, nudge the virtual look-ahead target laterally
    // away from that truck. The existing steering logic then aims at the
    // adjusted target, naturally steering around the obstacle.
    let lateralOffset = 0;
    for (const other of this.otherTrucks) {
      if (!other.mesh) continue;
      const odx = other.mesh.position.x - position.x;
      const odz = other.mesh.position.z - position.z;
      const distSq = odx * odx + odz * odz;
      if (distSq < 0.25 || distSq > AVOIDANCE_RADIUS * AVOIDANCE_RADIUS) continue;
      const dist = Math.sqrt(distSq);
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

    // Recompute toTarget toward the avoidance-adjusted virtual target (scratch — no allocation)
    this._toVirt.copyFromFloats(virtualTarget.x - position.x, 0, virtualTarget.z - position.z);
    this._toVirt.normalize();
    const toVirtual = this._toVirt;
    
    // Calculate steering angle using cross product
    let { y: turnStrength } = Vector3.Cross(forward, toVirtual);
    
    // Spin recovery: if lateral speed greatly exceeds forward speed the truck is
    // spinning / sliding sideways. Reduce steering authority so the wheels can
    // regain grip instead of fighting it with full lock.
    if (this.truck) {
      const fwd  = Math.abs(this.truck.state.velocity.dot(forward));
      const lat  = Math.abs(this.truck.state.velocity.dot(rightVec));
      if (lat > fwd * 1.5 && lat > 5) {
        // Damp steering proportionally — the more sideways, the less we steer
        const spinFactor = Math.max(0.15, fwd / lat);
        turnStrength *= spinFactor;
      }
    }
    
    // Smooth the raw turn signal — lerp at ~8 Hz equivalent to remove frame-to-frame jitter
    this._smoothedTurn += (turnStrength - this._smoothedTurn) * STEERING_SMOOTH;
    turnStrength = this._smoothedTurn;
    
    // Throttle / brake decision.
    // When following a telemetry path, compare current speed to the target speed
    // recorded at the nearest upcoming waypoint — accelerate if below, brake if over.
    // Without telemetry, fall back to the curvature-scan heuristic.
    let shouldMoveForward = true;
    let shouldReverse = false;
    if (this._usingTelemetry) {
      // Look a few waypoints ahead for a speed target (gives a small braking preview)
      const lookWaypoints = 3;
      let targetSpeed = Infinity;
      for (let wi = this.currentPathIndex; wi < Math.min(this.currentPathIndex + lookWaypoints, this.path.length); wi++) {
        const wp = this.path[wi];
        if (wp.speed !== undefined && wp.speed < targetSpeed) targetSpeed = wp.speed;
      }
      if (targetSpeed !== Infinity) {
        // Scale the recorded speed target by the ratio of current grip to recorded grip.
        // e.g. if the lap was recorded on packed dirt (grip 2.0) but the AI is now on
        // mud (grip 0.15), the target speed is reduced proportionally so it brakes earlier.
        const recordedGrip = this.path[this.currentPathIndex]?.grip ?? 1;
        if (recordedGrip > 0 && this.truck?._lastTerrainGrip) {
          targetSpeed *= Math.min(1, this.truck._lastTerrainGrip / recordedGrip);
        }
        shouldMoveForward = fwdSpeed < targetSpeed + SPEED_TOLERANCE;
        shouldReverse = false;
      }
    } else {
      // Direct-checkpoint path: waypoints carry .speed targets, same as telemetry.
      // Look far enough ahead to give the truck time to brake.  With STEP=3 and
      // Shorter look-ahead = AI brakes later for a more aggressive, committed driving style.
      const lookWaypoints = 12;
      let targetSpeed = Infinity;
      for (let wi = this.currentPathIndex; wi < Math.min(this.currentPathIndex + lookWaypoints, this.path.length); wi++) {
        const wp = this.path[wi];
        if (wp.speed !== undefined && wp.speed < targetSpeed) targetSpeed = wp.speed;
      }
      if (targetSpeed !== Infinity) {
        shouldMoveForward = fwdSpeed < targetSpeed + SPEED_TOLERANCE;
        shouldReverse = false;
      }
    }
    
    const isActuallyReversing = fwdSpeed < -0.3;
    const input = {
      forward: shouldMoveForward,
      back: shouldReverse,
      // When actually moving backward, steering physics is inverted — flip to compensate
      left: isActuallyReversing ? turnStrength > STEERING_THRESHOLD : turnStrength < -STEERING_THRESHOLD,
      right: isActuallyReversing ? turnStrength < -STEERING_THRESHOLD : turnStrength > STEERING_THRESHOLD
    };
    
    // Stuck detection — no-throttle case
    const currentPos = { x: position.x, z: position.z };
    if (!input.forward && !input.back) {
      this.stuckTimer += dt;
      if (this.stuckTimer >= this.stuckThreshold && this.truckMesh) {
        this.respawnFacingTarget(targetWaypoint);
        this.stuckTimer = 0;
        this.positionStuckTimer = 0;
        this.wallPressTimer = 0;
        this.lastCheckedPosition = currentPos;
      }
    } else {
      this.stuckTimer = 0;
    }

    // Stuck detection — wall-press case: throttle is on but forward speed is very low
    // (truck is pinned against a wall or driving along it without making track progress)
    if (input.forward && fwdSpeed < this.wallPressMaxSpeed) {
      this.wallPressTimer += dt;
      if (this.wallPressTimer >= this.wallPressThreshold && this.truckMesh) {
        this.respawnFacingTarget(targetWaypoint);
        this.wallPressTimer = 0;
        this.positionStuckTimer = 0;
        this.stuckTimer = 0;
        this.lastCheckedPosition = currentPos;
      }
    } else {
      this.wallPressTimer = 0;
    }

    // Stuck detection — position hasn't changed in 3 seconds
    this.positionCheckTimer += dt;
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
            this.wallPressTimer = 0;
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

    this._cachedInput = input;
    return input;
  }

  /**
   * Find waypoint at look-ahead distance
   */
  findLookAheadPoint(position) {
    if (this.path.length === 0) return null;

    // Bounded window search: only scan a limited number of waypoints forward (and a
    // few backward to tolerate trucks being nudged slightly behind their last index).
    // An unbounded forward scan can snap to a geometrically close waypoint that is
    // actually much further around the track whenever the path curves back near the
    // truck's displaced position — causing the AI to suddenly aim at the wrong section.
    const n = this.path.length;

    let closestIndex = this.currentPathIndex;
    let closestDist = Infinity;

    const start = Math.max(0, this.currentPathIndex - WAYPOINT_LOOK_BACK);
    const end   = Math.min(n - 1, this.currentPathIndex + WAYPOINT_LOOK_AHEAD);

    for (let i = start; i <= end; i++) {
      const waypoint = this.path[i];
      const dx = position.x - waypoint.x;
      const dz = position.z - waypoint.z;
      const dist = dx * dx + dz * dz; // squared — no sqrt needed for comparison
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = i;
      }
    }

    this.currentPathIndex = closestIndex;
    
    // Adaptive look-ahead: use closer waypoints when the path ahead is curved
    // This prevents targeting waypoints that are too far to the side on tight turns
    let adaptiveLookAhead = this.lookAheadDistance;
    
    // Check path curvature using precomputed per-waypoint headings (no atan2 per frame)
    if (closestIndex + 3 < this.path.length) {
      const angle1 = this.path[closestIndex].heading     ?? 0;
      const angle2 = this.path[closestIndex + 3].heading ?? 0;
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
    
    // Find point at adaptive look-ahead distance (uses precomputed segLen — no sqrt)
    let accumulatedDist = 0;
    for (let i = closestIndex; i < this.path.length - 1; i++) {
      const p1 = this.path[i];
      const p2 = this.path[i + 1];
      const segmentDist = p1.segLen ?? Math.sqrt((p2.x-p1.x)**2 + (p2.z-p1.z)**2);

      if (accumulatedDist + segmentDist >= adaptiveLookAhead) {
        const t = (adaptiveLookAhead - accumulatedDist) / segmentDist;
        return {
          x: p1.x + (p2.x - p1.x) * t,
          z: p1.z + (p2.z - p1.z) * t
        };
      }

      accumulatedDist += segmentDist;
    }
    
    // If we're near the end of the path, wrap around to the beginning for continuous laps.
    // Do this before the distance walk so the walk can start from index 0 on the next frame.
    if (this.currentPathIndex >= this.path.length - 10) {
      this.currentPathIndex = 0;
      return this.path[0];
    }

    // Return last waypoint if the remaining path is shorter than the look-ahead distance
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
   * Snap currentPathIndex to the closest waypoint to `pos`, then advance it
   * by a small look-ahead so the AI immediately drives away from the spawn
   * rather than toward the waypoint it's already sitting on top of.
   */
  _snapPathIndexToPosition(pos) {
    if (!this.path || this.path.length === 0) return;

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.path.length; i++) {
      const wp = this.path[i];
      const dx = wp.x - pos.x;
      const dz = wp.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    // Advance a few waypoints so the first target is clearly ahead of the truck,
    // not right underneath it (which would produce a random steering direction).
    this.currentPathIndex = (bestIdx + PATH_ADVANCE) % this.path.length;
  }

  /**
   * Respawn truck facing target waypoint, moving it clear of any nearby walls first.
   */
  respawnFacingTarget(targetWaypoint) {
    if (!this.truck || !this.truckMesh || !targetWaypoint) return;

    // Prefer to respawn at the last passed checkpoint rather than the current
    // (possibly off-track) position so the AI re-enters the track cleanly.
    const lastCp = this.checkpoints[this.lastCheckpointPassed % this.checkpoints.length];
    const basePos = lastCp
      ? { x: lastCp.x, z: lastCp.z }
      : { x: this.truckMesh.position.x, z: this.truckMesh.position.z };

    const spawnPos = this._findClearPosition(
      new Vector3(basePos.x, this.truckMesh.position.y, basePos.z),
      targetWaypoint
    );

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
    this.truck.state.velocity.y = 0;
    
    if (this.truck.physics && this.truck.physics.body) {
      this.truck.physics.body.setLinearVelocity(new Vector3(0, 0, 0));
      this.truck.physics.body.setAngularVelocity(new Vector3(0, 0, 0));
    }

    this._staticBodyCollisionManager?.notifyTeleport(this.truck);

    // Re-snap the path index to the closest waypoint ahead of the new spawn position
    // so the AI doesn't chase a stale waypoint that routes it through a wall.
    this._snapPathIndexToPosition(spawnPos);

    // console.debug(`[AIDriver] Respawned at (${spawnPos.x.toFixed(1)}, ${spawnPos.z.toFixed(1)}) facing ${(targetHeading * 180 / Math.PI).toFixed(1)}°`);
  }

  /**
   * Scan the recorded path ahead from `fromIndex`, up to `maxDistance` world units.
   * Returns the maximum single-vertex heading change (radians) found along that window.
   * Used by corner-braking logic to decide whether to release throttle before a turn.
   */
  _scanPathCurvature(fromIndex, maxDistance) {
    let accumulated = 0;
    let maxAngle = 0;
    for (let i = fromIndex; i < this.path.length - 2; i++) {
      const p0 = this.path[i];
      const p1 = this.path[i + 1];
      const p2 = this.path[i + 2];
      const segLen = Math.sqrt((p1.x - p0.x) ** 2 + (p1.z - p0.z) ** 2);
      accumulated += segLen;
      if (accumulated > maxDistance) break;

      const angle1 = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      const angle2 = Math.atan2(p2.x - p1.x, p2.z - p1.z);
      let delta = Math.abs(angle2 - angle1);
      if (delta > Math.PI) delta = 2 * Math.PI - delta;
      if (delta > maxAngle) maxAngle = delta;
    }
    return maxAngle;
  }

  /**
   * Find the nearest position clear of walls.
   * Prefers a recent path waypoint; falls back to a radial sweep.
   */
  _findClearPosition(currentPos) {
    // 1. Walk back along the recorded path to find the nearest unblocked waypoint
    for (let i = Math.max(0, this.currentPathIndex - 1); i >= 0; i--) {
      const wp = this.path[i];
      const cell = this.worldToGrid(wp.x, wp.z);
      if (!this.isBlocked(cell.x, cell.z)) {
        // Also verify it's not too far away (don't teleport across the map)
        const dx = wp.x - currentPos.x;
        const dz = wp.z - currentPos.z;
        if (dx * dx + dz * dz < 900) { // 30² = 900
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
