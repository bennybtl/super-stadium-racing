import { TIRE_MARKS_STORAGE_PREFIX } from "../managers/TireMarksStorage.js";
import { WALL_WEAR_STORAGE_PREFIX } from "../managers/WallWearStorage.js";

// Cosmetic data that regrows as you drive, dropped (in this order) to make room
// when localStorage is full. Tire marks can grow to fill the whole ~5 MB quota
// across tracks; after that, every other write threw QuotaExceededError.
const EVICTABLE_PREFIXES = [TIRE_MARKS_STORAGE_PREFIX, WALL_WEAR_STORAGE_PREFIX];

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
