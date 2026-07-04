import { Truck } from "../truck/truck.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { DebugManager } from "../managers/DebugManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { AudioManager } from "../managers/AudioManager.js";
import { TruckAudioController } from "../managers/TruckAudioController.js";
import { HotLapTracker } from "../managers/HotLapTracker.js";
import { DriveMode } from "./DriveMode.js";
import { basicColors } from "../constants.js";
import { loadPlayerUpgrades } from "../managers/UpgradeStorage.js";

/**
 * HotLapMode – single-player time trial. A thin drive mode that spawns one
 * truck and hands lap timing, the best-lap ghost, the leaderboard and the
 * hot-lap HUD to a HotLapTracker (which any mode could reuse the same way).
 */
export class HotLapMode extends DriveMode {
  constructor(controller) {
    super(controller);
    this.inputManager = null;
    this.audioManager = null;
    this.truckAudioController = null;
    this.hotLap = null;
    this.uiManager = null;
  }

  async setup({ trackKey, vehicleKey = 'default_truck', playerColorKey = null }) {
    const { engine, menuManager } = this.controller;

    const {
      scene,
      cameraController,
      shadows,
      currentTrack,
      terrainManager,
      checkpointManager,
      obstacleManager,
      flagManager,
      pickupManager,
    } = await this.buildDriveScene(trackKey);

    this.scene = scene;
    const frameProfiler = this.initFrameProfiler('HotLapMode');

    const audioManager = await AudioManager.create(scene);
    this.audioManager = audioManager;
    pickupManager.setAudioManager(audioManager);

    const { startFinishCp } = this.getStartFinishInfo(currentTrack);

    const vehicleDef = window.vehicleLoader?.getVehicle(vehicleKey) ?? null;
    this.truckAudioController = await TruckAudioController.create(audioManager, vehicleDef?.engineAudio);
    const playerColor = playerColorKey ? basicColors[playerColorKey]?.diffuse : null;
    const playerUpgrades = loadPlayerUpgrades();
    const playerTruck = new Truck(scene, shadows, playerColor, null, vehicleDef, playerUpgrades);
    playerTruck.setAudioController(this.truckAudioController);
    const truckDims = { width: playerTruck.width, height: playerTruck.height, depth: playerTruck.depth };

    const spawn = this.getSpawnBehindCheckpoint(currentTrack, startFinishCp, playerTruck.height, 6);
    const spawnPos = spawn.pos;
    const heading = spawn.heading;

    playerTruck.mesh.position.copyFrom(spawnPos);
    playerTruck.state.heading = heading;
    playerTruck.mesh.rotation.y = heading;

    const trucks = [{ truck: playerTruck, isPlayer: true }];
    this.respawnTruck(playerTruck, spawnPos, heading);

    // -- UI --
    const uiManager = new UIManager();
    this.uiManager = uiManager;

    const pushTruckStatus = (lap, boostActive) => uiManager.updateTruckStatus([{
      id: 'player',
      name: 'You',
      color: playerColor ?? basicColors.red.diffuse,
      lap,
      totalLaps: '--',
      boosts: playerTruck.state.boostCount,
      boostActive,
      finished: false,
    }]);
    pushTruckStatus(0, false);

    // -- Hot-lap tracking (timing, ghost, leaderboard, HUD) --
    this.hotLap = new HotLapTracker(scene, {
      checkpointManager,
      uiManager,
      trackKey,
      vehicleKey,
      vehicleDef,
      truckDims,
      upgrades: playerUpgrades,
      onLap: ({ lapCount }) => pushTruckStatus(lapCount, playerTruck.state.boostActive),
    });

    const debugManager = new DebugManager(scene);
    this.debugManager = debugManager;
    const staticBodyCollisionManager = new StaticBodyCollisionManager(scene);

    // Full reset back to the staging line (also re-primes the lap tracker).
    const resetHotLap = () => {
      this.hotLap.reset();
      pushTruckStatus(0, false);
      obstacleManager.rebuild();
      this.respawnTruck(playerTruck, spawnPos, heading, staticBodyCollisionManager);
    };

    this.cameraController = cameraController;
    const inputManager = new InputManager(playerTruck, cameraController);
    this.inputManager = inputManager;
    inputManager.onPause(() => menuManager.showPauseMenu());
    inputManager.onTogglePhotoMode(() => this.togglePhotoMode());
    this.setupDebugToggle(inputManager, debugManager);
    inputManager.onToggleVehicleDebug(() => debugManager.toggleVehicleOverlay());
    inputManager.onReset(() => resetHotLap());

    menuManager.onResume = () => menuManager.hideMenu();
    menuManager.onReset = () => {
      inputManager.onResetCallback();
      menuManager.hideMenu();
    };
    menuManager.onExit = () => this.controller.switchToMode('menu');

    const slowZones = this.getSlowZones(currentTrack);
    const outOfBoundsZones = this.getOutOfBoundsZones(currentTrack);
    const speedBoostZones = this.getSpeedBoostZones(currentTrack);

    this.setupVisibilityHandler(scene, trucks);

    let frameRenderStartMs = 0;

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
        () => playerTruck.update(input, dt, terrainManager, currentTrack, true, null, frameProfiler),
      );

      frameProfiler.measure('zones.slow', () => this.applySlowZones(trucks, slowZones));
      frameProfiler.measure('zones.boost', () => this.applySpeedBoostZones(trucks, speedBoostZones));

      const oobRemaining = frameProfiler.measure('zones.oob', () => this.updateOutOfBoundsCountdown({
        truckId: 'player',
        truck: playerTruck,
        outOfBoundsZones,
        track: currentTrack,
        dt,
        durationSec: 5,
        onTimeout: () => this.respawnTruck(playerTruck, spawnPos, heading, staticBodyCollisionManager),
      }));
      if (oobRemaining == null) uiManager.hideOutOfBoundsCountdown();
      else uiManager.showOutOfBoundsCountdown(oobRemaining);

      frameProfiler.measure('collision.staticBodies', () => staticBodyCollisionManager.update(trucks));
      frameProfiler.measure('obstacles.update', () => obstacleManager.update(trucks, dt));
      frameProfiler.measure('flags.update', () => flagManager.update(trucks, dt));
      frameProfiler.measure('pickups.update', () => pickupManager.update(trucks, dt));

      frameProfiler.measure('hotlap.update', () => this.hotLap.update(playerTruck, dt));

      frameProfiler.measure('debug.update', () => debugManager.update(debugInfo, terrainManager, currentTrack, playerTruck));
      frameProfiler.measure('camera.update', () => cameraController.update(playerTruck.mesh.position, playerTruck.state.heading, dt));
      frameRenderStartMs = performance.now();
    });

    return scene;
  }

  teardown() {
    if (this.hotLap) {
      this.hotLap.dispose();
      this.hotLap = null;
    }
    if (this.debugManager) {
      this.debugManager.hide();
      this.debugManager.hideVehicleOverlay();
    }
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
    this.controller.menuManager.currentMenu = null;
    this.controller.menuManager.isPaused = false;
    this.controller.menuManager._store.isPaused = false;
    super.teardown();
  }
}
