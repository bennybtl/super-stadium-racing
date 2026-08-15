import { TRUCK_DEPTH, TRUCK_HALF_HEIGHT, TRUCK_RADIUS, TRUCK_WIDTH } from "../constants.js";

const RESTITUTION = 0.35; // 0 = perfectly inelastic, 1 = perfectly elastic
const FRICTION = 0.075;    // fraction of tangential speed bled off on impact
// Small extra horizontal range so a dead-on touch registers as contact
// without needing to interpenetrate first.
const HORIZONTAL_SKIN = 0.05;

// Small extra vertical range so trucks resting flush on top of one another
// still read as "touching" rather than needing to interpenetrate first.
const VERTICAL_SKIN = 0.03;
// Caps how fast the vertical support spring can push a stacked truck out per
// frame — mirrors TerrainPhysics's SPRING.maxImpulsePerFrame so landing on a
// truck feels like landing on ground, not a rigid clank.
const MAX_VERTICAL_SPRING_IMPULSE = 3.5;

/**
 * TruckCollisionManager
 *
 * Handles truck-to-truck collision detection and response using the same
 * two-phase pattern as WallManager:
 *
 *   preUpdate(trucks, dt)  – call BEFORE updateTruck() to cancel velocity
 *                            components that would drive trucks into each other.
 *   update(trucks, dt)     – call AFTER updateTruck() to push overlapping
 *                            trucks apart and apply an impulse.
 *
 * Contact is resolved as a minimum-translation-vector pick between two
 * overlap tests — horizontal (each truck's oriented box extent, projected
 * onto the direction between the two centres) and vertical (the two
 * half-heights) — rather than horizontal-only. Without this, a truck landing
 * squarely on top of another has near-zero horizontal separation, which used
 * to read as a near-total horizontal overlap and shove it violently
 * sideways. Picking whichever axis has the smaller overlap means a stacked
 * truck resolves upward instead.
 *
 * The horizontal extent is a per-truck oriented support distance (heading +
 * half-width/half-depth), not the box's circumradius — using the circumradius
 * as a flat circle made two trucks "touch" up to ~2.7m apart while driving
 * side by side (see the identical fix's writeup in
 * StaticBodyCollisionManager's truck-vs-wall inflation).
 */
