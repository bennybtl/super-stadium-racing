/**
 * Shared vertical placement for editor gizmos.
 *
 * A handle is only useful if you can see it and the pick ray can reach it, so
 * every gizmo sits a fixed clearance above BOTH the terrain under it and
 * whatever its own feature sticks up (wall, slab, bridge deck, sign). Handles
 * that hug the surface get swallowed the moment a hill is raised under them or
 * the feature grows taller than its handle.
 *
 * Terrain height always comes from the analytic `track.getHeightAt`, never a
 * ground raycast: the ground mesh's picking octree goes stale after a terrain
 * edit, so raycast-placed gizmos stop tracking Y (that is what buried the
 * terrain-path waypoints). The analytic field reflects a feature edit the
 * instant the feature object changes.
 *
 * Gizmo Y is only ever a function of the current feature + terrain, so
 * `EditorController.refreshGizmoHeights()` can re-run it wholesale after a
 * terrain rebuild moves the ground out from under existing handles.
 */

/** Gap between the tallest thing a handle marks and the handle itself. */
export const GIZMO_CLEARANCE = 1.5;

/** Guide lines trace the shape, so they only need to clear z-fighting. */
export const GIZMO_LINE_CLEARANCE = 0.35;

/**
 * Y for a gizmo at (x, z).
 *
 * @param {object} track        current track (analytic height source)
 * @param {number} x
 * @param {number} z
 * @param {number|null} featureTopY  world Y of the top of the feature the gizmo
 *                                   marks; omit for ground-hugging features
 * @param {number} clearance
 */
export function gizmoY(track, x, z, featureTopY = null, clearance = GIZMO_CLEARANCE) {
  const terrainY = track?.getHeightAt?.(x, z) ?? 0;
  const top = Number.isFinite(featureTopY) ? Math.max(terrainY, featureTopY) : terrainY;
  return top + clearance;
}

/** As gizmoY, with the smaller clearance used for preview lines. */
export function gizmoLineY(track, x, z, featureTopY = null) {
  return gizmoY(track, x, z, featureTopY, GIZMO_LINE_CLEARANCE);
}

/**
 * World Y of a bridge deck / drive box over (x, z), or null on open ground —
 * pass it as `featureTopY` for gizmos that follow a route which can climb onto
 * a deck (AI paths), so their handles ride the deck instead of the ground below.
 *
 * Only non-ground surfaces count. A ground hit comes back through the same
 * picking octree that goes stale after a terrain edit, and the analytic field is
 * strictly the better answer there, so ground results are discarded rather than
 * raced against `gizmoY`'s own terrain sample.
 */
export function deckTopY(terrainQuery, x, z) {
  const y = terrainQuery?.tryHeightAtFast?.(x, z);
  if (y == null) return null;
  const surface = terrainQuery.getLastResolvedSurface?.();
  return surface && surface.surfaceType !== 'ground' ? y : null;
}
