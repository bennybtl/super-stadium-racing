import { BannerString, GUST_RADIUS } from "./lib/BannerString.js";

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

  /** Per-frame: feed passing trucks' wakes in, then advance the sway. */
  update(banner, { dt, trucks }) {
    if (!dt || dt <= 0) return;

    const origin = banner.container.position;
    const h   = banner.container.rotation.y;
    const cos = Math.cos(h);
    const sin = Math.sin(h);
    // Anything beyond the span plus a wake radius can't reach the banner.
    const reach = banner.feature.width / 2 + GUST_RADIUS;

    for (const truckData of trucks ?? []) {
      const truck = truckData.truck ?? truckData;
      if (!truck.mesh || !truck.state) continue;

      const tp = truck.mesh.position;
      const wx = tp.x - origin.x;
      const wz = tp.z - origin.z;
      if (wx * wx + wz * wz > reach * reach) continue;

      // Into banner-local space: +X runs along the span, +Z crosses it.
      const vel = truck.state.velocity;
      banner.applyGust(
        wx * cos - wz * sin,
        tp.y - origin.y,
        wx * sin + wz * cos,
        vel.x * sin + vel.z * cos,
        dt,
      );
    }

    banner.update(dt);
  },

  edit: {
    controls: () => ({
      width:      { type: 'range', label: 'Width',       min: 5, max: 50, step: 1, unit: 'm' },
      poleHeight: { type: 'range', label: 'Pole Height', min: 3, max: 24, step: 1, unit: 'm' },
      heading:    { type: 'range', label: 'Rotation',    min: 0, max: 180, step: 1, unit: '°' },
    }),
  },
};
