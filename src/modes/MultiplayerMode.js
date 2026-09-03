import { Vector3 } from "@babylonjs/core";
import { Truck } from "../truck/truck.js";
import { GameState } from "../managers/GameState.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { DebugManager } from "../managers/DebugManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { AudioManager } from "../managers/AudioManager.js";
import { TruckAudioController } from "../managers/TruckAudioController.js";
import { DriveMode } from "./DriveMode.js";
import { basicColors, TRUCK_HALF_HEIGHT } from "../constants.js";
import { loadPlayerUpgrades } from "../managers/UpgradeStorage.js";
import { multiplayerClient } from "../multiplayer/MultiplayerClient.js";
import { RemotePuppet } from "../multiplayer/RemotePuppet.js";

// Outbound truck-state broadcast rate. Faster than this just spends bandwidth
// on updates RemotePuppet's smoothing (CHASE_RATE) would mostly discard.
const NETWORK_SEND_INTERVAL = 1 / 15;

/**
 * MultiplayerMode — a race, not just free-drive: laps/checkpoints are tracked
 * the same way RaceMode tracks them (each client runs checkpointManager
 * against its own local physics — see truck/truck.js), but there's no AI and
 * no local truck-vs-truck race logic for other players. Instead each client
 * self-reports its own lap/finish events to the room (server/DriveRoom.js),
 * which is the single arbiter of finish order and the "everyone's done"
 * results trigger — see MultiplayerClient's reportLap/reportFinished and the
 * raceProgress/playerFinished/raceOver events. Other players are rendered as
 * RemotePuppets driven by position broadcasts, same as before.
 *
 * Deliberately left out for this first pass (candidates for later iteration):
 * truck-vs-truck collision between players, a DNF timer for stragglers,
 * telemetry/ghosts, the checkpoint-arrow pointer and floating pickup text.
 */
export class MultiplayerMode extends DriveMode {
  constructor(controller) {
    super(controller);
    this.inputManager = null;
    this.audioManager = null;
    this.truckAudioController = null;
    this._remotePuppets = new Map(); // sessionId -> RemotePuppet
    this._sendAccumulator = 0;
    this._netUnsubscribers = [];
    this._countdownTimeouts = [];
  }

