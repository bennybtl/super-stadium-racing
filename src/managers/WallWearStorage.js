// Persistent per-wall live scuff wear (see PolyWall/poly-ribbon's scuff
// system). Only the small per-sample intensity arrays are stored — never the
// rendered texture itself, which is cheaply regenerated from them at load
// time (the same way the deterministic AI-path bake already works).
//
// Walls are keyed by a hash of their own point geometry rather than a track
// feature id: a feature only gets a stable `.id` once something (a decal
// attachment, say) causes the track to be resaved with it, and wear is
// recorded during play, when nothing resaves the track. Hashing the wall's own
// points needs no such round-trip, and a track author reshaping a wall later
// naturally invalidates its old wear (a differently-shaped wall is, for wear
// purposes, a different wall).

const STORAGE_PREFIX = "wallWear_";
export const WALL_WEAR_SCHEMA_VERSION = 1;

function storageKey(trackKey) {
  return STORAGE_PREFIX + trackKey;
}

function _stringHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Stable key for a polyWall feature: its own id if it has one, else a hash of its points. */
export function wallWearKey(feature) {
  if (feature?.id) return feature.id;
  const pts = feature?.points ?? [];
  return _stringHash(pts.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join("|"));
}

/** All saved wall wear for a track: { [wallKey]: { left: number[], right: number[] } }. */
export function loadTrackWallWear(trackKey) {
  try {
    const raw = localStorage.getItem(storageKey(trackKey));
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (data?.version !== WALL_WEAR_SCHEMA_VERSION || !data.walls) return {};
    return data.walls;
  } catch {
    return {};
  }
}

/**
 * One wall's saved wear, or null if there is none, or if it doesn't match
 * `expectedLength` (the wall was reshaped/resampled differently since the save).
 */
export function loadWallWear(trackKey, wallKey, expectedLength) {
  const entry = loadTrackWallWear(trackKey)[wallKey];
  if (!entry || !Array.isArray(entry.left) || !Array.isArray(entry.right)) return null;
  if (entry.left.length !== expectedLength || entry.right.length !== expectedLength) return null;
  return entry;
}

/**
 * Persist one wall's live wear, merged into the track's saved set. Deferred
 * off the caller's frame (same pattern as HotLapStorage) so a save triggered
 * from dispose/race-end never hitches.
 */
export function saveWallWear(trackKey, wallKey, left, right) {
  // Rounded — this is a wear texture's input, not physics; a few KB of full
  // float precision per wall buys nothing visually.
  const round = (arr) => arr.map((v) => Math.round(v * 1000) / 1000);
  const payloadLeft = round(left);
  const payloadRight = round(right);
  setTimeout(() => {
    const key = storageKey(trackKey);
    try {
      const walls = loadTrackWallWear(trackKey);
      walls[wallKey] = { left: payloadLeft, right: payloadRight };
      localStorage.setItem(key, JSON.stringify({ version: WALL_WEAR_SCHEMA_VERSION, walls }));
    } catch (e) {
      console.warn("[WallWearStorage] Failed to persist wall wear:", e?.name ?? e);
    }
  }, 0);
}

/** Delete all saved wall wear for a track. */
export function deleteTrackWallWear(trackKey) {
  try {
    localStorage.removeItem(storageKey(trackKey));
  } catch {}
}
