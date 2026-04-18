import { Vector3 } from "@babylonjs/core";

export const DEFAULT_SPAWN_RECOVERY_CONFIG = {
  pathAdvance: 5,
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

  respawnFacingTarget(targetWaypoint) {
    const d = this.driver;
    if (!d.truck || !d.truckMesh || !targetWaypoint) return;

    const lastCp = d.checkpoints[d.lastCheckpointPassed % d.checkpoints.length];
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

  findClearPosition(currentPos) {
    const d = this.driver;

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
}
