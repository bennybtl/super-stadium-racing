import { Vector3 } from "@babylonjs/core";
import { TRUCK_HALF_HEIGHT } from "../constants.js";
import {
  OutOfBoundsTracker, getActionZones, isPointInActionZone, applySlowZones, applySpeedBoostZones,
  getStartFinishCheckpoint, respawnAtLastCheckpoint,
} from "../sim/race-rules.js";
import { rngStream } from "../sim/rng.js";
import { CheckpointManager } from "../managers/CheckpointManager.js";
import { gridSlotXZ, startGridSlot, DEFAULT_START_GRID, CHECKPOINT_GRID_BACK_OFFSET } from "../utils/start-grid.js";
import { AIDriver, AI_SKILL_PRESETS } from "../ai/AIDriver.js";
import { BaseMode } from "./BaseMode.js";
import { buildScene } from "./SceneBuilder.js";
import { FrameProfiler, shouldEnableFrameProfiler } from "../managers/FrameProfiler.js";
import { FireworksManager } from "../managers/FireworksManager.js";
import { FixedStepLoop } from "./fixed-step.js";
import { Minimap } from "../managers/Minimap.js";

/**
 * DriveMode - shared utilities for drivable gameplay modes.
 *
 * Captures common logic used by TestMode, PracticeMode and RaceMode:
 * - start/finish checkpoint discovery
 * - spawn helpers
 * - slow-zone lookup and per-frame clamping
 */
export class DriveMode extends BaseMode {
  constructor(controller) {
    super(controller);
    this._oobTracker = new OutOfBoundsTracker();
    this._fireworksManager = null;
    this.cameraController = null;
    this._photoModeActive = false;
    this.frameProfiler = null;
    // Pending 3-2-1-GO timeouts, tracked so teardown / a restart cancels them.
    this._countdownTimeouts = [];
    this.minimap = null;
    this._minimapDots = null;
  }

  /**
   * Track overview, bottom-right (managers/Minimap.js). The minimap itself
   * honours the "Minimap" Display setting (live) and is hidden in photo mode.
   * `getDots()` returns `[{ x, z, color, isPlayer }]`; it's called from
   * updateMinimap(), which the mode calls once per render frame. Disposed in
   * teardown.
   */
  setupMinimap(track, startFinish, getDots) {
    this.minimap = new Minimap(track, startFinish);
    this._minimapDots = getDots;
  }

  updateMinimap() {
    if (this.minimap?.enabled) this.minimap.update(this._minimapDots());
  }

  /** CSS colour for a truck's minimap dot. */
  static dotColor(color3, fallback = '#ff6b2e') {
    return color3?.toHexString?.() ?? fallback;
  }

  /**
   * The shared 3-2-1-GO choreography: shows each digit on the HUD one second
   * apart, calls `onGo` when "GO!" appears (t=3s), and clears the banner at
   * t=3.8s. Callers own everything mode-specific — freezing the field,
   * re-snapping the grid, the `countdownActive` flag — and call this for the
   * timing.
   */
  runCountdownSequence(uiManager, onGo) {
    this._countdownTimeouts.forEach(clearTimeout);
    this._countdownTimeouts = [
      setTimeout(() => uiManager.showCountdown('2'), 1000),
      setTimeout(() => uiManager.showCountdown('1'), 2000),
      setTimeout(() => { uiManager.showCountdown('GO!'); onGo?.(); }, 3000),
      setTimeout(() => uiManager.hideCountdown(), 3800),
    ];
    uiManager.showCountdown('3');
  }

  /**
   * Create and bind a per-mode frame profiler.
   */
  initFrameProfiler(name) {
    if (this.frameProfiler) {
      this.frameProfiler.dispose();
    }
    const enabled = shouldEnableFrameProfiler();
    this.frameProfiler = new FrameProfiler(name, {
      enabled,
      autoReport: enabled,
      reportEveryMs: 3000,
      maxHistoryFrames: 300,
    });
    this.frameProfiler.bindWindowApi(window, "gameLoopProfiler");
    return this.frameProfiler;
  }

  /**
   * Build a driving scene for this mode from the selected track.
   */
  async buildDriveScene(trackKey, opts = {}) {
    const { engine, trackLoader } = this.controller;
    const built = await buildScene(engine, trackLoader, trackKey, opts);
    this._setupBorderWallFade(built.scene);
    return built;
  }

