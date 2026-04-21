import { MenuMode } from "./MenuMode.js";
import { RaceMode } from "./RaceMode.js";
import { EditorMode } from "./EditorMode.js";
import { TestMode } from "./TestMode.js";
import { PracticeMode } from "./PracticeMode.js";
import { SeasonManager } from "../managers/SeasonManager.js";

/**
 * Owns the engine render loop and coordinates transitions between
 * MenuMode, RaceMode and EditorMode.
 *
 * Each mode receives a reference to this controller so it can trigger
 * transitions without importing any sibling mode directly.
 */
export class ModeController {
  constructor(engine, menuManager, trackLoader) {
    this.engine = engine;
    this.menuManager = menuManager;
    this.trackLoader = trackLoader;
    this.currentMode = null;
    this.seasonManager = null;
  }

  /**
   * Tear down the current mode, stop the render loop, instantiate the next
   * mode and start rendering its scene (if it returns one).
   */
  async switchTo(ModeClass, config = {}) {
    const modeName = ModeClass?.name ?? 'Mode';
    const loadingLabel = modeName.replace(/Mode$/, '') || 'Scene';
    this.menuManager.showLoading(`Loading ${loadingLabel}…`);

    if (this.currentMode) {
      this.currentMode.teardown();
      this.currentMode = null;
    }

    this.engine.stopRenderLoop();

    const mode = new ModeClass(this);
    this.currentMode = mode;

    try {
      const scene = await mode.setup(config);

      if (scene) {
        this.engine.runRenderLoop(() => scene.render());
      }
    } finally {
      this.menuManager.hideLoading();
    }
  }

  goToMenu() {
    return this.switchTo(MenuMode);
  }

  /** Called by any mode when the user chooses to exit back to the main menu. */
  exit() {
    if (this.seasonManager) this.seasonManager.save();
    return this.goToMenu();
  }

  // ── Season ────────────────────────────────────────────────────────────────

  /** Start a brand-new season. Creates a SeasonManager and launches race 1. */
  startSeason(lapsPerRace) {
    this.seasonManager = new SeasonManager();
    this.seasonManager.start(lapsPerRace);
    return this.showSeasonPit();
  }

  /**
   * Advance to the next race in the season (called from Pit screen).
   * If the season is already complete, shows the final standings.
   */
  continueSeason() {
    if (!this.seasonManager) return this.goToMenu();
    this.menuManager._store.pitData = null;
    this.menuManager.hideMenu(); // clear currentMenu so the game loop isn't blocked
    if (this.seasonManager.isSeasonComplete()) {
      this.menuManager.showSeasonFinal({
        standings: this.seasonManager.getStandings(),
      });
      return;
    }
    return this._launchCurrentSeasonRace();
  }

  /** Player retires early — clears season state and goes to main menu. */
  retireFromSeason() {
    this.seasonManager?.clear();
    this.seasonManager = null;
    return this.goToMenu();
  }

  /**
   * Purchase an upgrade and refresh the pit screen data.
   */
  purchaseUpgrade(upgradeId) {
    if (!this.seasonManager) return;
    const result = this.seasonManager.purchaseUpgrade(upgradeId);
    if (result.ok) this.goToPit(); // refresh pitData with updated balance + upgrade levels
  }

  /**
   * Build pitData from the current SeasonManager state and show the Pit screen.
   * Called after the player dismisses the PostRace screen.
   */
  goToPit() {
    if (!this.seasonManager) return;
    const sm = this.seasonManager;
    this.menuManager.showPit({
      raceNumber:       sm.getCurrentRaceNumber(),
      totalRaces:       sm.getTotalRaces(),
      nextTrackKey:     sm.getCurrentTrackKey(),
      nextRaceNumber:   sm.getCurrentRaceNumber(),
      isSeason:         true,
      isSeasonComplete: sm.isSeasonComplete(),
      standings:        sm.getStandings(),
      playerBalance:    sm.getPlayerBalance(),
      upgrades:         sm.getUpgrades(),
    });
  }

  /** @private */
  _launchCurrentSeasonRace() {
    const trackKey   = this.seasonManager.getCurrentTrackKey();
    const laps       = this.seasonManager.getLapsPerRace();
    const vehicleKey = this.menuManager.selectedVehicle;
    const playerColorKey = this.menuManager.selectedPlayerColor;
    return this.goToRace({ trackKey, laps, season: true, vehicleKey, playerColorKey });
  }

  showSeasonPit() {
    if (!this.seasonManager) return;
    const sm = this.seasonManager;
    this.menuManager.showPit({
      raceNumber:       sm.getCurrentRaceNumber(),
      totalRaces:       sm.getTotalRaces(),
      nextTrackKey:     sm.getCurrentTrackKey(),
      nextRaceNumber:   sm.getCurrentRaceNumber(),
      isSeason:         true,
      isSeasonComplete: sm.isSeasonComplete(),
      standings:        sm.getStandings(),
      playerBalance:    sm.getPlayerBalance(),
      upgrades:         sm.getUpgrades(),
    });
  }

  showSingleRacePit() {
    const trackKey = this.menuManager.selectedTrack;
    if (!trackKey) return;

    const trackName = window.trackLoader?.getTrack(trackKey)?.name ?? trackKey;
    const vehicleName = window.vehicleLoader?.getVehicle(this.menuManager.selectedVehicle)?.name ?? this.menuManager.selectedVehicle;

    this.menuManager.showPit({
      raceNumber:       1,
      totalRaces:       1,
      nextTrackKey:     trackKey,
      trackName,
      laps:             this.menuManager.selectedLaps,
      nextRaceNumber:   1,
      isSeason:         false,
      isSeasonComplete: false,
      standings:        [],
      playerBalance:    0,
      upgrades:         [],
      vehicleName,
    });
  }

  goToRace(config) {
    return this.switchTo(RaceMode, config);
  }

  goToPractice(config) {
    return this.switchTo(PracticeMode, config);
  }

  goToEditor(config) {
    return this.switchTo(EditorMode, config);
  }

  goToTest(config) {
    return this.switchTo(TestMode, config);
  }

  switchToMode(modeName) {
    if (modeName === 'menu') return this.goToMenu();
    if (modeName === 'race') return this.goToRace();
    if (modeName === 'practice') return this.goToPractice();
    if (modeName === 'editor') return this.goToEditor();
    if (modeName === 'test') return this.goToTest();
    return this.goToMenu();
  }
}
