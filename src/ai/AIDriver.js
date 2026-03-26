import { Vector3, MeshBuilder, StandardMaterial, Color3 } from "@babylonjs/core";

/**
 * AIDriver - Autonomous driver that navigates through checkpoints
 * Uses A* pathfinding to calculate optimal route avoiding obstacles
 */
export class AIDriver {
  constructor(track, checkpointManager, wallManager, scene) {
    this.track = track;
    this.checkpointManager = checkpointManager;
    this.wallManager = wallManager;
    this.scene = scene;
    
    // Pathfinding state
    this.path = [];
    this.currentPathIndex = 0;
    this.currentCheckpointTarget = 0;
    this.lastCheckpointPassed = 0;
    
    // Grid for pathfinding (simplified world representation)
    this.gridSize = 160; // Match terrain size
    this.gridResolution = 2; // 2 units per cell
    this.gridCells = Math.floor(this.gridSize / this.gridResolution);
    
    // Steering parameters
    this.lookAheadDistance = 15;
    this.steeringStrength = 1.0;
    this.maxSpeed = 0.8; // 80% of max speed for safety
    
    // Stuck detection
    this.stuckTimer = 0;
    this.stuckThreshold = 3000; // 3 seconds in milliseconds
    this.lastPosition = null;
    this.truckMesh = null; // Will be set after truck creation
    
    // Debug visualization
    this.debugLines = [];
    this.debugEnabled = true;
    
    // Get all checkpoints for reference
    this.checkpoints = this.getCheckpointPositions();
    
    // Calculate path to first checkpoint
    this.calculatePathToNextCheckpoint();
    
    if (this.debugEnabled && this.scene) {
      this.updateDebugVisualization();
    }
  }

  /**
   * Calculate path to next checkpoint from current position
   */
  calculatePathToNextCheckpoint(currentPosition = { x: 0, z: 0 }) {
    if (this.checkpoints.length === 0) {
      console.warn('[AIDriver] No checkpoints found!');
      return;
    }
    
    // Determine next checkpoint index
    const nextCheckpointIndex = this.lastCheckpointPassed % this.checkpoints.length;
    const targetCheckpoint = this.checkpoints[nextCheckpointIndex];
    
    // Calculate approach point - a point before the checkpoint in the correct direction
    // The checkpoint heading indicates which direction you should be traveling when passing through
    const approachDistance = 10; // Distance before checkpoint to aim for
    const approachPoint = {
      x: targetCheckpoint.x - Math.sin(targetCheckpoint.heading) * approachDistance,
      z: targetCheckpoint.z - Math.cos(targetCheckpoint.heading) * approachDistance
    };
    
    // Calculate path from current position to approach point
    this.path = this.findPath(currentPosition, approachPoint);
    
    // Add the checkpoint itself as the final waypoint to ensure we pass through it
    this.path.push({ x: targetCheckpoint.x, z: targetCheckpoint.z });
    
    this.currentPathIndex = 0;
    this.currentCheckpointTarget = nextCheckpointIndex;
    
    console.log(`[AIDriver] Calculated path to checkpoint #${targetCheckpoint.index} (heading: ${(targetCheckpoint.heading * 180 / Math.PI).toFixed(1)}°) with ${this.path.length} waypoints`);
    
    // Update debug visualization if enabled
    if (this.debugEnabled && this.scene) {
      this.updateDebugVisualization();
    }
  }

  /**
   * Called when AI passes a checkpoint - recalculate path to next
   */
  onCheckpointPassed(checkpointIndex, currentPosition) {
    this.lastCheckpointPassed = checkpointIndex;
    console.log(`[AIDriver] Passed checkpoint ${checkpointIndex}, recalculating path...`);
    this.calculatePathToNextCheckpoint(currentPosition);
  }

