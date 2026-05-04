import { useRaceStore } from '../vue/store.js';

/**
 * UIManager – thin bridge from game logic to the Vue/Pinia UI layer.
 * All DOM manipulation is gone; this class writes to reactive stores that
 * drive RaceHUD.vue. Debug panel state is managed by DebugManager.
 */
export class UIManager {
  constructor() {
    this._race = useRaceStore();
  }

  updateCheckpoints(count)          { this._race.checkpoints = count; }
  updateLaps(count, totalLaps = null) {
    this._race.lap = count;
    if (totalLaps !== null) this._race.totalLaps = totalLaps;
  }
  updateBoosts(count)                { this._race.boosts = count; }
  setBoostActive(active)             { this._race.boostActive = active; }
  updateTruckStatus(statuses, totalLaps = null) {
    this._race.truckStatus = Array.isArray(statuses) ? statuses : [];
    if (totalLaps !== null) this._race.totalLaps = totalLaps;
  }

  showRaceStatusPanel()              { this._race.visible = true; }
  hideRaceStatusPanel()              { this._race.visible = false; }

  showCountdown(text) {
    this._race.countdownText    = text;
    this._race.countdownVisible = true;
  }
  hideCountdown()                    { this._race.countdownVisible = false; }

  showOutOfBoundsCountdown(secondsRemaining) {
    this._race.oobCountdownSeconds = Math.max(0, Math.ceil(secondsRemaining));
    this._race.oobCountdownVisible = true;
  }

  hideOutOfBoundsCountdown() {
    this._race.oobCountdownVisible = false;
    this._race.oobCountdownSeconds = 0;
  }

  showRaceTimer()                    { this._race.timerVisible = true; }
  hideRaceTimer()                    { this._race.timerVisible = false; }

  updateTimer(milliseconds)          { this._race.timerMs = milliseconds; }

  /** Register a TelemetryRecorder so the HUD record/export buttons work. */
  setTelemetryRecorder(recorder) {
    this._race.telemetryRecording = false;
    this._race.telemetryHasData   = false;
    this._race.setTelemetryBridge(recorder);
  }

  /** Call from mode teardown() to reset all HUD state. */
  hideAll() {
    this._race.visible          = false;
    this._race.timerVisible     = false;
    this._race.countdownVisible = false;
    this._race.oobCountdownVisible = false;
    this._race.oobCountdownSeconds = 0;
    this._race.telemetryRecording = false;
    this._race.telemetryHasData   = false;
    this._race.truckStatus = [];
    this._race.setTelemetryBridge(null);
  }
}