  async setup({ trackKey, vehicleKey = 'baja', playerColorKey = null, reverse = false, laps = 3 }) {
    const { engine, menuManager } = this.controller;
    const totalLaps = laps || 3;

    const {
      scene,
      cameraController,
      shadows,
      currentTrack,
      terrainManager,
      obstacleManager,
      decorationManager,
      pickupManager,
      checkpointManager,
    } = await this.buildDriveScene(trackKey);

    this.scene = scene;
    const frameProfiler = this.initFrameProfiler('MultiplayerMode');

    const audioManager = await AudioManager.create(scene);
    this.audioManager = audioManager;
    pickupManager.setAudioManager(audioManager);
    // Money pickups are a championship-only feature; irrelevant here.
    pickupManager.enableMoney = false;

    // SceneBuilder created checkpoints in forward order; rebuild for reverse so
    // gate order/headings (and the grid spawn below) match the host's choice.
    if (reverse) {
      checkpointManager._reverse = true;
      checkpointManager.rebuild();
    }

    const { maxCheckpointNumber, startFinishCp } = this.getStartFinishInfo(currentTrack);
    const getGridSpawn = this.makeGridSpawner(currentTrack, checkpointManager, startFinishCp);

    // Every client resolves the same grid slot for the same player independently
    // (sorted session ids), so trucks don't need the server to assign order.
    const knownIds = new Set(multiplayerClient.players.keys());
    knownIds.add(multiplayerClient.selfId);
    const sortedIds = Array.from(knownIds).sort();
    const mySlot = Math.max(0, sortedIds.indexOf(multiplayerClient.selfId));
    const playerId = multiplayerClient.selfId;

    const vehicleDef = window.vehicleLoader?.getVehicle(vehicleKey) ?? null;
    this.truckAudioController = await TruckAudioController.create(audioManager, vehicleDef?.engineAudio);
    const playerColor = playerColorKey ? basicColors[playerColorKey]?.diffuse : null;
    const playerUpgrades = loadPlayerUpgrades();
    const playerTruck = new Truck(scene, shadows, playerColor, null, vehicleDef, playerUpgrades);
    playerTruck.setAudioController(this.truckAudioController);

    const spawn0 = getGridSpawn(mySlot);
    playerTruck.mesh.position.copyFrom(spawn0.pos);
    playerTruck.state.heading = spawn0.heading;
    playerTruck.mesh.rotation.y = spawn0.heading;

    const gameState = new GameState(playerTruck.state.maxBoosts);
    // Prime so the truck is ready to cross the start/finish line first.
    gameState.lastCheckpointPassed = maxCheckpointNumber > 0 ? maxCheckpointNumber - 1 : 0;
    let hasStarted = false; // crossed the start/finish line at least once

    const trucks = [{ truck: playerTruck }];
    this.respawnTruck(playerTruck, spawn0.pos, spawn0.heading);
    checkpointManager.updatePlayerCheckpointHighlight(gameState.lastCheckpointPassed);

    // -- Standings (for the shared truck-status HUD) --
    // id -> { name, colorKey, lap, finished }
    const standings = new Map();
    const addStanding = (id, name, colorKey) => standings.set(id, { name, colorKey, lap: 0, finished: false });
    addStanding(playerId, multiplayerClient.players.get(playerId)?.name ?? 'You', playerColorKey);
    multiplayerClient.players.forEach((p, id) => {
      if (id !== playerId) addStanding(id, p.name, p.colorKey);
    });

    // -- Remote players: visual-only puppets driven by network state --
    const spawnPuppet = (player) => {
      if (!player || player.id === playerId) return;
      if (this._remotePuppets.has(player.id)) return;
      const remoteVehicleDef = window.vehicleLoader?.getVehicle(player.vehicleKey) ?? vehicleDef;
      const puppet = new RemotePuppet(scene, shadows, {
        vehicleDef: remoteVehicleDef,
        colorKey: player.colorKey,
        dims: { width: playerTruck.width, height: playerTruck.height, depth: playerTruck.depth },
      });
      if (Number.isFinite(player.x)) puppet.setTarget(player.x, player.y, player.z, player.heading ?? 0);
      this._remotePuppets.set(player.id, puppet);
    };
    multiplayerClient.players.forEach(spawnPuppet);

    // -- UI --
    const uiManager = new UIManager();
    this.uiManager = uiManager;
    uiManager.showRaceStatusPanel();
    uiManager.updateLaps(0, totalLaps);

    const colorFor = (id) => {
      const colorKey = standings.get(id)?.colorKey;
      return (colorKey ? basicColors[colorKey]?.diffuse : null) ?? basicColors.gray.diffuse;
    };
    const syncTruckStatus = () => {
      uiManager.updateTruckStatus(
        Array.from(standings.entries()).map(([id, s]) => ({
          id,
          name: s.name,
          isPlayer: id === playerId,
          color: colorFor(id),
          lap: s.lap,
          totalLaps,
          boosts: id === playerId ? gameState.boostCount : 0,
          boostActive: id === playerId ? playerTruck.state.boostActive : false,
          finished: s.finished,
        })),
        totalLaps
      );
    };
    syncTruckStatus();

    const debugManager = new DebugManager(scene);
    this.debugManager = debugManager;
    const staticBodyCollisionManager = new StaticBodyCollisionManager(scene);

    // -- Network events --
    const onJoin = (player) => {
      spawnPuppet(player);
      if (!standings.has(player.id)) addStanding(player.id, player.name, player.colorKey);
      syncTruckStatus();
    };
    const onLeave = (id) => {
      this._remotePuppets.get(id)?.dispose();
      this._remotePuppets.delete(id);
      standings.delete(id);
      syncTruckStatus();
    };
    const onState = (data) => {
      const puppet = this._remotePuppets.get(data.id);
      if (puppet) puppet.setTarget(data.x, data.y, data.z, data.heading);
      else spawnPuppet(multiplayerClient.players.get(data.id));
    };
    const onRaceProgress = ({ id, lap }) => {
      const s = standings.get(id);
      if (!s) return;
      s.lap = lap;
      syncTruckStatus();
    };
    const onPlayerFinished = ({ id }) => {
      const s = standings.get(id);
      if (!s) return;
      s.finished = true;
      syncTruckStatus();
    };
    const onRaceOver = ({ rows }) => {
      const resultRows = rows.map(r => ({
        id: r.id,
        name: r.name,
        isPlayer: r.id === playerId,
        finishPosition: r.finishPosition,
        totalRaceTimeMs: r.totalTimeMs,
        fastestLapMs: r.fastestLapMs,
        dnf: r.totalTimeMs == null,
      }));
      menuManager.showSingleRaceResults({ trackKey, rows: resultRows });
    };
    multiplayerClient.on('join', onJoin);
    multiplayerClient.on('leave', onLeave);
    multiplayerClient.on('state', onState);
    multiplayerClient.on('raceProgress', onRaceProgress);
    multiplayerClient.on('playerFinished', onPlayerFinished);
    multiplayerClient.on('raceOver', onRaceOver);
    this._netUnsubscribers = [
      () => multiplayerClient.off('join', onJoin),
      () => multiplayerClient.off('leave', onLeave),
      () => multiplayerClient.off('state', onState),
      () => multiplayerClient.off('raceProgress', onRaceProgress),
      () => multiplayerClient.off('playerFinished', onPlayerFinished),
      () => multiplayerClient.off('raceOver', onRaceOver),
    ];

    // -- Respawn to last checkpoint (used for both the R-key reset and OOB) --
    const respawnToLastCheckpoint = () => {
      if (!hasStarted) {
        this.respawnTruck(playerTruck, spawn0.pos, spawn0.heading, staticBodyCollisionManager);
        return;
      }
      const lastCpNum = gameState.lastCheckpointPassed;
      let cpFeature;
      if (lastCpNum > 0) {
        const gates = checkpointManager.checkpointMeshes
          .map(cp => cp.feature)
          .filter(f => f.checkpointNumber === lastCpNum);
        const px = playerTruck.mesh.position.x;
        const pz = playerTruck.mesh.position.z;
        cpFeature = gates.reduce((best, g) => {
          if (!best) return g;
          const bd = (best.centerX - px) ** 2 + (best.centerZ - pz) ** 2;
          const gd = (g.centerX - px) ** 2 + (g.centerZ - pz) ** 2;
          return gd < bd ? g : best;
        }, null);
      } else {
        cpFeature = this.getStartFinishCheckpoint(checkpointManager) ?? startFinishCp;
      }
      if (cpFeature) {
        const y = currentTrack.getHeightAt(cpFeature.centerX, cpFeature.centerZ) + TRUCK_HALF_HEIGHT;
        this.respawnTruck(
          playerTruck,
          new Vector3(cpFeature.centerX, y, cpFeature.centerZ),
          cpFeature.heading,
          staticBodyCollisionManager
        );
      } else {
        this.respawnTruck(playerTruck, spawn0.pos, spawn0.heading, staticBodyCollisionManager);
      }
    };

    // -- Input --
    this.cameraController = cameraController;
    const inputManager = new InputManager(playerTruck, cameraController);
    this.inputManager = inputManager;
    inputManager.onPause(() => menuManager.showPauseMenu());
    inputManager.onTogglePhotoMode(() => this.togglePhotoMode());
    this.setupDebugToggle(inputManager, debugManager);
    inputManager.onToggleVehicleDebug(() => debugManager.toggleVehicleOverlay());
    inputManager.onBoost(() => {
      if (gameState.useBoost() && !playerTruck.state.boostActive) {
        playerTruck.state.boostActive = true;
        playerTruck.state.boostTimer = playerTruck.state.boostDuration;
        uiManager.updateBoosts(gameState.boostCount);
      }
    });
    inputManager.onReset(() => respawnToLastCheckpoint());

    menuManager.onResume = () => menuManager.hideMenu();
    menuManager.onReset = () => {
      respawnToLastCheckpoint();
      menuManager.hideMenu();
    };
    menuManager.onExit = () => {
      this.controller.switchToMode('menu');
    };

    pickupManager.onPickupCollected = (type, _truckData, value = 1) => {
      if (type !== 'boost') return; // coins are a championship-only feature
      gameState.boostCount += value;
      uiManager.updateBoosts(gameState.boostCount);
    };

    const slowZones = this.getSlowZones(currentTrack);
    const outOfBoundsZones = this.getOutOfBoundsZones(currentTrack);
    const speedBoostZones = this.getSpeedBoostZones(currentTrack);
    const fireworkZones = this.getFireworkZones(currentTrack);

    // -- Countdown --
    let raceStarted = false;
    let raceStartTime = null;
    let countdownActive = false;
    let lapStartTime = null;

    const startCountdown = () => {
      this._countdownTimeouts.forEach(clearTimeout);
      this._countdownTimeouts = [];
      countdownActive = true;
      this.respawnTruck(playerTruck, spawn0.pos, spawn0.heading, staticBodyCollisionManager);

      uiManager.showCountdown('3');
      this._countdownTimeouts.push(setTimeout(() => uiManager.showCountdown('2'), 1000));
      this._countdownTimeouts.push(setTimeout(() => uiManager.showCountdown('1'), 2000));
      this._countdownTimeouts.push(setTimeout(() => {
        uiManager.showCountdown('GO!');
        countdownActive = false;
        if (maxCheckpointNumber === 0 && !raceStarted) {
          raceStarted = true;
          raceStartTime = Date.now();
          lapStartTime = Date.now();
          uiManager.showRaceTimer();
        }
      }, 3000));
      this._countdownTimeouts.push(setTimeout(() => uiManager.hideCountdown(), 3800));
    };

    this.setupVisibilityHandler(scene, trucks);
    let frameRenderStartMs = 0;
    const timerUiIntervalMs = 50; // HUD shows MM:SS.cc; no need to push every frame
    let timerUiElapsedMs = 0;

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

      if (raceStarted && raceStartTime !== null) {
        timerUiElapsedMs += dt * 1000;
        if (timerUiElapsedMs >= timerUiIntervalMs) {
          timerUiElapsedMs = 0;
          frameProfiler.measure('ui.timer', () => uiManager.updateTimer(Date.now() - raceStartTime));
        }
      }

      const input = frameProfiler.measure('input', () => (
        countdownActive
          ? { forward: false, back: false, left: false, right: false }
          : inputManager.getMovementInput()
      ));

      // Finished truck coasts to a stop under its own drag (zero input).
      const truckInput = gameState.raceFinished ? { forward: false, back: false, left: false, right: false } : input;
      const debugInfo = frameProfiler.measure(
        'truck.update',
        () => playerTruck.update(truckInput, dt, terrainManager, currentTrack, true, null, frameProfiler)
      );

      frameProfiler.measure('zones.slow', () => this.applySlowZones(trucks, slowZones));
      frameProfiler.measure('zones.boost', () => this.applySpeedBoostZones(trucks, speedBoostZones));
      frameProfiler.measure('zones.fireworks', () => this.updateFireworkZones(scene, currentTrack, trucks, fireworkZones, dt));

      const oobRemaining = frameProfiler.measure('zones.oob', () => this.updateOutOfBoundsCountdown({
        truckId: playerId,
        truck: playerTruck,
        outOfBoundsZones,
        track: currentTrack,
        dt,
        durationSec: 5,
        onTimeout: () => respawnToLastCheckpoint(),
      }));
      if (oobRemaining == null) uiManager.hideOutOfBoundsCountdown();
      else uiManager.showOutOfBoundsCountdown(oobRemaining);

      frameProfiler.measure('collision.staticBodies', () => staticBodyCollisionManager.update(trucks, dt));
      frameProfiler.measure('obstacles.update', () => obstacleManager.update(trucks, dt));
      frameProfiler.measure('decorations.update', () => decorationManager.update(trucks, dt));
      frameProfiler.measure('pickups.update', () => pickupManager.update(trucks, dt));
      frameProfiler.measure('camera.update', () => cameraController.update(playerTruck.mesh.position, playerTruck.state.heading, dt));
      frameProfiler.measure('ui.boost', () => uiManager.setBoostActive(playerTruck.state.boostActive));

      frameProfiler.measure('multiplayer.puppets', () => {
        this._remotePuppets.forEach(puppet => puppet.update(dt));
      });

      this._sendAccumulator += dt;
      if (this._sendAccumulator >= NETWORK_SEND_INTERVAL) {
        this._sendAccumulator = 0;
        frameProfiler.measure('multiplayer.send', () => {
          multiplayerClient.sendState({
            x: playerTruck.mesh.position.x,
            y: playerTruck.mesh.position.y,
            z: playerTruck.mesh.position.z,
            heading: playerTruck.state.heading,
          });
        });
      }

      // -- Checkpoints/laps (local player only — see class doc) --
      frameProfiler.measure('checkpoints.laps', () => {
        if (gameState.raceFinished) return;

        const checkpointResult = checkpointManager.update(
          playerTruck.mesh.position,
          playerTruck.state.velocity,
          gameState.lastCheckpointPassed,
          playerId
        );
        if (!checkpointResult?.passed) return;

        // Start/finish crossing: start the race timer and reset sequence so
        // lap flow begins at checkpoint 1.
        if (checkpointResult.index === maxCheckpointNumber && !hasStarted) {
          hasStarted = true;
          if (!raceStarted) {
            raceStarted = true;
            raceStartTime = Date.now();
            uiManager.showRaceTimer();
          }
          lapStartTime = Date.now();
          gameState.lastCheckpointPassed = 0;
          gameState.checkpointCount = 0;
          checkpointManager.resetForTruck(playerId);
          checkpointManager.updatePlayerCheckpointHighlight(gameState.lastCheckpointPassed);
          uiManager.updateCheckpoints(0);
          return;
        }

        const newCount = gameState.incrementCheckpoint(checkpointResult.index);
        checkpointManager.updatePlayerCheckpointHighlight(gameState.lastCheckpointPassed);
        uiManager.updateCheckpoints(newCount);

        if (newCount !== checkpointManager.getTotalCheckpoints()) return;

        const currentTime = Date.now();
        const lapTime = lapStartTime ? currentTime - lapStartTime : 0;
        lapStartTime = currentTime;
        const lapCount = gameState.completeLap(lapTime);
        checkpointManager.resetForTruck(playerId);
        pickupManager.spawnForLap(lapCount);
        if (lapCount === totalLaps - 1) playerTruck.audioController?.playLastLapAirhorn();

        if (lapCount >= totalLaps) checkpointManager.clearPlayerCheckpointHighlight();
        else checkpointManager.updatePlayerCheckpointHighlight(gameState.lastCheckpointPassed);
        uiManager.updateLaps(lapCount, totalLaps);
        uiManager.updateCheckpoints(0);

        const mine = standings.get(playerId);
        if (mine) mine.lap = lapCount;
        syncTruckStatus();
        multiplayerClient.reportLap({ lap: lapCount, lapTimeMs: lapTime });

        if (lapCount >= totalLaps) {
          const totalTime = currentTime - raceStartTime;
          gameState.finishRace(totalTime);
          playerTruck.state.velocity = Vector3.Zero();
          if (mine) mine.finished = true;
          syncTruckStatus();
          multiplayerClient.reportFinished({ totalTimeMs: totalTime, fastestLapMs: gameState.fastestLap });
        }
      });

      frameProfiler.measure('debug.update', () => debugManager.update(debugInfo, terrainManager, currentTrack, playerTruck));
      frameRenderStartMs = performance.now();
    });

    cameraController.update(playerTruck.mesh.position, playerTruck.state.heading);
    startCountdown();

    return scene;
  }

  teardown() {
    this._countdownTimeouts.forEach(clearTimeout);
    this._countdownTimeouts = [];
    this._netUnsubscribers.forEach(fn => fn());
    this._netUnsubscribers = [];
    this._remotePuppets.forEach(puppet => puppet.dispose());
    this._remotePuppets.clear();
    multiplayerClient.leave();

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
