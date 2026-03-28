import { Engine } from "@babylonjs/core";
import { MenuManager } from "./managers/MenuManager.js";
import { TrackLoader } from "./managers/TrackLoader.js";
import { ModeController } from "./modes/ModeController.js";
import { MenuMode } from "./modes/MenuMode.js";

const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true);

const menuManager = new MenuManager();

const trackLoader = new TrackLoader();
window.trackLoader = trackLoader; // MenuManager reads this to list available tracks

const controller = new ModeController(engine, menuManager, trackLoader);

trackLoader.loadAllTracks().then(() => {
  console.log("Tracks loaded, starting game");
  controller.switchTo(MenuMode);
});

window.addEventListener("resize", () => engine.resize());
