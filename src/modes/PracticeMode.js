import { Vector3 } from "@babylonjs/core";
import { Truck } from "../truck/truck.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { DebugManager } from "../managers/DebugManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { DriveMode } from "./DriveMode.js";

/**
 * PracticeMode – free-drive mode for testing and practice.
 *
 * No AI trucks, no countdown, no lap/checkpoint tracking.
 * Just select a track and drive around to test handling and physics.
 */
export class PracticeMode extends DriveMode {
  constructor(controller) {
    super(controller);
    this.inputManager = null;
  }

  async setup({ trackKey, vehicleKey = 'default_truck' }) {
    const { engine, menuManager } = this.controller;

    const {
      scene,
      cameraController,
      shadows,
      currentTrack,
      terrainManager,
      obstacleManager,
      flagManager,
      pickupManager,
    } = await this.buildDriveScene(trackKey);
    // Note: Pickups are disabled by default via buildScene. We don't spawn them here.

    this.scene = scene;

    // Spawn just behind the start/finish checkpoint, facing forward
    const { startFinishCp: startCp } = this.getStartFinishInfo(currentTrack);

    // Create truck first so we can read its height when calculating spawnPos
    const vehicleDef = window.vehicleLoader?.getVehicle(vehicleKey) ?? null;
    const playerTruck = new Truck(scene, shadows, null, null, vehicleDef);

    const spawn = this.getSpawnBehindCheckpoint(currentTrack, startCp, playerTruck.height, 6);
    const spawnPos = spawn.pos;
    const heading = spawn.heading;

    playerTruck.mesh.position.copyFrom(spawnPos);
    playerTruck.state.heading = heading;
    playerTruck.mesh.rotation.y = heading;

    const trucks = [{ truck: playerTruck }];

    // Reset physics state to prevent gravity accumulation during async scene setup
    this.respawnTruck(playerTruck, spawnPos, heading);

    // -- UI --
    const uiManager = new UIManager();
    this.uiManager = uiManager;

    const debugManager = new DebugManager(scene);
    this.debugManager = debugManager;
    const staticBodyCollisionManager = new StaticBodyCollisionManager(scene);

    // Input — ESC opens pause menu
    this.cameraController = cameraController;
    const inputManager = new InputManager(playerTruck, cameraController);
    this.inputManager = inputManager;
    inputManager.onPause(() => menuManager.showPauseMenu());
    inputManager.onTogglePhotoMode(() => this.togglePhotoMode());
    this.setupDebugToggle(inputManager, debugManager);
    inputManager.onReset(() => this.respawnTruck(playerTruck, spawnPos, heading, staticBodyCollisionManager));

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

    // Pre-filter 'slowZone' action zones for per-frame position checks
    const slowZones = this.getSlowZones(currentTrack);
    const outOfBoundsZones = this.getOutOfBoundsZones(currentTrack);

    // Setup visibility handler to prevent physics accumulation
    this.setupVisibilityHandler(scene, trucks);

    // Simple game loop
    scene.onBeforeRenderObservable.add(() => {
      if (document.hidden) return;

      const dt = this.getClampedDeltaTime(engine, 0.05);
      if (this._photoModeActive) {
        const input = inputManager.getMovementInput();
        this.cameraController.moveFreeCamera(input, dt);
        this.cameraController.update();
        return;
      }
      if (menuManager.isPaused) return;

      const input = inputManager.getMovementInput();

      const debugInfo = playerTruck.update(input, dt, terrainManager, currentTrack);

      this.applySlowZones(trucks, slowZones);

      const oobRemaining = this.updateOutOfBoundsCountdown({
        truckId: 'player',
        truck: playerTruck,
        outOfBoundsZones,
        track: currentTrack,
        dt,
        durationSec: 5,
        onTimeout: () => {
          this.respawnTruck(playerTruck, spawnPos, heading, staticBodyCollisionManager);
        },
      });
      if (oobRemaining == null) uiManager.hideOutOfBoundsCountdown();
      else uiManager.showOutOfBoundsCountdown(oobRemaining);

      staticBodyCollisionManager.update(trucks);
      obstacleManager.update(trucks, dt);
      flagManager.update(trucks, dt);
      pickupManager.update(trucks, dt);
      cameraController.update(playerTruck.mesh.position, playerTruck.state.heading, dt);
      
      debugManager.update(debugInfo, terrainManager, currentTrack, playerTruck);
    });

    return scene;
  }

  teardown() {
    if (this.uiManager) {
      this.uiManager.hideAll();
      this.uiManager = null;
    }
    super.teardown();
  }
}
