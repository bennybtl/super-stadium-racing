import { Truck } from "../truck/truck.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { AudioManager } from "../managers/AudioManager.js";
import { TruckAudioController } from "../managers/TruckAudioController.js";
import { MusicManager, playTheme, stopTheme } from "../managers/MusicManager.js";
import { DriveMode } from "./DriveMode.js";
import { basicColors } from "../constants.js";
import { AI_COLOR_KEYS } from "../ai/setupAIDrivers.js";
import { NetClient, TICK_RATE } from "../net/NetClient.js";
import { Prediction } from "../net/Prediction.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { rngStream } from "../sim/rng.js";

// How many rendered frames a tapped nitro / reset key stays "held" in the
// input stream — enough to survive a dropped packet, one rising edge server-side.
const PRESS_HOLD_FRAMES = 4;
const TRUCK_STATUS_UI_INTERVAL_MS = 200;
const NEUTRAL = Object.freeze({ s: 0, g: 0, b: false, r: false });

/**
 * NetRaceMode — a server-authoritative online race (docs/MULTIPLAYER.md,
 * Phase 5). The server (server/lobby) simulates every truck; this client only
 * sends input and draws.
 *
 * Every truck — the player's too — is posed from snapshots interpolated ~100 ms
 * behind the server clock (NetClient), then runs its normal presentation
 * (body lean, dust, tire marks, wake, engine audio) via Truck.applyNetState +
 * updatePresentation. Laps, checkpoints, the timer and results all come from
 * the server. Expect the player's own truck to feel laggy: prediction is
 * Phase 6.
 *
 * Pickups and knocked-loose obstacles are mirrored too: pickups appear and
 * vanish on server events (the client never collects anything itself), and
 * obstacles take their pose from snapshots.
 */
export class NetRaceMode extends DriveMode {
  static loadingMessage = "Joining online race…";

  constructor(controller) {
    super(controller);
    this.net = null;
    this.inputManager = null;
    this.audioManager = null;
    this.truckAudioController = null;
    this.musicManager = null;
    this._unsubscribers = [];
  }

