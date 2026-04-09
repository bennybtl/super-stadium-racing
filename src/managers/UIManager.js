import { useRaceStore } from '../vue/store.js';
import { useDebugStore } from '../vue/store.js';

/**
 * UIManager – thin bridge from game logic to the Vue/Pinia UI layer.
 * All DOM manipulation is gone; this class writes to reactive stores that
 * drive RaceHUD.vue and DebugPanel.vue.
 */
export class UIManager {
  constructor() {
    this._race  = useRaceStore();
    this._debug = useDebugStore();
    
  }

  updateCheckpoints(count)          { this._race.checkpoints = count; }
  updateLaps(count, totalLaps = null) {
    this._race.lap = count;
    if (totalLaps !== null) this._race.totalLaps = totalLaps;
  }
  updateBoosts(count)                { this._race.boosts = count; }
  setBoostActive(active)             { this._race.boostActive = active; }

  showDebugPanel()                   { this._debug.visible = true; }
  hideDebugPanel()                   { this._debug.visible = false; }
  toggleDebugPanel()                 { this._debug.visible = !this._debug.visible; }

  showRaceStatusPanel()              { this._race.visible = true; }
  hideRaceStatusPanel()              { this._race.visible = false; }

  showCountdown(text) {
    this._race.countdownText    = text;
    this._race.countdownVisible = true;
  }
  hideCountdown()                    { this._race.countdownVisible = false; }

  showRaceTimer()                    { this._race.timerVisible = true; }
  hideRaceTimer()                    { this._race.timerVisible = false; }

  updateTimer(milliseconds)          { this._race.timerMs = milliseconds; }

  updateDebugPanel(debugInfo, terrainType, slopeAngleDeg = null) {
    if (!debugInfo) return;
    const d = this._debug.data;
    d.compression    = (debugInfo.compression ?? 0).toFixed(2);
    d.groundedness   = (debugInfo.groundedness ?? 0).toFixed(2);
    d.penetration    = (debugInfo.penetration ?? 0).toFixed(3);
    d.vvel           = (debugInfo.verticalVelocity ?? 0).toFixed(2);
    d.speed          = (debugInfo.speed ?? 0).toFixed(2);
    d.grip           = (debugInfo.effectiveGrip ?? 0).toFixed(3);
    d.slip           = ((debugInfo.slipAngle ?? 0) * 180 / Math.PI).toFixed(1) + '°';
    d.terrain        = terrainType?.name || 'dirt';
    d.slope          = slopeAngleDeg !== null ? slopeAngleDeg.toFixed(1) + '°' : '-';
  }

  updatePosition(position) {
    const d  = this._debug.data;
    d.x = position.x.toFixed(2);
    d.y = position.y.toFixed(2);
    d.z = position.z.toFixed(2);
  }

  /** Call from RaceMode.teardown() to reset all HUD state. */
  hideAll() {
    this._race.visible          = false;
    this._race.timerVisible     = false;
    this._race.countdownVisible = false;
    this._debug.visible         = false;
  }
}
