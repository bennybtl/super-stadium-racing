import { ensureFeatureId } from "../utils/feature-id.js";

/**
 * Keep decals stuck to a decoration / obstacle in sync when the prop itself is
 * deleted or duplicated. `kind` is "decoration" | "obstacle" — the `attachTo.kind`
 * the decal feature stores.
 */

/** Drop every decal feature attached to prop `id` from the track + the manager. */
export function removeAttachedDecals(track, decalManager, id) {
  if (!id) return;
  for (let i = track.features.length - 1; i >= 0; i--) {
    const f = track.features[i];
    if (f.type === "decal" && f.attachTo?.id === id) track.features.splice(i, 1);
  }
  decalManager?.removeAttachedTo?.(id);
}

/**
 * Copy every decal attached to `srcFeature` onto `dstFeature` (which gets a fresh
 * id), pushing the clones into the track and building them.
 */
export function copyAttachedDecals(track, decalManager, srcFeature, dstFeature, kind) {
  const srcId = srcFeature.id;
  if (!srcId) return;
  const dstId = ensureFeatureId(dstFeature, kind[0]);
  for (const f of track.features.slice()) {
    if (f.type !== "decal" || f.attachTo?.id !== srcId) continue;
    const clone = JSON.parse(JSON.stringify(f));
    delete clone.id;
    clone.attachTo = { kind, id: dstId };
    track.features.push(clone);
    decalManager?.createDecal?.(clone);
  }
}
