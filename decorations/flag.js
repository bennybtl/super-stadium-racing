import { Flag, COLLISION_RADIUS } from "./lib/Flag.js";
import { TRUCK_RADIUS } from "../src/constants.js";

/** Lateral speed (m/s) → impulse magnitude applied to the pole. */
const BEND_IMPULSE_SCALE = 1.2;

/**
 * Flag decoration controller.
 *
 * Procedural (no OBJ): builds its own pole + banner, simulates an inverted
 * pendulum each frame, and gets kicked by passing trucks. Editing is colour
 * only — a flag stands straight up, so it exposes no rotation or scale.
 */
export default {
  build(feature, def, { scene, groundY, shadows }) {
    return new Flag(
      feature.x,
      feature.z,
      feature.color ?? def.defaultColor ?? 'red',
      groundY,
      scene,
      shadows,
    );
  },

  /** Per-frame: truck collision impulses, then advance the spring-damper. */
  update(flag, { dt, trucks }) {
    if (!dt || dt <= 0) return;
    const CONTACT_DIST = TRUCK_RADIUS + COLLISION_RADIUS;

    for (const truckData of trucks ?? []) {
      const truck = truckData.truck ?? truckData;
      if (!truck.mesh || !truck.state) continue;

      const tp = truck.mesh.position;
      const dx = flag.x - tp.x;
      const dz = flag.z - tp.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > CONTACT_DIST || dist < 0.01) continue;

      // Unit vector truck → flag; only react when the truck is closing in.
      const nx = dx / dist;
      const nz = dz / dist;
      const vel = truck.state.velocity;
      const approach = vel.x * nx + vel.z * nz;
      if (approach <= 0) continue;

      const impulse = approach * BEND_IMPULSE_SCALE;
      flag.applyBendImpulse(nx * impulse, nz * impulse);
    }

    flag.update(dt);
  },

  edit: {
    controls: () => ({
      color: { type: 'color', label: 'Color' },
    }),
  },
};
