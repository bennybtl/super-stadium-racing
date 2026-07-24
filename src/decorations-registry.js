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
 *
 * Also hosts the shared decoration factory and the property/control plumbing
 * used by both the runtime manager and the editor.
 */
import { ModelDecoration } from "./objects/ModelDecoration.js";

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

// ─── Instance construction ───────────────────────────────────────────────────

/**
 * Build the visual for a decoration feature.
 *
 * A def whose controller exports `build()` supplies its own procedural geometry
 * (flag, banner string); everything else loads the def's OBJ via ModelDecoration.
 * The returned instance always carries `feature` and `def` so the managers and
 * the editor can reach the controller.
 */
export function createDecoration(feature, def, groundY, scene, shadows) {
  if (!def) return null;
  const controller = def.controller;
  const instance = controller?.build
    ? controller.build(feature, def, { scene, groundY, shadows })
    : new ModelDecoration(feature, def, groundY, scene, shadows);
  if (!instance) return null;
  instance.feature = feature;
  instance.def = def;
  return instance;
}

// ─── Editor controls ─────────────────────────────────────────────────────────

/** Panel controls for a plain model decoration, derived from `def.editable`. */
function defaultControls(def) {
  const e = def?.editable ?? { color: true, scale: true, heading: true };
  const controls = {};
  if (e.color)   controls.color   = { type: 'color', label: 'Color' };
  if (e.scale)   controls.scale   = { type: 'range', label: 'Scale',    min: 0.5, max: 4,   step: 0.1, unit: '×' };
  if (e.heading) controls.heading = { type: 'range', label: 'Rotation', min: 0,   max: 360, step: 1,   unit: '°' };
  controls.mirror = { type: 'mirror', label: 'Mirror' };
  return controls;
}

/**
 * The control descriptor the Decoration panel renders. A controller can return
 * a different set per feature (dynamic/conditional editing); otherwise the
 * def's `editable` flags drive the default set.
 *
 * The collider toggle is appended for any def that nominates `colliderMeshes`,
 * so it shows up regardless of whether a controller supplied its own controls.
 */
export function controlsFor(def, feature) {
  const controls = { ...(def?.controller?.edit?.controls?.(feature, def) ?? defaultControls(def)) };
  if (def?.colliderMeshes?.length && !controls.collider) {
    controls.collider = { type: 'toggle', label: 'Collider' };
  }
  return controls;
}

// ─── Property read/write ─────────────────────────────────────────────────────

/** Panel-facing value for a prop, read off the feature (heading in degrees). */
export function readDecorationProp(feature, def, prop) {
  switch (prop) {
    case 'heading': return +((feature.heading ?? 0) * 180 / Math.PI).toFixed(1);
    case 'color':   return feature.color ?? def?.defaultColor ?? 'white';
    case 'scale':   return +(feature.scale ?? def?.defaultScale ?? 1).toFixed(1);
    // Controller-defined props (width, height, …) fall back to the def's
    // featureDefaults so the panel still shows a value on older features.
    default:        return feature[prop] ?? def?.featureDefaults?.[prop];
  }
}

/** `width` → `setWidth`, `mirrorX` → `setMirrorX`, … */
function setterName(prop) {
  return `set${prop.charAt(0).toUpperCase()}${prop.slice(1)}`;
}

/**
 * Write a panel value onto the feature and push it to the live instance.
 *
 * The setter is resolved by naming convention, so any prop a controller puts in
 * its control descriptor works without adding a case here. Setters are
 * optional-chained, so a decoration that simply omits one (a flag has no
 * setHeading) silently ignores that prop.
 */
export function applyDecorationProp(instance, prop, value) {
  // Only the props needing a representation change are special-cased: the panel
  // shows degrees while features store radians, and mirrors are booleans.
  let stored = value;
  if (prop === 'heading') stored = value * (Math.PI / 180);
  else if (prop === 'mirrorX' || prop === 'mirrorZ') stored = !!value;

  instance.feature[prop] = stored;
  instance[setterName(prop)]?.(stored);
}
