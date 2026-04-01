import { useMenuStore } from '../vue/store.js';

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
    this.selectedTrack = null;
    this.selectedLaps  = 3;

    // Connect to Pinia store (Pinia is active because vue/main.js runs first)
    this._store = useMenuStore();
    this._store.setBridge(this);
  }

  // ── Public navigation (called by modes) ──────────────────────────────────

  showStartMenu() {
    this.currentMenu = 'start';
    this._store.screen = 'start';
  }

  showTrackSelectMenu() {
    this.currentMenu = 'trackSelect';
    this._refreshTrackList();
    this._store.screen = 'trackSelect';
  }

  showLapSelectMenu() {
    this.currentMenu = 'lapSelect';
    this._store.screen = 'lapSelect';
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

  showPauseMenu() {
    this.currentMenu = 'pause';
    this.isPaused = true;
    this._store.screen   = 'pause';
    this._store.isPaused = true;
  }

  hideMenu() {
    this.currentMenu = null;
    this.isPaused    = false;
    this._store.screen   = null;
    this._store.isPaused = false;
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
  onSettings()     { console.log('[MenuManager] Settings not implemented'); }
  onResume()       { this.hideMenu(); }
  onReset()        {}
  onExit()         { this.gameStarted = false; this.showStartMenu(); }
  onStartEditor()  { this.editorMode = true; this.hideMenu(); }
  onEditorResume() { this.hideMenu(); }
  onEditorSave()   {}
  onEditorLoad()   { this.showEditorTrackSelect(); }
  onEditorExit()   { this.editorMode = false; this.gameStarted = false; this.showStartMenu(); }

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
}
