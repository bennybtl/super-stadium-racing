import { Vector3 } from "@babylonjs/core";

export const DEFAULT_SPAWN_RECOVERY_CONFIG = {
  pathAdvance: 5,
  topologySearchRadius: 70,
  // How far before a missed gate (world units) to place a through-gate respawn.
  gateRespawnBackup: 20,
};

/**
 * AISpawnRecoveryController
 *
 * Owns respawn placement, wall-clear fallback search, and post-respawn
 * path-index snapping.
 */
export class AISpawnRecoveryController {
  constructor(driver, config = {}) {
    this.driver = driver;
    this.pathAdvance = config.pathAdvance ?? DEFAULT_SPAWN_RECOVERY_CONFIG.pathAdvance;
    this.topologySearchRadius = config.topologySearchRadius ?? DEFAULT_SPAWN_RECOVERY_CONFIG.topologySearchRadius;
  }

  snapPathIndexToPosition(pos) {
    if (!this.driver.path || this.driver.path.length === 0) return;

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.driver.path.length; i++) {
      const wp = this.driver.path[i];
      const dx = wp.x - pos.x;
      const dz = wp.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    this.driver.currentPathIndex = (bestIdx + this.pathAdvance) % this.driver.path.length;
  }

  /**
   * The gate the driver last passed, as {x, z}. When the last step has
   * alternatives, pick the gate nearest the driver so it respawns on the branch
   * it actually took rather than the other route.
   */
  _lastPassedGate() {
    const d = this.driver;
    const step = d.lastCheckpointPassed;
    if (!(step > 0)) return null;

    const gates = (d.checkpointManager?.checkpointMeshes ?? [])
      .map(cp => cp.feature)
      .filter(f => f?.checkpointNumber === step);
    if (gates.length === 0) return null;

    const px = d.truckMesh.position.x;
    const pz = d.truckMesh.position.z;
    const nearest = gates.reduce((best, g) => {
      const bd = (best.centerX - px) ** 2 + (best.centerZ - pz) ** 2;
      const gd = (g.centerX - px) ** 2 + (g.centerZ - pz) ** 2;
      return gd < bd ? g : best;
    });
    return { x: nearest.centerX, z: nearest.centerZ };
  }

  respawnFacingTarget(targetWaypoint) {
    const d = this.driver;
    if (!d.truck || !d.truckMesh || !targetWaypoint) return;

    const lastCp = this._lastPassedGate();
    const basePos = lastCp
      ? { x: lastCp.x, z: lastCp.z }
      : { x: d.truckMesh.position.x, z: d.truckMesh.position.z };

    const spawnPos = this.findClearPosition(
      new Vector3(basePos.x, d.truckMesh.position.y, basePos.z),
      targetWaypoint
    );

    d.truckMesh.position.x = spawnPos.x;
    d.truckMesh.position.z = spawnPos.z;
    d.truckMesh.position.y = d._terrainQuery.heightAt(spawnPos.x, spawnPos.z) + 0.6;

    const dx = targetWaypoint.x - spawnPos.x;
    const dz = targetWaypoint.z - spawnPos.z;
    const targetHeading = Math.atan2(dx, dz);

    d.truckMesh.rotation.y = targetHeading;
    d.truck.state.heading = targetHeading;

    d.truck.state.velocity.set(0, 0, 0);
    d.truck.state.velocity.y = 0;

    if (d.truck.physics && d.truck.physics.body) {
      d.truck.physics.body.setLinearVelocity(new Vector3(0, 0, 0));
      d.truck.physics.body.setAngularVelocity(new Vector3(0, 0, 0));
    }

    d._staticBodyCollisionManager?.notifyTeleport(d.truck);
    this.snapPathIndexToPosition(spawnPos);
  }

  /**
   * Teleport the truck to the approach side of `gate` facing through it, so a
   * driver that drove around the gate can re-attempt the pass cleanly.
   * @param {{x:number, z:number, heading:number}} gate
   */
  respawnThroughGate(gate) {
    const d = this.driver;
    if (!d.truck || !d.truckMesh || !gate) return;

    const fwdX = Math.sin(gate.heading);
    const fwdZ = Math.cos(gate.heading);

    // Clear approach point on the gate's entry side. We deliberately do NOT use
    // the generic findClearPosition here: it can snap to a topology connector or
    // a path waypoint on the *exit* side of the gate the truck just overshot,
    // which would respawn the driver in front of the gate instead of behind it.
    const spawnPos = this._findClearApproach(gate, fwdX, fwdZ);

    d.truckMesh.position.x = spawnPos.x;
    d.truckMesh.position.z = spawnPos.z;
    d.truckMesh.position.y = d._terrainQuery.heightAt(spawnPos.x, spawnPos.z) + 0.6;

    // Face straight through the gate (entry → exit direction).
    const targetHeading = Math.atan2(fwdX, fwdZ);
    d.truckMesh.rotation.y = targetHeading;
    d.truck.state.heading = targetHeading;

    d.truck.state.velocity.set(0, 0, 0);
    if (d.truck.physics && d.truck.physics.body) {
      d.truck.physics.body.setLinearVelocity(new Vector3(0, 0, 0));
      d.truck.physics.body.setAngularVelocity(new Vector3(0, 0, 0));
    }

    d._staticBodyCollisionManager?.notifyTeleport(d.truck);
    this.snapPathIndexToPosition(spawnPos);
  }

