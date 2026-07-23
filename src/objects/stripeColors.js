/**
 * Shared stripe-colour palette for polyWall / polyCurb ribbons.
 *
 * A feature carries `colors: ['red', 'white']` — 1 to 3 palette names repeated
 * as stripes along the ribbon: one colour renders solid, two alternate, three
 * repeat as a triad.
 */

export const STRIPE_PALETTE = {
  red:    [0.85, 0.08, 0.08],
  white:  [1.0,  1.0,  1.0],
  blue:   [0.08, 0.4,  0.85],
  yellow: [0.95, 0.8,  0.05],
  orange: [0.95, 0.45, 0.05],
  green:  [0.1,  0.6,  0.2],
  black:  [0.08, 0.08, 0.08],
  grey:   [0.55, 0.55, 0.55],
};

/** Selectable colour names, in dropdown order. */
export const STRIPE_COLOR_NAMES = Object.keys(STRIPE_PALETTE);

export const DEFAULT_STRIPE_COLORS = ['red', 'white'];

/**
 * Coerce an arbitrary list into a storable colour list: known palette names
 * only, 1–3 entries, falling back to the default when nothing valid is given.
 */
export function normalizeStripeColors(colors) {
  const valid = (Array.isArray(colors) ? colors : []).filter(name => STRIPE_PALETTE[name]);
  return valid.length ? valid.slice(0, 3) : [...DEFAULT_STRIPE_COLORS];
}

/** The 1–3 palette names for a feature. */
export function resolveStripeColorNames(feature) {
  return normalizeStripeColors(feature?.colors);
}

/** RGB triples for a feature's stripes, in order. Always 1–3 entries. */
export function resolveStripeColors(feature) {
  return resolveStripeColorNames(feature).map(name => STRIPE_PALETTE[name]);
}
