import { Truck } from "../truck/truck.js";
import { GameState } from "../managers/GameState.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { DebugManager } from "../managers/DebugManager.js";
import { TruckCollisionManager } from "../managers/TruckCollisionManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { basicColors } from "../constants.js";
import { DriveMode } from "./DriveMode.js";
import { TelemetryRecorder } from "../managers/TelemetryRecorder.js";
import { AudioManager } from "../managers/AudioManager.js";
import { TruckAudioController } from "../managers/TruckAudioController.js";
import { MusicManager, playTheme, stopTheme } from "../managers/MusicManager.js";
import { setupAIDrivers } from "../ai/setupAIDrivers.js";
import { loadPlayerUpgrades, jitterUpgrades } from "../managers/UpgradeStorage.js";
import { RacePositionLabels } from "../managers/RacePositionLabels.js";
import { FloatingTextManager } from "../managers/FloatingTextManager.js";
import { CheckpointArrow } from "../managers/CheckpointArrow.js";
import { loadGameplaySettings } from "../settingsStorage.js";
import { RaceSimulation } from "../sim/RaceSimulation.js";
import { randomSeed, rngStream } from "../sim/rng.js";
import { buildRaceResultRows } from "./race-results.js";

/**
 * RaceMode – full racing gameplay.
 *
 * Owns the Babylon scene, truck(s), input, UI, checkpoint/lap tracking
 * and the game loop. Delegates scene construction to SceneBuilder.
 *
 * Structure: setup() builds everything into `this._race` (the scene managers,
 * the truck list), then the rest of the class works off that object. The race
 * rules and state — clock, laps, finish order, DNF grace — live in `r.sim`, a
 * RaceSimulation with no presentation; this class feeds it input and turns its
 * events into HUD, audio and telemetry:
 *   _stepRace   — one fixed step: sim.step(), then truck effects / fireworks
 *   _simEvents  — sim callbacks (start, checkpoints, laps, finish, OOB, end)
 *   _renderRace — once per frame (HUD, labels, minimap, camera)
 *   _startCountdown / _resetGame / _onRaceEnd
 */
const TRUCK_STATUS_UI_INTERVAL_MS = 200;

export class RaceMode extends DriveMode {
  constructor(controller) {
    super(controller);
    this.inputManager = null;
    this.debugManager = null;
    this.audioManager = null;
    this.truckAudioController = null;
    this.musicManager = null;
    this.positionLabels = null;
    this.floatingText = null;
    this.checkpointArrow = null;
    this._gameplaySettingsChangedHandler = null;
    this._race = null; // everything setup() builds — see the class comment
  }

