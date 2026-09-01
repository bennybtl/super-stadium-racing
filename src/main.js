import { Engine } from "@babylonjs/core";
import { MenuManager } from "./managers/MenuManager.js";
import { TrackLoader } from "./managers/TrackLoader.js";
import { VehicleLoader } from "./managers/VehicleLoader.js";
import { DecorationLoader } from "./managers/DecorationLoader.js";
import { ObstacleLoader } from "./managers/ObstacleLoader.js";
import { ModeController } from "./modes/ModeController.js";
import { MenuMode } from "./modes/MenuMode.js";
import { initializeSettingsStorage } from "./settingsStorage.js";
import '/src/vue/main.js';

const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true);

// Ensure settings keys exist with defaults before gameplay systems read them.
initializeSettingsStorage();

const menuManager = new MenuManager(); // temp for trackLoader

const trackLoader = new TrackLoader();
window.trackLoader = trackLoader; // MenuManager reads this to list available tracks

const vehicleLoader = new VehicleLoader();
window.vehicleLoader = vehicleLoader;

const decorationLoader = new DecorationLoader();
window.decorationLoader = decorationLoader; // editor + managers read this to list/resolve decorations

const obstacleLoader = new ObstacleLoader();
window.obstacleLoader = obstacleLoader; // editor + managers read this to list/resolve obstacles

const controller = new ModeController(engine, menuManager, trackLoader);
menuManager.controller = controller;

menuManager.showLoading('Loading tracks and vehicles…');

Promise.all([
  trackLoader.loadAllTracks(),
  vehicleLoader.loadAllVehicles(),
  decorationLoader.loadAllDecorations(),
  obstacleLoader.loadAllObstacles(),
]).then(() => {
  // switchTo runs its own showLoading/hideLoading around the demo-race build,
  // so the loading modal stays up until MenuMode's backdrop is actually ready.
  return controller.switchTo(MenuMode);
}).catch((err) => {
  console.error(err);
  menuManager.hideLoading();
});

window.addEventListener("resize", () => engine.resize());
