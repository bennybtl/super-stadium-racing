import { Vector3, MeshBuilder, StandardMaterial, Color3 } from "@babylonjs/core";
import { Truck } from "../truck/truck.js";
import { AIDriver, AI_SKILL_PRESETS } from "../ai/AIDriver.js";
import { GameState } from "../managers/GameState.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { DebugManager } from "../managers/DebugManager.js";
import { TruckCollisionManager } from "../managers/TruckCollisionManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { TRUCK_HALF_HEIGHT, basicColors } from "../constants.js";
import { DriveMode } from "./DriveMode.js";
import { TelemetryRecorder } from "../managers/TelemetryRecorder.js";
import { AudioManager } from "../managers/AudioManager.js";
import { TruckAudioController } from "../managers/TruckAudioController.js";
import { setupAIDrivers } from "../ai/setupAIDrivers.js";
import { loadPlayerUpgrades } from "../managers/UpgradeStorage.js";
import { RacePositionLabels } from "../managers/RacePositionLabels.js";
import { FloatingTextManager } from "../managers/FloatingTextManager.js";
import { CheckpointArrow } from "../managers/CheckpointArrow.js";

/**
 * RaceMode – full racing gameplay.
 *
 * Owns the Babylon scene, truck(s), input, UI, checkpoint/lap tracking
 * and the game loop. Delegates scene construction to SceneBuilder.
 */
const DNF_GRACE_MS = 45_000;

export class RaceMode extends DriveMode {
  constructor(controller) {
    super(controller);
    this.inputManager = null;
    this._countdownTimeouts = [];
    this._dnfTimer = null;
    this.debugManager = null;
    this.audioManager = null;
    this.truckAudioController = null;
    this.positionLabels = null;
    this.floatingText = null;
    this.checkpointArrow = null;
  }