  /**
   * Set truck reference for respawning
   */
  setTruck(truck) {
    this.truck = truck;
    this.truckMesh = truck.mesh;
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
    
    console.log(`[AIDriver] Found ${checkpoints.length} checkpoints:`, checkpoints.map(cp => `#${cp.index} at (${cp.x.toFixed(1)}, ${cp.z.toFixed(1)})`));
    
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
   * Check if a grid cell is blocked by a wall segment
   */
  isBlocked(gridX, gridZ) {
    if (!this.wallManager) return false;

    const worldPos = this.gridToWorld(gridX, gridZ);
    const safetyMargin = 2; // extra clearance around each wall segment

    for (const seg of this.wallManager.getWallSegments()) {
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
  getInput(position, heading) {
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
    const distToTarget = toTarget.length();
    toTarget.normalize();
    
    // Current heading vector
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
    
    // Calculate steering angle using cross product
    const cross = Vector3.Cross(forward, toTarget);
    const dot = Vector3.Dot(forward, toTarget);
    
    // Determine turn direction
    const turnStrength = cross.y;
    const alignment = dot;
    
    // Always steer towards target
    const steeringThreshold = 0.05;
    
    // Adjust throttle based on how sharp the turn is
    let shouldMoveForward = true;
    let shouldReverse = false;
    
    // Sharp turn threshold - higher turnStrength means sharper turn needed
    const sharpTurnThreshold = 0.6;
    const extremeTurnThreshold = 0.85;
    
    if (Math.abs(turnStrength) > extremeTurnThreshold) {
      // Very sharp turn needed - brake to slow down
      shouldMoveForward = false;
      shouldReverse = true;
      // console.debug(`[AIDriver] Extreme turn detected (${turnStrength.toFixed(2)}), braking`);
    } else if (Math.abs(turnStrength) > sharpTurnThreshold) {
      // Sharp turn needed - coast (no throttle) to slow down
      shouldMoveForward = false;
      shouldReverse = false;
      // console.debug(`[AIDriver] Sharp turn detected (${turnStrength.toFixed(2)}), coasting`);
    }
    
    const input = {
      forward: shouldMoveForward,
      back: shouldReverse,
      left: turnStrength < -steeringThreshold,
      right: turnStrength > steeringThreshold
    };
    
    // Stuck detection - only trigger if not trying to move forward or back
    const currentPos = { x: position.x, z: position.z };
    if (!input.forward && !input.back) {
      this.stuckTimer += 16.67; // Approximate deltaTime (60fps)
      
      // If stuck for too long, respawn facing target
      if (this.stuckTimer >= this.stuckThreshold && this.truckMesh) {
        // console.debug('[AIDriver] Stuck detected (not moving forward/back), respawning facing target...');
        this.respawnFacingTarget(targetWaypoint);
        this.stuckTimer = 0;
      }
    } else {
      // Moving, reset timer
      this.stuckTimer = 0;
    }
    this.lastPosition = currentPos;
    
    // Update debug visualization
    if (this.debugEnabled && this.debugTarget) {
      this.debugTarget.position.x = targetWaypoint.x;
      this.debugTarget.position.z = targetWaypoint.z;
      this.debugTarget.position.y = this.track.getHeightAt(targetWaypoint.x, targetWaypoint.z) + 2;
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
    
    // Find point at look-ahead distance
    let accumulatedDist = 0;
    for (let i = closestIndex; i < this.path.length - 1; i++) {
      const p1 = this.path[i];
      const p2 = this.path[i + 1];
      const segmentDist = Math.sqrt(
        Math.pow(p2.x - p1.x, 2) + 
        Math.pow(p2.z - p1.z, 2)
      );
      
      if (accumulatedDist + segmentDist >= this.lookAheadDistance) {
        // Interpolate along this segment
        const t = (this.lookAheadDistance - accumulatedDist) / segmentDist;
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
   * Respawn truck at current position but facing target waypoint
   */
  respawnFacingTarget(targetWaypoint) {
    if (!this.truck || !this.truckMesh || !targetWaypoint) return;
    
    const currentPos = this.truckMesh.position;
    const dx = targetWaypoint.x - currentPos.x;
    const dz = targetWaypoint.z - currentPos.z;
    
    // Calculate heading to target
    const targetHeading = Math.atan2(dx, dz);
    
    // Set rotation on mesh
    this.truckMesh.rotation.y = targetHeading;
    
    // Update truck state heading
    this.truck.state.heading = targetHeading;
    
    // Reset velocities
    this.truck.state.velocity.set(0, 0, 0);
    this.truck.state.verticalVelocity = 0;
    
    // Reset physics body velocity
    if (this.truck.physics && this.truck.physics.body) {
      this.truck.physics.body.setLinearVelocity(new Vector3(0, 0, 0));
      this.truck.physics.body.setAngularVelocity(new Vector3(0, 0, 0));
    }
    
    console.log(`[AIDriver] Respawned facing target at heading ${(targetHeading * 180 / Math.PI).toFixed(1)}°`);
  }

  /**
   * Update visual debug representation of path
   */
  updateDebugVisualization() {
    if (!this.scene) return;
    
    // Clean up old debug markers
    this.debugLines.forEach(mesh => mesh.dispose());
    this.debugLines = [];
    
    // Create spheres along the path
    for (let i = 0; i < this.path.length; i += 5) { // Every 5th waypoint to reduce clutter
      const wp = this.path[i];
      const sphere = MeshBuilder.CreateSphere(`pathDebug${i}`, { diameter: 0.5 }, this.scene);
      sphere.position.x = wp.x;
      sphere.position.y = this.track.getHeightAt(wp.x, wp.z) + 1;
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
    
    console.log(`[AIDriver] Updated debug visualization with ${this.debugLines.length} markers`);
  }
}
