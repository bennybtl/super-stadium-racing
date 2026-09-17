// Persistent shared tire marks (see truck/TireMarks.js). A completed streak —
// one wheel's mark, start to finish — is the natural save unit: only the
// streak's raw geometry is stored (position + perpendicular offset + alpha
// per point), never colour or height, since both are cheaply recomputed at
// replay time the same way a live streak computes them (see
// TireMarks.appendStreak's `colorForPoint`/`sampleY`).

const STORAGE_PREFIX = "tireMarks_";
export const TIRE_MARKS_SCHEMA_VERSION = 1;
// FIFO cap on saved streaks (not points) — a streak is the unit a player
// actually perceives as "one mark", and capping at this level keeps the
// saved JSON bounded regardless of how many long/short streaks accumulate.
export const TIRE_MARKS_MAX_STREAKS = 600;

function storageKey(trackKey) {
  return STORAGE_PREFIX + trackKey;
}

/** Saved streaks for a track — [{points:[{x,z,offsetX,offsetZ,alpha}]}], oldest first. [] if none/invalid. */
export function loadTireMarkStreaks(trackKey) {
  try {
    const raw = localStorage.getItem(storageKey(trackKey));
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data?.version !== TIRE_MARKS_SCHEMA_VERSION || !Array.isArray(data.streaks)) return [];
    return data.streaks.slice(-TIRE_MARKS_MAX_STREAKS);
  } catch {
    return [];
  }
}

/**
 * Persist a track's tire-mark streaks. Deferred off the caller's frame (same
 * pattern as the other *Storage modules) so a periodic save never hitches.
 */
export function saveTireMarkStreaks(trackKey, streaks) {
  const round = (v) => Math.round(v * 1000) / 1000;
  const payload = streaks.slice(-TIRE_MARKS_MAX_STREAKS).map((streak) => ({
    points: streak.points.map((p) => ({
      x: round(p.x), z: round(p.z), offsetX: round(p.offsetX), offsetZ: round(p.offsetZ), alpha: round(p.alpha),
    })),
  }));
  setTimeout(() => {
    try {
      localStorage.setItem(
        storageKey(trackKey),
        JSON.stringify({ version: TIRE_MARKS_SCHEMA_VERSION, streaks: payload }),
      );
    } catch (e) {
      console.warn("[TireMarksStorage] Failed to persist tire marks:", e?.name ?? e);
    }
  }, 0);
}

/** Delete all saved tire marks for a track. */
export function deleteTireMarkStreaks(trackKey) {
  try {
    localStorage.removeItem(storageKey(trackKey));
  } catch {}
}
