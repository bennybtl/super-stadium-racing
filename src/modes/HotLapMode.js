import { Truck } from "../truck/truck.js";
import { GameState } from "../managers/GameState.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { DebugManager } from "../managers/DebugManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { AudioManager } from "../managers/AudioManager.js";
import { TruckAudioController } from "../managers/TruckAudioController.js";
import { GhostRecorder, GHOST_SCHEMA_VERSION } from "../managers/GhostRecorder.js";
import { GhostPlayer } from "../managers/GhostPlayer.js";
import { DriveMode } from "./DriveMode.js";
import { basicColors } from "../constants.js";
import { loadPlayerUpgrades } from "../managers/UpgradeStorage.js";
import { useRaceStore } from "../vue/store.js";

const GHOST_STORAGE_PREFIX = "hotlap_ghost_";

// Best laps are per track AND per vehicle — box size and pace both differ by
// vehicle, so a lap in one truck must not become the "best" shown in another.
function ghostKey(trackKey, vehicleKey) {
  return `${GHOST_STORAGE_PREFIX}${trackKey}__${vehicleKey}`;
}

function loadGhost(trackKey, vehicleKey) {
  try {
    const raw = localStorage.getItem(ghostKey(trackKey, vehicleKey));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.version !== GHOST_SCHEMA_VERSION) return null;
    if (!Array.isArray(data.frames) || data.frames.length === 0) return null;
    if (typeof data.frames[0].t !== 'number') return null;
    return data;
  } catch { return null; }
}

function saveGhost(trackKey, vehicleKey, payload) {
  // Defer the stringify + write off the render frame so a new best lap doesn't
  // hitch the exact frame the player crosses the finish line.
  setTimeout(() => {
    const key = ghostKey(trackKey, vehicleKey);
    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // Quota exceeded — retry once at half resolution rather than losing the
      // ghost (and the persisted best time) entirely.
      try {
        const decimated = { ...payload, frames: payload.frames.filter((_, i) => i % 2 === 0) };
        localStorage.setItem(key, JSON.stringify(decimated));
        console.warn('[HotLap] Ghost too large; saved at reduced resolution.');
      } catch (e) {
        console.warn('[HotLap] Failed to persist best-lap ghost:', e?.name ?? e);
      }
    }
  }, 0);
}

