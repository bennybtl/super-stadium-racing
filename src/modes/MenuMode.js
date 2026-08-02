import { Scene, Color4, FreeCamera, Vector3 } from "@babylonjs/core";
import { DriveMode } from "./DriveMode.js";
import { AIDriver } from "../ai/AIDriver.js";
import { setupAIDrivers } from "../ai/setupAIDrivers.js";
import { generateDriverNames } from "../ai/driverNames.js";
import { TruckCollisionManager } from "../managers/TruckCollisionManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { TRUCK_HALF_HEIGHT } from "../constants.js";

/** Size of the attract-mode field. */
const DEMO_AI_COUNT = 4;
/** Seconds the demo camera stays on one truck before cycling to the next. */
const DEMO_FOCUS_SWITCH_SEC = 14;
/** AI drivers never take input, so their update call gets a frozen stick. */
const NO_INPUT = Object.freeze({ forward: false, back: false, left: false, right: false });

/**
 * MenuMode – the scene that lives behind the start-screen DOM overlay
 * (managed by MenuManager).
 *
 * The scene is an attract-mode demo: a random track with a field of AI drivers
 * racing an endless, resultless race, which the menus sit on top of. If the
 * demo can't be built (no tracks, or a track that fails to load) it falls back
 * to a blank clear-colour scene and the menus show the static title image
 * instead.
 *
 * Wires up the two entry-point callbacks:
 *   onStartGame   → goToRace
 *   onStartEditor → goToEditor
 */
export class MenuMode extends DriveMode {
  constructor(controller) {
    super(controller);
  }

  async setup(_config) {
    const { menuManager } = this.controller;

    // Preserve the initial title screen on app startup, but restore the
    // interactive start menu after returning from a race or practice mode.
    if (menuManager.currentMenu == null) {
      menuManager.showStartMenu();
    }

    menuManager.onStartGame = () => {
      menuManager.hideMenu();
      this.controller.showSingleRacePit();
    };

    menuManager.onPurchaseUpgrade = (upgradeId) => {
      // In a cup, buys draw from the player's per-championship wallet; otherwise
      // the free global single-race upgrades.
      if (this.controller.inChampionship) {
        this.controller.purchaseChampionshipUpgrade(upgradeId);
      } else {
        this.controller.purchaseUpgrade(upgradeId);
      }
    };

    menuManager.onStartChampionship = () => {
      const store = menuManager._store;
      menuManager.gameStarted = true;
      menuManager.hideMenu();
      this.controller.startChampionship({
        initials:       store.champInitials || 'AAA',
        trackCount:     store.champTrackCount,
        aiCount:        menuManager.selectedAIDrivers,
        laps:           menuManager.selectedLaps,
        aiVehicleKey:   menuManager.selectedAIVehicleType,
        reverse:        false, // cups are forward-only for now (reverse UI hidden)
        vehicleKey:     menuManager.selectedVehicle,
        playerColorKey: menuManager.selectedPlayerColor,
      });
    };

    menuManager.onContinueChampionship = () => {
      this.controller.continueChampionship();
    };

    menuManager.onResumeChampionship = () => {
      this.controller.resumeChampionship();
    };

    menuManager.onChampionshipExit = () => {
      menuManager.gameStarted = false;
      menuManager.hideMenu();
      this.controller.exit();
    };

    menuManager.onStartPractice = () => {
      menuManager.gameStarted = true;
      menuManager._store.pitData = null;
      menuManager.hideMenu();
      this.controller.goToPractice({
        trackKey:   menuManager.selectedTrack,
        vehicleKey: menuManager.selectedVehicle,
        playerColorKey: menuManager.selectedPlayerColor,
      });
    };

    menuManager.onStartHotLap = () => {
      menuManager.gameStarted = true;
      menuManager._store.pitData = null;
      menuManager.hideMenu();
      this.controller.goToHotLap({
        trackKey:   menuManager.selectedTrack,
        vehicleKey: menuManager.selectedVehicle,
        playerColorKey: menuManager.selectedPlayerColor,
        reverse:    menuManager.selectedReverse,
      });
    };

    menuManager.onStartSingleRace = () => {
      menuManager.gameStarted = true;
      menuManager._store.pitData = null;
      menuManager.hideMenu();
      this.controller.goToRace({
        trackKey:        menuManager.selectedTrack,
        laps:            menuManager.selectedLaps,
        aiCount:         menuManager.selectedAIDrivers,
        aiVehicleKey:    menuManager.selectedAIVehicleType,
        vehicleKey:      menuManager.selectedVehicle,
        playerColorKey:  menuManager.selectedPlayerColor,
        reverse:         menuManager.selectedReverse,
      });
    };

    menuManager.onStartEditor = () => {
      menuManager.editorMode = true;
      menuManager.hideMenu();
      this.controller.goToEditor({
        trackKey: menuManager.selectedTrack,
      });
    };

    const demoScene = await this._buildDemoScene();
    this.scene = demoScene ?? this._buildBlankScene();
    menuManager.setDemoActive(demoScene != null);
    return this.scene;
  }

