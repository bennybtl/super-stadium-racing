import { Vector3 } from "@babylonjs/core";

/**
 * Save/restore an object's own fields, for rewinding a predicted truck
 * (Truck.captureSimState; src/net/Prediction.js). Numbers, booleans, strings
 * and references are copied as-is; Vector3s are cloned and restored in place
 * (the sim keeps references to them). Functions and the listed keys are
 * skipped — fixed wiring, not state.
 *
 * Only safe for objects whose other nested values are never mutated in place;
 * those need handling by the caller (see Truck.captureSimState).
 */
export function captureFields(obj, skip = null) {
  const out = {};
  for (const key of Object.keys(obj)) {
    if (skip?.has(key)) continue;
    const v = obj[key];
    if (typeof v === "function") continue;
    out[key] = v instanceof Vector3 ? v.clone() : v;
  }
  return out;
}

export function restoreFields(obj, saved) {
  for (const key of Object.keys(saved)) {
    const v = saved[key];
    if (v instanceof Vector3) {
      if (obj[key] instanceof Vector3) obj[key].copyFrom(v);
      else obj[key] = v.clone();
    } else {
      obj[key] = v;
    }
  }
}
