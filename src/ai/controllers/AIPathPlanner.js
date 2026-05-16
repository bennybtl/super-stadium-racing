const WAYPOINT_LOOK_BACK = 5;
const WAYPOINT_LOOK_AHEAD = 30;

/**
 * AIPathPlanner
 *
 * Owns authored/checkpoint path construction, telemetry path loading,
 * waypoint lookup/look-ahead targeting, and checkpoint path progression state.
 */
export class AIPathPlanner {
  constructor(driver, config = {}) {
    this.driver = driver;
    this.lookBack = config.lookBack ?? WAYPOINT_LOOK_BACK;
    this.lookAhead = config.lookAhead ?? WAYPOINT_LOOK_AHEAD;
  }

  getCheckpointPositions() {
    const checkpoints = [];

    for (const feature of this.driver.track.features) {
      if (feature.type === "checkpoint") {
        checkpoints.push({
          x: feature.centerX,
          z: feature.centerZ,
          index: feature.checkpointNumber || 0,
          heading: feature.heading,
        });
      }
    }

    checkpoints.sort((a, b) => a.index - b.index);
    return checkpoints;
  }

  calculateFullPath(startPosition = null) {
    const d = this.driver;
    if (d.checkpoints.length === 0) return;

    d.path = [];
    d.checkpointPathIndices = [];

    const aiPathFeature = d.track.features?.find(f => f.type === "aiPath");
    const authorNodes = aiPathFeature?.points?.length >= 2 ? aiPathFeature.points : null;

    const STEP = 3;
    const BASE_SPEED = 28 * d.maxSpeed;
    const MIN_SPEED = 14 * d.maxSpeed;
    const MAX_DECEL = 22;

    const buildAuthoredNodesWithBranches = () => {
      const mainNodes = authorNodes.map(p => ({ x: p.x, z: p.z }));
      const rawBranches = Array.isArray(aiPathFeature?.branches) ? aiPathFeature.branches : [];
      const validBranches = rawBranches.filter((b) => {
        if (!b || !Array.isArray(b.points) || b.points.length < 2) return false;
        if (!Number.isInteger(b.fromMainIndex) || !Number.isInteger(b.toMainIndex)) return false;
        if (b.fromMainIndex < 0 || b.fromMainIndex >= mainNodes.length) return false;
        if (b.toMainIndex <= b.fromMainIndex || b.toMainIndex >= mainNodes.length) return false;
        return true;
      });

      const byFrom = new Map();
      for (const branch of validBranches) {
        const list = byFrom.get(branch.fromMainIndex) ?? [];
        list.push(branch);
        byFrom.set(branch.fromMainIndex, list);
      }

      const pickWeightedBranch = (branchesAtJunction) => {
        const weighted = branchesAtJunction.map((b) => ({
          branch: b,
          weight: Number.isFinite(b.weight) ? Math.max(0, b.weight) : 1,
        }));
        // Keep "stay on main path" as a real option so branch weight is
        // a preference, not an unconditional branch trigger.
        const mainPathWeight = 1;
        const branchWeightTotal = weighted.reduce((sum, item) => sum + item.weight, 0);
        const totalWeight = mainPathWeight + branchWeightTotal;
        if (totalWeight <= 0) return null;

        let roll = Math.random() * totalWeight;
        roll -= mainPathWeight;
        if (roll <= 0) return null;

        for (const item of weighted) {
          roll -= item.weight;
          if (roll <= 0) return item.branch;
        }
        return null;
      };

      const nodesOut = [];
      const pushNode = (node) => {
        const last = nodesOut[nodesOut.length - 1];
        if (last && Math.abs(last.x - node.x) < 0.001 && Math.abs(last.z - node.z) < 0.001) return;
        nodesOut.push({ x: node.x, z: node.z });
      };

      let i = 0;
      while (i < mainNodes.length) {
        pushNode(mainNodes[i]);

        const candidates = byFrom.get(i) ?? [];
        const chosen = candidates.length > 0 ? pickWeightedBranch(candidates) : null;
        if (chosen) {
          for (const bp of chosen.points) pushNode(bp);
          i = chosen.toMainIndex;
        } else {
          i += 1;
        }
      }

      if (nodesOut.length > 0) pushNode(nodesOut[0]);
      return {
        nodes: nodesOut,
        branchCount: validBranches.length,
      };
    };

    const authoredPath = authorNodes ? buildAuthoredNodesWithBranches() : null;
    const nodes = authoredPath
      ? authoredPath.nodes
      : [...d.checkpoints.map(cp => ({ x: cp.x, z: cp.z })), { x: d.checkpoints[0].x, z: d.checkpoints[0].z }];

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

      d.checkpointPathIndices.push(d.path.length);

      const pts = interpolateSegment(a, b);
      const n = pts.length;
      for (let k = 0; k < n; k++) {
        const t = n > 1 ? k / (n - 1) : 0;
        pts[k].speed = speedA + (speedB - speedA) * t;
      }
      d.path.push(...pts);
    }
    d.path.push({ ...nodes[0], speed: cpSpeeds[0] });

    for (let i = d.path.length - 2; i >= 0; i--) {
      const curr = d.path[i];
      const next = d.path[i + 1];
      const dx = next.x - curr.x;
      const dz = next.z - curr.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const maxAllowed = Math.sqrt(next.speed * next.speed + 2 * MAX_DECEL * dist);
      if (curr.speed > maxAllowed) curr.speed = maxAllowed;
    }

