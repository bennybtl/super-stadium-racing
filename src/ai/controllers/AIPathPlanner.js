export const DEFAULT_PATH_CONFIG = {
  lookBack: 5,
  lookAhead: 30,
  // Look-ahead floor (world units): how close the AI may aim in the tightest
  // corners. The aim point is shrunk toward the local path radius (see
  // findLookAheadPoint) so it tracks sweepers instead of ballooning wide; this
  // stops it getting so short that steering turns twitchy.
  minLookAhead: 8,
  waypointStep: 3,
  baseSpeedFactor: 28,
  // Floor is low enough that the grip limit below (not this clamp) sets the
  // speed for tight corners — hairpins need to drop well under the old 15.
  minSpeedFactor: 9,
  maxDecel: 22,
  curveWindowUnits: 9,
  // Lateral grip budget (world units/s² per unit of skill pace). Corner
  // target speed is v = pace * sqrt(grip * radius): the fastest the truck
  // can hold that radius before sliding wide. But holdable grip isn't constant —
  // a sharp corner taken off a straight (turn-in transient, weight transfer)
  // holds less than a fast sweeper. So the budget tapers from `lateralAccel` on
  // gentle bends down to `lateralAccelSharp` on hairpins, by turn angle: fast
  // sweepers keep their pace while sharp corners slow disproportionately more.
  lateralAccel: 19,       // gentle-bend grip (fast sweepers)
  lateralAccelSharp: 11,  // hairpin grip (holds Zipper's ~68-90° apexes)
};

/**
 * AIPathPlanner
 *
 * Owns authored/checkpoint path construction, telemetry path loading,
 * waypoint lookup/look-ahead targeting, and checkpoint path progression state.
 */
export class AIPathPlanner {
  constructor(driver, config = {}) {
    this.driver = driver;
    this.lookBack = config.lookBack ?? DEFAULT_PATH_CONFIG.lookBack;
    this.lookAhead = config.lookAhead ?? DEFAULT_PATH_CONFIG.lookAhead;
    this.minLookAhead = config.minLookAhead ?? DEFAULT_PATH_CONFIG.minLookAhead;
    this.waypointStep = config.waypointStep ?? DEFAULT_PATH_CONFIG.waypointStep;
    this.baseSpeedFactor = config.baseSpeedFactor ?? DEFAULT_PATH_CONFIG.baseSpeedFactor;
    this.minSpeedFactor = config.minSpeedFactor ?? DEFAULT_PATH_CONFIG.minSpeedFactor;
    this.maxDecel = config.maxDecel ?? DEFAULT_PATH_CONFIG.maxDecel;
    this.curveWindowUnits = config.curveWindowUnits ?? DEFAULT_PATH_CONFIG.curveWindowUnits;
    this.lateralAccel = config.lateralAccel ?? DEFAULT_PATH_CONFIG.lateralAccel;
    this.lateralAccelSharp = config.lateralAccelSharp ?? DEFAULT_PATH_CONFIG.lateralAccelSharp;
  }

  getCheckpointPositions() {
    const checkpoints = [];
    const runtimeCheckpointFeatures = this.driver.checkpointManager?.checkpointMeshes
      ?.map(checkpoint => checkpoint.feature)
      ?.filter(feature => feature?.checkpointNumber != null);

    const sourceFeatures = Array.isArray(runtimeCheckpointFeatures) && runtimeCheckpointFeatures.length > 0
      ? runtimeCheckpointFeatures
      : this.driver.track.features.filter(
          feature => feature.type === "checkpoint" && feature.checkpointNumber != null
        );

    for (const feature of sourceFeatures) {
      checkpoints.push({
        x: feature.centerX,
        z: feature.centerZ,
        index: feature.checkpointNumber,
        heading: feature.heading,
        width: feature.width ?? 10,
      });
    }

    checkpoints.sort((a, b) => a.index - b.index);

    // Collapse alternative gates to one representative per step so the rest of
    // the AI (which indexes this list by step number) stays valid. Branch-aware
    // choices (e.g. respawn) query the CheckpointManager for the step's gates.
    const byStep = new Map();
    for (const cp of checkpoints) {
      if (!byStep.has(cp.index)) byStep.set(cp.index, cp);
    }
    return [...byStep.values()];
  }

