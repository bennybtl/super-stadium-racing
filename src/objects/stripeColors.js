import { basicColors } from "../constants.js";

/**
 * Shared stripe-colour palette for polyWall / polyCurb ribbons.
 *
 * A feature carries `colors: ['red', 'white']` — 1 to 3 palette names repeated
 * as stripes along the ribbon: one colour renders solid, two alternate, three
 * repeat as a triad.
 *
 * Colours are the game's standard palette (constants.basicColors); each stripe
 * uses that colour's `diffuse` as its RGB.
 */

/** name → [r, g, b] taken from each basicColors entry's diffuse channel. */
export const STRIPE_PALETTE = Object.fromEntries(
  Object.entries(basicColors).map(([name, { diffuse }]) => [name, [diffuse.r, diffuse.g, diffuse.b]]),
);

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