  /**
   * Fade a perimeter border wall out when the camera passes to its outside.
   * The chase camera can clip through the track edge on tight turns, and the
   * tall grey border wall then fills the screen instead of the truck. Physics
   * is untouched (the truck can't reach the outside) — only the visual
   * crossfades to transparent while the camera is beyond the wall, then back
   * once it returns. Applies to every drive mode; the editor builds its scene
   * via buildScene() directly, so its overhead camera is unaffected.
   */
  _setupBorderWallFade(scene) {
    const walls = ['borderNorth', 'borderSouth', 'borderEast', 'borderWest']
      .map(n => scene.getMeshByName(n))
      .filter(Boolean)
      .map(mesh => {
        // Outward normal: from track center toward the wall along its dominant
        // (thin, axis-aligned) axis. Camera is "outside" when it lies past the
        // wall along this normal.
        const { x: cx, z: cz } = mesh.position;
        const nx = Math.abs(cx) >= Math.abs(cz) ? Math.sign(cx) : 0;
        const nz = Math.abs(cz) >  Math.abs(cx) ? Math.sign(cz) : 0;
        return { mesh, cx, cz, nx, nz };
      });
    if (walls.length === 0) return;

    const FADE_RATE = 12; // per-second crossfade speed
    scene.onBeforeRenderObservable.add(() => {
      const cam = scene.activeCamera;
      if (!cam) return;
      const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      const p = cam.position;
      for (const w of walls) {
        const outside = (p.x - w.cx) * w.nx + (p.z - w.cz) * w.nz > 0;
        const target = outside ? 0 : 1;
        w.mesh.visibility += (target - w.mesh.visibility) * Math.min(1, dt * FADE_RATE);
      }
    });
  }

  togglePhotoMode() {
    if (!this.cameraController) return;
    this._photoModeActive = !this._photoModeActive;
    this.cameraController.toggleFreeMode();
    this.minimap?.setVisible(!this._photoModeActive);
    console.debug(
      `[DriveMode] Screenshot camera ${this._photoModeActive ? 'enabled' : 'disabled'} - WASD to move, +/- to zoom, P to toggle`
    );
  }

  teardown() {
    this._countdownTimeouts.forEach(clearTimeout);
    this._countdownTimeouts = [];

    if (this.inputManager) {
      this.inputManager.dispose();
      this.inputManager = null;
    }

    if (this.cameraController && this._photoModeActive) {
      this.cameraController.toggleFreeMode();
      this._photoModeActive = false;
    }
    this.cameraController = null;

    if (this.debugManager) {
      this.debugManager.hide();
      this.debugManager = null;
    }
    this.minimap?.dispose();
    this.minimap = null;
    this._minimapDots = null;

    if (this.frameProfiler) {
      this.frameProfiler.dispose(window, "gameLoopProfiler");
      this.frameProfiler = null;
    }
    if (this._fireworksManager) {
      this._fireworksManager.dispose();
      this._fireworksManager = null;
    }
    super.teardown();
  }