  /**
   * Find a clear respawn point strictly on the gate's entry side, backing
   * straight away from the gate along -forward until an unblocked cell is found.
   * Guarantees the result is behind the gate (along < 0), never in front of it.
   */
  _findClearApproach(gate, fwdX, fwdZ) {
    const d = this.driver;
    const base = DEFAULT_SPAWN_RECOVERY_CONFIG.gateRespawnBackup;
    const maxBackup = base * 3;

    for (let dist = base; dist <= maxBackup; dist += 4) {
      const x = gate.x - fwdX * dist;
      const z = gate.z - fwdZ * dist;
      const cell = d.worldToGrid(x, z);
      if (d.isValidCell(cell.x, cell.z) && !d.isBlocked(cell.x, cell.z)) {
        return { x, z };
      }
    }

    // Nothing clear found — fall back to the nominal backup point. Still on the
    // entry side, so the driver at least faces through the gate.
    return { x: gate.x - fwdX * base, z: gate.z - fwdZ * base };
  }

  findClearPosition(currentPos) {
    const d = this.driver;
    const topologyCandidate = this._findTopologyConnectorSpawn(currentPos);
    if (topologyCandidate) return topologyCandidate;

    for (let i = Math.max(0, d.currentPathIndex - 1); i >= 0; i--) {
      const wp = d.path[i];
      const cell = d.worldToGrid(wp.x, wp.z);
      if (!d.isBlocked(cell.x, cell.z)) {
        const dx = wp.x - currentPos.x;
        const dz = wp.z - currentPos.z;
        if (dx * dx + dz * dz < 900) {
          return { x: wp.x, z: wp.z };
        }
      }
    }

    const angles = 16;
    for (let radius = 2; radius <= 12; radius += 2) {
      for (let a = 0; a < angles; a++) {
        const angle = (a / angles) * Math.PI * 2;
        const candidateX = currentPos.x + Math.cos(angle) * radius;
        const candidateZ = currentPos.z + Math.sin(angle) * radius;
        const cell = d.worldToGrid(candidateX, candidateZ);
        if (d.isValidCell(cell.x, cell.z) && !d.isBlocked(cell.x, cell.z)) {
          return { x: candidateX, z: candidateZ };
        }
      }
    }

    return { x: currentPos.x, z: currentPos.z };
  }

  _findTopologyConnectorSpawn(currentPos) {
    const d = this.driver;
    const topologyGraph = d.scene?.metadata?.surfaceTopologyGraph ?? null;
    if (!topologyGraph?.getAllNodes) return null;

    const nodes = topologyGraph.getAllNodes();
    if (!Array.isArray(nodes) || nodes.length === 0) return null;

    const connectorNodes = nodes.filter(node =>
      node?.role === 'drive' &&
      (node?.connectorType || String(node?.kind ?? '').includes('transition'))
    );
    if (connectorNodes.length === 0) return null;

    const currentSurface = d.truck?.terrainPhysics?.floorSurface ?? null;
    const preferredLayer = Number.isFinite(currentSurface?.surfaceLevel)
      ? currentSurface.surfaceLevel
      : null;

    const byLayer = Number.isFinite(preferredLayer)
      ? connectorNodes.filter(node => node.layerId === preferredLayer)
      : [];
    const candidates = byLayer.length > 0 ? byLayer : connectorNodes;

    const radiusSq = this.topologySearchRadius * this.topologySearchRadius;
    const clearCandidates = [];

    for (const node of candidates) {
      const meshPos = node?.mesh?.position;
      if (!meshPos) continue;

      const dx = meshPos.x - currentPos.x;
      const dz = meshPos.z - currentPos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > radiusSq) continue;

      const cell = d.worldToGrid(meshPos.x, meshPos.z);
      if (!d.isValidCell(cell.x, cell.z) || d.isBlocked(cell.x, cell.z)) continue;

      clearCandidates.push({
        x: meshPos.x,
        z: meshPos.z,
        distSq,
      });
    }

    if (clearCandidates.length === 0) return null;
    clearCandidates.sort((a, b) => a.distSq - b.distSq);
    return { x: clearCandidates[0].x, z: clearCandidates[0].z };
  }
}
