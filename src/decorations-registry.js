/**
 * Shared helpers for resolving a track feature to a model-decoration definition.
 *
 * A feature is a model decoration when either:
 *   - feature.type === 'model'  (new form; the model id is feature.model), or
 *   - feature.type is itself a loaded decoration id (legacy form, e.g. the
 *     'tent' features saved in older tracks).
 *
 * This keeps old saved tracks working without rewriting them, while new
 * placements use the generic { type: 'model', model: <id> } shape.
 */

/** The decoration loader, exposed on window by main.js. */
export function getDecorationLoader() {
  return typeof window !== "undefined" ? window.decorationLoader : null;
}

/** Model id for a feature, or null if it isn't a model decoration. */
export function modelIdForFeature(feature, loader = getDecorationLoader()) {
  if (!feature || !loader) return null;
  if (feature.type === "model") return feature.model ?? null;
  // Legacy: a feature typed directly after a decoration id (e.g. 'tent').
  if (loader.getDecoration(feature.type)) return feature.type;
  return null;
}

/** True when the feature should be handled by the decoration system. */
export function isModelFeature(feature, loader = getDecorationLoader()) {
  return modelIdForFeature(feature, loader) !== null;
}

/** Definition object for a feature, or null. */
export function defForFeature(feature, loader = getDecorationLoader()) {
  const id = modelIdForFeature(feature, loader);
  return id ? (loader.getDecoration(id) ?? null) : null;
}
