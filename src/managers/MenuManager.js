import { useMenuStore } from '../vue/store.js';
import { SEASON_TRACKS } from './SeasonManager.js';

/**
 * MenuManager – thin bridge between game logic (ModeController / modes) and
 * the Vue UI layer (MenuOverlay.vue via Pinia).
 *
 * All rendering is delegated to Vue; this class owns state transitions and
 * exposes overrideable callbacks for modes to hook into.
 */
export class MenuManager {
  constructor() {
    // Game-logic state (plain JS — not reactive)
    this.currentMenu = 'start';
    this.gameStarted = false;
    this.isPaused    = false;
    this.editorMode  = false;

    // Set by Vue store actions before calling the callbacks below
    this.selectedTrack   = null;
    this.selectedLaps    = 3;
    this.selectedVehicle = 'default_truck';
    this.selectedPlayerColor = null;

    // Connect to Pinia store (Pinia is active because vue/main.js runs first)
    this._store = useMenuStore();
    this._store.setBridge(this);
    this._store.selectedTrack = this.selectedTrack;
    this._store.selectedLaps = this.selectedLaps;
    this._store.selectedVehicle = this.selectedVehicle;
  }

  // ── Public navigation (called by modes) ──────────────────────────────────

  showStartMenu() {
    this.currentMenu = 'start';
    this._store.postRaceData = null;
    this._store.pitData = null;
    this._store.seasonFinalData = null;
    this._store.screen = 'start';
  }

  showEditorTrackSelect() {
    this.currentMenu = 'editorTrackSelect';
    this._refreshTrackList();
    this._store.screen = 'editorTrackSelect';
  }

  showEditorMenu() {
    this.currentMenu = 'editorPause';
    this.isPaused = true;
    this._store.screen   = 'editorPause';
    this._store.isPaused = true;
  }

  showPitMenu(mode = 'singleRace') {
    this._refreshTrackList();
    this._refreshVehicleList();
    if (!this.selectedLaps) {
      this.selectedLaps = 3;
    }
    this._store.selectedLaps = this.selectedLaps;

    const isSeasonStart = mode === 'season';
    const nextTrackKey = isSeasonStart
      ? SEASON_TRACKS[0].replace('.json', '')
      : this.selectedTrack;
    const nextTrackName = isSeasonStart
      ? window.trackLoader?.getTrack(nextTrackKey)?.name ?? nextTrackKey
      : this._store.trackList.find(t => t.key === this.selectedTrack)?.name ?? this.selectedTrack;

    if (!isSeasonStart && !this.selectedTrack && this._store.trackList.length > 0) {
      this.selectedTrack = this._store.trackList[0]?.key ?? null;
      this._store.selectedTrack = this.selectedTrack;
    }

    this.currentMenu = 'pit';
    this._store.postRaceData = null;
    this._store.pitData = {
      pitMode:          isSeasonStart ? 'seasonStart' : mode,
      raceNumber:       1,
      totalRaces:       isSeasonStart ? SEASON_TRACKS.length : 1,
      nextTrackKey,
      trackName:        nextTrackName,
      laps:             this.selectedLaps,
      isSeason:         isSeasonStart,
      isSeasonComplete: false,
      standings:        [],
      playerBalance:    0,
      upgrades:         [],
      selectedColorKey: this.selectedPlayerColor,
    };
    this._store.seasonFinalData = null;
    this._store.screen = null;
  }

  setSelectedVehicle(key) {
    this.selectedVehicle = key;
    this._store.selectedVehicle = key;
  }

  setSelectedTrack(key) {
    this.selectedTrack = key;
    this._store.selectedTrack = key;
    if (this._store.pitData) {
      this._store.pitData.trackName = this._store.trackList.find(t => t.key === key)?.name ?? key;
      this._store.pitData.nextTrackKey = key;
    }
  }

  setSelectedLaps(laps) {
    this.selectedLaps = laps;
    this._store.selectedLaps = laps;
    if (this._store.pitData) {
      this._store.pitData.laps = laps;
    }
  }

