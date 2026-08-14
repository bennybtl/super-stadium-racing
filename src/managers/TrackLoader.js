import { zipSync, strToU8 } from 'fflate';
import { Track } from '../track.js';
import {
  getImageBlob, getImageUrl, getTrackJson, hasTrackJson, openTrackStore,
  removeTrackJson, setTrackJson, storedTrackKeys,
} from './TrackStore.js';
// Shipped tracks are bundled straight out of /src/tracks/ — dropping a
// `<name>.json` (plus optional `<name>.jpg` preview) in that folder surfaces it
// in-game without editing source. User-authored tracks come in separately
// through the track-pack importer in settings and live in TrackStore.
const TRACK_MODULES = import.meta.glob('/src/tracks/*.json', { query: '?raw', import: 'default' });
// Eager so preview images resolve to their hashed build URL synchronously.
const TRACK_IMAGE_URLS = import.meta.glob('/src/tracks/*.{png,jpg,jpeg}', { query: '?url', import: 'default', eager: true });

const TRACK_FILENAMES = Object.keys(TRACK_MODULES).map(path => path.split('/').pop()).sort();

/**
 * Bundled URL for a shipped track's preview image, or null when the track has
 * no image or it isn't a shipped one (imported tracks resolve through
 * TrackStore's getImageUrl instead).
 */
export function trackImageUrl(image) {
  if (!image) return null;
  return TRACK_IMAGE_URLS[`/src/tracks/${image}`] ?? null;
}

/**
 * TrackLoader - Loads tracks from JSON files
 */
export class TrackLoader {
  constructor() {
    this.tracks = new Map();
    this.trackList = [];
    this.builtinKeys = new Set();
  }

  /**
   * Load a track from a JSON file
   */
  async loadTrack(filename) {
    try {
      const load = TRACK_MODULES[`/src/tracks/${filename}`];
      if (!load) {
        throw new Error(`No bundled track named ${filename}`);
      }
      const jsonString = await load();
      const track = Track.fromJSON(jsonString);
      
      // Store with filename (without .json extension) as key
      const key = filename.replace('.json', '');
      this.tracks.set(key, track);
      this.builtinKeys.add(key);

      if (!this.trackList.includes(key)) {
        this.trackList.push(key);
      }
      
      return track;
    } catch (error) {
      console.error(`[TrackLoader] Error loading track ${filename}:`, error);
      return null;
    }
  }

  /**
   * Load all tracks from the tracks directory
   */
  async loadAllTracks() {
    // Hydrate saved tracks/images into memory first so every synchronous
    // accessor below (and in the Vue layer) can read them without awaiting.
    await openTrackStore();

    const loadPromises = TRACK_FILENAMES.map(async (filename) => {
      await this.loadTrack(filename);
    });

    await Promise.all(loadPromises);
    // Surface tracks that only exist in storage (created/saved in the
    // editor after this build) — they aren't in the file manifest.
    this.loadStorageTracks();
    this.trackList.sort((a, b) => a.localeCompare(b));
    // Warm the browser cache with track preview images so the selection
    // carousel shows them instantly instead of streaming in on first open.
    this.preloadTrackImages();
    return this.tracks;
  }

  /**
   * Load every saved track out of TrackStore. This picks up user-created
   * tracks that didn't exist at build time (and refreshes edited copies of
   * built-in tracks). Invalid entries are skipped.
   */
  loadStorageTracks() {
    for (const key of storedTrackKeys()) {
      try {
        this.loadTrackFromStorage(key);
      } catch (error) {
        console.warn(`[TrackLoader] Skipping invalid saved track "${key}":`, error);
      }
    }
  }

  /**
   * Kick off background fetches for every shipped track's preview image.
   * Fire-and-forget: the browser caches each one, so the <img> tags in the
   * track-selection carousel render from cache rather than loading visibly
   * when it first appears. Locally stored images resolve to an
   * already-hydrated object URL and need no warming.
   */
  preloadTrackImages() {
    if (typeof Image === 'undefined') return; // guard non-browser contexts
    const seen = new Set();
    for (const track of this.tracks.values()) {
      const image = track?.image;
      if (!image || seen.has(image)) continue;
      seen.add(image);
      const src = getImageUrl(image) ?? trackImageUrl(image);
      if (!src) continue;
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    }
  }

