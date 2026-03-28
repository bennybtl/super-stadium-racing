import { MenuMode } from "./MenuMode.js";
import { RaceMode } from "./RaceMode.js";
import { EditorMode } from "./EditorMode.js";

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
    if (this.currentMode) {
      this.currentMode.teardown();
      this.currentMode = null;
    }

    this.engine.stopRenderLoop();

    const mode = new ModeClass(this);
    this.currentMode = mode;

    const scene = await mode.setup(config);

    if (scene) {
      this.engine.runRenderLoop(() => scene.render());
    }
  }

  goToMenu() {
    return this.switchTo(MenuMode);
  }

  /** Called by any mode when the user chooses to exit back to the main menu. */
  exit() {
    return this.goToMenu();
  }

  goToRace(config) {
    return this.switchTo(RaceMode, config);
  }

  goToEditor(config) {
    return this.switchTo(EditorMode, config);
  }
}