  async setup({ trackKey, laps, aiCount = 9, vehicleKey = 'baja', aiVehicleKey = 'random', playerColorKey = null, reverse = false, night = false, championship = null }) {
    const { menuManager } = this.controller;

    const built = await this.buildDriveScene(trackKey, { night, reverse });
    const { scene, shadows, currentTrack, checkpointManager, pickupManager } = built;
    this.scene = scene;
    const frameProfiler = this.initFrameProfiler('RaceMode');
    // Update shadows every other frame to reduce render cost in races.
    if (shadows?.setRefreshRate) {
      shadows.setRefreshRate(2);
    } else {
      const shadowMap = shadows?.getShadowMap?.();
      if (shadowMap) shadowMap.refreshRate = 2;
    }
    const audioManager = await AudioManager.create(scene);
    this.audioManager = audioManager;
    pickupManager.setAudioManager(audioManager);
    this.musicManager = await MusicManager.create(audioManager);
    await playTheme(audioManager);
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
    const { maxCheckpointNumber, startFinishCp } = this.getStartFinishInfo(currentTrack);

    const r = this._race = {
      ...built,                   // scene, cameraController, currentTrack, managers…
      trackKey,
      championship,
      // Seeds every random draw in the race's sim (sim/rng.js).
      seed: randomSeed(),
      totalLaps: laps || 3,
      frameProfiler,
      audioManager,
      maxCheckpointNumber,
      startFinishCp,
      getGridSpawn: this.makeGridSpawner(currentTrack, checkpointManager, startFinishCp),
      // Kept live via the settings-changed event below, so changing the
      // Gameplay > Rubber Band setting from the pause menu applies on the next
      // step instead of needing a race restart.
      rubberBandLevel: loadGameplaySettings().rubberBand,
      countdownActive: false,

      // Cash collected from money pickups this race, per driver id. Applied to
      // each driver's championship wallet at race end (see _onRaceEnd).
      moneyCollected: {},

      playerDebugInfo: null,
      truckStatusUiElapsedMs: 0,
    };
    this._gameplaySettingsChangedHandler = (e) => {
      r.rubberBandLevel = e.detail?.rubberBand ?? loadGameplaySettings().rubberBand;
      if (r.sim) r.sim.rubberBandLevel = r.rubberBandLevel;
    };
    window.addEventListener('offroad:gameplay-settings-changed', this._gameplaySettingsChangedHandler);

    await this._createTrucks({ vehicleKey, aiVehicleKey, aiCount, playerColorKey });
    this._createRaceUi();
    this._wireInputAndMenus(menuManager);
    this._wirePickups();

    r.sim = new RaceSimulation({
      trucks: r.trucks,
      track: currentTrack,
      terrainManager: r.terrainManager,
      checkpointManager,
      truckCollisionManager: r.truckCollisionManager,
      staticBodyCollisionManager: r.staticBodyCollisionManager,
      obstacleManager: r.obstacleManager,
      pickupManager,
      aiDrivers: r.aiDrivers,
      totalLaps: r.totalLaps,
      maxCheckpointNumber,
      startFinishCp,
      getGridSpawn: r.getGridSpawn,
      focusId: r.playerTruckData.id,
      rubberBandLevel: r.rubberBandLevel,
      profiler: frameProfiler,
      events: this._simEvents(),
      seed: r.seed,
    });
    checkpointManager.updatePlayerCheckpointHighlight(r.playerTruckData.gameState.lastCheckpointPassed);

    // Fireworks are presentation; the sim applies the other zone types.
    r.fireworkZones = this.getFireworkZones(currentTrack);

    // Setup visibility handler to prevent physics accumulation
    this.setupVisibilityHandler(scene, r.trucks);

    // -- Game loop -- installRaceFrameLoop owns the frame envelope (dt clamp,
    // profiler frame, photo mode, menu bail, HUD-timer throttle, fixed step)
    // and calls onStep (simulation, SIM_DT) / onRender (presentation, frame dt).
    this.installRaceFrameLoop({
      engine: this.controller.engine,
      scene,
      uiManager: r.uiManager,
      inputManager: this.inputManager,
      isMenuUp: () => menuManager.isMenuActive(),
      isCountdownActive: () => r.countdownActive,
      getRaceStartMs: () => (r.sim.started && r.sim.startMs !== null ? r.sim.startMs : null),
      getRaceClockMs: () => r.sim.clockMs,
      getMeshes: () => r.trucks.map(td => td.truck.mesh),
      onStep: (dt, input) => this._stepRace(dt, input),
      onRender: (dt) => this._renderRace(dt),
    });

    // Start the pre-race countdown
    const player = r.playerTruckData.truck;
    r.cameraController.update(player.mesh.position, player.state.heading); // pre-snap before first frame
    this._startCountdown();

    return scene;
  }

  // ── Setup pieces ───────────────────────────────────────────────────────────