  async setup({ trackKey, laps, aiCount = 9, vehicleKey = 'baja', aiVehicleKey = 'random', playerColorKey = null, reverse = false, championship = null }) {
    const { engine, menuManager } = this.controller;
    const totalLaps = laps || 3;

    const {
      scene,
      cameraController,
      shadows,
      currentTrack,
      terrainManager,
      checkpointManager,
      wallManager,
      obstacleManager,
      decorationManager,
      pickupManager,
    } = await this.buildDriveScene(trackKey);

    this.scene = scene;
    const frameProfiler = this.initFrameProfiler('RaceMode');
    const shadowMap = shadows?.getShadowMap?.();
    if (shadowMap) {
      // Update shadows every other frame to reduce render cost in races.
      shadowMap.refreshRate = 2;
    }
    const audioManager = await AudioManager.create(scene);
    this.audioManager = audioManager;
    pickupManager.setAudioManager(audioManager);
    // Money (coin) pickups only appear in championship races, where the wallet
    // they feed actually means something.
    pickupManager.enableMoney = !!championship;

    // Rebuild checkpoints with reverse flag (SceneBuilder already called createCheckpoints
    // with the default forward order; rebuild here with the race-specific direction).
    if (reverse) {
      checkpointManager._reverse = true;
      checkpointManager.rebuild();
    }

    // -- Starting grid (based on the last/finish checkpoint) --
    const {
      maxCheckpointNumber,
      startFinishCp,
    } = this.getStartFinishInfo(currentTrack);

    const resolveGridAnchorCheckpoint = () =>
      this.getStartFinishCheckpoint(checkpointManager) ?? startFinishCp;

    const getGridSpawn = this.makeGridSpawner(currentTrack, checkpointManager, startFinishCp);

    // -- Race state --
    let raceStarted = false;
    let raceStartTime = null;
    let countdownActive = false;

    // -- Finish / DNF tracking --
    const finishOrder  = [];   // truckData entries in finish order
    let dnfTimer       = null; // started when the first driver begins their last lap
    let raceEnded      = false;

    // Cash collected from money pickups this race, per driver id. Applied to
    // each driver's championship wallet at race end (see triggerRaceEnd meta).
    const moneyCollected = {};

    // Keep a reference on `this` so teardown() can cancel an in-flight timer
    const setDnfTimer = (t) => { dnfTimer = t; this._dnfTimer = t; };
    const clearDnfTimer = () => { clearTimeout(dnfTimer); dnfTimer = null; this._dnfTimer = null; };

    const triggerRaceEnd = () => {
      if (raceEnded) return;
      raceEnded = true;
      if (dnfTimer) { clearDnfTimer(); }
      checkpointManager.clearPlayerCheckpointHighlight();

      // Stop the player engine loop immediately when the race ends.
      // The post-race summary screen is shown before this mode is torn down,
      // so waiting for teardown would leave the engine audio running there.
      this.truckAudioController?.stop();

      // Freeze trucks that DNF'd (still moving with no path to finish)
      trucks.forEach(td => {
        if (!td.gameState.raceFinished) {
          td.truck.state.velocity = Vector3.Zero();
          td.truck.state.velocity.y = 0;
        }
      });

      // Show the post-race results screen.
      const finishedIds = new Set(finishOrder.map(td => td.id));
      const dnfTrucks   = trucks.filter(td => !finishedIds.has(td.id));
      const rows = [
        ...finishOrder.map((td, idx) => ({
          id:              td.id,
          name:            td.name,
          isPlayer:        td.isPlayer,
          finishPosition:  idx + 1,
          totalRaceTimeMs: td.gameState.totalRaceTime,
          fastestLapMs:    td.gameState.fastestLap,
          dnf:             false,
        })),
        ...dnfTrucks.map((td, idx) => ({
          id:              td.id,
          name:            td.name,
          isPlayer:        td.isPlayer,
          finishPosition:  finishOrder.length + idx + 1,
          totalRaceTimeMs: null,
          fastestLapMs:    null,
          dnf:             true,
        })),
      ];
      // In a championship, hand the finish order (ids, winner first) back to the
      // cup orchestrator, which awards points/purse and drives the standings →
      // pit → next-race flow in place of the single-race results screen.
      if (championship?.onRaceComplete) {
        // Leftover nitro per driver so it carries into the next race.
        const remainingNitro = Object.fromEntries(
          trucks.map(td => [td.id, td.gameState.boostCount])
        );
        championship.onRaceComplete(rows.map(r => r.id), { trackKey, rows, remainingNitro, moneyCollected });
      } else {
        menuManager.showSingleRaceResults({ trackKey, rows });
      }
    };

    const handleDNF = () => {
      // Any truck that hasn't finished yet is DNF'd in truck-array order
      trucks
        .filter(td => !td.gameState.raceFinished)
        .forEach(td => {
          td.gameState.finishRace(null); // mark finished without a time
          finishOrder.push(td);
          console.debug(`[RaceMode] DNF: ${td.name}`);
        });
      triggerRaceEnd();
    };

    // -- Trucks --
    // In a championship the starting grid is ordered by standings (leader on
    // pole), so the player can grid anywhere; otherwise they start on pole.
    const playerGridSlot = championship?.playerGridSlot ?? 0;
    const spawn0 = getGridSpawn(playerGridSlot);

    const playerVehicleDef = window.vehicleLoader?.getVehicle(vehicleKey) ?? null;
    this.truckAudioController = await TruckAudioController.create(audioManager, playerVehicleDef?.engineAudio);
    const playerColor = playerColorKey ? basicColors[playerColorKey]?.diffuse : null;
    // In a championship the player drives their per-cup upgrade state (starts at
    // stock, earned over the series); otherwise the global single-race upgrades.
    const playerUpgrades = championship?.playerUpgrades ?? loadPlayerUpgrades();
    const playerTruck = new Truck(scene, shadows, playerColor, null, playerVehicleDef, playerUpgrades);
    playerTruck.setAudioController(this.truckAudioController);
    playerTruck.mesh.position.copyFrom(spawn0.pos);
    playerTruck.state.heading = spawn0.heading;
    playerTruck.mesh.rotation.y = spawn0.heading;

    // ── Telemetry ────────────────────────────────────────────────────────────
    const telemetryRecorder = new TelemetryRecorder(trackKey, /* checkpoints resolved below */ []);

    // ── AI drivers ───────────────────────────────────────────────────────────
    const getAIName  = championship?.aiNames ? (i) => championship.aiNames[i] : (i) => `AI ${i + 1}`;
    const getAIId    = (i) => `ai${i + 1}`;
    const getAISkill = (_i) => ({});
    const getAIDriver = (i) => {
      // In a championship, each AI keeps the skill preset persisted in its roster
      // entry; outside a cup, cycle good/ok/bad by grid slot as before.
      if (championship?.aiSkills) {
        const preset = AI_SKILL_PRESETS[championship.aiSkills[i]] ?? AI_SKILL_PRESETS.ok;
        return new AIDriver(currentTrack, checkpointManager, wallManager, scene, preset);
      }
      const slot = i % 3;
      if (slot === 0) return AIDriver.createGoodDriver(currentTrack, checkpointManager, wallManager, scene);
      if (slot === 1) return AIDriver.createOkDriver(currentTrack, checkpointManager, wallManager, scene);
      return AIDriver.createBadDriver(currentTrack, checkpointManager, wallManager, scene);
    };

    // In a championship, AI colour/vehicle come from the persisted roster so a
    // given AI keeps its identity race to race (indexed by ai order).
    const getAIColorKey   = championship?.aiColorKeys   ? (i) => championship.aiColorKeys[i]   : null;
    const getAIVehicleKey = championship?.aiVehicleKeys ? (i) => championship.aiVehicleKeys[i] : null;
    const getAIUpgrades   = championship?.aiUpgrades    ? (i) => championship.aiUpgrades[i]    : null;
    const getAIGridSlot   = championship?.aiGridSlots   ? (i) => championship.aiGridSlots[i]   : null;

    const { aiTruckDataList, aiDrivers } = setupAIDrivers({
      count: aiCount,
      scene,
      shadows,
      vehicleDef: playerVehicleDef,
      playerTruck,
      getGridSpawn,
      getAIName,
      getAIId,
      getAIDriver,
      getAIColorKey,
      getAIVehicleKey,
      getAIUpgrades,
      getAIGridSlot,
      aiVehicleKey,
      excludeColorKey: playerColorKey,
    });

    // Grab the canonical checkpoint list from the first AI driver (already sorted)
    const telemetryCheckpoints = aiDrivers[0]?.checkpoints ?? [];
    // Patch the recorder's checkpoint list now that we have it
    telemetryRecorder._checkpoints = telemetryCheckpoints;

    // If saved telemetry exists, load it into all AI drivers
    const savedTelemetry = window._telemetryStore?.[trackKey] ?? null;
    if (savedTelemetry && telemetryCheckpoints.length) {
      const { TelemetryPlayer } = await import("../managers/TelemetryPlayer.js");
      const tp = new TelemetryPlayer(trackKey, telemetryCheckpoints);
      if (tp.loadFromObject(savedTelemetry)) {
        const waypoints = tp.buildWaypoints();
        aiDrivers.forEach(d => d.loadTelemetry(waypoints));
      }
    }

    const trucks = [
      {
        truck: playerTruck,
        gameState: new GameState(playerTruck.state.maxBoosts),
        isPlayer: true,
        name: "Player",
        id: "player",
        gridSlot: playerGridSlot,
        hasStarted: false,
      },
      ...aiTruckDataList,
    ];

    const playerTruckData = trucks[0];
    aiTruckDataList.forEach((td, i) => {
      const d = aiDrivers[i];
      if (!d) return;
      d.setGameState(td.gameState);
      d.setRaceContext(td, trucks);
    });

    const syncTruckStatus = () => {
      uiManager.updateTruckStatus(
        trucks.map(td => ({
          id: td.id,
          name: td.name,
          isPlayer: td.isPlayer,
          color: td.truck.diffuseColor?.clone?.() ?? td.truck.diffuseColor ?? null,
          lap: td.gameState.lapCount,
          totalLaps,
          boosts: td.gameState.boostCount,
          boostActive: td.truck.state.boostActive,
          finished: td.gameState.raceFinished,
        })),
        totalLaps
      );
    };

    // Prime lastCheckpointPassed so trucks are ready to cross the start/finish line first
    trucks.forEach(td => {
      td.gameState.lastCheckpointPassed = maxCheckpointNumber > 0 ? maxCheckpointNumber - 1 : 0;
    });
    checkpointManager.updatePlayerCheckpointHighlight(playerTruckData.gameState.lastCheckpointPassed);

    // -- UI --
    const uiManager = new UIManager();
    this.uiManager = uiManager;
    // Register telemetry recorder with the Vue store so RaceHUD buttons can control it
    uiManager.setTelemetryRecorder(telemetryRecorder);
    // uiManager.showDebugPanel();
    uiManager.showRaceStatusPanel();
    uiManager.updateLaps(0, totalLaps);
    syncTruckStatus();

    const debugManager = new DebugManager(scene);
    this.debugManager = debugManager;

    // -- Floating 1st/2nd/3rd badges above the leading trucks --
    const positionLabels = new RacePositionLabels(scene);
    this.positionLabels = positionLabels;
    trucks.forEach(td => positionLabels.attach(td));

    // Transient world popups ("+$500" on coin pickup).
    const floatingText = new FloatingTextManager(scene);
    this.floatingText = floatingText;

    // -- Pointer orbiting the player truck toward the next checkpoint --
    const checkpointArrow = new CheckpointArrow(scene, checkpointManager);
    this.checkpointArrow = checkpointArrow;

    // -- Truck collision --
    const truckCollisionManager = new TruckCollisionManager();
    const staticBodyCollisionManager = new StaticBodyCollisionManager(scene);

    // Give AI drivers a reference to the collision manager so respawns flush prevPos
    aiDrivers.forEach(d => d.setStaticBodyCollisionManager(staticBodyCollisionManager));

    // -- Input --
    this.cameraController = cameraController;
    this.inputManager = new InputManager(playerTruckData.truck, cameraController);

    this.inputManager.onPause(() => menuManager.togglePause());
    this.inputManager.onTogglePhotoMode(() => this.togglePhotoMode());
    this.setupDebugToggle(this.inputManager, debugManager);

    this.inputManager.onBoost(() => {
      if (
        playerTruckData.gameState.useBoost() &&
        !playerTruckData.truck.state.boostActive
      ) {
        playerTruckData.truck.state.boostActive = true;
        playerTruckData.truck.state.boostTimer =
          playerTruckData.truck.state.boostDuration;
        uiManager.updateBoosts(playerTruckData.gameState.boostCount);
      }
    });

    // -- Respawn --
    // Teleport a truck to the center of the last checkpoint it physically passed.
    // Falls back to the player's grid spawn if the race hasn't started yet.
    const respawnToLastCheckpoint = (truckData) => {
      if (!truckData.hasStarted) {
        const { pos, heading } = getGridSpawn(truckData.gridSlot ?? (truckData.isPlayer ? 0 : 1));
        this.respawnTruck(truckData.truck, pos, heading, staticBodyCollisionManager);
        return;
      }
      const lastCpNum = truckData.gameState.lastCheckpointPassed;
      // Resolve gates from the manager, not the raw track features: in reverse
      // races the manager holds copies with flipped headings and renumbered
      // sequence, while the originals keep their forward numbering. When the step
      // has alternatives, respawn at the gate nearest the truck (the branch it took).
      let cpFeature;
      if (lastCpNum > 0) {
        const gates = checkpointManager.checkpointMeshes
          .map(cp => cp.feature)
          .filter(f => f.checkpointNumber === lastCpNum);
        const px = truckData.truck.mesh.position.x;
        const pz = truckData.truck.mesh.position.z;
        cpFeature = gates.reduce((best, g) => {
          if (!best) return g;
          const bd = (best.centerX - px) ** 2 + (best.centerZ - pz) ** 2;
          const gd = (g.centerX - px) ** 2 + (g.centerZ - pz) ** 2;
          return gd < bd ? g : best;
        }, null);
      } else {
        cpFeature = resolveGridAnchorCheckpoint();
      }
      if (cpFeature) {
        const y = currentTrack.getHeightAt(cpFeature.centerX, cpFeature.centerZ) + TRUCK_HALF_HEIGHT;
        this.respawnTruck(
          truckData.truck,
          new Vector3(cpFeature.centerX, y, cpFeature.centerZ),
          cpFeature.heading,
          staticBodyCollisionManager
        );
      } else {
        const { pos, heading } = getGridSpawn(truckData.gridSlot ?? (truckData.isPlayer ? 0 : 1));
        this.respawnTruck(truckData.truck, pos, heading, staticBodyCollisionManager);
      }
    };

    this.inputManager.onReset(() => respawnToLastCheckpoint(playerTruckData));

    // -- Pickups -- spawned as trucks complete laps (see the lap-complete block),
    // not scattered up front. Value scales with the lap, so grant it in full.
    pickupManager.onPickupCollected = (type, truckData, value = 1) => {
      if (type === 'boost' && truckData.gameState) {
        truckData.gameState.boostCount += value;
        if (truckData.isPlayer) {
          uiManager.updateBoosts(truckData.gameState.boostCount);
          floatingText.spawn(`+${value.toLocaleString()} nitro${value > 1 ? 's' : ''}`, truckData.truck.mesh.position);
        }
        return;
      }
      if (type === 'coin') {
        // Bank the cash for this driver; applied to their cup wallet at race end.
        moneyCollected[truckData.id] = (moneyCollected[truckData.id] ?? 0) + value;
        if (truckData.isPlayer) {
          truckData.truck.audioController?.playReload?.();
          floatingText.spawn(`+$${value.toLocaleString()}`, truckData.truck.mesh.position);
        }
        return;
      }
    };

    // -- Countdown --
    const startCountdown = () => {
      this._countdownTimeouts.forEach(clearTimeout);
      this._countdownTimeouts = [];
      countdownActive = true;
      aiDrivers.forEach(d => { d.paused = true; });

      // Re-snap all trucks to their grid positions with zeroed physics state.
      // This neutralises any drift from the large first-frame dt that accumulates
      // during async scene setup, so trucks are clean when the player sees "3".
      trucks.forEach((truckData, index) => {
        const { pos, heading } = getGridSpawn(index);
        this.respawnTruck(truckData.truck, pos, heading, staticBodyCollisionManager);
      });

      uiManager.showCountdown('3');
      this._countdownTimeouts.push(setTimeout(() => uiManager.showCountdown('2'), 1000));
      this._countdownTimeouts.push(setTimeout(() => uiManager.showCountdown('1'), 2000));
      this._countdownTimeouts.push(setTimeout(() => {
        uiManager.showCountdown('GO!');
        countdownActive = false;
        aiDrivers.forEach(d => { d.paused = false; });
        if (maxCheckpointNumber === 0 && !raceStarted) {
          raceStarted = true;
          raceStartTime = Date.now();
          trucks.forEach(t => t.lapStartTime = Date.now());
          uiManager.showRaceTimer();
        }
      }, 3000));
      this._countdownTimeouts.push(setTimeout(() => uiManager.hideCountdown(), 3800));
    };

    // -- Full race reset --
    const resetGame = () => {
      raceStarted = false;
      raceStartTime = null;
      trucks.forEach(t => t.lapStartTime = null);
      raceEnded = false;
      finishOrder.length = 0;
      if (dnfTimer) { clearDnfTimer(); }
      uiManager.hideRaceTimer();

      trucks.forEach((truckData, index) => {
        const { pos, heading } = getGridSpawn(index);
        // Use the proper respawn path. teleportTo zeroes the physics body and
        // notifyTeleport flushes the collision manager's stale previous position.
        // A bare mesh.position assignment leaves prevPos at the truck's pre-reset
        // spot, so the swept-AABB static-collision test drags the truck straight
        // back onto the track the moment the game loop resumes.
        this.respawnTruck(truckData.truck, pos, heading, staticBodyCollisionManager);
        truckData.gameState.reset();
        truckData.gameState.lastCheckpointPassed = maxCheckpointNumber > 0 ? maxCheckpointNumber - 1 : 0;
        truckData.hasStarted = false;
      });

      // Reset AI navigation + recovery state to match a freshly-built driver.
      // Without this the stuck-recovery and checkpoint-guidance watchers keep
      // stale state across the reset (a pending stuck-flag or gate-miss), and
      // fire a respawn the moment the countdown ends — teleporting AI trucks
      // off the grid back onto the track instead of starting them on the line.
      aiDrivers.forEach(d => {
        d.reset();
        d.currentCheckpointTarget = 0;
        d.lastCheckpointPassed = 0;
      });

      checkpointManager.rebuild();
      checkpointManager.updatePlayerCheckpointHighlight(playerTruckData.gameState.lastCheckpointPassed);
      wallManager.rebuild();
      obstacleManager.rebuild();
      pickupManager.clearAll();

      uiManager.updateBoosts(playerTruckData.gameState.boostCount);
      uiManager.updateLaps(0, totalLaps);
      uiManager.updateCheckpoints(0);

      syncTruckStatus();

      startCountdown();
    };

    // -- Menu callbacks --
    menuManager.onResume = () => menuManager.hideMenu();
    menuManager.onReset = () => {
      resetGame();
      menuManager.hideMenu();
    };

    menuManager.onExit = () => {
      resetGame();
      menuManager.gameStarted = false;
      menuManager.hideMenu();
      this.controller.exit();
    };

    // Retire (pause menu, championship only): wipe the saved cup, then take the
    // same teardown-to-menu path as Exit.
    menuManager.onRetireChampionship = () => {
      this.controller.retireChampionship();
      resetGame();
      menuManager.gameStarted = false;
      menuManager.hideMenu();
      this.controller.exit();
    };

    // Pre-filter 'slowZone' action zones for per-frame position checks
    const slowZones = this.getSlowZones(currentTrack);
    const outOfBoundsZones = this.getOutOfBoundsZones(currentTrack);
    const speedBoostZones = this.getSpeedBoostZones(currentTrack);
    const truckStatusUiIntervalMs = 200;
    const aiGripSampleIntervalMs = 100;
    // The HUD shows MM:SS.cc, so 20Hz is finer than the readout — pushing a new
    // value every frame re-renders the Vue component 60×/sec for nothing.
    const timerUiIntervalMs = 50;
    let truckStatusUiElapsedMs = 0;
    let aiGripSampleElapsedMs = 0;
    let timerUiElapsedMs = 0;

    // Setup visibility handler to prevent physics accumulation
    this.setupVisibilityHandler(scene, trucks);
    let frameRenderStartMs = 0;

    scene.onAfterRenderObservable.add(() => {
      if (frameRenderStartMs > 0) {
        frameProfiler.addDuration('render.pipeline', performance.now() - frameRenderStartMs);
        frameRenderStartMs = 0;
      }
      frameProfiler.endFrame();
    });

    // -- Game loop --
    scene.onBeforeRenderObservable.add(() => {
      if (document.hidden) return;

      // Use 50ms cap for race mode (more generous than default 20ms)
      const dt = this.getClampedDeltaTime(engine, 0.05);
      frameProfiler.beginFrame(dt);
      if (this._photoModeActive) {
        const input = frameProfiler.measure('input.photo', () => this.inputManager.getMovementInput());
        frameProfiler.measure('camera.photoMove', () => this.cameraController.moveFreeCamera(input, dt));
        frameProfiler.measure('camera.photoUpdate', () => this.cameraController.update());
        frameRenderStartMs = performance.now();
        return;
      }
      if (menuManager.isMenuActive()) {
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
          : this.inputManager.getMovementInput()
      ));

      frameProfiler.measure('collision.truck.pre', () => truckCollisionManager.preUpdate(trucks, dt));

      let playerDebugInfo = null;
      frameProfiler.measure('trucks.update', () => trucks.forEach((truckData) => {
        // Finished trucks still get physics updates (zero input) so they coast to a stop
        const isCoasting = truckData.gameState.raceFinished;
        const truckInput = (isCoasting || !truckData.isPlayer)
          ? { forward: false, back: false, left: false, right: false }
          : input;
        const debugInfo = truckData.truck.update(
          truckInput,
          dt,
          terrainManager,
          currentTrack,
          truckData.isPlayer,
          playerTruckData.truck.mesh.position,
          frameProfiler
        );
        if (truckData.isPlayer) {
          playerDebugInfo = debugInfo;
        }
      }));

      frameProfiler.measure('collision.staticBodies', () => staticBodyCollisionManager.update(trucks, dt));

      frameProfiler.measure('zones.slow', () => this.applySlowZones(trucks, slowZones));
      frameProfiler.measure('zones.boost', () => this.applySpeedBoostZones(trucks, speedBoostZones));

      frameProfiler.measure('zones.oob', () => trucks.forEach((truckData) => {
        const oobRemaining = this.updateOutOfBoundsCountdown({
          truckId: truckData.id,
          truck: truckData.truck,
          outOfBoundsZones,
          track: currentTrack,
          dt,
          durationSec: truckData.isPlayer ? 5 : 2,
          onTimeout: () => {
            respawnToLastCheckpoint(truckData);
          },
        });

        if (truckData.isPlayer) {
          if (oobRemaining == null) uiManager.hideOutOfBoundsCountdown();
          else uiManager.showOutOfBoundsCountdown(oobRemaining);
        }
      }));

      frameProfiler.measure('collision.truck.resolve', () => truckCollisionManager.update(trucks));
      frameProfiler.measure('obstacles.update', () => obstacleManager.update(trucks));
      frameProfiler.measure('decorations.update', () => decorationManager.update(trucks, dt));
      frameProfiler.measure('pickups.update', () => pickupManager.update(trucks, dt));
      frameProfiler.measure('floatingText.update', () => floatingText.update(dt));
      frameProfiler.measure('checkpointArrow.update', () => checkpointArrow.update(playerTruckData.truck.mesh));

      truckStatusUiElapsedMs += dt * 1000;
      if (truckStatusUiElapsedMs >= truckStatusUiIntervalMs) {
        syncTruckStatus();
        truckStatusUiElapsedMs = 0;
      }

      frameProfiler.measure('debug.update', () => debugManager.update(playerDebugInfo, terrainManager, currentTrack, playerTruckData.truck));
      frameProfiler.measure('ui.boost', () => uiManager.setBoostActive(playerTruckData.truck.state.boostActive));

      const engineSpeed = Math.sqrt(
        playerTruckData.truck.state.velocity.x * playerTruckData.truck.state.velocity.x +
        playerTruckData.truck.state.velocity.z * playerTruckData.truck.state.velocity.z
      );

      // Feed telemetry recorder each frame for the player truck
      frameProfiler.measure('telemetry.player', () => {
        if (telemetryRecorder.recording && raceStarted) {
          const pt = playerTruckData.truck;
          const fwdVec = new Vector3(Math.sin(pt.state.heading), 0, Math.cos(pt.state.heading));
          const fwdSpd = pt.state.velocity.dot(fwdVec);
          const currentGrip = playerDebugInfo?.terrainGripMultiplier ?? 1;
          telemetryRecorder.update(
            { x: pt.mesh.position.x, z: pt.mesh.position.z },
            fwdSpd,
            dt * 1000,
            currentGrip
          );
        }
      });

      // Keep each AI truck's last-known terrain grip updated for telemetry speed scaling.
      // Sampling at 10hz cuts redundant per-frame terrain lookups with minimal behavior change.
      frameProfiler.measure('ai.gripSample', () => {
        aiGripSampleElapsedMs += dt * 1000;
        if (aiGripSampleElapsedMs >= aiGripSampleIntervalMs) {
          trucks.forEach(td => {
            if (!td.isPlayer && td.truck.driver) {
              const terrain = terrainManager.getTerrainAt(td.truck.mesh.position);
              td.truck._lastTerrainGrip = terrain.gripMultiplier;
            }
          });
          aiGripSampleElapsedMs = 0;
        }
      });

      frameProfiler.measure('checkpoints.laps', () => trucks.forEach((truckData) => {
        if (truckData.gameState.raceFinished) return;

        const wasBoostActive = truckData._wasBoostActive ?? false;
        const nowBoostActive = truckData.truck.state.boostActive;
        truckData._wasBoostActive = nowBoostActive;

        const checkpointResult = checkpointManager.update(
          truckData.truck.mesh.position,
          truckData.truck.state.velocity,
          truckData.gameState.lastCheckpointPassed,
          truckData.id
        );

        if (!checkpointResult?.passed) return;

        // Start/finish crossing: start race timer and reset sequence so lap flow begins at CP 1
        if (checkpointResult.index === maxCheckpointNumber && !truckData.hasStarted) {
          truckData.hasStarted = true;
          
          if (!raceStarted) {
            raceStarted = true;
            raceStartTime = Date.now();
            uiManager.showRaceTimer();
            console.debug("Race started!");
          }
          
          truckData.lapStartTime = Date.now();
          truckData.gameState.lastCheckpointPassed = 0;
          truckData.gameState.checkpointCount = 0;
          checkpointManager.resetForTruck(truckData.id);
          if (truckData.isPlayer) {
            checkpointManager.updatePlayerCheckpointHighlight(truckData.gameState.lastCheckpointPassed);
            uiManager.updateCheckpoints(0);
            // Auto-start telemetry recording when player crosses the start line
            if (telemetryRecorder.recording) {
              telemetryRecorder.onCheckpointPassed(
                maxCheckpointNumber,
                { x: truckData.truck.mesh.position.x, z: truckData.truck.mesh.position.z },
                truckData.truck.state.velocity.dot(new Vector3(Math.sin(truckData.truck.state.heading), 0, Math.cos(truckData.truck.state.heading))),
                playerDebugInfo?.terrainGripMultiplier ?? 1
              );
            }
          }
          // Notify AI driver so it recalculates path toward checkpoint #1
          if (!truckData.isPlayer && truckData.truck.driver) {
            truckData.truck.driver.onCheckpointPassed(maxCheckpointNumber, {
              x: truckData.truck.mesh.position.x,
              z: truckData.truck.mesh.position.z,
            });
          }
          return;
        }

        const newCount = truckData.gameState.incrementCheckpoint(
          checkpointResult.index
        );

        if (!truckData.isPlayer && truckData.truck.driver) {
          truckData.truck.driver.onCheckpointPassed(checkpointResult.index, {
            x: truckData.truck.mesh.position.x,
            z: truckData.truck.mesh.position.z,
          });
        }

        // Feed mid-lap checkpoint events into the telemetry recorder
        if (truckData.isPlayer && telemetryRecorder.recording) {
          const fwdVec = new Vector3(Math.sin(truckData.truck.state.heading), 0, Math.cos(truckData.truck.state.heading));
          telemetryRecorder.onCheckpointPassed(
            checkpointResult.index,
            { x: truckData.truck.mesh.position.x, z: truckData.truck.mesh.position.z },
            truckData.truck.state.velocity.dot(fwdVec),
            playerDebugInfo?.terrainGripMultiplier ?? 1
          );
        }

        if (truckData.isPlayer) {
          checkpointManager.updatePlayerCheckpointHighlight(truckData.gameState.lastCheckpointPassed);
          uiManager.updateCheckpoints(newCount);
        }

        if (newCount === checkpointManager.getTotalCheckpoints()) {
          const currentTime = Date.now();
          const lapTime = truckData.lapStartTime ? currentTime - truckData.lapStartTime : 0;
          truckData.lapStartTime = currentTime;
          const lapCount = truckData.gameState.completeLap(lapTime);
          checkpointManager.resetForTruck(truckData.id);

          // Any truck finishing a lap has a chance to spawn a pickup, more
          // valuable on later laps (up to 3x nitro).
          pickupManager.spawnForLap(lapCount);

          // Play airhorn when player truck starts last lap
          if (truckData.isPlayer && lapCount === totalLaps - 1) {
            truckData.truck.audioController?.playLastLapAirhorn();
          }

          if (truckData.isPlayer) {
            if (lapCount >= totalLaps) checkpointManager.clearPlayerCheckpointHighlight();
            else checkpointManager.updatePlayerCheckpointHighlight(truckData.gameState.lastCheckpointPassed);
            uiManager.updateLaps(lapCount, totalLaps);
            uiManager.updateCheckpoints(0);
            console.debug(`Lap ${lapCount} completed in ${(lapTime / 1000).toFixed(2)}s`);
          } else {
            console.debug(
              `[${truckData.name}] Completed lap ${lapCount} in ${(lapTime / 1000).toFixed(2)}s!`
            );
          }

          if (lapCount >= totalLaps) {
            const totalTime = currentTime - raceStartTime;
            truckData.gameState.finishRace(totalTime);
            finishOrder.push(truckData);

            // Stop AI driver from issuing further steering inputs
            if (!truckData.isPlayer && truckData.truck.driver) {
              truckData.truck.driver.paused = true;
            }

            // For 1-lap races the "start final lap" trigger never fires, so start
            // the DNF timer here on first finish instead.
            if (dnfTimer === null && !raceEnded && finishOrder.length < trucks.length) {
              console.debug(`[RaceMode] ${truckData.name} finished — DNF timer started (${DNF_GRACE_MS / 1000}s)`);
              setDnfTimer(setTimeout(handleDNF, DNF_GRACE_MS));
            }

            if (truckData.isPlayer) {
              console.debug("\n=== RACE FINISHED ===");
              console.debug(`Total Time: ${(totalTime / 1000).toFixed(2)}s`);
              console.debug("Lap Times:");
              truckData.gameState.lapTimes.forEach((time, i) => {
                console.debug(`  Lap ${i + 1}: ${(time / 1000).toFixed(2)}s`);
              });
            } else {
              console.debug(
                `[${truckData.name}] Finished race! Total time: ${(totalTime / 1000).toFixed(2)}s`
              );
            }

            // All drivers finished — end race immediately
            if (finishOrder.length === trucks.length) {
              triggerRaceEnd();
            }
          }
        }
      }));

      frameProfiler.measure('positions', () => {
        if (raceStarted && !raceEnded) positionLabels.update(trucks, checkpointManager, finishOrder);
        else positionLabels.hideAll();
      });

      frameProfiler.measure('camera.update', () => cameraController.update(playerTruckData.truck.mesh.position, playerTruckData.truck.state.heading, dt));
      frameRenderStartMs = performance.now();
    });

    // Start the pre-race countdown
    cameraController.update(playerTruckData.truck.mesh.position, playerTruckData.truck.state.heading); // pre-snap before first frame
    startCountdown();

    return scene;
  }

  teardown() {
    this._countdownTimeouts.forEach(clearTimeout);
    this._countdownTimeouts = [];
    if (this._dnfTimer) { clearTimeout(this._dnfTimer); this._dnfTimer = null; }
    if (this.positionLabels) {
      this.positionLabels.dispose();
      this.positionLabels = null;
    }
    if (this.floatingText) {
      this.floatingText.dispose();
      this.floatingText = null;
    }
    if (this.checkpointArrow) {
      this.checkpointArrow.dispose();
      this.checkpointArrow = null;
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
    super.teardown();
  }
}
