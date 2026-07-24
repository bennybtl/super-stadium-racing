import { BannerString } from "./lib/BannerString.js";

/**
 * Banner string decoration controller.
 *
 * Procedural (no OBJ): two poles with a catenary rope. The pennant count is
 * derived from the width, so changing width/pole height rebuilds the children —
 * handled inside BannerString's own setters. No colour (pennants alternate a
 * fixed palette) and no scale; rotation is limited to a half turn since the
 * string is symmetric.
 */
export default {
  build(feature, def, { scene, groundY, shadows }) {
    return new BannerString(feature, groundY, scene, shadows);
  },

  edit: {
    controls: () => ({
      width:      { type: 'range', label: 'Width',       min: 5, max: 50, step: 1, unit: 'm' },
      poleHeight: { type: 'range', label: 'Pole Height', min: 3, max: 24, step: 1, unit: 'm' },
      heading:    { type: 'range', label: 'Rotation',    min: 0, max: 180, step: 1, unit: '°' },
    }),
  },
};