  /** Player truck, AI field, telemetry, and the shared `r.trucks` list. */
  async _createTrucks({ vehicleKey, aiVehicleKey, aiCount, playerColorKey }) {
    const r = this._race;
    const { scene, shadows, championship, getGridSpawn } = r;

    // In a championship the starting grid is ordered by standings (leader on
    // pole), so the player can grid anywhere; otherwise they start on pole.
    const playerGridSlot = championship?.playerGridSlot ?? 0;
    const spawn0 = getGridSpawn(playerGridSlot);

    const playerVehicleDef = window.vehicleLoader?.getVehicle(vehicleKey) ?? null;
    this.truckAudioController = await TruckAudioController.create(r.audioManager, playerVehicleDef?.engineAudio);
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
    r.telemetryRecorder = new TelemetryRecorder(r.trackKey, /* checkpoints resolved below */ []);

    // ── AI drivers ───────────────────────────────────────────────────────────
    const getAIName  = championship?.aiNames ? (i) => championship.aiNames[i] : (i) => `AI ${i + 1}`;
    const getAIId    = (i) => `ai${i + 1}`;
    const getAIDriver = this.makeAIDriverFactory({
      currentTrack: r.currentTrack,
      checkpointManager: r.checkpointManager,
      wallManager: r.wallManager,
      scene,
      terrainManager: r.terrainManager,
      championship,
      seed: r.seed,
    });

    // In a championship, AI colour/vehicle come from the persisted roster so a
    // given AI keeps its identity race to race (indexed by ai order).
    const getAIColorKey   = championship?.aiColorKeys   ? (i) => championship.aiColorKeys[i]   : null;
    const getAIVehicleKey = championship?.aiVehicleKeys ? (i) => championship.aiVehicleKeys[i] : null;
    // Outside a championship there's no AI economy to earn upgrades from, so
    // give each AI truck a jittered variant of the player's own upgrade
    // levels (each category +/-1) to keep the race competitive without
    // every AI being identically tuned.
    const getAIUpgrades   = championship?.aiUpgrades    ? (i) => championship.aiUpgrades[i]    : () => jitterUpgrades(playerUpgrades);
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
      random: rngStream(r.seed, 'grid'),
    });
    r.aiDrivers = aiDrivers;

    // Grab the canonical checkpoint list from the first AI driver (already sorted)
    const telemetryCheckpoints = aiDrivers[0]?.checkpoints ?? [];
    // Patch the recorder's checkpoint list now that we have it
    r.telemetryRecorder._checkpoints = telemetryCheckpoints;

    // If saved telemetry exists, load it into all AI drivers
    const savedTelemetry = window._telemetryStore?.[r.trackKey] ?? null;
    if (savedTelemetry && telemetryCheckpoints.length) {
      const { TelemetryPlayer } = await import("../managers/TelemetryPlayer.js");
      const tp = new TelemetryPlayer(r.trackKey, telemetryCheckpoints);
      if (tp.loadFromObject(savedTelemetry)) {
        const waypoints = tp.buildWaypoints();
        aiDrivers.forEach(d => d.loadTelemetry(waypoints));
      }
    }

    r.trucks = [
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
    r.playerTruckData = r.trucks[0];
    aiTruckDataList.forEach((td, i) => {
      const d = aiDrivers[i];
      if (!d) return;
      d.setGameState(td.gameState);
      d.setRaceContext(td, r.trucks);
    });
  }

  /** HUD, debug overlay, position badges, minimap, popups, arrow, collisions. */
  _createRaceUi() {
    const r = this._race;
    const { scene } = r;

    r.uiManager = new UIManager();
    this.uiManager = r.uiManager;
    // Register telemetry recorder with the Vue store so RaceHUD buttons can control it
    r.uiManager.setTelemetryRecorder(r.telemetryRecorder);
    r.uiManager.showRaceStatusPanel();
    r.uiManager.updateLaps(0, r.totalLaps);
    this._syncTruckStatus();

    r.debugManager = new DebugManager(scene);
    this.debugManager = r.debugManager;

    // -- Floating 1st/2nd/3rd badges above the leading trucks --
    this.positionLabels = new RacePositionLabels(scene);
    r.trucks.forEach(td => this.positionLabels.attach(td));

    // -- Track overview, bottom-right --
    const dotColors = r.trucks.map(td => DriveMode.dotColor(td.truck.diffuseColor));
    this.setupMinimap(r.currentTrack, r.startFinishCp, () => r.trucks.map((td, i) => ({
      x: td.truck.mesh.position.x,
      z: td.truck.mesh.position.z,
      color: dotColors[i],
      isPlayer: td.isPlayer,
    })));

    // Transient world popups ("+$500" on coin pickup).
    this.floatingText = new FloatingTextManager(scene);

    // -- Pointer orbiting the player truck toward the next checkpoint --
    this.checkpointArrow = new CheckpointArrow(scene, r.checkpointManager);

    // -- Truck collision --
    r.truckCollisionManager = new TruckCollisionManager();
    r.staticBodyCollisionManager = new StaticBodyCollisionManager(scene);
    // Give AI drivers a reference to the collision manager so respawns flush prevPos
    r.aiDrivers.forEach(d => d.setStaticBodyCollisionManager(r.staticBodyCollisionManager));
  }

  /** Keyboard (pause, photo, debug, nitro, reset) and the pause-menu callbacks. */
  _wireInputAndMenus(menuManager) {
    const r = this._race;
    const player = r.playerTruckData;

    this.cameraController = r.cameraController;
    this.inputManager = new InputManager(player.truck, r.cameraController);

    this.inputManager.onPause(() => menuManager.togglePause());
    this.inputManager.onTogglePhotoMode(() => this.togglePhotoMode());
    this.setupDebugToggle(this.inputManager, r.debugManager);

    this.inputManager.onBoost(() => {
      if (r.sim.requestBoost(player.id)) r.uiManager.updateBoosts(player.gameState.boostCount);
    });
    this.inputManager.onReset(() => r.sim.requestRespawn(player.id));

    menuManager.onResume = () => menuManager.hideMenu();
    menuManager.onReset = () => {
      this._resetGame();
      menuManager.hideMenu();
    };
    menuManager.onExit = () => {
      this._resetGame();
      menuManager.gameStarted = false;
      menuManager.hideMenu();
      this.controller.exit();
    };
    // Retire (pause menu, championship only): wipe the saved cup, then take the
    // same teardown-to-menu path as Exit.
    menuManager.onRetireChampionship = () => {
      this.controller.retireChampionship();
      this._resetGame();
      menuManager.gameStarted = false;
      menuManager.hideMenu();
      this.controller.exit();
    };
  }

  /** Pickups are spawned as trucks complete laps (see RaceSimulation), not up
   *  front. Value scales with the lap, so grant it in full. */
  _wirePickups() {
    const r = this._race;
    r.pickupManager.onPickupCollected = (type, truckData, value = 1) => {
      if (type === 'boost' && truckData.gameState) {
        truckData.gameState.boostCount += value;
        if (truckData.isPlayer) {
          r.uiManager.updateBoosts(truckData.gameState.boostCount);
          this.floatingText.spawn(`+${value.toLocaleString()} nitro${value > 1 ? 's' : ''}`, truckData.truck.mesh.position);
        }
        return;
      }
      if (type === 'coin') {
        // Bank the cash for this driver; applied to their cup wallet at race end.
        r.moneyCollected[truckData.id] = (r.moneyCollected[truckData.id] ?? 0) + value;
        if (truckData.isPlayer) {
          truckData.truck.audioController?.playReload?.();
          this.floatingText.spawn(`+$${value.toLocaleString()}`, truckData.truck.mesh.position);
        }
      }
    };
  }

  // ── Race flow ──────────────────────────────────────────────────────────────

  _syncTruckStatus() {
    const r = this._race;
    r.uiManager.updateTruckStatus(
      r.trucks.map(td => ({
        id: td.id,
        name: td.name,
        isPlayer: td.isPlayer,
        color: td.truck.diffuseColor?.clone?.() ?? td.truck.diffuseColor ?? null,
        lap: td.gameState.lapCount,
        totalLaps: r.totalLaps,
        boosts: td.gameState.boostCount,
        boostActive: td.truck.state.boostActive,
        finished: td.gameState.raceFinished,
      })),
      r.totalLaps
    );
  }

  _startCountdown() {
    const r = this._race;
    r.countdownActive = true;
    r.aiDrivers.forEach(d => { d.paused = true; });
    // Restarting mid-race (pause-menu reset) hands audio back to the theme
    // for the new countdown; on the very first call this is a no-op since
    // the theme is already playing from setup().
    this.musicManager?.stop();
    playTheme(r.audioManager);

    // Re-snap all trucks to their grid positions with zeroed physics state and
    // the handbrake on. This neutralises any drift from the large first-frame
    // dt that accumulates during async scene setup, so trucks are clean when
    // the player sees "3".
    r.sim.placeOnGrid({ parked: true });

    this.runCountdownSequence(r.uiManager, () => {
      r.countdownActive = false;
      r.aiDrivers.forEach(d => { d.paused = false; });
      // Green light: hand off from the theme to the regular playlist.
      stopTheme(r.audioManager);
      this.musicManager?.start();
      r.sim.go();
    });
  }

  /** Full race reset (pause menu Restart / Exit). */
  _resetGame() {
    const r = this._race;
    r.uiManager.hideRaceTimer();
    r.sim.reset();

    r.checkpointManager.rebuild();
    r.checkpointManager.updatePlayerCheckpointHighlight(r.playerTruckData.gameState.lastCheckpointPassed);
    r.wallManager.rebuild();
    r.obstacleManager.rebuild();
    r.pickupManager.clearAll();
    // wall/obstacle rebuild disposed and recreated the collider meshes, so the
    // collision manager must drop its cached (now-disposed) collider list —
    // stale bounds otherwise phantom-collide and pin trucks in place after reset.
    r.staticBodyCollisionManager.invalidateColliderCache();

    r.uiManager.updateBoosts(r.playerTruckData.gameState.boostCount);
    r.uiManager.updateLaps(0, r.totalLaps);
    r.uiManager.updateCheckpoints(0);

    this._syncTruckStatus();
    this._startCountdown();
  }

  /** The sim ended the race (everyone finished, or the DNF grace ran out). */
  _onRaceEnd(finishOrder) {
    const r = this._race;
    r.checkpointManager.clearPlayerCheckpointHighlight();

    // Stop the player engine loop immediately when the race ends.
    // The post-race summary screen is shown before this mode is torn down,
    // so waiting for teardown would leave the engine audio running there.
    this.truckAudioController?.stop();

    const rows = buildRaceResultRows(finishOrder, r.trucks);
    // The post-race screen (single-race results or the championship pit) is
    // its own view — clear the race HUD and stop rendering the frozen race
    // scene behind it until this mode tears down.
    r.uiManager.hideAll();
    this.controller.engine.stopRenderLoop();

    // In a championship, hand the finish order (ids, winner first) back to the
    // cup orchestrator, which awards points/purse and drives the standings →
    // pit → next-race flow in place of the single-race results screen.
    if (r.championship?.onRaceComplete) {
      // Leftover nitro per driver so it carries into the next race.
      const remainingNitro = Object.fromEntries(
        r.trucks.map(td => [td.id, td.gameState.boostCount])
      );
      r.championship.onRaceComplete(rows.map(row => row.id), {
        trackKey: r.trackKey, rows, remainingNitro, moneyCollected: r.moneyCollected,
      });
    } else {
      this.controller.menuManager.showSingleRaceResults({ trackKey: r.trackKey, rows });
    }
  }

  // ── Game loop ──────────────────────────────────────────────────────────────

  /** One fixed physics step (SIM_DT) — see installRaceFrameLoop. */
  _stepRace(dt, input) {
    const r = this._race;
    const { frameProfiler: fp, trucks } = r;
    const player = r.playerTruckData;

    r.sim.step(dt, { [player.id]: input });
    r.playerDebugInfo = player.truck.getDebugInfo();

    // Per-step truck effects (body puppet, audio, particles, tire marks, wake).
    fp.measure('trucks.presentation', () => trucks.forEach((td) =>
      td.truck.updatePresentation(dt, r.terrainManager, r.currentTrack, player.truck.mesh.position, fp)
    ));
    fp.measure('zones.fireworks', () =>
      this.updateFireworkZones(r.scene, r.currentTrack, trucks, r.fireworkZones, dt)
    );

    // Feed the telemetry recorder each step for the player truck.
    fp.measure('telemetry.player', () => {
      if (r.telemetryRecorder.recording && r.sim.started) {
        const pt = player.truck;
        r.telemetryRecorder.update(
          { x: pt.mesh.position.x, z: pt.mesh.position.z },
          forwardSpeed(pt),
          dt * 1000,
          r.playerDebugInfo.terrainGripMultiplier ?? 1
        );
      }
    });
  }

  /** RaceSimulation callbacks → HUD, checkpoint highlight, audio, telemetry. */
  _simEvents() {
    const r = () => this._race;
    const playerGrip = () => r().playerTruckData.truck.simFrame.terrainGripMultiplier ?? 1;
    const recordCheckpoint = (index, pos) => {
      const { telemetryRecorder, playerTruckData } = r();
      if (telemetryRecorder.recording) {
        telemetryRecorder.onCheckpointPassed(index, pos, forwardSpeed(playerTruckData.truck), playerGrip());
      }
    };

    return {
      onRaceStart: () => {
        r().uiManager.showRaceTimer();
        console.debug("Race started!");
      },

      onStartLine: (td, pos) => {
        if (!td.isPlayer) return;
        r().checkpointManager.updatePlayerCheckpointHighlight(td.gameState.lastCheckpointPassed);
        r().uiManager.updateCheckpoints(0);
        // Auto-start telemetry recording when the player crosses the start line.
        recordCheckpoint(r().maxCheckpointNumber, pos);
      },

      onCheckpoint: (td, index, count, pos) => {
        if (!td.isPlayer) return;
        recordCheckpoint(index, pos);
        r().checkpointManager.updatePlayerCheckpointHighlight(td.gameState.lastCheckpointPassed);
        r().uiManager.updateCheckpoints(count);
      },

      onLap: (td, lapCount, lapTime) => {
        const { totalLaps, checkpointManager, uiManager } = r();
        if (!td.isPlayer) {
          console.debug(`[${td.name}] Completed lap ${lapCount} in ${(lapTime / 1000).toFixed(2)}s!`);
          return;
        }
        // Air horn as the player starts the last lap.
        if (lapCount === totalLaps - 1) td.truck.audioController?.playLastLapAirhorn();
        if (lapCount >= totalLaps) checkpointManager.clearPlayerCheckpointHighlight();
        else checkpointManager.updatePlayerCheckpointHighlight(td.gameState.lastCheckpointPassed);
        uiManager.updateLaps(lapCount, totalLaps);
        uiManager.updateCheckpoints(0);
        console.debug(`Lap ${lapCount} completed in ${(lapTime / 1000).toFixed(2)}s`);
      },

      onFinish: (td, totalTime) => {
        if (!td.isPlayer) {
          console.debug(`[${td.name}] Finished race! Total time: ${(totalTime / 1000).toFixed(2)}s`);
          return;
        }
        console.debug("\n=== RACE FINISHED ===");
        console.debug(`Total Time: ${(totalTime / 1000).toFixed(2)}s`);
        console.debug("Lap Times:");
        td.gameState.lapTimes.forEach((time, i) => {
          console.debug(`  Lap ${i + 1}: ${(time / 1000).toFixed(2)}s`);
        });
      },

      onOutOfBounds: (td, remaining) => {
        if (!td.isPlayer) return;
        if (remaining == null) r().uiManager.hideOutOfBoundsCountdown();
        else r().uiManager.showOutOfBoundsCountdown(remaining);
      },

      onRaceEnd: (finishOrder) => this._onRaceEnd(finishOrder),
    };
  }

  /** Once per render frame — presentation only (see installRaceFrameLoop). */
  _renderRace(dt) {
    const r = this._race;
    const { frameProfiler: fp, trucks } = r;
    const player = r.playerTruckData.truck;

    fp.measure('decorations.update', () => r.decorationManager.update(trucks, dt));
    fp.measure('floatingText.update', () => this.floatingText.update(dt));
    fp.measure('checkpointArrow.update', () => this.checkpointArrow.update(player.mesh));

    r.truckStatusUiElapsedMs += dt * 1000;
    if (r.truckStatusUiElapsedMs >= TRUCK_STATUS_UI_INTERVAL_MS) {
      this._syncTruckStatus();
      r.truckStatusUiElapsedMs = 0;
    }

    fp.measure('debug.update', () => r.debugManager.update(r.playerDebugInfo, r.terrainManager, r.currentTrack, player));
    fp.measure('ui.boost', () => r.uiManager.setBoostActive(player.state.boostActive));

    fp.measure('positions', () => {
      if (r.sim.started && !r.sim.ended) this.positionLabels.update(trucks, r.checkpointManager, r.sim.finishOrder);
      else this.positionLabels.hideAll();
    });

    fp.measure('minimap', () => this.updateMinimap());

    fp.measure('camera.update', () => r.cameraController.update(player.mesh.position, player.state.heading, dt, player.state.velocity));
  }

  teardown() {
    if (this._gameplaySettingsChangedHandler) {
      window.removeEventListener('offroad:gameplay-settings-changed', this._gameplaySettingsChangedHandler);
      this._gameplaySettingsChangedHandler = null;
    }
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
      this.musicManager?.stop();
      this.musicManager = null;
      this.audioManager.dispose();
      this.audioManager = null;
    }
    super.teardown();
  }
}

/** Speed along the truck's heading (m/s) — telemetry's forward speed. */
function forwardSpeed(truck) {
  const h = truck.state.heading;
  return truck.state.velocity.x * Math.sin(h) + truck.state.velocity.z * Math.cos(h);
}
