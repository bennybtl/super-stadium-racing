import { Vector3 } from "@babylonjs/core";
import { TireStack, TIRE_OUTER_RADIUS, STACK_MASS } from "../objects/TireStack.js";
import { TRUCK_RADIUS } from "../constants.js";
import { TerrainQuery } from "./TerrainQuery.js";
/**
 * TireStackManager — creates and manages movable tire stacks on the track.
 *
 * Construction and disposal of individual stacks is handled by TireStack.
 * This manager is responsible for spawning stacks from track features,
 * running per-frame collision with trucks, and reset/dispose lifecycle.
 */
export class TireStackManager {
  constructor(scene, track, shadows) {
    this.scene   = scene;
    this.track   = track;
    this.shadows = shadows;
    this._terrainQuery = new TerrainQuery(scene);

    // Array of TireStack instances
    this._stacks = [];
  }

  // ─── Creation ────────────────────────────────────────────────────────────
  createStack(feature) {
    const { x, z } = feature;
    const groundY = this._terrainQuery.heightAt(x, z);
    const stack = new TireStack(x, z, groundY, this.scene, this.shadows);
    this._stacks.push(stack);
  }

  // ─── Per-frame interaction ────────────────────────────────────────────────

  /**
   * Call every frame after trucks have moved.
   * Detects truck ↔ stack proximity, launches the stack with a physics impulse,
   * and bleeds speed from the truck proportional to the impact.
   */
  update(trucks) {
    // Combined contact radius: truck (≈half-diagonal of 1.5×2.2 box) + stack
    // Maximum fraction of truck speed lost per hit (capped so we don't reverse the truck)
    const MAX_SLOW       = 0.55;

    for (const stack of this._stacks) {
      const sp = stack.position;

      for (const truckData of trucks) {
        const truck = truckData.truck ?? truckData;
        if (!truck.mesh || !truck.state) continue;

        const CONTACT_DIST = (truck.radius ?? TRUCK_RADIUS) + TIRE_OUTER_RADIUS;

        const tp  = truck.mesh.position;
        const dx  = sp.x - tp.x;
        const dz  = sp.z - tp.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > CONTACT_DIST || dist < 0.01) continue;

        // Unit vector from truck → stack
        const nx = dx / dist;
        const nz = dz / dist;

        // How hard the stack gets kicked per unit of approach speed × truck mass proxy
        const IMPULSE_SCALE  = STACK_MASS * 0.3;

        // How fast the truck is moving toward the stack
        // nx/nz points truck→stack, so a positive dot = truck approaching
        const vel = truck.state.velocity;
        const approach = vel.x * nx + vel.z * nz; // positive = approaching
        if (approach <= 0) continue; // already separating

        // ── Kick the stack ──────────────────────────────────────────────
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

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  reset() {
    this.dispose();
  }

  rebuild() {
    this.dispose();
    for (const feature of this.track.features) {
      if (feature.type === "tireStack") this.createStack(feature);
    }
  }

  dispose() {
    for (const stack of this._stacks) stack.dispose();
    this._stacks = [];
  }
}
