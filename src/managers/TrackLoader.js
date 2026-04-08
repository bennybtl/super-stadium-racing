import { Track } from '../track.js';

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
      const response = await fetch(`/tracks/${filename}`);
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
      
      console.log(`[TrackLoader] Loaded track: ${track.name} (${key})`);
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
    const modules = import.meta.glob('/tracks/*.json', { query: '?raw', import: 'default' });

    const loadPromises = Object.entries(modules).map(async ([path, load]) => {
      try {
        const rawJson = await load();
        const filename = path.split('/').pop();
        const key = filename.replace('.json', '');
        const track = Track.fromJSON(rawJson);
        this.tracks.set(key, track);
        if (!this.trackList.includes(key)) this.trackList.push(key);
        console.log(`[TrackLoader] Loaded track: ${track.name} (${key})`);
      } catch (error) {
        console.error(`[TrackLoader] Error loading track ${path}:`, error);
      }
    });

    await Promise.all(loadPromises);
    this.trackList.sort((a, b) => a.localeCompare(b));
    console.log(`[TrackLoader] Loaded ${this.tracks.size} tracks`);
    return this.tracks;
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
    console.log(`[TrackLoader] Saved track ${key} to local storage`);
  }

  /**
   * Load a track from local storage
   */
  loadTrackFromStorage(key) {
    const json = localStorage.getItem(`track_${key}`);
    if (json) {
      console.log(`[TrackLoader] Found saved track in localStorage for ${key}`);
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
    a.download = `${track.name.replace(/\s+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`[TrackLoader] Downloaded track: ${track.name}`);
  }
}
