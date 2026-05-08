import { Vector3 } from "@babylonjs/core";
import { Truck } from "../truck/truck.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { DebugManager } from "../managers/DebugManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { AudioManager } from "../managers/AudioManager.js";
import { TruckAudioController } from "../managers/TruckAudioController.js";
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
    this.audioManager = null;
    this.truckAudioController = null;
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
    const frameProfiler = this.initFrameProfiler('PracticeMode');

    const audioManager = await AudioManager.create(scene);
    this.audioManager = audioManager;
    pickupManager.setAudioManager(audioManager);

    // Spawn just behind the start/finish checkpoint, facing forward
    const { startFinishCp: startCp } = this.getStartFinishInfo(currentTrack);

    // Create truck first so we can read its height when calculating spawnPos
    const vehicleDef = window.vehicleLoader?.getVehicle(vehicleKey) ?? null;
    this.truckAudioController = await TruckAudioController.create(audioManager, vehicleDef?.engineAudio);
    const playerTruck = new Truck(scene, shadows, null, null, vehicleDef);
    playerTruck.setAudioController(this.truckAudioController);

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
    inputManager.onReset(() => {
      obstacleManager.rebuild();
      this.respawnTruck(playerTruck, spawnPos, heading, staticBodyCollisionManager);
    });

    // Wire up pause callbacks
    menuManager.onResume = () => {
      menuManager.hideMenu();
    };

    menuManager.onReset = () => {
      obstacleManager.rebuild();
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
    let frameRenderStartMs = 0;

    // Simple game loop
    scene.onAfterRenderObservable.add(() => {
      if (frameRenderStartMs > 0) {
        frameProfiler.addDuration('render.pipeline', performance.now() - frameRenderStartMs);
        frameRenderStartMs = 0;
      }
      frameProfiler.endFrame();
    });

    scene.onBeforeRenderObservable.add(() => {
      if (document.hidden) return;

      const dt = this.getClampedDeltaTime(engine, 0.05);
      frameProfiler.beginFrame(dt);
      if (this._photoModeActive) {
        const input = frameProfiler.measure('input.photo', () => inputManager.getMovementInput());
        frameProfiler.measure('camera.photoMove', () => this.cameraController.moveFreeCamera(input, dt));
        frameProfiler.measure('camera.photoUpdate', () => this.cameraController.update());
        frameRenderStartMs = performance.now();
        return;
      }
      if (menuManager.isPaused) {
        frameRenderStartMs = performance.now();
        return;
      }

      const input = frameProfiler.measure('input', () => inputManager.getMovementInput());

      const debugInfo = frameProfiler.measure(
        'truck.update',
        () => playerTruck.update(input, dt, terrainManager, currentTrack, true, null, frameProfiler)
      );

      frameProfiler.measure('zones.slow', () => this.applySlowZones(trucks, slowZones));

      const oobRemaining = frameProfiler.measure('zones.oob', () => this.updateOutOfBoundsCountdown({
        truckId: 'player',
        truck: playerTruck,
        outOfBoundsZones,
        track: currentTrack,
        dt,
        durationSec: 5,
        onTimeout: () => {
          this.respawnTruck(playerTruck, spawnPos, heading, staticBodyCollisionManager);
        },
      }));
      if (oobRemaining == null) uiManager.hideOutOfBoundsCountdown();
      else uiManager.showOutOfBoundsCountdown(oobRemaining);

      frameProfiler.measure('collision.staticBodies', () => staticBodyCollisionManager.update(trucks));
      frameProfiler.measure('obstacles.update', () => obstacleManager.update(trucks, dt));
      frameProfiler.measure('flags.update', () => flagManager.update(trucks, dt));
      frameProfiler.measure('pickups.update', () => pickupManager.update(trucks, dt));
      frameProfiler.measure('camera.update', () => cameraController.update(playerTruck.mesh.position, playerTruck.state.heading, dt));
      
      const engineSpeed = Math.sqrt(
        playerTruck.state.velocity.x * playerTruck.state.velocity.x +
        playerTruck.state.velocity.z * playerTruck.state.velocity.z
      );
      frameProfiler.measure('debug.update', () => debugManager.update(debugInfo, terrainManager, currentTrack, playerTruck));
      frameRenderStartMs = performance.now();
    });

    return scene;
  }

  teardown() {
    if (this.uiManager) {
      this.uiManager.hideAll();
      this.uiManager = null;
    }
    if (this.audioManager) {
      this.truckAudioController?.stop();
      this.truckAudioController = null;
      this.audioManager.dispose();
      this.audioManager = null;
    }
    // Clear paused state so MenuMode shows the start menu rather than staying
    // stuck on the pause screen.
    this.controller.menuManager.currentMenu = null;
    this.controller.menuManager.isPaused = false;
    this.controller.menuManager._store.isPaused = false;
    super.teardown();
  }
}
