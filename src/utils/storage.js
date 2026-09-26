import { WALL_WEAR_STORAGE_PREFIX } from "../managers/WallWearStorage.js";

// Data that's safe to drop (in this order) to make room when localStorage is
// full: tire marks saved there before they moved to IndexedDB (they could fill
// the whole ~5 MB quota, after which every other write threw
// QuotaExceededError), then wall wear, which regrows as you drive.
const LEGACY_TIRE_MARKS_PREFIX = "tireMarks_";
const EVICTABLE_PREFIXES = [LEGACY_TIRE_MARKS_PREFIX, WALL_WEAR_STORAGE_PREFIX];

const isQuotaError = (e) => e?.name === "QuotaExceededError";

/**
 * localStorage.setItem for data that must persist (upgrades, championship,
 * hot-lap records, settings). On a full quota, clears cosmetic data and
 * retries; still throws if even that doesn't make room.
 */
export function setItemEvictingCosmetics(key, value) {
  try {
    localStorage.setItem(key, value);
    return;
  } catch (e) {
    if (!isQuotaError(e)) throw e;
  }
  for (const prefix of EVICTABLE_PREFIXES) {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(prefix)) localStorage.removeItem(k);
    }
    try {
      localStorage.setItem(key, value);
      console.warn(`[storage] localStorage was full; cleared ${prefix}* to save ${key}.`);
      return;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
    }
  }
  localStorage.setItem(key, value);
}
