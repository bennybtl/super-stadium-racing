import { defineStore } from 'pinia';
import { ref, reactive, shallowRef } from 'vue';

// ─── Menu store ───────────────────────────────────────────────────────────────
export const useMenuStore = defineStore('menu', () => {
  // UI state — drives MenuOverlay.vue rendering. null = hidden.
  const screen = ref('start');
  const isPaused = ref(false);
  const trackList = ref([]); // [{ key, name }]

  // Opaque reference to MenuManager; not observed deeply.
  const _bridge = shallowRef(null);
  function setBridge(manager) { _bridge.value = manager; }

  // ── Actions called by Vue components ──
  function showTrackSelect()       { _bridge.value?.showTrackSelectMenu(); }
  function showEditorTrackSelect() { _bridge.value?.showEditorTrackSelect(); }

  function selectTrack(key) {
    if (!_bridge.value) return;
    _bridge.value.selectedTrack = key;
    _bridge.value.showLapSelectMenu();
  }

  function startGame(laps) {
    if (!_bridge.value) return;
    _bridge.value.selectedLaps = laps;
    _bridge.value.onStartGame();
  }

  function startEditor(key) {
    if (!_bridge.value) return;
    _bridge.value.selectedTrack = key;
    _bridge.value.onStartEditor();
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
    else if (target === 'trackSelect') _bridge.value.showTrackSelectMenu();
  }

  return {
    screen, isPaused, trackList,
    setBridge,
    showTrackSelect, showEditorTrackSelect, selectTrack,
    startGame, startEditor,
    resume, reset, exit,
    editorResume, editorSave, editorLoad, editorExit,
    settings, back,
  };
});

// ─── Race HUD store ───────────────────────────────────────────────────────────
export const useRaceStore = defineStore('race', () => {
  const visible = ref(false);
  const checkpoints = ref(0);
  const lap = ref(0);
  const totalLaps = ref(3);
  const boosts = ref(5);
  const boostActive = ref(false);
  const timerMs = ref(0);
  const timerVisible = ref(false);
  const countdownText = ref('');
  const countdownVisible = ref(false);

  return {
    visible, checkpoints, lap, totalLaps,
    boosts, boostActive,
    timerMs, timerVisible,
    countdownText, countdownVisible,
  };
});

// ─── Debug panel store ────────────────────────────────────────────────────────
export const useDebugStore = defineStore('debug', () => {
  const visible = ref(false);
  const data = reactive({
    compression: '-', groundedness: '-', penetration: '-',
    vvel: '-', speed: '-', grip: '-', slip: '-',
    terrain: '-', slope: '-', x: '0.00', y: '0.00', z: '0.00',
  });
  return { visible, data };
});

// ─── Editor store ─────────────────────────────────────────────────────────────
export const useEditorStore = defineStore('editor', () => {
  // Which entity type is currently selected (null | 'checkpoint' | 'hill' | 'squareHill' | 'terrainRect' | 'meshGrid' | 'polyWall')
  const selectedType = ref(null);

  // Add-entity menu
  const addMenuOpen = ref(false);

  // Snap
  const snapEnabled = ref(false);
  const snapSize = ref(1);

  // ── Checkpoint panel ──
  const checkpoint = reactive({
    width: 10,
    orderNum: 1,
  });

  // ── Hill panel ──
  const hill = reactive({
    radius: 10,
    height: 5,
  });

  // ── Square hill panel ──
  const squareHill = reactive({
    width: 10,
    depth: 10,
    height: 3,
    transition: 4,
    angle: 0,
    slopeMode: false,
    heightAtMin: 0,
    heightAtMax: 3,
  });

  // ── Terrain rect panel ──
  const terrainRect = reactive({
    width: 10,
    depth: 10,
    terrainType: 'mud',
  });

  // ── Mesh grid panel ──
  const meshGrid = reactive({
    rows: 3,
    cols: 3,
    visible: false,
  });

  // ── Poly wall panel ──
  const polyWall = reactive({
    selectedIndex: null,
    pointCount: 0,
    visible: false,
  });

  // ── Test mode (back button) ──
  const testModeActive = ref(false);
  const testModeReturnKey = ref(null);

  return {
    selectedType,
    addMenuOpen,
    snapEnabled, snapSize,
    checkpoint,
    hill,
    squareHill,
    terrainRect,
    meshGrid,
    polyWall,
    testModeActive, testModeReturnKey,
  };
});
