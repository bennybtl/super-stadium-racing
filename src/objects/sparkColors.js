/**
 * Spark-fountain palette for firework action zones.
 *
 * Each entry is the three-stop ramp a gerb burns through: a near-white `core`
 * at the muzzle, the saturated `body` colour that reads as the fountain's hue,
 * and a dark `dead` ember it fades out on. Keeping the hot core in every entry
 * is what makes a coloured fountain still read as burning rather than painted.
 *
 * Plain arrays (no Babylon types) so the editor panel can import the list
 * without pulling the particle code in with it.
 */

/** name → { core, body, dead } as [r, g, b]. */
export const SPARK_PALETTE = {
  red:    { core: [1.00, 0.75, 0.60], body: [1.00, 0.22, 0.15], dead: [0.60, 0.06, 0.03] },
  orange: { core: [1.00, 0.95, 0.65], body: [1.00, 0.70, 0.25], dead: [0.70, 0.25, 0.05] },
  yellow: { core: [1.00, 1.00, 0.80], body: [1.00, 0.90, 0.25], dead: [0.60, 0.45, 0.05] },
  green:  { core: [0.82, 1.00, 0.80], body: [0.35, 1.00, 0.35], dead: [0.05, 0.50, 0.10] },
  blue:   { core: [0.75, 0.90, 1.00], body: [0.30, 0.60, 1.00], dead: [0.05, 0.15, 0.60] },
  purple: { core: [0.90, 0.80, 1.00], body: [0.65, 0.35, 1.00], dead: [0.25, 0.05, 0.50] },
  pink:   { core: [1.00, 0.85, 0.95], body: [1.00, 0.35, 0.75], dead: [0.55, 0.05, 0.30] },
};

/** The stock gerb look — what every fountain burned before colours existed. */
export const DEFAULT_SPARK_COLOR = 'orange';

/** Selectable colour names, in dropdown order. */
export const SPARK_COLOR_NAMES = Object.keys(SPARK_PALETTE);

/** Ramp for a colour name, falling back to the default for anything unknown. */
export function resolveSparkColor(name) {
  return SPARK_PALETTE[name] ?? SPARK_PALETTE[DEFAULT_SPARK_COLOR];
}