  /**
   * Wire the per-frame plumbing every player-driven racing mode shares onto
   * `scene`. RaceMode and MultiplayerMode differ in what happens each tick
   * (local physics + AI + DNF vs. server reconciliation + puppets) but agree on
   * the frame envelope:
   *
   *   onAfterRender  → record the render-pipeline span, close the profiler frame
   *   onBeforeRender → bail while the tab is hidden; clamp dt + open the profiler
   *                    frame; in photo mode fly the free camera and stop; while a
   *                    menu is up, stop; throttle the HUD race timer to ~20Hz;
   *                    then run `onStep(SIM_DT, input)` on the fixed timestep
   *                    (see fixed-step.js) and `onRender(dt)` once per frame.
   *
   * `input` is the movement stick, forced to neutral while the countdown runs.
   * `onStep` is the simulation — trucks, collisions, zones, checkpoints, laps.
   * `onRender` is presentation — camera, HUD, labels, decoration animation — and
   * runs after the truck meshes (from `getMeshes`) are on their interpolated
   * render pose.
   *
   * @param {object} o
   * @param {import('@babylonjs/core').Engine}  o.engine
   * @param {import('@babylonjs/core').Scene}   o.scene
   * @param {object}   o.uiManager
   * @param {object}   o.inputManager
   * @param {() => boolean}      o.isMenuUp           pause/menu overlay is showing
   * @param {() => boolean}      o.isCountdownActive  pre-race 3-2-1 is running
   * @param {() => (number|null)} o.getRaceStartMs    race-clock basis for the HUD
   *                                                  timer, or null before the start
   * @param {() => number} [o.getRaceClockMs=Date.now] the clock that basis is on.
   *   Single-player passes its sim-time race clock (stops while paused / in slow
   *   frames); multiplayer keeps the wall clock — the shared race runs in real
   *   time whether or not this client is paused.
   * @param {boolean} [o.runTimerWhilePaused=false]   keep ticking the HUD timer
   *   while a menu/photo mode holds the sim. Single-player leaves this off (the
   *   race is genuinely suspended); multiplayer sets it, since the server keeps
   *   the race running whether or not this client is looking.
   * @param {() => Iterable<object>} o.getMeshes  truck meshes to interpolate
   * @param {(dt: number, input: object) => void} o.onStep
   * @param {(dt: number) => void} o.onRender
   */
  installRaceFrameLoop({ engine, scene, uiManager, inputManager, isMenuUp, isCountdownActive, getRaceStartMs, getRaceClockMs = Date.now, runTimerWhilePaused = false, getMeshes, onStep, onRender }) {
    const sim = this.fixedStep = new FixedStepLoop(getMeshes);
    const NEUTRAL = Object.freeze({ forward: false, back: false, left: false, right: false });
    const TIMER_UI_INTERVAL_MS = 50; // HUD reads MM:SS.cc; 20Hz is finer than the glyphs
    let timerUiElapsedMs = 0;
    let frameRenderStartMs = 0;

    const tickHudTimer = (dt) => {
      const raceStartMs = getRaceStartMs();
      if (raceStartMs == null) return;
      timerUiElapsedMs += dt * 1000;
      if (timerUiElapsedMs >= TIMER_UI_INTERVAL_MS) {
        timerUiElapsedMs = 0;
        this.frameProfiler.measure('ui.timer', () => uiManager.updateTimer(getRaceClockMs() - raceStartMs));
      }
    };

    scene.onAfterRenderObservable.add(() => {
      if (frameRenderStartMs > 0) {
        this.frameProfiler.addDuration('render.pipeline', performance.now() - frameRenderStartMs);
        frameRenderStartMs = 0;
      }
      this.frameProfiler.endFrame();
    });

    scene.onBeforeRenderObservable.add(() => {
      if (document.hidden) return;

      const dt = this.getClampedDeltaTime(engine, 0.1);
      this.frameProfiler.beginFrame(dt);

      if (this._photoModeActive) {
        const input = this.frameProfiler.measure('input.photo', () => inputManager.getMovementInput());
        this.frameProfiler.measure('camera.photoMove', () => this.cameraController.moveFreeCamera(input, dt));
        this.frameProfiler.measure('camera.photoUpdate', () => this.cameraController.update());
        if (runTimerWhilePaused) tickHudTimer(dt);
        frameRenderStartMs = performance.now();
        return;
      }
      if (isMenuUp()) {
        if (runTimerWhilePaused) tickHudTimer(dt);
        frameRenderStartMs = performance.now();
        return;
      }

      tickHudTimer(dt);

      const input = this.frameProfiler.measure('input', () =>
        isCountdownActive() ? NEUTRAL : inputManager.getMovementInput()
      );

      sim.run(dt, (stepDt) => onStep(stepDt, input));
      onRender(dt);
      frameRenderStartMs = performance.now();
    });
  }

  /**
   * Apply the three per-frame action-zone effects — slow zones, speed-boost
   * pads, firework triggers — to `trucks`. Pass `profiler` to time each pass
   * under its `zones.*` label (MenuMode runs unprofiled).
   */
  applyZoneEffects(scene, track, trucks, { slowZones, speedBoostZones, fireworkZones }, dt, profiler = null) {
    const run = (label, fn) => (profiler ? profiler.measure(label, fn) : fn());
    run('zones.slow', () => this.applySlowZones(trucks, slowZones));
    run('zones.boost', () => this.applySpeedBoostZones(trucks, speedBoostZones));
    run('zones.fireworks', () => this.updateFireworkZones(scene, track, trucks, fireworkZones, dt));
  }