  showSettingsMenu() {
    this.currentMenu = 'settings';
    this._store.screen = 'settings';
  }

  showPauseMenu() {
    this.currentMenu = 'pause';
    this.isPaused = true;
    this._store.screen   = 'pause';
    this._store.isPaused = true;
  }

  showPostRace(data) {
    this.currentMenu = 'postRace';
    this._store.postRaceData = data;
    this._store.pitData = null;
    this._store.seasonFinalData = null;
    this._store.screen = null; // hide MenuOverlay; PostRaceOverlay gates on postRaceData
  }

  showSingleRaceResults(data) {
    this.currentMenu = 'singleRaceResults';
    this._store.singleRaceData = data;
    this._store.screen = null; // hide MenuOverlay; SingleRaceOverlay gates on singleRaceData
  }

  showPit(data) {
    this._refreshVehicleList();
    this.currentMenu = 'pit';
    this._store.postRaceData = null;
    this._store.pitData = {
      pitMode:          data.pitMode ?? (data.isSeason ? 'season' : 'singleRace'),
      ...data,
      selectedColorKey: this.selectedPlayerColor,
      selectedVehicleKey: this.selectedVehicle,
    };
    this._store.seasonFinalData = null;
    this._store.screen = null;
  }

  showSeasonFinal(data) {
    this.currentMenu = 'seasonFinal';
    this._store.postRaceData = null;
    this._store.pitData = null;
    this._store.seasonFinalData = data;
    this._store.screen = null;
  }

  hideMenu() {
    this.currentMenu = null;
    this.isPaused    = false;
    this._store.screen   = null;
    this._store.isPaused = false;
  }

  showLoading(message = 'Loading…') {
    this._store.setLoading(true, message);
  }

  hideLoading() {
    this._store.setLoading(false);
  }

  togglePause() {
    if (this.editorMode) {
      if (this.isPaused) this.onEditorResume();
      else               this.showEditorMenu();
    } else if (this.gameStarted && this.currentMenu !== 'start') {
      if (this.isPaused) this.onResume();
      else               this.showPauseMenu();
    }
  }

  // ── Overrideable callbacks (assigned by modes) ────────────────────────────

  onStartGame()    { this.gameStarted = true; this.hideMenu(); }
  onStartPractice() { this.gameStarted = true; this.hideMenu(); }
  onSettings()     { this.showSettingsMenu(); }
  onResume()       { this.hideMenu(); }
  onReset()        {}
  onExit()         { this.gameStarted = false; this.showStartMenu(); }
  onStartEditor()  { this.editorMode = true; this.hideMenu(); }
  onEditorResume() { this.hideMenu(); }
  onEditorSave()   {}
  onEditorLoad()   { this.showEditorTrackSelect(); }
  onEditorExit()   { this.editorMode = false; this.gameStarted = false; this.showStartMenu(); }

  // Season callbacks — overridden by MenuMode
  setSelectedPlayerColor(colorKey) {
    this.selectedPlayerColor = colorKey;
    if (this._store?.pitData) {
      this._store.pitData.selectedColorKey = colorKey;
    }
  }

  onSeasonStart(_laps) {}
  onContinueSeason()   {}
  onRetireFromSeason() {}
  onGoToPit()          {}
  onStartSingleRace()  {}

  // ── Query helpers (used by InputManager etc.) ─────────────────────────────

  isMenuActive() { return this.currentMenu !== null; }
  isGamePaused() { return this.isPaused; }

  // ── Internal ──────────────────────────────────────────────────────────────

  _refreshTrackList() {
    if (!window.trackLoader) return;
    this._store.trackList = window.trackLoader.getTrackList().map(key => {
      const track = window.trackLoader.getTrack(key);
      return { key, name: track?.name ?? key };
    });
  }

  _refreshVehicleList() {
    if (!window.vehicleLoader) return;
    this._store.vehicleList = window.vehicleLoader.getVehicleList();
  }
}
