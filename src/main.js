import { Engine } from "@babylonjs/core";
import { MenuManager } from "./managers/MenuManager.js";
import { TrackLoader } from "./managers/TrackLoader.js";
import { VehicleLoader } from "./managers/VehicleLoader.js";
import { ModeController } from "./modes/ModeController.js";
import { MenuMode } from "./modes/MenuMode.js";
import '/src/vue/main.js';

const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true);

const menuManager = new MenuManager();

const trackLoader = new TrackLoader();
window.trackLoader = trackLoader; // MenuManager reads this to list available tracks

const vehicleLoader = new VehicleLoader();
window.vehicleLoader = vehicleLoader;

const controller = new ModeController(engine, menuManager, trackLoader);

Promise.all([
  trackLoader.loadAllTracks(),
  vehicleLoader.loadAllVehicles(),
]).then(() => {
  console.log("Tracks and vehicles loaded, starting game");
  controller.switchTo(MenuMode);
});

window.addEventListener("resize", () => engine.resize());