  /**
   * Teleport `truck` back to the last checkpoint it physically cleared: the
   * nearest gate carrying `lastCheckpointNumber` (so an alternative branch lands
   * on the gate the truck actually took), the start/finish line before the
   * first checkpoint, or `fallbackSpawn()` when the truck hasn't started or
   * nothing resolves. Gates come from the CheckpointManager, not raw track
   * features, so reverse races (flipped headings, renumbered sequence) work.
   * respawnTruck's notifyTeleport flushes the collision manager's stale prevPos.
   *
   * @param {object} truck  a Truck instance
   * @param {object} o
   * @param {number}   o.lastCheckpointNumber
   * @param {boolean}  o.hasStarted
   * @param {object}   o.checkpointManager
   * @param {object}   o.track                     (for getHeightAt)
   * @param {object}   o.staticBodyCollisionManager
   * @param {object}   [o.fallbackCheckpoint]      used when no gate is numbered
   * @param {() => { pos: import('@babylonjs/core').Vector3, heading: number }} o.fallbackSpawn
   */
  respawnAtLastCheckpoint(truck, opts) {
    respawnAtLastCheckpoint(truck, opts);
  }

  /**
   * The AI-skill factory shared by RaceMode (the real field) and MenuMode (the
   * attract demo). Outside a championship, skill cycles good → ok → bad by field
   * index so the pack spreads out and trades places; inside one, each AI keeps
   * the preset persisted on its roster entry. Every driver is handed the terrain
   * manager so path baking can scale corner-speed targets by real surface grip.
   *
   * Returns a `(index) => AIDriver` suitable for `setupAIDrivers({ getAIDriver })`.
   */
  makeAIDriverFactory({ currentTrack, checkpointManager, wallManager, scene, terrainManager, championship = null, seed = null }) {
    return (i) => {
      let driver;
      if (championship?.aiSkills) {
        const preset = AI_SKILL_PRESETS[championship.aiSkills[i]] ?? AI_SKILL_PRESETS.ok;
        driver = new AIDriver(currentTrack, checkpointManager, wallManager, scene, preset);
      } else {
        const slot = i % 3;
        if (slot === 0) driver = AIDriver.createGoodDriver(currentTrack, checkpointManager, wallManager, scene);
        else if (slot === 1) driver = AIDriver.createOkDriver(currentTrack, checkpointManager, wallManager, scene);
        else driver = AIDriver.createBadDriver(currentTrack, checkpointManager, wallManager, scene);
      }
      driver.setTerrainManager(terrainManager);
      // Seeded race: each driver draws from its own stream (sim/rng.js).
      if (seed != null) driver.random = rngStream(seed, `ai:${i}`);
      return driver;
    };
  }

  /**
   * Get ordered checkpoint features and the start/finish checkpoint.
   * Start/finish is defined by checkpoint feature order; the last checkpoint is the finish.
   */
  getStartFinishInfo(track) {
    const checkpointFeatures = track.features.filter(f => f.type === "checkpoint");
    // Steps, not gate count: `alternative` / `jokerLap` gates share a step.
    const maxCheckpointNumber = CheckpointManager.groupIntoSteps(checkpointFeatures).length;
    const startFinishCp = checkpointFeatures[checkpointFeatures.length - 1] || null;

    return { checkpointFeatures, maxCheckpointNumber, startFinishCp };
  }

  /**
   * Resolve the start/finish gate from a (possibly reversed) CheckpointManager.
   * The gate with the highest checkpointNumber is the finish; its heading already
   * reflects the traversal direction (reverse rebuilds flip it), so spawning
   * behind it works for both forward and reverse. Returns null if unnumbered.
   */
  getStartFinishCheckpoint(checkpointManager) {
    return getStartFinishCheckpoint(checkpointManager);
  }

  /**
   * The track's `startPosition` marker, if it has one and it applies.
   *
   * The marker is ignored in a reverse race: it is only "behind the line" for
   * the forward direction, so a reversed run falls back to the gate — whose
   * heading the reverse rebuild has already flipped — and grids behind that.
   */
  getStartPositionFeature(track, checkpointManager) {
    if (checkpointManager?._reverse) return null;
    return track.features.find(f => f.type === 'startPosition') ?? null;
  }

