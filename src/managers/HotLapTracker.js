import { GhostRecorder } from "./GhostRecorder.js";
import { GhostPlayer } from "./GhostPlayer.js";
import { loadHotLapRecords, insertHotLapRecord, saveHotLapRecords } from "./HotLapStorage.js";
import { useRaceStore } from "../vue/store.js";

/**
 * HotLapTracker — reusable lap-timing + best-lap-ghost feature that any drive
 * mode can bolt on.
 *
 * It detects laps through a CheckpointManager, keeps a dt-based lap clock (so
 * paused/hidden time is excluded and the clock stays in sync with the recorded
 * ghost), replays the fastest recorded lap as a translucent ghost, persists a
 * per-track leaderboard, and drives the hot-lap HUD (timer, best-lap readout,
 * ghost toggle, per-lap flash).
 *
 * Usage from a mode:
 *   this.hotLap = new HotLapTracker(scene, {
 *     checkpointManager, uiManager,
 *     trackKey, vehicleKey, vehicleDef, truckDims, upgrades,
 *     onLap: ({ lapCount, lapTimeMs, isRecord }) => { ... },
 *   });
 *   // each frame, after moving the truck:  this.hotLap.update(truck, dt);
 *   // on respawn/reset:                    this.hotLap.reset();
 *   // on teardown:                         this.hotLap.dispose();
 *
 * It tracks gate crossings under its own `truckId`, independent of any lap
 * logic the host mode runs for its trucks.
 */
export class HotLapTracker {
  constructor(scene, {
    checkpointManager,
    uiManager,
    trackKey,
    reverse = false,
    vehicleKey = 'default_truck',
    vehicleDef = null,
    truckDims = null,
    upgrades = null,
    truckId = 'hotlap',
    onLap = null,
  }) {
    this.scene = scene;
    this.checkpointManager = checkpointManager;
    this.uiManager = uiManager;
    this.trackKey = trackKey;
    this.reverse = reverse;
    this.vehicleKey = vehicleKey;
    this.vehicleDef = vehicleDef;
    this.truckDims = truckDims;
    this.upgrades = upgrades;
    this.truckId = truckId;
    this.onLap = onLap;
    this.store = useRaceStore();

    this.maxCheckpoint = checkpointManager.getTotalCheckpoints();
    if (this.maxCheckpoint === 0) {
      console.warn('[HotLap] Track has no checkpoints; lap timing and ghost are disabled.');
    }

    this.recorder = new GhostRecorder();
    this.ghost = null;
    this.ghostTruckType = null;

    // Per-track leaderboard (fastest first). The ghost replays the fastest lap,
    // which may have been set in a different truck than the one driving now.
    this.records = loadHotLapRecords(trackKey, reverse);
    const best = this.records[0] ?? null;
    this.bestLapMs = best?.lapTimeMs ?? null;
    if (best) {
      const ghostDef = window.vehicleLoader?.getVehicle(best.truckType) ?? vehicleDef;
      this.ghost = new GhostPlayer(scene, best.frames, { dims: best.dims ?? truckDims, vehicleDef: ghostDef });
      this.ghostTruckType = best.truckType;
    }

    this.lapCount = 0;
    this.hasStarted = false;
    this.checkpointCount = 0;
    this.lastCheckpointPassed = 0;

    // Hot-lap HUD (cleared centrally by UIManager.hideAll() on mode teardown).
    uiManager.showRaceStatusPanel();
    uiManager.showRaceTimer();
    this.store.hotLapMode = true;
    this.store.hotLapBestMs = this.bestLapMs;
    this.store.hotLapGhostVisible = true;

    this.reset();
  }

  /** Back to the staging line: fresh clock, checkpoint sequence, and recorder. */
  reset() {
    this.hasStarted = false;
    this.checkpointCount = 0;
    this.lapCount = 0;
    // Prime so the truck is ready to cross the start/finish gate first.
    this.lastCheckpointPassed = this.maxCheckpoint > 0 ? this.maxCheckpoint - 1 : 0;
    this.recorder.reset();
    this.checkpointManager.resetForTruck(this.truckId);
    if (this.maxCheckpoint > 0) {
      this.checkpointManager.updatePlayerCheckpointHighlight(this.lastCheckpointPassed);
    }
    this.uiManager.updateTimer(0);
    this.uiManager.updateCheckpoints(0);
  }

