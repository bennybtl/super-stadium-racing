import { Scene, Color4, FreeCamera, Vector3 } from "@babylonjs/core";

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
export class MenuMode {
  constructor(controller) {
    this.controller = controller;
    this.scene = null;
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
        trackKey: menuManager.selectedTrack,
        laps: menuManager.selectedLaps,
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
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
  }
}
