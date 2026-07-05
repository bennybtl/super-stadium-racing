import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

// ─── Race HUD store ───────────────────────────────────────────────────────────
export const useRaceStore = defineStore('race', () => {
  const visible = ref(false);
  const checkpoints = ref(0);
  const lap = ref(0);
  const totalLaps = ref(3);
  const truckStatus = ref([]);
  const boosts = ref(5);
  const boostActive = ref(false);
  const timerMs = ref(0);
  const timerVisible = ref(false);
  const countdownText = ref('');
  const countdownVisible = ref(false);
  const oobCountdownVisible = ref(false);
  const oobCountdownSeconds = ref(0);

  // Hot Lap mode state
  const hotLapMode = ref(false);
  const hotLapBestMs = ref(null);
  const hotLapGhostVisible = ref(false);
  // Per-lap flash overlay: bumping the nonce replays the fade animation.
  const hotLapFlashMs = ref(0);
  const hotLapFlashRecord = ref(false);
  const hotLapFlashNonce = ref(0);

  // Telemetry recording state — driven by RaceMode via the bridge below
  const telemetryRecording = ref(false);
  const telemetryHasData   = ref(false);
  const _bridge = shallowRef(null);
  function setTelemetryBridge(recorder) { _bridge.value = recorder; }
  function toggleTelemetry() {
    if (!_bridge.value) return;
    if (_bridge.value.recording) {
      _bridge.value.stop();
      telemetryRecording.value = false;
      telemetryHasData.value = true;
    } else {
      _bridge.value.start(0);
      telemetryRecording.value = true;
      telemetryHasData.value = false;
    }
  }
  function exportTelemetry() {
    if (!_bridge.value || !telemetryHasData.value) return;
    const data = _bridge.value.export();
    // Persist in memory so the AI picks it up next race on the same track
    if (data) {
      if (!window._telemetryStore) window._telemetryStore = {};
      window._telemetryStore[data.trackId] = data;
    }
  }

  return {
    visible, checkpoints, lap, totalLaps, truckStatus,
    boosts, boostActive,
    timerMs, timerVisible,
    countdownText, countdownVisible,
    oobCountdownVisible, oobCountdownSeconds,
    hotLapMode, hotLapBestMs, hotLapGhostVisible,
    hotLapFlashMs, hotLapFlashRecord, hotLapFlashNonce,
    telemetryRecording, telemetryHasData,
    setTelemetryBridge, toggleTelemetry, exportTelemetry,
  };
});
