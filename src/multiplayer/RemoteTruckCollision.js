import { TRUCK_HALF_HEIGHT, TRUCK_WIDTH, TRUCK_DEPTH } from "../constants.js";
import { orientedSupport } from "../truck/collision-math.js";

const RESTITUTION = 0.35; // matches TruckCollisionManager's single-player feel
const FRICTION = 0.075;
const HORIZONTAL_SKIN = 0.05;

/**
 * Truck-vs-remote-puppet collision for multiplayer. Each client is only
 * authoritative for its own truck — a RemotePuppet's position is whatever the
 * owning client last broadcast, so nudging it here would just be overwritten
 * by their next network update a few dozen milliseconds later. This only
 * ever touches the LOCAL truck's position/velocity.
 *
 * Every other connected client runs this same check symmetrically from its
 * own point of view, each pushing itself half the resolution distance (the
 * same per-truck share TruckCollisionManager splits between two trucks it
 * does have authority over) — so two overlapping trucks each separately
 * back away from each other, which reads as a shared bounce without either
 * side needing authority over the other. It won't be pixel-identical between
 * clients under latency, but for casual play that's an acceptable tradeoff
 * for not needing a server-authoritative physics step.
 *
 * Horizontal (XZ) only — no vertical stacking response, unlike
 * TruckCollisionManager. Landing on top of another player's (non-authoritative)
 * puppet is a rare, low-stakes case not worth the extra complexity here.
 */
export class RemoteTruckCollision {
  /** Call before truck.update() — cancels the local truck's velocity
   *  component that would drive it further into an overlapping puppet. */
  preUpdate(localTruck, puppets, dt) {
    for (const puppet of puppets) {
      if (!puppet.hasTarget) continue;
      const overlap = this._overlap(localTruck, puppet);
      if (!overlap) continue;

      const posA = localTruck.mesh.position;
      const posB = puppet.position;
      const velA = localTruck.state.velocity;
      const velB = puppet.velocity;
      const { nx, nz } = overlap;

      const nextAx = posA.x + velA.x * dt, nextAz = posA.z + velA.z * dt;
      const nextBx = posB.x + velB.x * dt, nextBz = posB.z + velB.z * dt;
      const dx = posA.x - posB.x, dz = posA.z - posB.z;
      const ndx = nextAx - nextBx, ndz = nextAz - nextBz;
      if (ndx * ndx + ndz * ndz >= dx * dx + dz * dz) continue; // separating already

      const relVelN = (velA.x - velB.x) * nx + (velA.z - velB.z) * nz;
      if (relVelN >= 0) continue;

      // Cancel only this truck's half-share of the approaching component —
      // mirrors TruckCollisionManager.preUpdate's 0.5 split.
      velA.x -= nx * relVelN * 0.5;
      velA.z -= nz * relVelN * 0.5;
    }
  }

  /** Call after truck.update() — pushes the local truck out of any
   *  overlapping puppet and applies a bounce impulse. */
  update(localTruck, puppets) {
    for (const puppet of puppets) {
      if (!puppet.hasTarget) continue;
      const overlap = this._overlap(localTruck, puppet);
      if (!overlap) continue;
      this._resolve(localTruck, puppet, overlap);
    }
  }

  _overlap(localTruck, puppet) {
    const posA = localTruck.mesh.position;
    const posB = puppet.position;
    const dx = posA.x - posB.x;
    const dz = posA.z - posB.z;
    const distXZ = Math.sqrt(dx * dx + dz * dz);
    const dist = distXZ || 0.001;
    const dirX = dx / dist, dirZ = dz / dist;

    const collisionDist =
      orientedSupport(localTruck.state.heading, localTruck.width ?? TRUCK_WIDTH, localTruck.depth ?? TRUCK_DEPTH, dirX, dirZ) +
      orientedSupport(puppet.heading, puppet.width ?? TRUCK_WIDTH, puppet.depth ?? TRUCK_DEPTH, dirX, dirZ) +
      HORIZONTAL_SKIN;
    const overlapXZ = collisionDist - distXZ;
    if (overlapXZ <= 0) return null;

    // Vertical gate only — an airborne truck well above/below a puppet
    // shouldn't collide with it, but there's no stacking response.
    const vertRange = (localTruck.halfHeight ?? TRUCK_HALF_HEIGHT) + (puppet.halfHeight ?? TRUCK_HALF_HEIGHT);
    if (Math.abs(posA.y - posB.y) > vertRange) return null;

    return { overlapXZ, nx: dirX, nz: dirZ };
  }

  _resolve(localTruck, puppet, overlap) {
    const { overlapXZ, nx, nz } = overlap;
    const posA = localTruck.mesh.position;

    // This truck's own half-share of the separation (see class doc).
    const halfOverlap = overlapXZ * 0.5;
    posA.x += nx * halfOverlap;
    posA.z += nz * halfOverlap;

    const velA = localTruck.state.velocity;
    const velB = puppet.velocity;
    const relVelN = (velA.x - velB.x) * nx + (velA.z - velB.z) * nz;
    if (relVelN >= 0) return; // already separating after the position fix

    const impulse = -(1 + RESTITUTION) * relVelN * 0.5;
    velA.x += nx * impulse;
    velA.z += nz * impulse;

    // Bleed off a fraction of tangential speed (friction at contact).
    const tx = -nz, tz = nx;
    const relVelT = (velA.x - velB.x) * tx + (velA.z - velB.z) * tz;
    velA.x -= tx * relVelT * FRICTION;
    velA.z -= tz * relVelT * FRICTION;
  }
}
