import { zipSync, strToU8 } from 'fflate';
import { Track } from '../track.js';
import {
  getImageBlob, getImageUrl, getTrackJson, hasTrackJson, openTrackStore,
  removeTrackJson, setTrackJson, storedTrackKeys,
} from './TrackStore.js';
// Track filenames are scanned from public/tracks/ at build time (and re-scanned
// on add/remove during dev) by the track-manifest Vite plugin — see
// vite.config.js. Dropping a new .json there surfaces it without editing source.
import TRACK_FILENAMES from 'virtual:track-manifest';

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
      const response = await fetch(`${import.meta.env.BASE_URL}tracks/${filename}`);
      if (!response.ok) {
        throw new Error(`Failed to load track: ${response.statusText}`);
      }
      const jsonString = await response.text();
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
   * Kick off background fetches for every track's preview image that still
   * lives in public/tracks. Fire-and-forget: the browser caches each one, so
   * the <img> tags in the track-selection carousel render from cache rather
   * than loading visibly when it first appears. Locally stored images resolve
   * to an already-hydrated object URL and need no warming.
   */
  preloadTrackImages() {
    if (typeof Image === 'undefined') return; // guard non-browser contexts
    const base = import.meta.env.BASE_URL;
    const seen = new Set();
    for (const track of this.tracks.values()) {
      const image = track?.image;
      if (!image || seen.has(image)) continue;
      seen.add(image);
      const img = new Image();
      img.decoding = 'async';
      img.src = getImageUrl(image) ?? `${base}tracks/${image}`;
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
   * (editor screenshots / pack imports) and falling back to the shipped file
   * in public/tracks. Returns { bytes, ext } or null.
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

    try {
      const res = await fetch(`${import.meta.env.BASE_URL}tracks/${image}`);
      if (!res.ok) return null;
      const ext = image.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
      return { bytes: new Uint8Array(await res.arrayBuffer()), ext };
    } catch {
      return null;
    }
  }
}