export class TruckCollisionManager {
  /**
   * Pre-frame velocity cancel: for every truck pair on a horizontal collision
   * course this frame, zero the component of each truck's velocity directed
   * toward the other. This prevents grip/drift physics from re-injecting
   * into-other-truck motion during updateTruck(). Vertical contact is left
   * to update()/the support spring — gravity already drives that approach.
   */
  preUpdate(trucks, dt) {
    for (let i = 0; i < trucks.length; i++) {
      for (let j = i + 1; j < trucks.length; j++) {
        const tA = trucks[i].truck;
        const tB = trucks[j].truck;
        if (!tA?.mesh || !tB?.mesh) continue;

        const posA = tA.mesh.position;
        const posB = tB.mesh.position;
        const overlap = this._overlap(tA, tB, posA, posB);
        if (!overlap || overlap.axis !== "xz") continue;

        const velA = tA.state.velocity;
        const velB = tB.state.velocity;
        const { nx, nz } = overlap;

        // Predicted positions
        const nextAx = posA.x + velA.x * dt;
        const nextAz = posA.z + velA.z * dt;
        const nextBx = posB.x + velB.x * dt;
        const nextBz = posB.z + velB.z * dt;
        const ndx = nextAx - nextBx;
        const ndz = nextAz - nextBz;
        const dx = posA.x - posB.x;
        const dz = posA.z - posB.z;
        const distSq = dx * dx + dz * dz;
        const nextDistSq = ndx * ndx + ndz * ndz;

        // Only intervene if they're getting closer
        if (nextDistSq >= distSq) continue;

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
  update(trucks, dt) {
    for (let i = 0; i < trucks.length; i++) {
      for (let j = i + 1; j < trucks.length; j++) {
        const tA = trucks[i].truck;
        const tB = trucks[j].truck;
        if (!tA?.mesh || !tB?.mesh) continue;

        this._resolve(tA, tB, dt);
      }
    }
  }

  /**
   * Overlap test + minimum-translation-vector axis pick for a truck pair.
   * Returns null when not overlapping in 3D, otherwise one of:
   *   { axis: "xz", overlapXZ, nx, nz }
   *   { axis: "y",  overlapY, dy }
   */
  _overlap(tA, tB, posA, posB) {
    const dx = posA.x - posB.x;
    const dz = posA.z - posB.z;
    const distXZ = Math.sqrt(dx * dx + dz * dz);
    const dist = distXZ || 0.001;
    const dirX = dx / dist;
    const dirZ = dz / dist;

    const collisionDist =
      this._orientedSupport(tA, dirX, dirZ) +
      this._orientedSupport(tB, dirX, dirZ) +
      HORIZONTAL_SKIN;
    const overlapXZ = collisionDist - distXZ;
    if (overlapXZ <= 0) return null;

    const halfA = tA.halfHeight ?? TRUCK_HALF_HEIGHT;
    const halfB = tB.halfHeight ?? TRUCK_HALF_HEIGHT;
    const dy = posA.y - posB.y;
    const overlapY = halfA + halfB + VERTICAL_SKIN - Math.abs(dy);
    if (overlapY <= 0) return null;

    if (overlapY < overlapXZ) {
      return { axis: "y", overlapY, dy };
    }

    return { axis: "xz", overlapXZ, nx: dirX, nz: dirZ };
  }

  /**
   * Distance from a truck's centre to its box edge along a given world-space
   * unit direction — i.e. how far that truck's oriented footprint extends
   * toward the other truck, not its (larger, orientation-independent)
   * circumradius.
   */
  _orientedSupport(truck, dirX, dirZ) {
    const heading = truck.state.heading;
    const fwdX = Math.sin(heading), fwdZ = Math.cos(heading);
    const rightX = Math.cos(heading), rightZ = -Math.sin(heading);
    const localX = dirX * rightX + dirZ * rightZ;
    const localZ = dirX * fwdX + dirZ * fwdZ;
    const halfWidth = (truck.width ?? TRUCK_WIDTH) / 2;
    const halfDepth = (truck.depth ?? TRUCK_DEPTH) / 2;
    return halfWidth * Math.abs(localX) + halfDepth * Math.abs(localZ);
  }

  _resolve(tA, tB, dt) {
    const posA = tA.mesh.position;
    const posB = tB.mesh.position;
    const overlap = this._overlap(tA, tB, posA, posB);
    if (!overlap) return;

    if (overlap.axis === "y") {
      this._resolveVertical(tA, tB, overlap, dt);
    } else {
      this._resolveHorizontal(tA, tB, posA, posB, overlap);
    }
  }

  _resolveHorizontal(tA, tB, posA, posB, overlap) {
    const { overlapXZ, nx, nz } = overlap;

    // ── Position correction: push both trucks apart by half the overlap ──
    const halfOverlap = overlapXZ * 0.5;
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
    velA.x -= tx * relVelT * FRICTION;
    velA.z -= tz * relVelT * FRICTION;
    velB.x += tx * relVelT * FRICTION;
    velB.z += tz * relVelT * FRICTION;
  }

  /**
   * Vertical support: treat the bottom truck's roof as a spring contact for
   * the top truck, using the top truck's own suspension tuning
   * (springStrength/damping) — same shape as TerrainPhysics's ground spring,
   * so resting on another truck settles instead of snapping or bouncing.
   * Deliberately doesn't touch the bottom truck's position — it's likely
   * grounded on the real terrain, and nudging it here would just fight its
   * own terrain spring next frame.
   */
  _resolveVertical(tA, tB, overlap, dt) {
    const top = overlap.dy > 0 ? tA : tB;
    const bottom = overlap.dy > 0 ? tB : tA;

    // Contact normal tilts away from straight-up as the top truck sits
    // off-centre on the roof below, so it slides off an edge landing instead
    // of bouncing in place on a perfectly vertical spring. Modelled as the
    // gradient of an ellipsoid capping the bottom truck: TRUCK_RADIUS for the
    // roof's horizontal extent, the combined half-heights for the vertical
    // extent. Dead-centre landings still push straight up.
    const dx = top.mesh.position.x - bottom.mesh.position.x;
    const dz = top.mesh.position.z - bottom.mesh.position.z;
    const dy = top.mesh.position.y - bottom.mesh.position.y; // > 0 by construction
    const rv = (top.halfHeight ?? TRUCK_HALF_HEIGHT) + (bottom.halfHeight ?? TRUCK_HALF_HEIGHT);

    let nx = dx / (TRUCK_RADIUS * TRUCK_RADIUS);
    let ny = dy / (rv * rv);
    let nz = dz / (TRUCK_RADIUS * TRUCK_RADIUS);
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen; ny /= nLen; nz /= nLen;

    const springForce = overlap.overlapY * top.state.springStrength;
    const springImpulse = Math.min(springForce * dt, MAX_VERTICAL_SPRING_IMPULSE);
    top.state.velocity.x += nx * springImpulse;
    top.state.velocity.y += ny * springImpulse;
    top.state.velocity.z += nz * springImpulse;

    const relVelN =
      (top.state.velocity.x - bottom.state.velocity.x) * nx +
      (top.state.velocity.y - bottom.state.velocity.y) * ny +
      (top.state.velocity.z - bottom.state.velocity.z) * nz;
    if (relVelN < 0) {
      const damp = -relVelN * top.state.damping * dt;
      top.state.velocity.x += nx * damp;
      top.state.velocity.y += ny * damp;
      top.state.velocity.z += nz * damp;
    }
  }
}
