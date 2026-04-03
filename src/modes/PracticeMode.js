import { Vector3 } from "@babylonjs/core";
import { createTruck, updateTruck } from "../truck.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { buildScene } from "./SceneBuilder.js";
import { TRUCK_HEIGHT } from "../constants.js";
import { BaseMode } from "./BaseMode.js";

/**
 * PracticeMode – free-drive mode for testing and practice.
 *
 * No AI trucks, no countdown, no lap/checkpoint tracking.
 * Just select a track and drive around to test handling and physics.
 */
export class PracticeMode extends BaseMode {
  constructor(controller) {
    super(controller);
    this.inputManager = null;
  }

  async setup({ trackKey }) {
    const { engine, menuManager, trackLoader } = this.controller;

    const {
      scene,
      cameraController,
      shadows,
      currentTrack,
      terrainManager,
      wallManager,
      tireStackManager,
      flagManager,
    } = await buildScene(engine, trackLoader, trackKey);

    this.scene = scene;

    // Spawn just behind the start/finish checkpoint, facing forward
    const checkpointFeatures = currentTrack.features.filter(
      f => f.type === 'checkpoint' && f.checkpointNumber != null
    );
    const maxNum = checkpointFeatures.reduce((m, f) => Math.max(m, f.checkpointNumber), 0);
    const startCp = checkpointFeatures.find(f => f.checkpointNumber === maxNum) || null;

    let spawnPos, heading;
    if (startCp) {
      const h = startCp.heading;
      const x = startCp.centerX + Math.sin(h) * -6;
      const z = startCp.centerZ + Math.cos(h) * -6;
      spawnPos = new Vector3(x, currentTrack.getHeightAt(x, z) + TRUCK_HEIGHT, z);
      heading = h;
    } else {
      spawnPos = new Vector3(0, TRUCK_HEIGHT, 0);
      heading = 0;
    }

    // Create truck
    const playerTruck = createTruck(scene, shadows, null, null, spawnPos);
    playerTruck.state.heading = heading;
    playerTruck.mesh.rotation.y = heading;

    const trucks = [{ truck: playerTruck }];

    // Reset physics state to prevent gravity accumulation during async scene setup
    this.resetTruckPhysics(playerTruck, spawnPos);

    // -- UI --
    const uiManager = new UIManager();
    this.uiManager = uiManager;
    uiManager.showDebugPanel();

    // Input — ESC opens pause menu
    const inputManager = new InputManager(playerTruck, cameraController);
    this.inputManager = inputManager;
    inputManager.onPause(() => menuManager.showPauseMenu());
    inputManager.onReset(() => {
      this.resetTruckPhysics(playerTruck, spawnPos);
      playerTruck.state.heading = heading;
      playerTruck.mesh.rotation.y = heading;
    });

    // Wire up pause callbacks
    menuManager.onResume = () => {
      menuManager.hideMenu();
    };

    menuManager.onReset = () => {
      inputManager.onResetCallback();
      menuManager.hideMenu();
    };

    menuManager.onExit = () => {
      this.controller.switchToMode('menu');
    };

    // Setup visibility handler to prevent physics accumulation
    this.setupVisibilityHandler(scene, trucks);

    // Simple game loop
    scene.onBeforeRenderObservable.add(() => {
      if (menuManager.isPaused || document.hidden) return;

      const dt = this.getClampedDeltaTime(engine);
      const input = inputManager.getMovementInput();
            
      wallManager.preUpdate(trucks, dt);
      const debugInfo = updateTruck(playerTruck, input, dt, terrainManager, currentTrack);
      wallManager.update(trucks);
      tireStackManager.update(trucks, dt);
      flagManager.update(trucks);
      cameraController.update(playerTruck.mesh.position);
      
      // Update debug panel
      const slopeDegFront = currentTrack.getTerrainSlopeAt(
        playerTruck.mesh.position.x,
        playerTruck.mesh.position.z,
        playerTruck.state.heading,
        1,
        4
      );
      uiManager.updateDebugPanel(
        debugInfo,
        terrainManager.getTerrainAt(playerTruck.mesh.position),
        slopeDegFront
      );
      uiManager.updatePosition(playerTruck.mesh.position);
    });

    return scene;
  }

  teardown() {
    if (this.uiManager) {
      this.uiManager.hideAll();
      this.uiManager = null;
    }
    if (this.inputManager) {
      this.inputManager.dispose();
      this.inputManager = null;
    }
    super.teardown();
  }
}
