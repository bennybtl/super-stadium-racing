import { Vector3 } from "@babylonjs/core";
import { Truck } from "../truck/truck.js";
import { GameState } from "../managers/GameState.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { DebugManager } from "../managers/DebugManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { AudioManager } from "../managers/AudioManager.js";
import { TruckAudioController } from "../managers/TruckAudioController.js";
import { GhostRecorder } from "../managers/GhostRecorder.js";
import { GhostPlayer } from "../managers/GhostPlayer.js";
import { DriveMode } from "./DriveMode.js";
import { basicColors } from "../constants.js";
import { loadPlayerUpgrades } from "../managers/UpgradeStorage.js";

const GHOST_STORAGE_PREFIX = "hotlap_ghost_";

function loadGhost(trackKey) {
  try {
    const raw = localStorage.getItem(GHOST_STORAGE_PREFIX + trackKey);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.frames) || data.frames.length === 0) return null;
    return data;
  } catch { return null; }
}

function saveGhost(trackKey, lapTimeMs, frames) {
  try {
    localStorage.setItem(GHOST_STORAGE_PREFIX + trackKey, JSON.stringify({
      lapTimeMs,
      frames,
      savedAt: Date.now(),
    }));
  } catch { /* storage full — silently skip */ }
}

export class HotLapMode extends DriveMode {
  constructor(controller) {
    super(controller);
    this.inputManager = null;
    this.audioManager = null;
    this.truckAudioController = null;
    this.ghostRecorder = null;
    this.ghostPlayer = null;
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

    checkpointManager.createCheckpoints();
    const { maxCheckpointNumber, startFinishCp } = this.getStartFinishInfo(currentTrack);

    const vehicleDef = window.vehicleLoader?.getVehicle(vehicleKey) ?? null;
    this.truckAudioController = await TruckAudioController.create(audioManager, vehicleDef?.engineAudio);
    const playerColor = playerColorKey ? basicColors[playerColorKey]?.diffuse : null;
    const playerUpgrades = loadPlayerUpgrades();
    const playerTruck = new Truck(scene, shadows, playerColor, null, vehicleDef, playerUpgrades);
    playerTruck.setAudioController(this.truckAudioController);

    const spawn = this.getSpawnBehindCheckpoint(currentTrack, startFinishCp, playerTruck.height, 6);
    const spawnPos = spawn.pos;
    const heading = spawn.heading;

    playerTruck.mesh.position.copyFrom(spawnPos);
    playerTruck.state.heading = heading;
    playerTruck.mesh.rotation.y = heading;

    const gameState = new GameState();
    const truckData = { truck: playerTruck, gameState, isPlayer: true, id: 'player', hasStarted: false, lapStartTime: null };
    const trucks = [truckData];

    this.respawnTruck(playerTruck, spawnPos, heading);

    // -- Ghost --
    const ghostRecorder = new GhostRecorder();
    this.ghostRecorder = ghostRecorder;

    const savedGhost = loadGhost(trackKey);
    let ghostPlayer = null;
    if (savedGhost) {
      ghostPlayer = new GhostPlayer(scene, savedGhost.frames);
      ghostPlayer.setVisible(true);
      this.ghostPlayer = ghostPlayer;
    }

    let bestLapMs = savedGhost?.lapTimeMs ?? null;

    // -- UI --
    const uiManager = new UIManager();
    this.uiManager = uiManager;
    uiManager.showRaceStatusPanel();
    uiManager.showRaceTimer();
    uiManager.updateLaps(0, null);
    uiManager.updateTruckStatus([{
      id: 'player',
      name: 'You',
      color: playerColor ?? basicColors.red.diffuse,
      lap: 0,
      totalLaps: '--',
      boosts: gameState.boostCount,
      boostActive: false,
      finished: false,
    }]);

    // Push best-lap and ghost-visible state into the race store for the HUD
    const raceStore = uiManager._race;
    raceStore.hotLapBestMs = bestLapMs;
    raceStore.hotLapGhostVisible = !!ghostPlayer;
    raceStore.hotLapMode = true;

    const debugManager = new DebugManager(scene);
    this.debugManager = debugManager;
    const staticBodyCollisionManager = new StaticBodyCollisionManager(scene);

    this.cameraController = cameraController;
    const inputManager = new InputManager(playerTruck, cameraController);
    this.inputManager = inputManager;
    inputManager.onPause(() => menuManager.showPauseMenu());
    inputManager.onTogglePhotoMode(() => this.togglePhotoMode());
    this.setupDebugToggle(inputManager, debugManager);
    inputManager.onToggleVehicleDebug(() => debugManager.toggleVehicleOverlay());
    inputManager.onReset(() => {
      obstacleManager.rebuild();
      this.respawnTruck(playerTruck, spawnPos, heading, staticBodyCollisionManager);
    });

    menuManager.onResume = () => menuManager.hideMenu();
    menuManager.onReset = () => {
      obstacleManager.rebuild();
      inputManager.onResetCallback();
      menuManager.hideMenu();
    };
    menuManager.onExit = () => this.controller.switchToMode('menu');

    const slowZones = this.getSlowZones(currentTrack);
    const outOfBoundsZones = this.getOutOfBoundsZones(currentTrack);
    const speedBoostZones = this.getSpeedBoostZones(currentTrack);

    this.setupVisibilityHandler(scene, trucks);

    let raceStartTime = null;
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

      // -- Timer --
      if (raceStartTime != null) {
        uiManager.updateTimer(Date.now() - raceStartTime);
      }

      // -- Ghost recording --
      if (ghostRecorder.recording) {
        ghostRecorder.record(playerTruck.mesh.position, playerTruck.state.heading);
      }

      // -- Ghost playback --
      if (ghostPlayer) {
        ghostPlayer.setVisible(raceStore.hotLapGhostVisible);
        if (ghostPlayer.visible) {
          frameProfiler.measure('ghost.update', () => ghostPlayer.update());
        }
      }

      // -- Checkpoint / lap tracking --
      frameProfiler.measure('checkpoints.laps', () => {
        if (gameState.raceFinished) return;

        const checkpointResult = checkpointManager.update(
          playerTruck.mesh.position,
          playerTruck.state.velocity,
          gameState.lastCheckpointPassed,
          'player',
        );
        if (!checkpointResult?.passed) return;

        // Start/finish line crossing — first time starts the timer
        if (checkpointResult.index === maxCheckpointNumber && !truckData.hasStarted) {
          truckData.hasStarted = true;
          raceStartTime = Date.now();
          truckData.lapStartTime = Date.now();
          gameState.lastCheckpointPassed = 0;
          gameState.checkpointCount = 0;
          checkpointManager.resetForTruck('player');
          checkpointManager.updatePlayerCheckpointHighlight(0);
          uiManager.updateCheckpoints(0);
          ghostRecorder.start();
          if (ghostPlayer) ghostPlayer.reset();
          return;
        }

        gameState.incrementCheckpoint(checkpointResult.index);
        checkpointManager.updatePlayerCheckpointHighlight(gameState.lastCheckpointPassed);
        uiManager.updateCheckpoints(gameState.checkpointCount);

        // Lap complete
        if (gameState.checkpointCount === checkpointManager.getTotalCheckpoints()) {
          const now = Date.now();
          const lapTime = truckData.lapStartTime ? now - truckData.lapStartTime : 0;
          truckData.lapStartTime = now;
          const lapCount = gameState.completeLap(lapTime);
          checkpointManager.resetForTruck('player');
          checkpointManager.updatePlayerCheckpointHighlight(0);
          uiManager.updateCheckpoints(0);

          console.log(`[HotLap] Lap ${lapCount}: ${(lapTime / 1000).toFixed(2)}s`);

          // Save ghost if this is a new best lap
          const lapFrames = ghostRecorder.stop();
          if (lapFrames && (bestLapMs === null || lapTime < bestLapMs)) {
            bestLapMs = lapTime;
            saveGhost(trackKey, lapTime, lapFrames);
            raceStore.hotLapBestMs = bestLapMs;

            // Update live ghost with the new best
            if (ghostPlayer) ghostPlayer.dispose();
            ghostPlayer = new GhostPlayer(scene, lapFrames);
            ghostPlayer.setVisible(raceStore.hotLapGhostVisible);
            this.ghostPlayer = ghostPlayer;

            console.log(`[HotLap] New best: ${(lapTime / 1000).toFixed(2)}s`);
          }

          // Start recording next lap
          ghostRecorder.start();
          if (ghostPlayer) ghostPlayer.reset();

          uiManager.updateTruckStatus([{
            id: 'player',
            name: 'You',
            color: playerColor ?? basicColors.red.diffuse,
            lap: lapCount,
            totalLaps: '--',
            boosts: gameState.boostCount,
            boostActive: playerTruck.state.boostActive,
            finished: false,
          }]);
        }
      });

      frameProfiler.measure('debug.update', () => debugManager.update(debugInfo, terrainManager, currentTrack, playerTruck));
      frameProfiler.measure('camera.update', () => cameraController.update(playerTruck.mesh.position, playerTruck.state.heading, dt));
      frameRenderStartMs = performance.now();
    });

    return scene;
  }

  teardown() {
    if (this.ghostPlayer) {
      this.ghostPlayer.dispose();
      this.ghostPlayer = null;
    }
    if (this.ghostRecorder) {
      this.ghostRecorder.reset();
      this.ghostRecorder = null;
    }
    if (this.debugManager) {
      this.debugManager.hide();
      this.debugManager.hideVehicleOverlay();
    }
    if (this.uiManager) {
      const raceStore = this.uiManager._race;
      raceStore.hotLapMode = false;
      raceStore.hotLapBestMs = null;
      raceStore.hotLapGhostVisible = false;
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
