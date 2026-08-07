/**
 * Scalar math shared across terrain, physics, audio and UI code.
 *
 * Dependency-free on purpose: this is imported by modules that must stay
 * runnable outside a browser (and by hot per-frame code, where pulling in
 * Babylon or the terrain pipeline just to clamp a number is wasteful).
 */

/** Clamp to [min, max]. */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Clamp to [0, 1]. Non-finite input reads as 0. */
export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Linear interpolation; `t` is not clamped. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Hermite ease between two edges, clamped to [0, 1]. */
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