  /** Drive one frame from the player truck and delta time (seconds). */
  update(truck, dt) {
    // Lap clock + ghost recording.
    if (this.recorder.recording) {
      this.recorder.record(truck.mesh.position, truck.state.heading, dt * 1000);
      this.uiManager.updateTimer(this.recorder.elapsedMs);
    }

    // Ghost playback, driven by the live lap clock rather than its own counter.
    if (this.ghost) {
      const visible = this.store.hotLapGhostVisible;
      this.ghost.setVisible(visible);
      if (visible) this.ghost.update(this.recorder.recording ? this.recorder.elapsedMs : 0, dt);
    }

    // Checkpoint / lap detection.
    const res = this.checkpointManager.update(
      truck.mesh.position, truck.state.velocity, this.lastCheckpointPassed, this.truckId,
    );
    if (!res?.passed) return;

    // First crossing of the start/finish gate starts the clock + recording.
    if (res.index === this.maxCheckpoint && !this.hasStarted) {
      this.hasStarted = true;
      this.lastCheckpointPassed = 0;
      this.checkpointCount = 0;
      this.checkpointManager.resetForTruck(this.truckId);
      this.checkpointManager.updatePlayerCheckpointHighlight(0);
      this.uiManager.updateCheckpoints(0);
      this.recorder.start();
      return;
    }

    this.checkpointCount++;
    this.lastCheckpointPassed = res.index;
    this.checkpointManager.updatePlayerCheckpointHighlight(this.lastCheckpointPassed);
    this.uiManager.updateCheckpoints(this.checkpointCount);

    if (this.checkpointCount === this.maxCheckpoint) {
      this._completeLap();
    }
  }

  _completeLap() {
    const lapTime = Math.round(this.recorder.elapsedMs);
    const lapFrames = this.recorder.stop();
    this.lapCount++;
    this.checkpointCount = 0;
    this.lastCheckpointPassed = 0;
    this.checkpointManager.resetForTruck(this.truckId);
    this.checkpointManager.updatePlayerCheckpointHighlight(0);
    this.uiManager.updateCheckpoints(0);

    console.debug(`[HotLap] Lap ${this.lapCount}: ${(lapTime / 1000).toFixed(2)}s`);

    // Record the lap into the leaderboard; a new #1 becomes the ghost.
    let isRecord = false;
    if (lapFrames != null) {
      const { records, rank } = insertHotLapRecord(this.records, {
        lapTimeMs: lapTime,
        truckType: this.vehicleKey,
        upgrades: this.upgrades,
        dims: this.truckDims,
        frames: lapFrames,
        savedAt: Date.now(),
      });
      if (rank !== -1) {
        this.records = records;
        saveHotLapRecords(this.trackKey, records, this.reverse);
      }
      isRecord = rank === 0;

      if (isRecord) {
        this.bestLapMs = lapTime;
        this.store.hotLapBestMs = lapTime;
        this._swapGhost(lapFrames);
        console.debug(`[HotLap] New best: ${(lapTime / 1000).toFixed(2)}s`);
      }
    }

    // Per-lap flash overlay (fades via the HUD animation).
    this.store.hotLapFlashMs = lapTime;
    this.store.hotLapFlashRecord = isRecord;
    this.store.hotLapFlashNonce++;

    // Begin recording the next lap.
    this.recorder.start();

    this.onLap?.({ lapCount: this.lapCount, lapTimeMs: lapTime, isRecord });
  }

  _swapGhost(frames) {
    // Reuse the puppet only if it's already the current truck type; otherwise
    // rebuild it to look like the truck that set this lap.
    if (this.ghost && this.ghostTruckType === this.vehicleKey) {
      this.ghost.setFrames(frames);
    } else {
      this.ghost?.dispose();
      this.ghost = new GhostPlayer(this.scene, frames, { dims: this.truckDims, vehicleDef: this.vehicleDef });
    }
    this.ghostTruckType = this.vehicleKey;
    this.ghost.setVisible(this.store.hotLapGhostVisible);
  }

  dispose() {
    this.ghost?.dispose();
    this.ghost = null;
    this.recorder.reset();
    this.store.hotLapMode = false;
  }
}
