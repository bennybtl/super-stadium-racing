import { Vector3 } from "@babylonjs/core";
import { Obstacle, normalizeObstacleType } from "../objects/Obstacle.js";
import { TerrainQuery } from "./TerrainQuery.js";
import { TRUCK_RADIUS, TRUCK_WIDTH, TRUCK_DEPTH, TRUCK_HALF_HEIGHT } from "../constants.js";
/**
 * ObstacleManager — creates and manages movable obstacles on the track.
 *
 * Construction and disposal of individual stacks is handled by Obstacle.
 * This manager is responsible for spawning obstacles from track features,
 * running per-frame collision with trucks, and reset/dispose lifecycle.
 */
export class ObstacleManager {
  constructor(scene, track, shadows) {
    this.scene   = scene;
    this.track   = track;
    this.shadows = shadows;
    this._terrainQuery = new TerrainQuery(scene);

    // Array of Obstacle instances
    this._stacks = [];
  }

  // ─── Creation ────────────────────────────────────────────────────────────
  createStack(feature) {
    const { x, z } = feature;
    const groundY = this._terrainQuery.heightAt(x, z);
    const obstacleType = normalizeObstacleType(feature.obstacleType);
    const angle = typeof feature.angle === 'number' ? feature.angle : 0;
    const rawScale = typeof feature.scale === 'number' ? feature.scale : 1;
    const scale = rawScale === 0.1 ? 1 : rawScale;
    const weight = typeof feature.weight === 'number' ? feature.weight : null;
    const stack = new Obstacle(x, z, groundY, this.scene, this.shadows, obstacleType, angle, scale, weight, feature.color, feature.count);
    stack.feature = feature; // so a stuck-on decal can resolve its parent by id
    this._stacks.push(stack);
  }

  /** Obstacle instance whose feature carries this id, or null. */
  findById(id) {
    if (!id) return null;
    return this._stacks.find((s) => s.feature?.id === id) ?? null;
  }

  // ─── Per-frame interaction ────────────────────────────────────────────────

  /**
   * Call every frame after trucks have moved.
   * Detects truck ↔ stack overlap using the existing box bodies, launches the
   * stack with a physics impulse, and bleeds speed from the truck proportional
   * to the impact.
   */
  update(trucks) {
    // Maximum fraction of truck speed lost per hit (capped so we don't reverse the truck)
    const MAX_SLOW       = 0.55;

    for (const stack of this._stacks) {
      const sp = stack.position;
      const he = stack.halfExtents ?? { x: stack.radius ?? 1, y: 1, z: stack.radius ?? 1 };
      const obsAngle = stack.angle ?? stack.body?.rotation.y ?? 0;

      // Cheap circle reject before the oriented test. Uses the obstacle's true
      // half-diagonal so a long wall is never rejected while its end still
      // overlaps the truck.
      const rejectDist = Math.hypot(he.x, he.z) + TRUCK_RADIUS;
      const rejectDistSq = rejectDist * rejectDist;

      for (const truckData of trucks) {
        const truck = truckData.truck ?? truckData;
        if (!truck.mesh || !truck.state) continue;

        const tp = truck.mesh.position;
        const dx = sp.x - tp.x;
        const dz = sp.z - tp.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > rejectDistSq) continue;

        // Vertical overlap: obstacle body vs truck box.
        const truckHalfY = truck.halfHeight ?? TRUCK_HALF_HEIGHT;
        if (Math.abs(sp.y - tp.y) > he.y + truckHalfY) continue;

        // Oriented (OBB) XZ overlap. Replaces an AABB intersectsMesh test that
        // over-reported by a couple of metres whenever either box was turned
        // off-axis — the "hits the long side too early" on a rotated wall.
        if (!this._obbOverlapXZ(
          tp, truck.state.heading,
          (truck.width ?? TRUCK_WIDTH) / 2, (truck.depth ?? TRUCK_DEPTH) / 2,
          sp, obsAngle, he.x, he.z,
        )) continue;

        const dist = Math.sqrt(distSq);
        if (dist < 0.01) continue;

        // Unit vector from truck → stack
        const nx = dx / dist;
        const nz = dz / dist;

        // How hard the obstacle gets kicked per unit of approach speed × truck mass proxy
        const IMPULSE_SCALE  = (stack.mass ?? 40) * 0.3;

        // How fast the truck is moving toward the stack
        // nx/nz points truck→stack, so a positive dot = truck approaching
        const vel = truck.state.velocity;
        const approach = vel.x * nx + vel.z * nz; // positive = approaching
        if (approach <= 0) continue; // already separating

        // ── Kick the stack ──────────────────────────────────────────────
        // Release it from its pinned pose first, then launch it.
        stack.activate();
        const impulseMag = approach * IMPULSE_SCALE;
        stack.aggregate.body.applyImpulse(
          new Vector3(nx * impulseMag, impulseMag * 0.25, nz * impulseMag),
          sp.clone()
        );

        // ── Slow the truck ──────────────────────────────────────────────
        const slowFactor = Math.min(MAX_SLOW, approach * 0.04);
        vel.x *= (1 - slowFactor);
        vel.z *= (1 - slowFactor);
      }
    }
  }

  /**
   * 2D oriented-box overlap in the XZ plane (separating-axis test). Box yaw
   * follows the mesh.rotation.y convention trucks and obstacle bodies share:
   * local +X (half hx) = (cos a, −sin a), local +Z (half hz) = (sin a, cos a).
   */
  _obbOverlapXZ(cA, angA, hxA, hzA, cB, angB, hxB, hzB) {
    const axAx = Math.cos(angA), axAz = -Math.sin(angA);
    const azAx = Math.sin(angA), azAz = Math.cos(angA);
    const axBx = Math.cos(angB), axBz = -Math.sin(angB);
    const azBx = Math.sin(angB), azBz = Math.cos(angB);
    const dx = cB.x - cA.x, dz = cB.z - cA.z;

    const axes = [[axAx, axAz], [azAx, azAz], [axBx, axBz], [azBx, azBz]];
    for (const [lx, lz] of axes) {
      const sep = Math.abs(dx * lx + dz * lz);
      const rA = hxA * Math.abs(axAx * lx + axAz * lz) + hzA * Math.abs(azAx * lx + azAz * lz);
      const rB = hxB * Math.abs(axBx * lx + axBz * lz) + hzB * Math.abs(azBx * lx + azBz * lz);
      if (sep > rA + rB) return false;
    }
    return true;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  reset() {
    this.dispose();
  }

  rebuild() {
    this.dispose();
    for (const feature of this.track.features) {
      if (feature.type === "obstacle") this.createStack(feature);
    }
  }

  dispose() {
    for (const stack of this._stacks) stack.dispose();
    this._stacks = [];
  }
}
