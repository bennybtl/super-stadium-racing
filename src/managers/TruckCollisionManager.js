import { TRUCK_RADIUS } from "../constants.js";

// Two trucks collide when the distance between their centres is less than the
// sum of their bounding radii.  We treat each truck as a circle (horizontal
// plane only) with radius TRUCK_RADIUS.
const COLLISION_DIST = TRUCK_RADIUS * 2;
const COLLISION_DIST_SQ = COLLISION_DIST * COLLISION_DIST;
const RESTITUTION = 0.35; // 0 = perfectly inelastic, 1 = perfectly elastic
const FRICTION = 0.15;    // fraction of tangential speed bled off on impact

/**
 * TruckCollisionManager
 *
 * Handles truck-to-truck collision detection and response using the same
 * two-phase pattern as WallManager:
 *
 *   preUpdate(trucks, dt)  – call BEFORE updateTruck() to cancel velocity
 *                            components that would drive trucks into each other.
 *   update(trucks)         – call AFTER updateTruck() to push overlapping
 *                            trucks apart and apply an impulse.
 */
export class TruckCollisionManager {
  /**
   * Pre-frame velocity cancel: for every truck pair that is on a collision
   * course this frame, zero the component of each truck's velocity directed
   * toward the other.  This prevents grip/drift physics from re-injecting
   * into-other-truck motion during updateTruck().
   */
  preUpdate(trucks, dt) {
    for (let i = 0; i < trucks.length; i++) {
      for (let j = i + 1; j < trucks.length; j++) {
        const tA = trucks[i].truck;
        const tB = trucks[j].truck;
        if (!tA?.mesh || !tB?.mesh) continue;

        const posA = tA.mesh.position;
        const posB = tB.mesh.position;
        const velA = tA.state.velocity;
        const velB = tB.state.velocity;

        const dx = posA.x - posB.x;
        const dz = posA.z - posB.z;
        const distSq = dx * dx + dz * dz;
        if (distSq >= COLLISION_DIST_SQ) continue;

        // Predicted positions
        const nextAx = posA.x + velA.x * dt;
        const nextAz = posA.z + velA.z * dt;
        const nextBx = posB.x + velB.x * dt;
        const nextBz = posB.z + velB.z * dt;
        const ndx = nextAx - nextBx;
        const ndz = nextAz - nextBz;
        const nextDistSq = ndx * ndx + ndz * ndz;

        // Only intervene if they're getting closer
        if (nextDistSq >= distSq) continue;

        const dist = Math.sqrt(distSq) || 0.001;
        const nx = dx / dist; // normal from B toward A
        const nz = dz / dist;

        // Relative velocity along normal (positive = separating)
        const relVelN = (velA.x - velB.x) * nx + (velA.z - velB.z) * nz;
        if (relVelN >= 0) continue; // already separating

        // Cancel the approaching component from each truck equally
        velA.x -= nx * relVelN * 0.5;
        velA.z -= nz * relVelN * 0.5;
        velB.x += nx * relVelN * 0.5;
        velB.z += nz * relVelN * 0.5;
      }
    }
  }

  /**
   * Post-frame collision resolve: push overlapping trucks apart and apply
   * an impulse so they bounce off each other realistically.
   */
  update(trucks) {
    for (let i = 0; i < trucks.length; i++) {
      for (let j = i + 1; j < trucks.length; j++) {
        const tA = trucks[i].truck;
        const tB = trucks[j].truck;
        if (!tA?.mesh || !tB?.mesh) continue;

        this._resolve(tA, tB);
      }
    }
  }

  _resolve(tA, tB) {
    const posA = tA.mesh.position;
    const posB = tB.mesh.position;

    const dx = posA.x - posB.x;
    const dz = posA.z - posB.z;
    const distSq = dx * dx + dz * dz;
    if (distSq >= COLLISION_DIST_SQ) return;

    const dist = Math.sqrt(distSq) || 0.001;
    const nx = dx / dist; // normal from B toward A
    const nz = dz / dist;

    // ── Position correction: push both trucks apart by half the overlap ──
    const overlap = COLLISION_DIST - dist;
    const halfOverlap = overlap * 0.5;
    posA.x += nx * halfOverlap;
    posA.z += nz * halfOverlap;
    posB.x -= nx * halfOverlap;
    posB.z -= nz * halfOverlap;

    // ── Impulse ───────────────────────────────────────────────────────────
    const velA = tA.state.velocity;
    const velB = tB.state.velocity;

    const relVelN = (velA.x - velB.x) * nx + (velA.z - velB.z) * nz;
    if (relVelN >= 0) return; // already separating after position fix

    // Equal-mass impulse with restitution
    const impulse = -(1 + RESTITUTION) * relVelN * 0.5;
    velA.x += nx * impulse;
    velA.z += nz * impulse;
    velB.x -= nx * impulse;
    velB.z -= nz * impulse;

    // Bleed off a fraction of tangential speed (simulates friction at contact)
    const tx = -nz, tz = nx; // tangent perpendicular to normal
    const relVelT = (velA.x - velB.x) * tx + (velA.z - velB.z) * tz;
    velA.x -= tx * relVelT * FRICTION * 0.5;
    velA.z -= tz * relVelT * FRICTION * 0.5;
    velB.x += tx * relVelT * FRICTION * 0.5;
    velB.z += tz * relVelT * FRICTION * 0.5;
  }
}
