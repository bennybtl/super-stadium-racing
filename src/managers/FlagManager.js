import { Vector3 } from "@babylonjs/core";
import { Flag, COLLISION_RADIUS } from "../objects/Flag.js";
import { TRUCK_RADIUS } from "../constants.js";

/**
 * FlagManager — creates and manages flag objects on the track.
 * Flags are decorative elements that bend/sway when hit by trucks.
 */
export class FlagManager {
  constructor(scene, track, shadows) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;

    // Array of Flag instances
    this._flags = [];
  }

  // ─── Creation ────────────────────────────────────────────────────────────
  createFlag(feature) {
    const { x, z, color = 'red' } = feature;
    const groundY = this.track.getHeightAt(x, z);
    const flag = new Flag(x, z, color, groundY, this.scene, this.shadows);
    this._flags.push(flag);
  }

  // ─── Per-frame interaction ────────────────────────────────────────────────

  /**
   * Call every frame after trucks have moved.
   * Detects truck collisions and advances the spring-damper bend simulation.
   */
  update(trucks, dt) {
    if (!dt || dt <= 0) return;

    const CONTACT_DIST = TRUCK_RADIUS + COLLISION_RADIUS;
    /** How strongly the pole bends per unit of truck approach speed */
    const BEND_IMPULSE_SCALE = 3.0;

    for (const flag of this._flags) {
      const fx = flag.x;
      const fz = flag.z;

      // Check each truck for collision
      for (const truckData of trucks) {
        const truck = truckData.truck ?? truckData;
        if (!truck.mesh || !truck.state) continue;

        const tp = truck.mesh.position;
        const dx = fx - tp.x;
        const dz = fz - tp.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > CONTACT_DIST || dist < 0.01) continue;

        // Unit vector from truck → flag
        const nx = dx / dist;
        const nz = dz / dist;

        // How fast the truck is approaching the flag
        const vel = truck.state.velocity;
        const approach = vel.x * nx + vel.z * nz;
        if (approach <= 0) continue; // separating

        // Bend the pole AWAY from the truck.
        // Rotation around X axis tilts in Z direction, and vice versa,
        // so map the push direction accordingly.
        const impulse = approach * BEND_IMPULSE_SCALE;
        flag.applyBendImpulse(nz * impulse, -nx * impulse);
      }

      // Advance spring simulation
      flag.update(dt);
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  reset() {
    this.dispose();
  }

  rebuild() {
    this.dispose();
    for (const feature of this.track.features) {
      if (feature.type === "flag") this.createFlag(feature);
    }
  }

  dispose() {
    for (const flag of this._flags) flag.dispose();
    this._flags = [];
  }
}
