/**
 * TrackStore - IndexedDB persistence for user tracks and their preview images,
 * fronted by a synchronous in-memory mirror.
 *
 * Tracks outgrew localStorage's ~5MB quota: JSON is charged at 2 bytes/char
 * (localStorage strings are UTF-16) and images had to be base64 data-URLs, so
 * one track cost ~70KB of quota — a ceiling of roughly 70 tracks. IndexedDB
 * keeps images as Blobs (raw bytes, no base64 inflation) and raises the limit
 * to a share of free disk.
 *
 * IndexedDB is async but almost every caller here is synchronous (Vue computeds,
 * TrackLoader accessors), so openTrackStore() hydrates everything into memory
 * once at startup and all reads are served from the maps below. Writes update
 * the mirror synchronously and persist in the background.
 *
 * Everything else — settings, lap records, championship, upgrades — stays in
 * localStorage; those are small and fine where they are.
 */

const DB_NAME = 'offroad-tracks';
const DB_VERSION = 1;
const TRACKS = 'tracks';
const IMAGES = 'images';

const LS_TRACK_PREFIX = 'track_';
const LS_IMAGE_PREFIX = 'trackImage_';

let db = null;

// Synchronous mirrors of the two object stores.
const trackJson = new Map();   // track key   -> JSON string
const imageBlobs = new Map();  // image name  -> Blob
const imageUrls = new Map();   // image name  -> object URL (for <img src>)

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Open the database, migrate any legacy localStorage entries, and hydrate the
 * in-memory mirror. Safe to call more than once. If IndexedDB is unavailable
 * we fall back to reading track JSON out of localStorage so user tracks are
 * never silently lost; images are skipped there (they're regenerable).
 */
export async function openTrackStore() {
  if (db) return;
  try {
    db = await openDb();
  } catch (e) {
    console.warn('[TrackStore] IndexedDB unavailable — falling back to localStorage:', e);
    hydrateFromLocalStorage();
    return;
  }
  await migrateFromLocalStorage();
  await hydrate();
}

/** Track keys that have a saved copy. */
export function storedTrackKeys() {
  return [...trackJson.keys()];
}

/** Saved track JSON string, or null. */
export function getTrackJson(key) {
  return trackJson.get(key) ?? null;
}

export function hasTrackJson(key) {
  return trackJson.has(key);
}

export function setTrackJson(key, json) {
  trackJson.set(key, json);
  if (!db) {
    try { localStorage.setItem(LS_TRACK_PREFIX + key, json); } catch (e) {
      console.warn(`[TrackStore] Failed to save track ${key}:`, e);
    }
    return;
  }
  persist(() => put(TRACKS, key, json), `save track ${key}`);
}

export function removeTrackJson(key) {
  trackJson.delete(key);
  if (!db) {
    try { localStorage.removeItem(LS_TRACK_PREFIX + key); } catch {}
    return;
  }
  persist(() => del(TRACKS, key), `remove track ${key}`);
}

/**
 * A URL for a stored preview image, usable directly as an <img> src, or null
 * if this image isn't stored locally (callers fall back to the image bundled from src/tracks/).
 */
export function getImageUrl(filename) {
  return imageUrls.get(filename) ?? null;
}

/** The raw Blob for a stored preview image, or null. Used when packing zips. */
export function getImageBlob(filename) {
  return imageBlobs.get(filename) ?? null;
}

export function setImage(filename, blob) {
  revokeUrl(filename);
  imageBlobs.set(filename, blob);
  imageUrls.set(filename, URL.createObjectURL(blob));
  persist(() => put(IMAGES, filename, blob), `save image ${filename}`);
}

export function removeImage(filename) {
  if (!filename) return;
  revokeUrl(filename);
  imageBlobs.delete(filename);
  persist(() => del(IMAGES, filename), `remove image ${filename}`);
}

// ─── Internals ─────────────────────────────────────────────────────────────

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB is not defined'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(TRACKS)) d.createObjectStore(TRACKS);
      if (!d.objectStoreNames.contains(IMAGES)) d.createObjectStore(IMAGES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('open blocked by another tab'));
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function put(store, key, value) {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  return txDone(tx);
}

function del(store, key) {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return txDone(tx);
}

async function readAll(store) {
  const tx = db.transaction(store, 'readonly');
  const os = tx.objectStore(store);
  const [keys, values] = await Promise.all([request(os.getAllKeys()), request(os.getAll())]);
  return keys.map((key, i) => [key, values[i]]);
}

/** Writes are fire-and-forget: the mirror is already updated, so a failed
 *  write costs persistence, not correctness of the running session. */
function persist(run, label) {
  if (!db) return;
  try {
    run().catch(e => console.warn(`[TrackStore] Failed to ${label}:`, e));
  } catch (e) {
    console.warn(`[TrackStore] Failed to ${label}:`, e);
  }
}

async function hydrate() {
  for (const [key, json] of await readAll(TRACKS)) {
    if (typeof json === 'string') trackJson.set(key, json);
  }
  for (const [name, blob] of await readAll(IMAGES)) {
    if (blob instanceof Blob) {
      imageBlobs.set(name, blob);
      imageUrls.set(name, URL.createObjectURL(blob));
    }
  }
}

/**
 * One-time move of `track_*` / `trackImage_*` out of localStorage. Entries are
 * only dropped from localStorage once the IndexedDB write has committed, so an
 * interrupted migration retries on the next load rather than losing tracks.
 */
async function migrateFromLocalStorage() {
  if (typeof localStorage === 'undefined') return;

  const trackKeys = [];
  const imageKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith(LS_TRACK_PREFIX)) trackKeys.push(k);
    else if (k.startsWith(LS_IMAGE_PREFIX)) imageKeys.push(k);
  }
  if (trackKeys.length === 0 && imageKeys.length === 0) return;

  for (const k of trackKeys) {
    try {
      await put(TRACKS, k.slice(LS_TRACK_PREFIX.length), localStorage.getItem(k));
      localStorage.removeItem(k);
    } catch (e) {
      console.warn(`[TrackStore] Migration failed for ${k}:`, e);
    }
  }
  for (const k of imageKeys) {
    try {
      const blob = dataUrlToBlob(localStorage.getItem(k));
      if (blob) await put(IMAGES, k.slice(LS_IMAGE_PREFIX.length), blob);
      localStorage.removeItem(k);
    } catch (e) {
      console.warn(`[TrackStore] Migration failed for ${k}:`, e);
    }
  }
  console.debug(`[TrackStore] Migrated ${trackKeys.length} track(s) and ${imageKeys.length} image(s) to IndexedDB`);
}

/** Degraded path: IndexedDB unavailable, so serve whatever localStorage holds. */
function hydrateFromLocalStorage() {
  if (typeof localStorage === 'undefined') return;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(LS_TRACK_PREFIX)) {
      trackJson.set(k.slice(LS_TRACK_PREFIX.length), localStorage.getItem(k));
    }
  }
}

function revokeUrl(filename) {
  const url = imageUrls.get(filename);
  if (url) URL.revokeObjectURL(url);
  imageUrls.delete(filename);
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl?.startsWith('data:')) return null;
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