    for (let i = 0; i < d.path.length - 1; i++) {
      const a = d.path[i];
      const b = d.path[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      a.segLen = Math.sqrt(dx * dx + dz * dz);
      a.heading = Math.atan2(dx, dz);
    }
    d.path[d.path.length - 1].segLen = 0;
    d.path[d.path.length - 1].heading = d.path[d.path.length - 2]?.heading ?? 0;

    d.currentCheckpointTarget = 0;
    d.currentPathIndex = 0;

    if (startPosition && typeof startPosition.x === 'number' && typeof startPosition.z === 'number') {
      let bestIndex = 0;
      let bestDistSq = Infinity;
      for (let i = 0; i < d.path.length; i++) {
        const dx = d.path[i].x - startPosition.x;
        const dz = d.path[i].z - startPosition.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestIndex = i;
        }
      }
      d.currentPathIndex = bestIndex;
    }

    const sourceLabel = authoredPath
      ? `author aiPath (${authorNodes.length} main nodes, ${authoredPath.branchCount} branches)`
      : `checkpoints (${d.checkpoints.length} nodes)`;
    console.debug(`[AIDriver] Path built from ${sourceLabel}: ${d.path.length} waypoints. startPos=${startPosition.x.toFixed(2)},${startPosition.z.toFixed(2)} idx=${d.currentPathIndex}`);

    if (d.debugEnabled && d.scene) {
      d.updateDebugVisualization();
    }
  }

  onCheckpointPassed(checkpointIndex, currentPosition) {
    void currentPosition;
    const d = this.driver;
    d.lastCheckpointPassed = checkpointIndex;
    d.currentCheckpointTarget = checkpointIndex % d.checkpoints.length;
  }

  loadTelemetry(waypoints) {
    const d = this.driver;
    if (!waypoints || waypoints.length === 0) {
      d._usingTelemetry = false;
      console.debug("[AIDriver] No telemetry; using authored/checkpoint path.");
      return;
    }

    d.path = waypoints;
    for (let i = 0; i < d.path.length - 1; i++) {
      const a = d.path[i], b = d.path[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      a.segLen = Math.sqrt(dx * dx + dz * dz);
      a.heading = Math.atan2(dx, dz);
    }
    d.path[d.path.length - 1].segLen = 0;
    d.path[d.path.length - 1].heading = d.path[d.path.length - 2]?.heading ?? 0;
    d.currentPathIndex = 0;
    d._usingTelemetry = true;
    console.debug(`[AIDriver] Telemetry path loaded: ${waypoints.length} waypoints.`);
    if (d.debugEnabled && d.scene) {
      d.updateDebugVisualization();
    }
  }

  findLookAheadPoint(position) {
    const d = this.driver;
    if (d.path.length === 0) return null;

    const n = d.path.length;
    let closestIndex = d.currentPathIndex;
    let closestDist = Infinity;

    const start = Math.max(0, d.currentPathIndex - this.lookBack);
    const end = Math.min(n - 1, d.currentPathIndex + this.lookAhead);

    for (let i = start; i <= end; i++) {
      const waypoint = d.path[i];
      const dx = position.x - waypoint.x;
      const dz = position.z - waypoint.z;
      const dist = dx * dx + dz * dz;
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = i;
      }
    }

    d.currentPathIndex = closestIndex;

    let adaptiveLookAhead = d.lookAheadDistance;
    if (closestIndex + 3 < d.path.length) {
      const angle1 = d.path[closestIndex].heading ?? 0;
      const angle2 = d.path[closestIndex + 3].heading ?? 0;
      let angleDiff = Math.abs(angle2 - angle1);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

      const sharpTurnAngle = Math.PI / 4;
      if (angleDiff > sharpTurnAngle) {
        const curveFactor = Math.min(angleDiff / Math.PI, 1.0);
        adaptiveLookAhead = d.lookAheadDistance * (1.0 - curveFactor * 0.6);
      }
    }

    let accumulatedDist = 0;
    for (let i = closestIndex; i < d.path.length - 1; i++) {
      const p1 = d.path[i];
      const p2 = d.path[i + 1];
      const segmentDist = p1.segLen ?? Math.sqrt((p2.x - p1.x) ** 2 + (p2.z - p1.z) ** 2);

      if (accumulatedDist + segmentDist >= adaptiveLookAhead) {
        const t = (adaptiveLookAhead - accumulatedDist) / segmentDist;
        return {
          x: p1.x + (p2.x - p1.x) * t,
          z: p1.z + (p2.z - p1.z) * t,
        };
      }

      accumulatedDist += segmentDist;
    }

    if (d.currentPathIndex >= d.path.length - 10) {
      d.currentPathIndex = 0;
      return d.path[0];
    }

    return d.path[d.path.length - 1];
  }

  /**
   * Scan path ahead and return max heading delta (radians) over a distance window.
   */
  scanPathCurvature(fromIndex, maxDistance) {
    const d = this.driver;
    let accumulated = 0;
    let maxAngle = 0;
    for (let i = fromIndex; i < d.path.length - 2; i++) {
      const p0 = d.path[i];
      const p1 = d.path[i + 1];
      const p2 = d.path[i + 2];
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
}
