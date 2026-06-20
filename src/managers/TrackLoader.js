import { Track } from '../track.js';
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
    const loadPromises = TRACK_FILENAMES.map(async (filename) => {
      await this.loadTrack(filename);
    });

    await Promise.all(loadPromises);
    this.trackList.sort((a, b) => a.localeCompare(b));
    // Warm the browser cache with track preview images so the selection
    // carousel shows them instantly instead of streaming in on first open.
    this.preloadTrackImages();
    return this.tracks;
  }

  /**
   * Kick off background fetches for every track's preview image. Fire-and-forget:
   * the browser caches each one, so the <img> tags in the track-selection
   * carousel render from cache rather than loading visibly when it first appears.
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
      img.src = `${base}tracks/${image}`;
    }
  }

  /**
   * Get a track by key
   */
  getTrack(key) {
    // First check if there's a saved version in localStorage
    const savedTrack = this.loadTrackFromStorage(key);
    if (savedTrack) {
      console.log(`[TrackLoader] Loaded track ${key} from localStorage with ${savedTrack.features.length} features`);
      return savedTrack;
    }
    
    // Otherwise return the default track
    console.log(`[TrackLoader] No localStorage version found for ${key}, using default`);
    return this.tracks.get(key);
  }

  /**
   * Get list of all track keys
   */
  getTrackList() {
    return [...this.trackList];
  }

  /**
   * Save a track to local storage (for browser-based editing)
   */
  saveTrackToStorage(key, track) {
    const json = track.toJSON();
    localStorage.setItem(`track_${key}`, json);
  }

  /**
   * Load a track from local storage
   */
  loadTrackFromStorage(key) {
    const json = localStorage.getItem(`track_${key}`);
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
   * Download track as JSON file
   */
  downloadTrack(track) {
    const json = track.toJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${track.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
