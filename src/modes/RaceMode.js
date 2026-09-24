import { Vector3 } from "@babylonjs/core";
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
import { stepRubberBandMultiplier } from "../ai/RubberBand.js";
import { buildRaceResultRows } from "./race-results.js";

/**
 * RaceMode – full racing gameplay.
 *
 * Owns the Babylon scene, truck(s), input, UI, checkpoint/lap tracking
 * and the game loop. Delegates scene construction to SceneBuilder.
 *
 * Structure: setup() builds everything into `this._race` (the scene managers,
 * the truck list, and the mutable race state — clock, started, finish order,
 * DNF deadline), then the rest of the class works off that object:
 *   _stepRace   — one fixed physics step (trucks, collisions, zones, laps)
 *   _updateLaps — checkpoint crossings, lap/race completion, DNF start
 *   _renderRace — once per frame (HUD, labels, minimap, camera)
 *   _startCountdown / _resetGame / _triggerRaceEnd / _handleDNF
 */
const DNF_GRACE_MS = 45_000;
const TRUCK_STATUS_UI_INTERVAL_MS = 200;
// AI last-known terrain grip (telemetry speed scaling), sampled at 10 Hz —
// cuts redundant per-step terrain lookups with minimal behaviour change.
const AI_GRIP_SAMPLE_INTERVAL_MS = 100;
const NO_INPUT = Object.freeze({ forward: false, back: false, left: false, right: false });

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

      // -- Race state --
      // Race timing runs on sim time: clockMs advances only in fixed physics
      // steps, so pausing, a background tab or slow frames never count against a
      // lap. startMs / each truck's lapStartTime / the DNF deadline are all on it.
      clockMs: 0,
      started: false,
      startMs: null,
      countdownActive: false,

      // -- Finish / DNF tracking --
      finishOrder: [],     // truckData entries in finish order
      dnfDeadlineMs: null, // race-clock time the DNF grace ends (set on first finish)
      ended: false,

      // Cash collected from money pickups this race, per driver id. Applied to
      // each driver's championship wallet at race end (see _triggerRaceEnd).
      moneyCollected: {},

      playerDebugInfo: null,
      truckStatusUiElapsedMs: 0,
      aiGripSampleElapsedMs: 0,
    };
    this._gameplaySettingsChangedHandler = (e) => {
      r.rubberBandLevel = e.detail?.rubberBand ?? loadGameplaySettings().rubberBand;
    };
    window.addEventListener('offroad:gameplay-settings-changed', this._gameplaySettingsChangedHandler);

    await this._createTrucks({ vehicleKey, aiVehicleKey, aiCount, playerColorKey });
    this._createRaceUi();
    this._wireInputAndMenus(menuManager);
    this._wirePickups();

    // Pre-filter action zones for per-step position checks
    r.slowZones = this.getSlowZones(currentTrack);
    r.outOfBoundsZones = this.getOutOfBoundsZones(currentTrack);
    r.speedBoostZones = this.getSpeedBoostZones(currentTrack);
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
      getRaceStartMs: () => (r.started && r.startMs !== null ? r.startMs : null),
      getRaceClockMs: () => r.clockMs,
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

    // Prime lastCheckpointPassed so trucks are ready to cross the start/finish line first
    r.trucks.forEach(td => {
      td.gameState.lastCheckpointPassed = r.maxCheckpointNumber > 0 ? r.maxCheckpointNumber - 1 : 0;
    });
    r.checkpointManager.updatePlayerCheckpointHighlight(r.playerTruckData.gameState.lastCheckpointPassed);
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
      if (player.gameState.useBoost() && !player.truck.state.boostActive) {
        player.truck.state.boostActive = true;
        player.truck.state.boostTimer = player.truck.state.boostDuration;
        r.uiManager.updateBoosts(player.gameState.boostCount);
      }
    });
    this.inputManager.onReset(() => this._respawnToLastCheckpoint(player));

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

  /** Pickups are spawned as trucks complete laps (see _updateLaps), not up
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

  /** Teleport a truck to the center of the last checkpoint it physically
   *  passed; the grid spawn if the race hasn't started yet. */
  _respawnToLastCheckpoint(truckData) {
    const r = this._race;
    this.respawnAtLastCheckpoint(truckData.truck, {
      lastCheckpointNumber: truckData.gameState.lastCheckpointPassed,
      hasStarted: truckData.hasStarted,
      checkpointManager: r.checkpointManager,
      track: r.currentTrack,
      staticBodyCollisionManager: r.staticBodyCollisionManager,
      fallbackCheckpoint: r.startFinishCp,
      fallbackSpawn: () => r.getGridSpawn(truckData.gridSlot ?? (truckData.isPlayer ? 0 : 1)),
    });
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

    // Re-snap all trucks to their grid positions with zeroed physics state.
    // This neutralises any drift from the large first-frame dt that accumulates
    // during async scene setup, so trucks are clean when the player sees "3".
    r.trucks.forEach((truckData, index) => {
      const { pos, heading } = r.getGridSpawn(index);
      this.respawnTruck(truckData.truck, pos, heading, r.staticBodyCollisionManager);
      // Handbrake hold: a sloped grid spot would otherwise let the truck
      // roll during the countdown, since neither AI's paused input nor the
      // player's neutral input engages any brake.
      truckData.truck.state.parked = true;
    });

    this.runCountdownSequence(r.uiManager, () => {
      r.countdownActive = false;
      r.aiDrivers.forEach(d => { d.paused = false; });
      r.trucks.forEach(td => { td.truck.state.parked = false; });
      // Green light: hand off from the theme to the regular playlist.
      stopTheme(r.audioManager);
      this.musicManager?.start();
      // No start/finish gate: the race (and every lap clock) starts on GO.
      if (r.maxCheckpointNumber === 0 && !r.started) {
        r.started = true;
        r.startMs = r.clockMs;
        r.trucks.forEach(t => t.lapStartTime = r.clockMs);
        r.uiManager.showRaceTimer();
      }
    });
  }

  /** Full race reset (pause menu Restart / Exit). */
  _resetGame() {
    const r = this._race;
    r.started = false;
    r.startMs = null;
    r.trucks.forEach(t => t.lapStartTime = null);
    r.ended = false;
    r.finishOrder.length = 0;
    r.dnfDeadlineMs = null;
    r.uiManager.hideRaceTimer();

    r.trucks.forEach((truckData, index) => {
      const { pos, heading } = r.getGridSpawn(index);
      // Use the proper respawn path. teleportTo zeroes the physics body and
      // notifyTeleport flushes the collision manager's stale previous position.
      // A bare mesh.position assignment leaves prevPos at the truck's pre-reset
      // spot, so the swept-AABB static-collision test drags the truck straight
      // back onto the track the moment the game loop resumes.
      this.respawnTruck(truckData.truck, pos, heading, r.staticBodyCollisionManager);
      truckData.gameState.reset();
      truckData.gameState.lastCheckpointPassed = r.maxCheckpointNumber > 0 ? r.maxCheckpointNumber - 1 : 0;
      truckData.hasStarted = false;
      truckData.truck.state.rubberBandSpeedMult = 1;
    });

    // Reset AI navigation + recovery state to match a freshly-built driver.
    // Without this the stuck-recovery and checkpoint-guidance watchers keep
    // stale state across the reset (a pending stuck-flag or gate-miss), and
    // fire a respawn the moment the countdown ends — teleporting AI trucks
    // off the grid back onto the track instead of starting them on the line.
    r.aiDrivers.forEach(d => {
      d.reset();
      d.currentCheckpointTarget = 0;
      d.lastCheckpointPassed = 0;
    });

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

  /** Grace period since the first finish ran out: every truck still racing is
   *  finished without a time, in truck-array order. */
  _handleDNF() {
    const r = this._race;
    r.trucks
      .filter(td => !td.gameState.raceFinished)
      .forEach(td => {
        td.gameState.finishRace(null); // mark finished without a time
        r.finishOrder.push(td);
        console.debug(`[RaceMode] DNF: ${td.name}`);
      });
    this._triggerRaceEnd();
  }

  _triggerRaceEnd() {
    const r = this._race;
    if (r.ended) return;
    r.ended = true;
    r.dnfDeadlineMs = null;
    r.checkpointManager.clearPlayerCheckpointHighlight();

    // Stop the player engine loop immediately when the race ends.
    // The post-race summary screen is shown before this mode is torn down,
    // so waiting for teardown would leave the engine audio running there.
    this.truckAudioController?.stop();

    // Freeze trucks that DNF'd (still moving with no path to finish)
    r.trucks.forEach(td => {
      if (!td.gameState.raceFinished) {
        td.truck.state.velocity = Vector3.Zero();
      }
    });

    const rows = buildRaceResultRows(r.finishOrder, r.trucks);
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
    const { frameProfiler: fp, trucks, currentTrack } = r;
    const player = r.playerTruckData;

    r.clockMs += dt * 1000;
    if (r.dnfDeadlineMs !== null && r.clockMs >= r.dnfDeadlineMs && !r.ended) {
      r.dnfDeadlineMs = null;
      this._handleDNF();
    }

    fp.measure('collision.truck.pre', () => r.truckCollisionManager.preUpdate(trucks, dt));

    fp.measure('trucks.update', () => trucks.forEach((truckData) => {
      // Finished trucks still get physics updates (zero input) so they coast to
      // a stop; AI trucks take their input from their driver inside update().
      const truckInput = (truckData.gameState.raceFinished || !truckData.isPlayer) ? NO_INPUT : input;
      const debugInfo = truckData.truck.update(
        truckInput,
        dt,
        r.terrainManager,
        currentTrack,
        truckData.isPlayer,
        player.truck.mesh.position,
        fp
      );
      if (truckData.isPlayer) r.playerDebugInfo = debugInfo;
    }));

    fp.measure('collision.staticBodies', () => r.staticBodyCollisionManager.update(trucks, dt));

    // r carries slowZones / speedBoostZones / fireworkZones.
    this.applyZoneEffects(r.scene, currentTrack, trucks, r, dt, fp);

    fp.measure('zones.oob', () => trucks.forEach((truckData) => {
      const oobRemaining = this.updateOutOfBoundsCountdown({
        truckId: truckData.id,
        truck: truckData.truck,
        outOfBoundsZones: r.outOfBoundsZones,
        track: currentTrack,
        dt,
        durationSec: truckData.isPlayer ? 5 : 2,
        onTimeout: () => this._respawnToLastCheckpoint(truckData),
      });
      if (truckData.isPlayer) {
        if (oobRemaining == null) r.uiManager.hideOutOfBoundsCountdown();
        else r.uiManager.showOutOfBoundsCountdown(oobRemaining);
      }
    }));

    fp.measure('collision.truck.resolve', () => r.truckCollisionManager.update(trucks, dt));
    fp.measure('obstacles.update', () => r.obstacleManager.update(trucks));
    fp.measure('pickups.update', () => r.pickupManager.update(trucks, dt));

    // Feed the telemetry recorder each step for the player truck.
    fp.measure('telemetry.player', () => {
      if (r.telemetryRecorder.recording && r.started) {
        const pt = player.truck;
        r.telemetryRecorder.update(
          { x: pt.mesh.position.x, z: pt.mesh.position.z },
          forwardSpeed(pt),
          dt * 1000,
          r.playerDebugInfo?.terrainGripMultiplier ?? 1
        );
      }
    });

    // Keep each AI truck's last-known terrain grip updated for telemetry speed scaling.
    fp.measure('ai.gripSample', () => {
      r.aiGripSampleElapsedMs += dt * 1000;
      if (r.aiGripSampleElapsedMs >= AI_GRIP_SAMPLE_INTERVAL_MS) {
        trucks.forEach(td => {
          if (!td.isPlayer && td.truck.driver) {
            const terrain = r.terrainManager.getTerrainAt(td.truck.mesh.position);
            td.truck._lastTerrainGrip = terrain.gripMultiplier;
          }
        });
        r.aiGripSampleElapsedMs = 0;
      }
    });

    fp.measure('checkpoints.laps', () => trucks.forEach((td) => this._updateLaps(td)));

    // Rubber-band: nudge each AI's effective top speed toward the player based
    // on race-progress gap (laps + checkpoints). Player speed is never touched.
    fp.measure('ai.rubberBand', () => {
      if (!r.started || r.ended || r.rubberBandLevel === 'off') return;
      const total = Math.max(1, r.checkpointManager.getTotalCheckpoints());
      const playerGs = player.gameState;
      const playerProgress = playerGs.lapCount * total + playerGs.checkpointCount;
      trucks.forEach(td => {
        if (td.isPlayer || td.gameState.raceFinished) return;
        const gs = td.gameState;
        const aiProgress = gs.lapCount * total + gs.checkpointCount;
        const gapLaps = (playerProgress - aiProgress) / total;
        td.truck.state.rubberBandSpeedMult = stepRubberBandMultiplier(
          td.truck.state.rubberBandSpeedMult ?? 1,
          gapLaps,
          r.rubberBandLevel,
          dt
        );
      });
    });
  }

  /** Checkpoint crossings for one truck: race start, lap completion, finish. */
  _updateLaps(truckData) {
    const r = this._race;
    const { checkpointManager, uiManager, telemetryRecorder, maxCheckpointNumber, totalLaps } = r;
    if (truckData.gameState.raceFinished) return;

    const truck = truckData.truck;
    const checkpointResult = checkpointManager.update(
      truck.mesh.position,
      truck.state.velocity,
      truckData.gameState.lastCheckpointPassed,
      truckData.id
    );
    if (!checkpointResult?.passed) return;
    const pos = { x: truck.mesh.position.x, z: truck.mesh.position.z };

    // Start/finish crossing: start race timer and reset sequence so lap flow begins at CP 1
    if (checkpointResult.index === maxCheckpointNumber && !truckData.hasStarted) {
      truckData.hasStarted = true;

      if (!r.started) {
        r.started = true;
        r.startMs = r.clockMs;
        uiManager.showRaceTimer();
        console.debug("Race started!");
      }

      truckData.lapStartTime = r.clockMs;
      truckData.gameState.lastCheckpointPassed = 0;
      truckData.gameState.checkpointCount = 0;
      checkpointManager.resetForTruck(truckData.id);
      if (truckData.isPlayer) {
        checkpointManager.updatePlayerCheckpointHighlight(truckData.gameState.lastCheckpointPassed);
        uiManager.updateCheckpoints(0);
        // Auto-start telemetry recording when player crosses the start line
        if (telemetryRecorder.recording) {
          telemetryRecorder.onCheckpointPassed(
            maxCheckpointNumber, pos, forwardSpeed(truck), r.playerDebugInfo?.terrainGripMultiplier ?? 1
          );
        }
      }
      // Notify AI driver so it recalculates path toward checkpoint #1
      if (!truckData.isPlayer && truck.driver) {
        truck.driver.onCheckpointPassed(maxCheckpointNumber, pos);
      }
      return;
    }

    const newCount = truckData.gameState.incrementCheckpoint(checkpointResult.index);

    if (!truckData.isPlayer && truck.driver) {
      truck.driver.onCheckpointPassed(checkpointResult.index, pos);
    }

    // Feed mid-lap checkpoint events into the telemetry recorder
    if (truckData.isPlayer && telemetryRecorder.recording) {
      telemetryRecorder.onCheckpointPassed(
        checkpointResult.index, pos, forwardSpeed(truck), r.playerDebugInfo?.terrainGripMultiplier ?? 1
      );
    }

    if (truckData.isPlayer) {
      checkpointManager.updatePlayerCheckpointHighlight(truckData.gameState.lastCheckpointPassed);
      uiManager.updateCheckpoints(newCount);
    }

    if (newCount !== checkpointManager.getTotalCheckpoints()) return;

    // -- Lap complete --
    const currentTime = r.clockMs;
    const lapTime = truckData.lapStartTime != null ? currentTime - truckData.lapStartTime : 0;
    truckData.lapStartTime = currentTime;
    const lapCount = truckData.gameState.completeLap(lapTime);
    checkpointManager.resetForTruck(truckData.id);

    // Any truck finishing a lap has a chance to spawn a pickup, more
    // valuable on later laps (up to 3x nitro).
    r.pickupManager.spawnForLap(lapCount);

    // Play airhorn when player truck starts last lap
    if (truckData.isPlayer && lapCount === totalLaps - 1) {
      truck.audioController?.playLastLapAirhorn();
    }

    if (truckData.isPlayer) {
      if (lapCount >= totalLaps) checkpointManager.clearPlayerCheckpointHighlight();
      else checkpointManager.updatePlayerCheckpointHighlight(truckData.gameState.lastCheckpointPassed);
      uiManager.updateLaps(lapCount, totalLaps);
      uiManager.updateCheckpoints(0);
      console.debug(`Lap ${lapCount} completed in ${(lapTime / 1000).toFixed(2)}s`);
    } else {
      console.debug(`[${truckData.name}] Completed lap ${lapCount} in ${(lapTime / 1000).toFixed(2)}s!`);
    }

    if (lapCount < totalLaps) return;

    // -- Race finished for this truck --
    const totalTime = currentTime - r.startMs;
    truckData.gameState.finishRace(totalTime);
    r.finishOrder.push(truckData);

    // Stop AI driver from issuing further steering inputs
    if (!truckData.isPlayer && truck.driver) {
      truck.driver.paused = true;
    }

    // The first finisher starts the DNF grace for everyone still racing.
    if (r.dnfDeadlineMs === null && !r.ended && r.finishOrder.length < r.trucks.length) {
      console.debug(`[RaceMode] ${truckData.name} finished — DNF timer started (${DNF_GRACE_MS / 1000}s)`);
      r.dnfDeadlineMs = r.clockMs + DNF_GRACE_MS;
    }

    if (truckData.isPlayer) {
      console.debug("\n=== RACE FINISHED ===");
      console.debug(`Total Time: ${(totalTime / 1000).toFixed(2)}s`);
      console.debug("Lap Times:");
      truckData.gameState.lapTimes.forEach((time, i) => {
        console.debug(`  Lap ${i + 1}: ${(time / 1000).toFixed(2)}s`);
      });
    } else {
      console.debug(`[${truckData.name}] Finished race! Total time: ${(totalTime / 1000).toFixed(2)}s`);
    }

    // All drivers finished — end race immediately
    if (r.finishOrder.length === r.trucks.length) {
      this._triggerRaceEnd();
    }
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
      if (r.started && !r.ended) this.positionLabels.update(trucks, r.checkpointManager, r.finishOrder);
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