  /**
   * @param {object} o
   * @param {{ host: string, port: number, token: string }} o.race  from the lobby view
   * @param {string}  o.trackKey
   * @param {boolean} o.reverse
   * @param {number}  o.laps
   * @param {{ id: string, name: string, vehicleKey: string|null }[]} o.players
   * @param {string}  o.selfId
   */
  async setup({ race, trackKey, reverse = false, laps = 3, players, selfId }) {
    const { engine, menuManager } = this.controller;
    const built = await this.buildDriveScene(trackKey, { reverse });
    const {
      scene, shadows, cameraController, currentTrack, terrainManager, checkpointManager, decorationManager,
      pickupManager, obstacleManager,
    } = built;
    this.scene = scene;

    const audioManager = await AudioManager.create(scene);
    this.audioManager = audioManager;
    this.musicManager = await MusicManager.create(audioManager);
    await playTheme(audioManager);

    if (reverse) {
      checkpointManager._reverse = true;
      checkpointManager.rebuild();
    }
    const { maxCheckpointNumber, startFinishCp } = this.getStartFinishInfo(currentTrack);
    // Everyone's first gate is the start/finish line.
    checkpointManager.updatePlayerCheckpointHighlight(maxCheckpointNumber > 0 ? maxCheckpointNumber - 1 : 0);

    // -- One visual truck per racer; the server decides where each one is --
    const selfVehicleDef = window.vehicleLoader?.getVehicle(players.find((p) => p.id === selfId)?.vehicleKey) ?? null;
    this.truckAudioController = await TruckAudioController.create(audioManager, selfVehicleDef?.engineAudio);
    const racers = players.map((p, i) => {
      const colorKey = AI_COLOR_KEYS[i % AI_COLOR_KEYS.length];
      const vehicleDef = window.vehicleLoader?.getVehicle(p.vehicleKey ?? 'baja') ?? null;
      const truck = new Truck(scene, shadows, basicColors[colorKey]?.diffuse ?? null, null, vehicleDef, null);
      truck.mesh.isVisible = false;
      if (p.id === selfId) truck.setAudioController(this.truckAudioController);
      return { ...p, colorKey, truck, isSelf: p.id === selfId, seen: false, lap: 0, finished: false };
    });
    const self = racers.find((r) => r.isSelf);

    // -- HUD --
    const uiManager = new UIManager();
    this.uiManager = uiManager;
    uiManager.showRaceStatusPanel();
    uiManager.updateLaps(0, laps);
    const syncTruckStatus = () => uiManager.updateTruckStatus(racers.map((r) => ({
      id: r.id,
      name: r.isSelf ? 'You' : r.name,
      isPlayer: r.isSelf,
      color: r.truck.diffuseColor,
      lap: r.lap,
      totalLaps: laps,
      boosts: r.boosts ?? 0,
      boostActive: r.truck.state.boostActive,
      finished: r.finished,
    })), laps);
    syncTruckStatus();

    const dotColors = racers.map((r) => DriveMode.dotColor(r.truck.diffuseColor));
    this.setupMinimap(currentTrack, startFinishCp, () => racers.map((r, i) => ({
      x: r.truck.mesh.position.x, z: r.truck.mesh.position.z, color: dotColors[i], isPlayer: r.isSelf,
    })));

    // -- Network --
    const net = this.net = new NetClient({ host: race.host, port: race.port, token: race.token });
    let raceStartTick = null;
    let selfFinishMs = null;
    let resultsShown = false;

    // -- Prediction: our own truck simulates locally, reconciled to the server --
    const prediction = new Prediction({
      truck: self.truck,
      track: currentTrack,
      terrainManager,
      staticBodyCollisionManager: new StaticBodyCollisionManager(scene),
    });
    this.prediction = prediction;
    const pendingSnapshots = [];

    this._unsubscribers.push(
      net.on('welcome', ({ seed }) => {
        // The same seeded roughness stream the server gives our truck.
        self.truck.terrainPhysics.random = rngStream(seed, `truck:${selfId}`);
      }),
      net.on('snapshot', (snap) => pendingSnapshots.push(snap)),
      net.on('countdown', ({ goTick }) => {
        prediction.goTick = goTick;
        // Line the 3-2-1 up with the server's GO tick.
        const msToGo = ((goTick - net.serverTick()) / TICK_RATE) * 1000;
        const t = setTimeout(() => this.runCountdownSequence(uiManager, () => {
          stopTheme(audioManager);
          this.musicManager?.start();
        }), Math.max(0, msToGo - 3000));
        this._countdownTimeouts.push(t);
      }),
      net.on('event', (e) => {
        // Pickups live on the server; show the ones it spawns, drop the taken.
        if (e.event === 'pickupSpawn') {
          pickupManager.addMirrored({ id: e.id, x: e.x, z: e.z, type: e.kind, value: e.value });
          return;
        }
        if (e.event === 'pickup') {
          pickupManager.removeMirrored(e.pickupId);
          if (e.id === selfId && e.kind === 'boost') self.truck.audioController?.playReload?.();
          return;
        }
        if (e.event === 'raceStart') {
          raceStartTick = e.t;
          uiManager.showRaceTimer();
          return;
        }
        if (e.id !== selfId) return;
        if (e.event === 'startLine') {
          checkpointManager.updatePlayerCheckpointHighlight(0);
          uiManager.updateCheckpoints(0);
        } else if (e.event === 'checkpoint') {
          checkpointManager.updatePlayerCheckpointHighlight(e.index);
          uiManager.updateCheckpoints(e.count);
        } else if (e.event === 'lap') {
          uiManager.updateLaps(e.lap, laps);
          uiManager.updateCheckpoints(0);
          if (e.lap === laps - 1) self.truck.audioController?.playLastLapAirhorn();
          if (e.lap >= laps) checkpointManager.clearPlayerCheckpointHighlight();
          else checkpointManager.updatePlayerCheckpointHighlight(0);
        } else if (e.event === 'finish') {
          selfFinishMs = e.timeMs;
        }
      }),
      net.on('results', ({ rows }) => {
        resultsShown = true;
        this.truckAudioController?.stop();
        uiManager.hideAll();
        menuManager.showSingleRaceResults({
          trackKey,
          rows: rows.map((row) => {
            const r = racers.find((x) => x.id === row.id);
            const c = r?.truck.diffuseColor;
            return {
              id: row.id,
              name: r?.isSelf ? 'You' : row.name,
              isPlayer: !!r?.isSelf,
              finishPosition: row.position,
              totalRaceTimeMs: row.timeMs,
              fastestLapMs: row.bestLapMs,
              dnf: row.dnf,
              vehicleKey: r?.truck.vehicleDef?.id ?? null,
              color: c ? [c.r, c.g, c.b] : null,
            };
          }),
        });
      }),
      net.on('close', ({ code }) => {
        if (resultsShown) return;
        console.warn(`[NetRaceMode] race connection closed (${code})`);
        uiManager.showCountdown('Disconnected');
      }),
    );

    // -- Input --
    this.cameraController = cameraController;
    const inputManager = this.inputManager = new InputManager(self.truck, cameraController);
    let boostFrames = 0;
    let resetFrames = 0;
    inputManager.onPause(() => menuManager.showPauseMenu());
    inputManager.onBoost(() => { boostFrames = PRESS_HOLD_FRAMES; });
    inputManager.onReset(() => { resetFrames = PRESS_HOLD_FRAMES; });
    menuManager.onResume = () => menuManager.hideMenu();
    menuManager.onReset = () => {
      resetFrames = PRESS_HOLD_FRAMES;
      menuManager.hideMenu();
    };
    menuManager.onExit = () => this.controller.switchToMode('menu');

    // -- Frame loop: send input, pose trucks from snapshots, present --
    const sample = {};
    let statusElapsedMs = 0;
    let statsElapsedMs = 0;
    scene.onBeforeRenderObservable.add(() => {
      if (document.hidden) return;
      const dt = this.getClampedDeltaTime(engine, 0.1);

      // A paused player sends neutral input: the server repeats the last
      // frame it got, so a held throttle would otherwise keep driving.
      let frame = NEUTRAL;
      if (!menuManager.isPaused) {
        const m = inputManager.getMovementInput();
        frame = {
          s: m.left ? -1 : m.right ? 1 : 0,
          g: m.forward ? 1 : m.back ? -1 : 0,
          b: boostFrames > 0,
          r: resetFrames > 0,
        };
      }
      if (boostFrames > 0) boostFrames--;
      if (resetFrames > 0) resetFrames--;

      // Our truck: back onto its sim pose, reconcile with any new snapshots,
      // then simulate the ticks we're sending input for now.
      prediction.restorePose();
      for (const snap of pendingSnapshots.splice(0)) {
        const mine = snap.trucks.find((t) => t.id === selfId);
        if (!mine) continue;
        if (!prediction.started) prediction.start(mine, snap.t);
        else prediction.reconcile(mine, snap.t);
        self.lap = mine.lap ?? self.lap;
        self.finished = (mine.flags & 4) !== 0;
      }
      const ticks = net.sendInput(frame);
      prediction.predictTo(ticks.at(-1) ?? prediction.lastTick ?? -1, ticks.map((t) => [t, frame]));
      if (prediction.started) {
        if (!self.seen) self.seen = true;
        prediction.present(Math.min(1, Math.max(0, net.predictionTick() - prediction.lastTick)), dt);
        self.truck.updatePresentation(dt, terrainManager, currentTrack, self.truck.mesh.position);
        self.boosts = prediction.boosts;
      }

      const renderTick = net.renderTick();
      for (const r of racers) {
        if (r.isSelf && prediction.started) continue;
        if (!net.snapshots.sample(r.id, renderTick, sample)) continue;
        if (!r.seen) {
          r.seen = true;
          r.truck.mesh.isVisible = false; // the body puppet is the visible truck
        }
        r.truck.applyNetState(sample, terrainManager);
        r.truck.updatePresentation(dt, terrainManager, currentTrack, self.truck.mesh.position);
        r.lap = sample.lap ?? r.lap;
        r.finished = (sample.flags & 4) !== 0;
        r.boosts = sample.n;
      }

      for (const pose of net.snapshots.sampleObstacles(renderTick)) obstacleManager.applyPose(pose);
      pickupManager.animate(dt);

      if (raceStartTick !== null) {
        const ms = selfFinishMs ?? ((net.serverTick() - raceStartTick) / TICK_RATE) * 1000;
        uiManager.updateTimer(Math.max(0, ms));
      }
      uiManager.updateBoosts(self.boosts ?? 0);
      uiManager.setBoostActive(self.truck.state.boostActive);
      statsElapsedMs += dt * 1000;
      if (statsElapsedMs >= 5000) {
        statsElapsedMs = 0;
        const s = prediction.stats;
        console.info(`[NetRaceMode] rtt ${net.clock.rttMs?.toFixed(0)} ms · corrections ${s.corrections} (last ${s.lastError.toFixed(3)} m, replayed ${s.replayed}) · resets ${s.resets}`);
      }
      statusElapsedMs += dt * 1000;
      if (statusElapsedMs >= TRUCK_STATUS_UI_INTERVAL_MS) {
        statusElapsedMs = 0;
        syncTruckStatus();
      }
      decorationManager.update(racers, dt);
      this.updateMinimap();
      cameraController.update(self.truck.mesh.position, self.truck.state.heading, dt, self.truck.state.velocity);
    });

    cameraController.update(self.truck.mesh.position, self.truck.state.heading);
    return scene;
  }

  teardown() {
    this._unsubscribers.forEach((fn) => fn());
    this._unsubscribers = [];
    this.net?.close();
    this.net = null;
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
    this.controller.menuManager.currentMenu = null;
    this.controller.menuManager.isPaused = false;
    this.controller.menuManager._store.isPaused = false;
    super.teardown();
  }
}
