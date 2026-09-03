import { Truck } from "../truck/truck.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { DebugManager } from "../managers/DebugManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { AudioManager } from "../managers/AudioManager.js";
import { TruckAudioController } from "../managers/TruckAudioController.js";
import { DriveMode } from "./DriveMode.js";
import { basicColors } from "../constants.js";
import { loadPlayerUpgrades } from "../managers/UpgradeStorage.js";
import { multiplayerClient } from "../multiplayer/MultiplayerClient.js";
import { RemotePuppet } from "../multiplayer/RemotePuppet.js";

// Outbound truck-state broadcast rate. Faster than this just spends bandwidth
// on updates RemotePuppet's smoothing (CHASE_RATE) would mostly discard.
const NETWORK_SEND_INTERVAL = 1 / 15;

/**
 * MultiplayerMode — free-drive like PracticeMode, plus other players'
 * trucks rendered as RemotePuppets driven by MultiplayerClient state
 * broadcasts. Each client simulates its own truck locally (see truck/truck.js)
 * and only shares position/heading — there is no server-authoritative physics.
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

  async setup({ trackKey, vehicleKey = 'baja', playerColorKey = null, reverse = false }) {
    const { engine, menuManager } = this.controller;

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

    // SceneBuilder created checkpoints in forward order; rebuild for reverse so
    // gate order/headings (and the grid spawn below) match the host's choice.
    if (reverse) {
      checkpointManager._reverse = true;
      checkpointManager.rebuild();
    }

    const { startFinishCp } = this.getStartFinishInfo(currentTrack);
    const getGridSpawn = this.makeGridSpawner(currentTrack, checkpointManager, startFinishCp);

    // Every client resolves the same grid slot for the same player independently
    // (sorted session ids), so trucks don't need the server to assign order.
    const knownIds = new Set(multiplayerClient.players.keys());
    knownIds.add(multiplayerClient.selfId);
    const sortedIds = Array.from(knownIds).sort();
    const mySlot = Math.max(0, sortedIds.indexOf(multiplayerClient.selfId));

    const vehicleDef = window.vehicleLoader?.getVehicle(vehicleKey) ?? null;
    this.truckAudioController = await TruckAudioController.create(audioManager, vehicleDef?.engineAudio);
    const playerColor = playerColorKey ? basicColors[playerColorKey]?.diffuse : null;
    const playerUpgrades = loadPlayerUpgrades();
    const playerTruck = new Truck(scene, shadows, playerColor, null, vehicleDef, playerUpgrades);
    playerTruck.setAudioController(this.truckAudioController);

    const { pos: spawnPos, heading } = getGridSpawn(mySlot);
    playerTruck.mesh.position.copyFrom(spawnPos);
    playerTruck.state.heading = heading;
    playerTruck.mesh.rotation.y = heading;

    const trucks = [{ truck: playerTruck }];
    this.respawnTruck(playerTruck, spawnPos, heading);

    // -- Remote players: visual-only puppets driven by network state --
    const spawnPuppet = (player) => {
      if (!player || player.id === multiplayerClient.selfId) return;
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

    const onJoin = (player) => spawnPuppet(player);
    const onLeave = (id) => {
      this._remotePuppets.get(id)?.dispose();
      this._remotePuppets.delete(id);
    };
    const onState = (data) => {
      const puppet = this._remotePuppets.get(data.id);
      if (puppet) puppet.setTarget(data.x, data.y, data.z, data.heading);
      else spawnPuppet(multiplayerClient.players.get(data.id));
    };
    multiplayerClient.on('join', onJoin);
    multiplayerClient.on('leave', onLeave);
    multiplayerClient.on('state', onState);
    this._netUnsubscribers = [
      () => multiplayerClient.off('join', onJoin),
      () => multiplayerClient.off('leave', onLeave),
      () => multiplayerClient.off('state', onState),
    ];

    // -- UI --
    const uiManager = new UIManager();
    this.uiManager = uiManager;

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

    const slowZones = this.getSlowZones(currentTrack);
    const outOfBoundsZones = this.getOutOfBoundsZones(currentTrack);
    const speedBoostZones = this.getSpeedBoostZones(currentTrack);
    const fireworkZones = this.getFireworkZones(currentTrack);

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
        () => playerTruck.update(input, dt, terrainManager, currentTrack, true, null, frameProfiler)
      );

      frameProfiler.measure('zones.slow', () => this.applySlowZones(trucks, slowZones));
      frameProfiler.measure('zones.boost', () => this.applySpeedBoostZones(trucks, speedBoostZones));
      frameProfiler.measure('zones.fireworks', () => this.updateFireworkZones(scene, currentTrack, trucks, fireworkZones, dt));

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

      frameProfiler.measure('collision.staticBodies', () => staticBodyCollisionManager.update(trucks, dt));
      frameProfiler.measure('obstacles.update', () => obstacleManager.update(trucks, dt));
      frameProfiler.measure('decorations.update', () => decorationManager.update(trucks, dt));
      frameProfiler.measure('pickups.update', () => pickupManager.update(trucks, dt));
      frameProfiler.measure('camera.update', () => cameraController.update(playerTruck.mesh.position, playerTruck.state.heading, dt));

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

      frameProfiler.measure('debug.update', () => debugManager.update(debugInfo, terrainManager, currentTrack, playerTruck));
      frameRenderStartMs = performance.now();
    });

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
