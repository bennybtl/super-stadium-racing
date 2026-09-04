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
import { basicColors, TRUCK_HALF_HEIGHT, TRUCK_WIDTH, TRUCK_HEIGHT, TRUCK_DEPTH } from "../constants.js";
import { loadPlayerUpgrades } from "../managers/UpgradeStorage.js";
import { multiplayerClient } from "../multiplayer/MultiplayerClient.js";
import { RemotePuppet } from "../multiplayer/RemotePuppet.js";
import { RemoteTruckCollision } from "../multiplayer/RemoteTruckCollision.js";

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
 * Truck-vs-truck collision (RemoteTruckCollision) only ever moves the LOCAL
 * truck — a puppet's position is network-driven, so pushing it locally would
 * just be overwritten by the next broadcast. Every client resolves the same
 * overlap from its own side, which approximates a shared bounce; see that
 * class's doc for the tradeoffs.
 *
 * Deliberately left out for this first pass (candidates for later iteration):
 * telemetry/ghosts, the checkpoint-arrow pointer, and floating pickup text.
 * A DNF timer *is* in place (server/DriveRoom.js's DNF_GRACE_MS) for a racer
 * who never finishes once someone else has.
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
  }

  async setup({ trackKey, vehicleKey = 'baja', playerColorKey = null, reverse = false, laps = 3 }) {
    const { engine, menuManager } = this.controller;
    const totalLaps = laps ?? 3;

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

    // -- Race progress (for the shared truck-status HUD) --
    // Only the two fields that don't already live anywhere else — name and
    // colorKey stay sourced live from multiplayerClient.players (the roster
    // is already the single source of truth for identity) rather than being
    // copied in here too.
    // id -> { lap, finished }
    const raceProgress = new Map();
    raceProgress.set(playerId, { lap: 0, finished: false });
    multiplayerClient.players.forEach((_p, id) => {
      if (id !== playerId) raceProgress.set(id, { lap: 0, finished: false });
    });

    // -- Remote players: visual-only puppets driven by network state --
    const remoteTruckCollision = new RemoteTruckCollision();
    const spawnPuppet = (player) => {
      if (!player || player.id === playerId) return;
      if (this._remotePuppets.has(player.id)) return;
      const remoteVehicleDef = window.vehicleLoader?.getVehicle(player.vehicleKey) ?? vehicleDef;
      // Each vehicle can define its own physicsBox (see truck/truck.js) — use
      // the remote player's actual vehicle dims, not the local truck's, so
      // collision distances against them are right.
      const box = remoteVehicleDef?.physicsBox ?? {};
      const puppet = new RemotePuppet(scene, shadows, {
        vehicleDef: remoteVehicleDef,
        colorKey: player.colorKey,
        dims: {
          width:  box.width  ?? TRUCK_WIDTH,
          height: box.height ?? TRUCK_HEIGHT,
          depth:  box.depth  ?? TRUCK_DEPTH,
        },
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

    // Own colorKey is the param passed into setup(); everyone else's comes
    // live from the roster (multiplayerClient.players), which is already
    // kept current by MultiplayerClient's own message handlers.
    const colorFor = (id) => {
      const colorKey = id === playerId ? playerColorKey : multiplayerClient.players.get(id)?.colorKey;
      return (colorKey ? basicColors[colorKey]?.diffuse : null) ?? basicColors.gray.diffuse;
    };
    const nameFor = (id) => (id === playerId ? 'You' : multiplayerClient.players.get(id)?.name) ?? 'Racer';
    const syncTruckStatus = () => {
      uiManager.updateTruckStatus(
        Array.from(raceProgress.entries()).map(([id, progress]) => ({
          id,
          name: nameFor(id),
          isPlayer: id === playerId,
          color: colorFor(id),
          lap: progress.lap,
          totalLaps,
          boosts: id === playerId ? gameState.boostCount : 0,
          boostActive: id === playerId ? playerTruck.state.boostActive : false,
          finished: progress.finished,
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
      if (!raceProgress.has(player.id)) raceProgress.set(player.id, { lap: 0, finished: false });
      syncTruckStatus();
    };
    const onLeave = (id) => {
      this._remotePuppets.get(id)?.dispose();
      this._remotePuppets.delete(id);
      raceProgress.delete(id);
      syncTruckStatus();
    };
    const onState = (data) => {
      const puppet = this._remotePuppets.get(data.id);
      if (puppet) puppet.setTarget(data.x, data.y, data.z, data.heading);
      else spawnPuppet(multiplayerClient.players.get(data.id));
    };
    const onRaceProgress = ({ id, lap }) => {
      const progress = raceProgress.get(id);
      if (!progress) return;
      progress.lap = lap;
      syncTruckStatus();
    };
    const onPlayerFinished = ({ id }) => {
      const progress = raceProgress.get(id);
      if (!progress) return;
      progress.finished = true;
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
    const respawnToLastCheckpoint = () => this.respawnAtLastCheckpoint(playerTruck, {
      lastCheckpointNumber: gameState.lastCheckpointPassed,
      hasStarted,
      checkpointManager,
      track: currentTrack,
      staticBodyCollisionManager,
      fallbackCheckpoint: startFinishCp,
      fallbackSpawn: () => spawn0,
    });

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
      countdownActive = true;
      this.respawnTruck(playerTruck, spawn0.pos, spawn0.heading, staticBodyCollisionManager);

      this.runCountdownSequence(uiManager, () => {
        countdownActive = false;
        if (maxCheckpointNumber === 0 && !raceStarted) {
          raceStarted = true;
          raceStartTime = Date.now();
          lapStartTime = Date.now();
          uiManager.showRaceTimer();
        }
      });
    };

    this.setupVisibilityHandler(scene, trucks);

    // installRaceFrameLoop owns the frame envelope (dt clamp, profiler frame,
    // photo mode, menu bail, HUD-timer throttle) and hands us (dt, input). The
    // body below keeps its indentation to keep this diff readable.
    this.installRaceFrameLoop({
      engine, scene, uiManager, inputManager,
      isMenuUp: () => menuManager.isPaused,
      isCountdownActive: () => countdownActive,
      getRaceStartMs: () => (raceStarted && raceStartTime !== null ? raceStartTime : null),
      onFrame: (dt, input) => {

      frameProfiler.measure('collision.remoteTrucks.pre', () =>
        remoteTruckCollision.preUpdate(playerTruck, this._remotePuppets.values(), dt)
      );

      // Finished truck coasts to a stop under its own drag (zero input).
      const truckInput = gameState.raceFinished ? { forward: false, back: false, left: false, right: false } : input;
      const debugInfo = frameProfiler.measure(
        'truck.update',
        () => playerTruck.update(truckInput, dt, terrainManager, currentTrack, true, null, frameProfiler)
      );

      this.applyZoneEffects(scene, currentTrack, trucks, { slowZones, speedBoostZones, fireworkZones }, dt, frameProfiler);

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
      frameProfiler.measure('collision.remoteTrucks', () =>
        remoteTruckCollision.update(playerTruck, this._remotePuppets.values())
      );
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

        const mine = raceProgress.get(playerId);
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

      }, // end onFrame
    });

    cameraController.update(playerTruck.mesh.position, playerTruck.state.heading);
    startCountdown();

    return scene;
  }

  teardown() {
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