  /**
   * Build a starting-grid spawn function. `index` is a race index: 0 is pole,
   * then back through the field. A `startPosition` marker places the slots (a
   * grid of its own shape, or hand-placed positions — see start-grid.js);
   * without one, slots are two-wide rows stacked behind the start/finish gate.
   *
   * Both are resolved per call so an edit — or a reverse rebuild, which flips
   * gate headings — is picked up.
   *
   * @param {Track} track
   * @param {CheckpointManager} checkpointManager
   * @param {object} [fallbackCheckpoint] Used when no gate carries a number.
   * @returns {(index: number) => { pos: Vector3, heading: number }}
   */
  makeGridSpawner(track, checkpointManager, fallbackCheckpoint = null) {
    const atGround = (x, z, heading) => ({
      pos: new Vector3(x, track.getHeightAt(x, z) + TRUCK_HALF_HEIGHT, z),
      heading,
    });

    return (index) => {
      const marker = this.getStartPositionFeature(track, checkpointManager);
      if (marker) {
        const slot = startGridSlot(marker, index);
        return atGround(slot.x, slot.z, slot.heading);
      }

      const gate = this.getStartFinishCheckpoint(checkpointManager) ?? fallbackCheckpoint;
      if (!gate) {
        return atGround((index % 2) * 3, Math.floor(index / 2) * 3, 0);
      }

      const { x, z } = gridSlotXZ(index, {
        x: gate.centerX,
        z: gate.centerZ,
        heading: gate.heading,
        ...DEFAULT_START_GRID,
        backOffset: CHECKPOINT_GRID_BACK_OFFSET,
      });
      return atGround(x, z, gate.heading);
    };
  }

  /**
   * Spawn just behind a checkpoint heading by `backOffset` world units.
   */
  getSpawnBehindCheckpoint(track, checkpoint, truckHeight, backOffset = 6) {
    if (!checkpoint) {
      return {
        pos: new Vector3(0, truckHeight, 0),
        heading: 0,
      };
    }

    const h = checkpoint.heading;
    const x = checkpoint.centerX + Math.sin(h) * -backOffset;
    const z = checkpoint.centerZ + Math.cos(h) * -backOffset;
    return {
      pos: new Vector3(x, track.getHeightAt(x, z) + truckHeight, z),
      heading: h,
    };
  }

  /**
   * Resolve all slow-zone action zones from track features.
   */
  getSlowZones(track) {
    return getActionZones(track, 'slowZone');
  }

  /** Resolve all out-of-bounds action zones from track features. */
  getOutOfBoundsZones(track) {
    return getActionZones(track, 'outOfBounds');
  }

  /** Resolve all speed-boost action zones from track features. */
  getSpeedBoostZones(track) {
    return getActionZones(track, 'speedBoost');
  }

  /** Resolve all firework action zones from track features. */
  getFireworkZones(track) {
    return getActionZones(track, 'fireworks');
  }

  /**
   * Set off a firework volley for any truck that has just driven into a
   * firework zone, and advance shells already in the air. The manager is
   * created on first use so tracks without firework zones pay nothing.
   */
  updateFireworkZones(scene, track, trucks, fireworkZones, dt) {
    if (!fireworkZones?.length && !this._fireworksManager) return;
    if (!this._fireworksManager) {
      this._fireworksManager = new FireworksManager(scene, track);
    }
    this._fireworksManager.update(trucks, fireworkZones, dt);
  }

  isPointInActionZone(x, z, zone) {
    return isPointInActionZone(x, z, zone);
  }

  /**
   * Clamp speed for trucks inside any slow zone.
   * `trucks` accepts either Truck instances or truckData objects with `.truck`.
   */
  applySlowZones(trucks, slowZones) {
    applySlowZones(trucks, slowZones);
  }

  /**
   * Arm a timed speed boost on any truck inside a speed-boost zone. The boost
   * re-arms each frame while inside, then lingers for `boostDuration` seconds
   * after the truck leaves (a boost-pad feel). Strength scales top speed and
   * acceleration. `trucks` accepts Truck instances or truckData with `.truck`.
   */
  applySpeedBoostZones(trucks, boostZones) {
    applySpeedBoostZones(trucks, boostZones);
  }

  /**
   * Shared out-of-bounds countdown/respawn logic.
   * Returns remaining seconds (float) while active, or null when inactive.
   */
  updateOutOfBoundsCountdown(opts) {
    return this._oobTracker.update(opts);
  }
}
