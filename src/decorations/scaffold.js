import { ScaffoldArch } from "./lib/ScaffoldArch.js";

/**
 * Scaffold decoration controller.
 *
 * The OBJ is a single box unit; the arch is assembled by repeating it — `width`
 * boxes across the top and `height` boxes per side pillar. Static (no per-frame
 * behaviour), so only build + edit hooks are needed.
 */
export default {
  build(feature, def, { scene, groundY, shadows }) {
    return new ScaffoldArch(feature, def, groundY, scene, shadows);
  },

  edit: {
    controls: () => ({
      color:   { type: 'color', label: 'Color' },
      width:   { type: 'range', label: 'Width',    min: 1,   max: 20, step: 1, unit: ' boxes' },
      height:  { type: 'range', label: 'Height',   min: 1,   max: 20, step: 1, unit: ' boxes' },
      scale:   { type: 'range', label: 'Scale',    min: 0.5, max: 4,  step: 0.1, unit: '×' },
      heading: { type: 'range', label: 'Rotation', min: 0,   max: 360, step: 1, unit: '°' },
    }),
  },
};