  /**
   * Get a track by key
   */
  getTrack(key) {
    // First check if there's a saved version
    const savedTrack = this.loadTrackFromStorage(key);
    if (savedTrack) {
      console.debug(`[TrackLoader] Loaded saved track ${key} with ${savedTrack.features.length} features`);
      return savedTrack;
    }

    // Otherwise return the default track
    console.debug(`[TrackLoader] No saved version found for ${key}, using default`);
    return this.tracks.get(key);
  }

  /**
   * Get list of all track keys
   */
  getTrackList() {
    return [...this.trackList];
  }

  /**
   * Save a track to persistent storage (for browser-based editing)
   */
  saveTrackToStorage(key, track) {
    setTrackJson(key, track.toJSON());
    // Register the key in-memory too. Storage alone isn't enough: the menu
    // carousel is built from `trackList`, which is otherwise only populated at
    // boot (loadStorageTracks), so a track saved under a key this session —
    // a brand-new track, or one whose id was just renamed — stayed invisible
    // until a reload.
    this.tracks.set(key, track);
    if (!this.trackList.includes(key)) {
      this.trackList.push(key);
      this.trackList.sort((a, b) => a.localeCompare(b));
    }
  }

  /**
   * Load a track from persistent storage
   */
  loadTrackFromStorage(key) {
    const json = getTrackJson(key);
    if (json) {
      const track = Track.fromJSON(json);
      this.tracks.set(key, track);
      if (!this.trackList.includes(key)) {
        this.trackList.push(key);
      }
      return track;
    }
    return null;
  }

  /**
   * Remove a user-saved track. Built-in tracks cannot be removed.
   * Returns true if the track was removed.
   */
  removeTrack(key) {
    if (this.builtinKeys.has(key)) return false;
    removeTrackJson(key);
    this.tracks.delete(key);
    const idx = this.trackList.indexOf(key);
    if (idx !== -1) this.trackList.splice(idx, 1);
    return true;
  }

  /**
   * True if a saved copy exists for this key. Built-in tracks pick one up when
   * edited & saved in the editor; pack/editor tracks always have one (that's
   * how they persist).
   */
  hasStoredTrack(key) {
    return hasTrackJson(key);
  }

  /**
   * Discard the saved edits for a built-in track, restoring the shipped
   * default. Returns true if an override was cleared.
   */
  async revertTrack(key) {
    if (!this.builtinKeys.has(key)) return false;
    if (!this.hasStoredTrack(key)) return false;
    removeTrackJson(key);
    // The edit overwrote the in-memory copy, so reload the shipped default.
    await this.loadTrack(`${key}.json`);
    return true;
  }

  /**
   * Download a track as a zip track-pack (`<id>.json` + its preview image),
   * i.e. exactly the format loadTrackPack() imports, so a downloaded track
   * round-trips back into another browser with its image intact.
   */
  async downloadTrack(track) {
    const data = JSON.parse(track.toJSON());
    const files = {};

    const image = await this._loadTrackImageBytes(track.image);
    if (image) {
      // Name the packed image after its actual encoding and point the track
      // JSON at it, so the importer stores and looks it up under one key.
      data.image = `${track.id}.${image.ext}`;
      files[data.image] = image.bytes;
    }
    files[`${track.id}.json`] = strToU8(JSON.stringify(data, null, 2));

    const blob = new Blob([zipSync(files)], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${track.id}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Raw bytes for a track's preview image, preferring the locally stored copy
   * (editor screenshots / pack imports) and falling back to the shipped image
   * bundled from src/tracks. Returns { bytes, ext } or null.
   */
  async _loadTrackImageBytes(image) {
    if (!image) return null;

    const stored = getImageBlob(image);
    if (stored) {
      return {
        bytes: new Uint8Array(await stored.arrayBuffer()),
        ext: stored.type === 'image/png' ? 'png' : 'jpg',
      };
    }

    const url = trackImageUrl(image);
    if (!url) return null;

    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      // Read the extension off the resolved URL, not the source filename: the
      // dist optimizer re-encodes bundled images (png → jpg/webp), so the two
      // can disagree and the zip should be named after what we actually got.
      const ext = url.toLowerCase().match(/\.(png|jpe?g|webp)(?:\?|$)/)?.[1] ?? 'jpg';
      return { bytes: new Uint8Array(await res.arrayBuffer()), ext: ext === 'jpeg' ? 'jpg' : ext };
    } catch {
      return null;
    }
  }
}
