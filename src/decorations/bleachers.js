import { BleachersStand } from "./lib/BleachersStand.js";

/**
 * Bleachers decoration controller.
 *
 * Two OBJ units — a raked seating section (`bleachers.obj`) and a riser cube
 * (`bleachers_box.obj`) — assembled into a grandstand. `width` repeats the
 * seating section across; `height` stacks a staircase of riser cubes behind it
 * (each cube one step further back and one step higher). Static, so only the
 * build + edit hooks are needed.
 */
export default {
  build(feature, def, { scene, groundY, shadows }) {
    return new BleachersStand(feature, def, groundY, scene, shadows);
  },

  edit: {
    controls: () => ({
      color:   { type: 'color', label: 'Color' },
      width:   { type: 'range', label: 'Width',    min: 1,   max: 20,  step: 1, unit: ' rows' },
      height:  { type: 'range', label: 'Height',   min: 1,   max: 10,  step: 1, unit: ' tiers' },
      heading: { type: 'range', label: 'Rotation', min: 0,   max: 360, step: 1, unit: '°' },
    }),
  },
};