  /**
   * Blank scene so the engine actively clears the canvas each frame and the
   * previous mode's last frame doesn't bleed through behind the menus.
   */
  _buildBlankScene() {
    const scene = new Scene(this.controller.engine);
    scene.clearColor = new Color4(0.15, 0.12, 0.1, 1);
    // A camera is required for Babylon to render the scene without warnings
    new FreeCamera("menuCam", new Vector3(0, 0, -10), scene);
    return scene;
  }

  /** A random visible, raceable track for the demo, or null if there are none. */
  _pickDemoTrack() {
    const { trackLoader } = this.controller;
    const keys = (trackLoader?.getTrackList?.() ?? []).filter(key => {
      const track = trackLoader.getTrack(key);
      if (!track || track.hidden === true) return false;
      // Without gates the AI has nothing to drive toward, so the demo would
      // just be four parked trucks.
      return (track.features ?? []).filter(f => f.type === 'checkpoint').length >= 2;
    });
    if (keys.length === 0) return null;
    return keys[Math.floor(Math.random() * keys.length)];
  }

  /**
   * Build the attract-mode race. Returns the scene, or null if it couldn't be
   * built — callers fall back to the blank scene.
   */
  async _buildDemoScene() {
    const trackKey = this._pickDemoTrack();
    if (!trackKey) return null;

    let built = null;
    try {
      built = await this.buildDriveScene(trackKey);
      this._populateDemo(built, trackKey);
      return built.scene;
    } catch (err) {
      console.warn('[MenuMode] Attract-mode demo failed to build; falling back to the title image.', err);
      built?.scene?.dispose();
      return null;
    }
  }

  /**
   * Fill a freshly built drive scene with an AI-only field and run it on an
   * endless loop. This is a slimmed RaceMode: no player, no input, no HUD, no
   * lap limit and no results — laps just roll over forever.
   */
  _populateDemo(built, trackKey) {
    const { engine } = this.controller;
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
    } = built;

    const { maxCheckpointNumber, startFinishCp } = this.getStartFinishInfo(currentTrack);
    const getGridSpawn = this.makeGridSpawner(currentTrack, checkpointManager, startFinishCp);

    // Shadow cost matters less with nothing to chase, and the menus sit on top;
    // halve the refresh rate as races do.
    const shadowMap = shadows?.getShadowMap?.();
    if (shadowMap) shadowMap.refreshRate = 2;

    const names = generateDriverNames(DEMO_AI_COUNT);
    const { aiTruckDataList: trucks, aiDrivers } = setupAIDrivers({
      count: DEMO_AI_COUNT,
      scene,
      shadows,
      currentTrack,
      checkpointManager,
      wallManager,
      vehicleDef: window.vehicleLoader?.getVehicle('baja') ?? null,
      playerTruck: null,
      getGridSpawn,
      getAIName: (i) => names[i],
      getAIId:   (i) => `demo${i + 1}`,
      getAISkill: () => ({}),
      // Mixed skills so the field spreads out and trades places instead of
      // running as a train.
      getAIDriver: (i) => {
        const slot = i % 3;
        if (slot === 0) return AIDriver.createGoodDriver(currentTrack, checkpointManager, wallManager, scene);
        if (slot === 1) return AIDriver.createOkDriver(currentTrack, checkpointManager, wallManager, scene);
        return AIDriver.createBadDriver(currentTrack, checkpointManager, wallManager, scene);
      },
      // No player, so the field fills the grid from pole.
      getAIGridSlot: (i) => i,
      trackKey,
      aiVehicleKey: 'random',
      telemetryCheckpoints: null,
    });

    if (trucks.length === 0) return;

    aiDrivers.forEach((driver, i) => {
      driver.setGameState(trucks[i].gameState);
      driver.setRaceContext(trucks[i], trucks);
    });

    // Prime the sequence so every truck is ready to cross the start/finish line
    // first, exactly as a real race grid does.
    trucks.forEach(td => {
      td.gameState.lastCheckpointPassed = maxCheckpointNumber > 0 ? maxCheckpointNumber - 1 : 0;
    });
    // No player here, so no gate should be lit up as "next".
    checkpointManager.clearPlayerCheckpointHighlight();

    const truckCollisionManager = new TruckCollisionManager();
    const staticBodyCollisionManager = new StaticBodyCollisionManager(scene);
    aiDrivers.forEach(d => d.setStaticBodyCollisionManager(staticBodyCollisionManager));

