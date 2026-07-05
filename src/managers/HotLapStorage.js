// Persistent per-track hot-lap leaderboard.
//
// Each track keeps its top N laps (fastest first). A record bundles the ghost
// trace plus the setup that drove it — truck type and upgrades — so an entry is
// self-describing (the leaderboard may mix vehicles) and its ghost can be
// rebuilt to look like the truck that set it.

const STORAGE_PREFIX = "hotlap_laps_";
// Reverse laps are a distinct challenge, so they get their own leaderboard.
// Forward keys stay bare (backward compatible); reverse keys carry this suffix.
const REVERSE_SUFFIX = "::rev";
export const HOT_LAP_SCHEMA_VERSION = 3;
export const MAX_HOT_LAP_RECORDS = 5;

function storageKey(trackKey, reverse = false) {
  return STORAGE_PREFIX + trackKey + (reverse ? REVERSE_SUFFIX : '');
}

function isValidRecord(r) {
  return r
    && typeof r.lapTimeMs === 'number'
    && Array.isArray(r.frames) && r.frames.length > 0
    && typeof r.frames[0].t === 'number';
}

/** Load a track's records, fastest first. Returns [] if none/invalid. */
export function loadHotLapRecords(trackKey, reverse = false) {
  try {
    const raw = localStorage.getItem(storageKey(trackKey, reverse));
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data?.version !== HOT_LAP_SCHEMA_VERSION || !Array.isArray(data.records)) return [];
    return data.records
      .filter(isValidRecord)
      .sort((a, b) => a.lapTimeMs - b.lapTimeMs)
      .slice(0, MAX_HOT_LAP_RECORDS);
  } catch {
    return [];
  }
}

/**
 * Insert `record` into a fastest-first list, capped at MAX_HOT_LAP_RECORDS.
 * Returns { records, rank } where rank is the 0-based finishing position, or
 * -1 if the lap didn't make the cut (list unchanged).
 */
export function insertHotLapRecord(records, record) {
  const merged = [...records, record].sort((a, b) => a.lapTimeMs - b.lapTimeMs);
  const capped = merged.slice(0, MAX_HOT_LAP_RECORDS);
  const rank = capped.indexOf(record);
  return { records: rank === -1 ? records : capped, rank };
}

/** Every leaderboard saved: [{ trackKey, reverse, records }], one per direction. */
export function listHotLapTracks() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    let rest = key.slice(STORAGE_PREFIX.length);
    const reverse = rest.endsWith(REVERSE_SUFFIX);
    if (reverse) rest = rest.slice(0, -REVERSE_SUFFIX.length);
    const trackKey = rest;
    const records = loadHotLapRecords(trackKey, reverse);
    if (records.length > 0) out.push({ trackKey, reverse, records });
  }
  return out;
}

/** Delete all saved records for a track+direction. */
export function deleteHotLapRecords(trackKey, reverse = false) {
  localStorage.removeItem(storageKey(trackKey, reverse));
}

/**
 * Persist a track's records. Deferred off the caller's frame so the stringify
 * never hitches gameplay; retries once at half frame-resolution on quota error.
 */
export function saveHotLapRecords(trackKey, records, reverse = false) {
  const payload = { version: HOT_LAP_SCHEMA_VERSION, records };
  setTimeout(() => {
    const key = storageKey(trackKey, reverse);
    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      try {
        const trimmed = {
          ...payload,
          records: records.map(r => ({ ...r, frames: r.frames.filter((_, i) => i % 2 === 0) })),
        };
        localStorage.setItem(key, JSON.stringify(trimmed));
        console.warn('[HotLap] Records too large; saved at reduced resolution.');
      } catch (e) {
        console.warn('[HotLap] Failed to persist hot-lap records:', e?.name ?? e);
      }
    }
  }, 0);
}
