// IndexedDB key-value store for disposable, regenerable data (tire marks).
// Kept apart from the 'offroad-tracks' database that holds user tracks, so
// cache schema changes never touch it, and out of localStorage, whose ~5 MB
// quota this data used to fill.
//
// Best effort throughout: if IndexedDB is unavailable or a request fails,
// reads resolve to undefined and writes do nothing (with a warning); callers
// treat that as "nothing saved".

const DB_NAME = "offroad-cache";
const DB_VERSION = 1;
export const TIRE_MARKS_STORE = "tireMarks";

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TIRE_MARKS_STORE)) db.createObjectStore(TIRE_MARKS_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn("[CacheStore] IndexedDB unavailable:", req.error);
        resolve(null);
      };
      req.onblocked = () => {
        console.warn("[CacheStore] open blocked by another tab");
        resolve(null);
      };
    });
  }
  return dbPromise;
}

async function run(store, mode, action) {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** The value under `key`, or undefined (missing, or IndexedDB unavailable). */
export async function cacheGet(store, key) {
  try {
    return await run(store, "readonly", (s) => s.get(key));
  } catch (e) {
    console.warn(`[CacheStore] read ${store}/${key} failed:`, e);
    return undefined;
  }
}

export async function cachePut(store, key, value) {
  try {
    await run(store, "readwrite", (s) => s.put(value, key));
  } catch (e) {
    console.warn(`[CacheStore] write ${store}/${key} failed:`, e);
  }
}

export async function cacheDelete(store, key) {
  try {
    await run(store, "readwrite", (s) => s.delete(key));
  } catch (e) {
    console.warn(`[CacheStore] delete ${store}/${key} failed:`, e);
  }
}
