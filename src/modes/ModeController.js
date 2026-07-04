import { MenuMode } from "./MenuMode.js";
import { RaceMode } from "./RaceMode.js";
import { EditorMode } from "./EditorMode.js";
import { TestMode } from "./TestMode.js";
import { PracticeMode } from "./PracticeMode.js";
import { HotLapMode } from "./HotLapMode.js";
import { incrementUpgradeLevel, getUpgradeCatalog } from "../managers/UpgradeStorage.js";

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
    return this.goToMenu();
  }

  /**
   * Purchase an upgrade and refresh the pit screen data.
   * Upgrade progress persists independently of any race.
   */
  purchaseUpgrade(upgradeId) {
    const result = incrementUpgradeLevel(upgradeId);
    if (result.ok) {
      this.menuManager._store.upgrades = getUpgradeCatalog({ balance: 0, ignoreBalance: true });
    }
  }

  showSingleRacePit() {
    const trackKey = this.menuManager.selectedTrack;
    if (!trackKey) return;

    const trackName = window.trackLoader?.getTrack(trackKey)?.name ?? trackKey;
    const vehicleName = window.vehicleLoader?.getVehicle(this.menuManager.selectedVehicle)?.name ?? this.menuManager.selectedVehicle;

    this.menuManager.showPit({
      nextTrackKey:     trackKey,
      trackName,
      laps:             this.menuManager.selectedLaps,
      aiDrivers:        this.menuManager.selectedAIDrivers,
      upgrades:         getUpgradeCatalog({ balance: 0, ignoreBalance: true }),
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

  goToHotLap(config) {
    return this.switchTo(HotLapMode, config);
  }

  goToTest(config) {
    return this.switchTo(TestMode, config);
  }

  switchToMode(modeName) {
    if (modeName === 'menu') return this.goToMenu();
    if (modeName === 'race') return this.goToRace();
    if (modeName === 'practice') return this.goToPractice();
    if (modeName === 'editor') return this.goToEditor();
    if (modeName === 'hotlap') return this.goToHotLap();
    if (modeName === 'test') return this.goToTest();
    return this.goToMenu();
  }
}
