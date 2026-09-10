/**
 * Short, stable id for a track feature that other features need to reference by
 * name in the saved JSON (e.g. a decal's `attachTo.id` pointing at the decoration
 * or obstacle it is stuck to).
 *
 * Assigned lazily — a feature only gets one the first time something attaches to
 * it — so untouched tracks stay byte-identical. Collision-resistant enough for a
 * single hand-edited track: a time seed plus a little randomness.
 */
export function makeFeatureId(prefix = "f") {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${t}${r}`;
}

/** Ensure `feature.id` exists, assigning one with `prefix` if not. Returns it. */
export function ensureFeatureId(feature, prefix = "f") {
  if (!feature.id) feature.id = makeFeatureId(prefix);
  return feature.id;
}
