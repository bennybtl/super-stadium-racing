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
    const trackFiles = [
      'simple.json',
      'crossroads.json',
      'rollercoaster.json',
      'hills.json',
      'mudPit.json',
      'bankedTurn.json'
    ];

    const loadPromises = trackFiles.map(file => this.loadTrack(file));
    await Promise.all(loadPromises);
    
    console.log(`[TrackLoader] Loaded ${this.tracks.size} tracks`);
    return this.tracks;
  }

  /**
   * Get a track by key
   */
  getTrack(key) {
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