/**
 * HotLapMode – single-player time trial with a best-lap ghost.
 *
 * One truck, no AI, continuous timed laps against a translucent replay of the
 * player's own best lap (persisted per track+vehicle in localStorage).
 */
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

    // Checkpoints are already created by SceneBuilder.buildScene — do not
    // re-create them here (that would double every gate and break lap counting).
    const { maxCheckpointNumber, startFinishCp } = this.getStartFinishInfo(currentTrack);
    if (maxCheckpointNumber === 0) {
      console.warn('[HotLap] Track has no checkpoints; lap timing and ghost are disabled.');
    }

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

    const gameState = new GameState();
    // Prime lastCheckpointPassed so the truck is ready to cross the start/finish
    // gate first (it spawns just behind it), matching RaceMode.
    gameState.lastCheckpointPassed = maxCheckpointNumber > 0 ? maxCheckpointNumber - 1 : 0;
    const truckData = { truck: playerTruck, isPlayer: true, hasStarted: false };
    const trucks = [truckData];

    this.respawnTruck(playerTruck, spawnPos, heading);

    // -- Ghost --
    const ghostRecorder = new GhostRecorder();
    this.ghostRecorder = ghostRecorder;

    const savedGhost = loadGhost(trackKey, vehicleKey);
    if (savedGhost) {
      this.ghostPlayer = new GhostPlayer(scene, savedGhost.frames, { dims: savedGhost.dims ?? truckDims, vehicleDef });
    }
    let bestLapMs = savedGhost?.lapTimeMs ?? null;

    // -- UI --
    const uiManager = new UIManager();
    this.uiManager = uiManager;
    const raceStore = useRaceStore();
    uiManager.showRaceStatusPanel();
    uiManager.showRaceTimer();
    uiManager.updateLaps(0, null);
    uiManager.updateTimer(0);

    const pushTruckStatus = (lap, boostActive) => uiManager.updateTruckStatus([{
      id: 'player',
      name: 'You',
      color: playerColor ?? basicColors.red.diffuse,
      lap,
      totalLaps: '--',
      boosts: gameState.boostCount,
      boostActive,
      finished: false,
    }]);
    pushTruckStatus(0, false);

    // Hot-lap HUD state (best-lap readout + ghost toggle). Cleared centrally by
    // UIManager.hideAll() on teardown.
    raceStore.hotLapMode = true;
    raceStore.hotLapBestMs = bestLapMs;
    raceStore.hotLapGhostVisible = true;

    if (maxCheckpointNumber > 0) {
      checkpointManager.updatePlayerCheckpointHighlight(gameState.lastCheckpointPassed);
    }

    const debugManager = new DebugManager(scene);
    this.debugManager = debugManager;
    const staticBodyCollisionManager = new StaticBodyCollisionManager(scene);

    // Full reset back to the staging line: fresh lap clock, checkpoint sequence,
    // and ghost recorder (so a mid-lap reset doesn't bake the teleport into a
    // saved ghost or keep the old clock running).
    const resetHotLap = () => {
      truckData.hasStarted = false;
      gameState.reset();
      gameState.lastCheckpointPassed = maxCheckpointNumber > 0 ? maxCheckpointNumber - 1 : 0;
      ghostRecorder.reset();
      checkpointManager.resetForTruck('player');
      if (maxCheckpointNumber > 0) {
        checkpointManager.updatePlayerCheckpointHighlight(gameState.lastCheckpointPassed);
      }
      uiManager.updateTimer(0);
      uiManager.updateCheckpoints(0);
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

      // -- Lap clock + ghost recording (dt-based, so paused/hidden time is
      //    excluded and lap time stays in sync with the recorded ghost). --
      if (ghostRecorder.recording) {
        ghostRecorder.record(playerTruck.mesh.position, playerTruck.state.heading, dt * 1000);
        uiManager.updateTimer(ghostRecorder.elapsedMs);
      }

      // -- Ghost playback (driven by the live lap clock, not its own counter) --
      if (this.ghostPlayer) {
        this.ghostPlayer.setVisible(raceStore.hotLapGhostVisible);
        if (raceStore.hotLapGhostVisible) {
          const lapMs = ghostRecorder.recording ? ghostRecorder.elapsedMs : 0;
          frameProfiler.measure('ghost.update', () => this.ghostPlayer.update(lapMs, dt));
        }
      }

      // -- Checkpoint / lap tracking --
      frameProfiler.measure('checkpoints.laps', () => {
        const checkpointResult = checkpointManager.update(
          playerTruck.mesh.position,
          playerTruck.state.velocity,
          gameState.lastCheckpointPassed,
          'player',
        );
        if (!checkpointResult?.passed) return;

        // Start/finish line crossing — first time starts the lap clock + ghost
        if (checkpointResult.index === maxCheckpointNumber && !truckData.hasStarted) {
          truckData.hasStarted = true;
          gameState.lastCheckpointPassed = 0;
          gameState.checkpointCount = 0;
          checkpointManager.resetForTruck('player');
          checkpointManager.updatePlayerCheckpointHighlight(0);
          uiManager.updateCheckpoints(0);
          ghostRecorder.start();
          return;
        }

        gameState.incrementCheckpoint(checkpointResult.index);
        checkpointManager.updatePlayerCheckpointHighlight(gameState.lastCheckpointPassed);
        uiManager.updateCheckpoints(gameState.checkpointCount);

        // Lap complete
        if (gameState.checkpointCount === checkpointManager.getTotalCheckpoints()) {
          const lapTime = Math.round(ghostRecorder.elapsedMs);
          const lapFrames = ghostRecorder.stop();
          const lapCount = gameState.completeLap(lapTime);
          checkpointManager.resetForTruck('player');
          checkpointManager.updatePlayerCheckpointHighlight(0);
          uiManager.updateCheckpoints(0);

          console.log(`[HotLap] Lap ${lapCount}: ${(lapTime / 1000).toFixed(2)}s`);

          // Save + swap in the new ghost if this beat the best lap
          const isRecord = lapFrames != null && (bestLapMs === null || lapTime < bestLapMs);
          if (isRecord) {
            bestLapMs = lapTime;
            saveGhost(trackKey, vehicleKey, {
              version: GHOST_SCHEMA_VERSION,
              lapTimeMs: lapTime,
              dims: truckDims,
              frames: lapFrames,
              savedAt: Date.now(),
            });
            raceStore.hotLapBestMs = bestLapMs;

            // Reuse the existing puppet (same vehicle) — just swap the lap data.
            if (this.ghostPlayer) this.ghostPlayer.setFrames(lapFrames);
            else this.ghostPlayer = new GhostPlayer(scene, lapFrames, { dims: truckDims, vehicleDef });
            this.ghostPlayer.setVisible(raceStore.hotLapGhostVisible);

            console.log(`[HotLap] New best: ${(lapTime / 1000).toFixed(2)}s`);
          }

          // Flash the lap result on-screen (fades via the HUD animation)
          raceStore.hotLapFlashMs = lapTime;
          raceStore.hotLapFlashRecord = isRecord;
          raceStore.hotLapFlashNonce++;

          // Begin recording the next lap
          ghostRecorder.start();
          pushTruckStatus(lapCount, playerTruck.state.boostActive);
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
