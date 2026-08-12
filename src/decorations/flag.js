import { Flag, COLLISION_RADIUS, POLE_HEIGHT } from "./lib/Flag.js";
import { TRUCK_RADIUS } from "../constants.js";

/** Lateral speed (m/s) → impulse magnitude applied to the pole. */
const BEND_IMPULSE_SCALE = 1.2;

/**
 * Flag decoration controller.
 *
 * Procedural (no OBJ): builds its own pole + banner, simulates an inverted
 * pendulum each frame, and gets kicked by passing trucks. Editable props:
 * colour, heading (spin about the pole), scale, and pole height.
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
      {
        heading: feature.heading ?? 0,
        scale:   feature.scale ?? def.defaultScale ?? 1,
        height:  feature.height ?? def.featureDefaults?.height ?? POLE_HEIGHT,
      },
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
      color:   { type: 'color', label: 'Color' },
      heading: { type: 'range', label: 'Rotation', min: 0,   max: 360, step: 1,   unit: '°' },
      scale:   { type: 'range', label: 'Scale',    min: 0.5, max: 4,   step: 0.1, unit: '×' },
      height:  { type: 'range', label: 'Height',   min: 2,   max: 15,  step: 0.5, unit: 'm' },
    }),
  },
};
