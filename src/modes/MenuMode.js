import { Scene, Color4, FreeCamera, Vector3 } from "@babylonjs/core";
import { BaseMode } from "./BaseMode.js";

/**
 * MenuMode – shows the start-screen DOM overlay (managed by MenuManager).
 * A minimal Babylon scene (clear colour only) keeps the canvas blank while
 * the DOM menu is visible so the previous mode's last frame doesn't bleed
 * through.
 *
 * Wires up the two entry-point callbacks:
 *   onStartGame   → goToRace
 *   onStartEditor → goToEditor
 */
export class MenuMode extends BaseMode {
  constructor(controller) {
    super(controller);
  }

  async setup(_config) {
    const { engine, menuManager } = this.controller;

    // Blank scene so the engine actively clears the canvas each frame
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.15, 0.12, 0.1, 1);
    // A camera is required for Babylon to render the scene without warnings
    new FreeCamera("menuCam", new Vector3(0, 0, -10), scene);
    this.scene = scene;

    menuManager.onStartGame = () => {
      menuManager.gameStarted = true;
      menuManager.hideMenu();
      this.controller.goToRace({
        trackKey:   menuManager.selectedTrack,
        laps:       menuManager.selectedLaps,
        vehicleKey: menuManager.selectedVehicle,
      });
    };

    menuManager.onSeasonStart = (laps) => {
      menuManager.gameStarted = true;
      menuManager.hideMenu();
      this.controller.startSeason(laps);
    };

    menuManager.onContinueSeason = () => {
      this.controller.continueSeason();
    };

    menuManager.onRetireFromSeason = () => {
      this.controller.retireFromSeason();
    };

    menuManager.onGoToPit = () => {
      this.controller.goToPit();
    };

    menuManager.onPurchaseUpgrade = (upgradeId) => {
      this.controller.purchaseUpgrade(upgradeId);
    };

    menuManager.onStartPractice = () => {
      menuManager.gameStarted = true;
      menuManager.hideMenu();
      this.controller.goToPractice({
        trackKey:   menuManager.selectedTrack,
        vehicleKey: menuManager.selectedVehicle,
      });
    };

    menuManager.onStartEditor = () => {
      menuManager.editorMode = true;
      menuManager.hideMenu();
      this.controller.goToEditor({
        trackKey: menuManager.selectedTrack,
      });
    };

    menuManager.showStartMenu();

    return scene;
  }

  teardown() {
    super.teardown();
  }
}