    // Snap onto the grid with zeroed physics — the async scene build leaves a
    // large first-frame dt that would otherwise fling the trucks.
    trucks.forEach(td => {
      const { pos, heading } = getGridSpawn(td.gridSlot);
      this.respawnTruck(td.truck, pos, heading, staticBodyCollisionManager);
    });

    /** Put a stranded truck back on its last gate (or the grid). */
    const respawnToLastGate = (td) => {
      const lastCpNum = td.gameState.lastCheckpointPassed;
      const gate = (lastCpNum > 0
        ? checkpointManager.checkpointMeshes.map(cp => cp.feature)
            .find(f => f.checkpointNumber === lastCpNum)
        : null) ?? this.getStartFinishCheckpoint(checkpointManager);
      if (gate) {
        const y = currentTrack.getHeightAt(gate.centerX, gate.centerZ) + TRUCK_HALF_HEIGHT;
        this.respawnTruck(td.truck, new Vector3(gate.centerX, y, gate.centerZ), gate.heading, staticBodyCollisionManager);
        return;
      }
      const { pos, heading } = getGridSpawn(td.gridSlot);
      this.respawnTruck(td.truck, pos, heading, staticBodyCollisionManager);
    };

    const slowZones = this.getSlowZones(currentTrack);
    const outOfBoundsZones = this.getOutOfBoundsZones(currentTrack);
    const speedBoostZones = this.getSpeedBoostZones(currentTrack);

    // Camera cycles through the field so the demo doesn't dwell on one truck.
    this.cameraController = cameraController;
    let focusIndex = 0;
    let focusElapsed = 0;
    const focusTruck = () => trucks[focusIndex].truck;

    this.setupVisibilityHandler(scene, trucks);

    cameraController.update(focusTruck().mesh.position, focusTruck().state.heading);

    scene.onBeforeRenderObservable.add(() => {
      if (document.hidden) return;
      const dt = this.getClampedDeltaTime(engine, 0.05);

      focusElapsed += dt;
      if (focusElapsed >= DEMO_FOCUS_SWITCH_SEC) {
        focusElapsed = 0;
        focusIndex = (focusIndex + 1) % trucks.length;
      }
      const focusPos = focusTruck().mesh.position;

      truckCollisionManager.preUpdate(trucks, dt);
      // Each truck steers itself: Truck.update pulls input from its AI driver
      // and ignores the object passed here.
      trucks.forEach(td => td.truck.update(NO_INPUT, dt, terrainManager, currentTrack, false, focusPos, null));

      staticBodyCollisionManager.update(trucks, dt);
      this.applySlowZones(trucks, slowZones);
      this.applySpeedBoostZones(trucks, speedBoostZones);

      trucks.forEach(td => this.updateOutOfBoundsCountdown({
        truckId: td.id,
        truck: td.truck,
        outOfBoundsZones,
        track: currentTrack,
        dt,
        durationSec: 2,
        onTimeout: () => respawnToLastGate(td),
      }));

      truckCollisionManager.update(trucks);
      obstacleManager.update(trucks);
      decorationManager.update(trucks, dt);

      trucks.forEach(td => {
        const result = checkpointManager.update(
          td.truck.mesh.position,
          td.truck.state.velocity,
          td.gameState.lastCheckpointPassed,
          td.id,
        );
        if (!result?.passed) return;

        // Crossing start/finish for the first time opens the lap sequence.
        if (result.index === maxCheckpointNumber && !td.hasStarted) {
          td.hasStarted = true;
          td.gameState.lastCheckpointPassed = 0;
          td.gameState.checkpointCount = 0;
          checkpointManager.resetForTruck(td.id);
          td.truck.driver?.onCheckpointPassed(maxCheckpointNumber, {
            x: td.truck.mesh.position.x,
            z: td.truck.mesh.position.z,
          });
          return;
        }

        const count = td.gameState.incrementCheckpoint(result.index);
        td.truck.driver?.onCheckpointPassed(result.index, {
          x: td.truck.mesh.position.x,
          z: td.truck.mesh.position.z,
        });

        if (count === checkpointManager.getTotalCheckpoints()) {
          td.gameState.completeLap();
          checkpointManager.resetForTruck(td.id);
          // Endless race: hand the nitro back each lap so the field keeps
          // showing off boosts instead of settling into a parade.
          td.gameState.boostCount = td.truck.state.maxBoosts ?? 5;
        }
      });

      cameraController.update(focusPos, focusTruck().state.heading, dt);
    });
  }

  teardown() {
    this.controller.menuManager.setDemoActive(false);
    super.teardown();
  }
}