  calculateFullPath(startPosition = null) {
    const d = this.driver;
    if (d.checkpoints.length === 0) return;

    d.path = [];
    d.checkpointPathIndices = [];

    const aiPathFeature = d.track.features?.find(f => f.type === "aiPath");
    const authorNodes = aiPathFeature?.points?.length >= 2 ? aiPathFeature.points : null;

    const STEP = this.waypointStep;
    const BASE_SPEED = this.baseSpeedFactor * d.pace;
    const MIN_SPEED = this.minSpeedFactor * d.pace;
    const MAX_DECEL = this.maxDecel;
    const CURVE_WINDOW_UNITS = this.curveWindowUnits;
    const LAT_GENTLE = this.lateralAccel;
    const LAT_SHARP = this.lateralAccelSharp;
    // Turn angle (rad) at which the grip budget reaches LAT_SHARP; sharper turns
    // stay there. ~90° — Zipper's tightest apexes measure just under this.
    const GRIP_TAPER_ANGLE = Math.PI / 2;

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
    const reverseAuthoredLoop = (loopNodes) => {
      if (!Array.isArray(loopNodes) || loopNodes.length < 3) return loopNodes;

      const first = loopNodes[0];
      const last = loopNodes[loopNodes.length - 1];
      const isClosed = Math.abs(first.x - last.x) < 0.001 && Math.abs(first.z - last.z) < 0.001;
      const openNodes = isClosed ? loopNodes.slice(0, -1) : [...loopNodes];
      const reversed = [...openNodes].reverse();
      if (reversed.length > 0) {
        reversed.push({ ...reversed[0] });
      }
      return reversed;
    };

    const reverseModeEnabled = Boolean(d.checkpointManager?._reverse);
    const authoredNodes = authoredPath?.nodes ?? null;
    const effectiveAuthoredNodes = reverseModeEnabled && authoredNodes
      ? reverseAuthoredLoop(authoredNodes)
      : authoredNodes;

    const nodes = effectiveAuthoredNodes
      ? effectiveAuthoredNodes
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

    // Build the path geometry first (uniform ~STEP spacing), recording where
    // each segment starts for checkpoint progression.
    for (let seg = 0; seg < nodes.length - 1; seg++) {
      d.checkpointPathIndices.push(d.path.length);
      d.path.push(...interpolateSegment(nodes[seg], nodes[seg + 1]));
    }
    d.path.push({ x: nodes[0].x, z: nodes[0].z });

    // Corner target speed from a lateral-grip limit: the fastest the truck can
    // hold this radius without sliding wide. We measure the path's turn angle
    // over a fixed-distance window (independent of how densely the corner was
    // authored) and convert it to a radius, then apply v = pace * sqrt(
    // grip * radius). The grip budget itself tapers from LAT_GENTLE (sweepers)
    // down to LAT_SHARP (hairpins) by the turn angle — but by the angle over
    // BOTH a local window and a wider "sweep" window, taking whichever reads
    // sharper. A long sweeping corner is locally gentle yet demands sustained
    // grip and drifts wide at sweeper speed, so the wide window pulls its target
    // down. The backward braking pass below turns these into early braking.
    const P = d.path.length;
    const win = Math.max(2, Math.round(CURVE_WINDOW_UNITS / STEP));
    // Wider window (~24u) catches sustained curvature; SWEEP_FULL_ANGLE is the
    // deflection across it that counts as fully sharp for the grip taper.
    const sweepWin = Math.max(win + 1, Math.round(24 / STEP));
    const SWEEP_FULL_ANGLE = (2 * Math.PI) / 4; // 120°
    for (let i = 0; i < P; i++) {
      const a = d.path[Math.max(0, i - win)];
      const curr = d.path[i];
      const b = d.path[Math.min(P - 1, i + win)];
      const ax = curr.x - a.x, az = curr.z - a.z;
      const bx = b.x - curr.x, bz = b.z - curr.z;
      const lenA = Math.sqrt(ax * ax + az * az);
      const lenB = Math.sqrt(bx * bx + bz * bz);
      let speed = BASE_SPEED;
      let radius = Infinity;
      if (lenA > 0.001 && lenB > 0.001) {
        const dot = (ax * bx + az * bz) / (lenA * lenB);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (angle > 1e-3) {
          // Circular-arc estimate: tangent turns by `angle` over the arc length
          // spanning the window, so radius = arcLength / angle.
          radius = (lenA + lenB) / angle;
          // Local sharpness (this apex) and sweep sharpness (sustained turn);
          // grip tapers high→low by whichever reads sharper.
          const localSharp = Math.min(angle / GRIP_TAPER_ANGLE, 1);
          const wa = d.path[Math.max(0, i - sweepWin)];
          const wb = d.path[Math.min(P - 1, i + sweepWin)];
          const wax = curr.x - wa.x, waz = curr.z - wa.z;
          const wbx = wb.x - curr.x, wbz = wb.z - curr.z;
          const wlenA = Math.sqrt(wax * wax + waz * waz);
          const wlenB = Math.sqrt(wbx * wbx + wbz * wbz);
          let sweepSharp = 0;
          if (wlenA > 0.001 && wlenB > 0.001) {
            const wdot = (wax * wbx + waz * wbz) / (wlenA * wlenB);
            const wAngle = Math.acos(Math.max(-1, Math.min(1, wdot)));
            sweepSharp = Math.min(wAngle / SWEEP_FULL_ANGLE, 1);
          }
          const sharpness = Math.max(localSharp, sweepSharp);
          const grip = LAT_GENTLE + (LAT_SHARP - LAT_GENTLE) * sharpness;
          speed = d.pace * Math.sqrt(grip * radius);
        }
      }
      curr.speed = Math.max(MIN_SPEED, Math.min(BASE_SPEED, speed));
      // Cached for the look-ahead: how tightly the path curls here (see findLookAheadPoint).
      curr.radius = radius;
    }

    // Backward pass: cap each point's speed so it can brake to the next one.
    for (let i = P - 2; i >= 0; i--) {
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

    // Map each checkpoint to its nearest point on the racing line. Look-ahead
    // targeting uses this to cap the aim point at the next required gate so the
    // truck can't steer straight across a tight loop and skip the checkpoint
    // inside it.
    d.checkpointNearestPathIndex = d.checkpoints.map(cp => {
      let bestIndex = 0;
      let bestDistSq = Infinity;
      for (let i = 0; i < d.path.length; i++) {
        const dx = d.path[i].x - cp.x;
        const dz = d.path[i].z - cp.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestIndex = i;
        }
      }
      return bestIndex;
    });

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

    // The next required checkpoint's spot on the racing line acts as a hard cap
    // while it lies ahead of us this lap: neither the closest-point search nor
    // the look-ahead target may advance past it. This keeps the truck pulled
    // toward the gate instead of cutting across a tight loop to a later part of
    // the path (which skipped the checkpoint inside the loop). The cap releases
    // as soon as the checkpoint is physically passed (currentCheckpointTarget
    // advances) or when it is behind us in path order (a lap-wrap gate).
    const gateIndex = d.checkpointNearestPathIndex?.[d.currentCheckpointTarget];
    const gateCap = Number.isInteger(gateIndex) && gateIndex >= d.currentPathIndex
      ? gateIndex
      : null;

    let closestIndex = d.currentPathIndex;
    let closestDist = Infinity;

    const start = Math.max(0, d.currentPathIndex - this.lookBack);
    let end = Math.min(n - 1, d.currentPathIndex + this.lookAhead);
    if (gateCap !== null) end = Math.min(end, gateCap);

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

    // Shrink the look-ahead toward the tightest path radius just ahead. A fixed
    // long look-ahead on a sustained sweeper aims across the arc, so the truck
    // under-turns and runs wide; matching it to the radius keeps the aim on the
    // line. Radius is cached on the path by calculateFullPath; telemetry paths
    // lack it, so we keep the full distance there.
    let adaptiveLookAhead = d.lookAheadDistance;
    const scan = Math.max(1, Math.round(d.lookAheadDistance / (this.waypointStep || 3)));
    let minRadius = Infinity;
    for (let i = closestIndex; i < Math.min(n, closestIndex + scan); i++) {
      const r = d.path[i].radius;
      if (typeof r === 'number' && r < minRadius) minRadius = r;
    }
    if (Number.isFinite(minRadius)) {
      adaptiveLookAhead = Math.max(this.minLookAhead, Math.min(d.lookAheadDistance, minRadius));
    }

    const endIndex = gateCap !== null ? gateCap : n - 1;
    const clampedToGate = gateCap !== null;

    let accumulatedDist = 0;
    for (let i = closestIndex; i < endIndex; i++) {
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

    // Reached the gate cap before covering the full look-ahead distance — aim
    // at the gate point so the truck heads into the loop, not past it.
    if (clampedToGate) return d.path[endIndex];

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
