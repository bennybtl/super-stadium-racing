import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { resetPlayerUpgrades, getUpgradeCatalog } from '../../managers/UpgradeStorage.js';

// ─── Menu store ───────────────────────────────────────────────────────────────
export const useMenuStore = defineStore('menu', () => {
  // UI state — drives MenuOverlay.vue rendering. null = hidden.
  const screen = ref('title');
  const isPaused = ref(false);
  const trackList = ref([]); // [{ key, name }]
  const vehicleList = ref([]); // [{ key, name }]
  const selectedTrack = ref(null);
  const selectedLaps = ref(5);
  const selectedAIDrivers = ref(3);
  const selectedAIVehicleType = ref('random');
  const selectedReverse = ref(false);
  const selectedVehicle = ref('default_truck');
  // Current gameplay mode: null | 'practice' | 'singleRace'
  const mode = ref(null);

  // Overlay data (null when not showing)
  const pitData         = ref(null);
  const singleRaceData  = ref(null);
  const loadingVisible = ref(false);
  const loadingMessage = ref('Loading…');
  // Upgrades state for UI
  const upgrades = ref([]);
  
  // Settings state
  const truckMode = ref(localStorage.getItem('truckMode') || 'arcade');

  // Opaque reference to MenuManager; not observed deeply.
  const _bridge = shallowRef(null);
  function setBridge(manager) { _bridge.value = manager; }

  // ── Actions called by Vue components ──
  function showEditorTrackSelect() { _bridge.value?.showEditorTrackSelect(); }

  function startEditor(key) {
    if (!_bridge.value) return;
    _bridge.value.selectedTrack = key;
    _bridge.value.onStartEditor();
  }

  function selectPlayerVehicle(key) { if (!_bridge.value) return; _bridge.value.setSelectedVehicle(key); }
  function setSelectedTrack(key) { if (!_bridge.value) return; _bridge.value.setSelectedTrack(key); }
  function setSelectedLaps(laps) { if (!_bridge.value) return; _bridge.value.setSelectedLaps(laps); }
  function setSelectedAIDrivers(count) { if (!_bridge.value) return; _bridge.value.setSelectedAIDrivers(count); }
  function setSelectedAIVehicleType(key) { if (!_bridge.value) return; _bridge.value.setSelectedAIVehicleType(key); }
  function setSelectedReverse(val) { selectedReverse.value = !!val; if (_bridge.value) _bridge.value.selectedReverse = !!val; }
  function showPitMenu(pitMode = 'singleRace') {
    if (pitMode === 'singleRace') mode.value = 'singleRace';
    _bridge.value?.showPitMenu(pitMode);
  }

  function startPracticeMode() {
    mode.value = 'practice';
    _bridge.value?.onStartPractice();
  }

  function resume()       { _bridge.value?.onResume(); }
  function reset()        { _bridge.value?.onReset(); }
  function exit()         { _bridge.value?.onExit(); }
  function editorResume() { _bridge.value?.onEditorResume(); }
  function editorSave()   { _bridge.value?.onEditorSave(); }
  function editorLoad()   { _bridge.value?.onEditorLoad(); }
  function editorExit()   { _bridge.value?.onEditorExit(); }
  function settings()     { _bridge.value?.onSettings(); }

  function back(target) {
    if (!_bridge.value) return;
    if (target === 'start')            _bridge.value.showStartMenu();
  }

  function refreshTrackList() { _bridge.value?._refreshTrackList(); }

  // ── Upgrade / pit actions ────────────────────────────────────────────────
  function purchaseUpgrade(id)     { _bridge.value?.onPurchaseUpgrade(id); }
  function resetUpgrades() {
    resetPlayerUpgrades();
    upgrades.value = getUpgradeCatalog({ balance: 0, ignoreBalance: true });
  }
  function selectPlayerColor(key)  { if (!_bridge.value) return; _bridge.value.setSelectedPlayerColor(key); }
  function startHotLapMode()          { mode.value = 'hotLap'; _bridge.value?.onStartHotLap(); }
  function startSingleRace()        { mode.value = 'singleRace'; _bridge.value?.onStartSingleRace(); }
  function singleRaceExit()        { mode.value = null; singleRaceData.value = null; _bridge.value?.onExit(); }
  function setMode(nextMode)       { mode.value = nextMode; }

  function setLoading(visible, message = null) {
    loadingVisible.value = !!visible;
    if (typeof message === 'string' && message.length) loadingMessage.value = message;
  }

  return {
    screen, isPaused, trackList, vehicleList, selectedTrack, selectedLaps, selectedAIDrivers, selectedAIVehicleType, selectedVehicle, mode,
    selectedReverse,
    pitData, singleRaceData, upgrades,
    loadingVisible, loadingMessage,
    setBridge,
    showEditorTrackSelect,
    startEditor,
    selectPlayerVehicle, setSelectedTrack, setSelectedLaps, setSelectedAIDrivers, setSelectedAIVehicleType, showPitMenu, startPracticeMode,
    setSelectedReverse,
    resume, reset, exit,
    editorResume, editorSave, editorLoad, editorExit,
    settings, back, refreshTrackList,
    purchaseUpgrade, resetUpgrades, selectPlayerColor, startHotLapMode, startSingleRace, singleRaceExit,
    setMode,
    setLoading,
  };
});
