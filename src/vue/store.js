import { defineStore } from 'pinia';
import { ref, reactive, computed, shallowRef } from 'vue';
import { getObstacleSpec } from '../objects/Obstacle.js';
import { resetPlayerUpgrades, getUpgradeCatalog } from '../managers/UpgradeStorage.js';

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

  // ── Upgrade / pit actions ────────────────────────────────────────────────
  function purchaseUpgrade(id)     { _bridge.value?.onPurchaseUpgrade(id); }
  function resetUpgrades() {
    resetPlayerUpgrades();
    upgrades.value = getUpgradeCatalog({ balance: 0, ignoreBalance: true });
  }
  function selectPlayerColor(key)  { if (!_bridge.value) return; _bridge.value.setSelectedPlayerColor(key); }
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
    settings, back,
    purchaseUpgrade, resetUpgrades, selectPlayerColor, startSingleRace, singleRaceExit,
    setMode,
    setLoading,
  };
});

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
    telemetryRecording, telemetryHasData,
    setTelemetryBridge, toggleTelemetry, exportTelemetry,
  };
});

// ─── Debug panel store ────────────────────────────────────────────────────────
export const useDebugStore = defineStore('debug', () => {
  const visible = ref(false);
  const showBridgeDriveSurfaces = ref(false);
  const data = reactive({
    compression: '-', groundedness: '-', penetration: '-',
    vvel: '-', speed: '-', grip: '-', slip: '-',
    terrain: '-', slope: '-', x: '0.00', y: '0.00', z: '0.00',
    nx: '0.000', ny: '1.000', nz: '0.000',
    surfaceId: '-', surfaceType: '-', surfaceKind: '-', surfaceLevel: '-',
    topologyNodes: '-', topologyConnectors: '-', topologySummary: '-',
    topologyAutoLinked: '-', topologyAutoUnlinked: '-',
    topologyTerrainLinks: '-', topologyBridgeLinks: '-',
  });
  const recording  = ref(false);
  const frameCount = ref(0);

  // ── Vehicle handling debug overlay (practice mode) ──
  const vehicleVisible = ref(false);
  const vehicle = reactive({
    name: '-',
    // High-level handling knobs (the live-tunable interface).
    driftEnter: 0.5,
    driftMaintain: 0.5,
    lateralBias: 0.0,
    driftExit: 0.5,
    // A few high-value params that round out the vehicle's feel.
    grip: 0.12,
    turnSpeed: 3.6,
    weightTransfer: 1.35,
    // Read-only: the low-level drift values the knobs currently resolve to.
    resolved: {},
  });

  const _bridge = shallowRef(null);
  function setBridge(mgr) { _bridge.value = mgr; }
  function startRecording() { _bridge.value?.startRecording(); }
  function stopRecording()  { _bridge.value?.stopRecording();  }
  function dumpLog()        { _bridge.value?.dumpLog();        }
  function toggleBridgeDriveSurfaces() {
    showBridgeDriveSurfaces.value = !showBridgeDriveSurfaces.value;
    _bridge.value?.setBridgeDriveSurfaceDebug?.(showBridgeDriveSurfaces.value);
  }
  // Setting a handling knob re-resolves the low-level drift params on the truck.
  function setVehicleKnob(key, val) {
    vehicle[key] = val;
    _bridge.value?.applyVehicleHandling?.();
  }
  // Setting a direct param writes it straight onto truck state.
  function setVehicleParam(key, val) {
    vehicle[key] = val;
    _bridge.value?.applyVehicleParam?.(key, val);
  }
  function copyVehicleJson() { _bridge.value?.copyVehicleJson?.(); }
  function resetVehicleHandling() { _bridge.value?.resetVehicleHandling?.(); }

  return {
    visible,
    showBridgeDriveSurfaces,
    data,
    recording,
    frameCount,
    vehicleVisible,
    vehicle,
    setBridge,
    startRecording,
    stopRecording,
    dumpLog,
    toggleBridgeDriveSurfaces,
    setVehicleKnob,
    setVehicleParam,
    copyVehicleJson,
    resetVehicleHandling,
  };
});

// ─── Editor store ─────────────────────────────────────────────────────────────
export const useEditorStore = defineStore('editor', () => {
  // Which entity type is currently selected (null | 'checkpoint' | 'hill' | 'squareHill' | 'terrainShape' | 'normalMapDecal' | 'meshGrid' | 'polyWall' | 'flag' | 'obstacle')
  const selectedType = ref(null);
  const activeTool = ref(null);

  // Add-entity menu
  const addMenuOpen = ref(false);

  // Snap
  const snapEnabled = ref(false);
  const snapSize = ref(1);
  const gizmosVisible = ref(true);

  // ── Checkpoint panel ──
  const checkpoint = reactive({
    width: 10,
    orderNum: 1,
    heading: 0,
  });

  // ── Hill panel ──
  const hill = reactive({
    radiusX: 10,
    radiusZ: 10,
    rotation: 0,
    height: 5,
    waterLevelOffset: 2,
    terrainType: 'none',
    blendWidth: 0,
  });

  // ── Square hill panel ──
  const squareHill = reactive({
    width: 10,
    depth: 10,
    height: 3,
    waterLevelOffset: 1,
    transition: 4,
    angle: 0,
    slopeMode: false,
    heightAtMin: 0,
    heightAtMax: 3,
    terrainType: 'none',
    blendWidth: 0,
  });

  // ── Terrain shape panel (rect + circle/ellipse) ──
  const terrainShape = reactive({
    shape: 'rect',
    width: 10,
    depth: 10,
    rotation: 0,
    blendWidth: 0,
    terrainType: 'mud',
  });

  // ── Normal Map Decal panel ──
  const normalMapDecal = reactive({
    width: 10,
    depth: 10,
    angle: 0,
    normalMap: 'normals/6481-normal.jpg',
    repeatU: 1,
    repeatV: 1,
    intensity: 0.5,
  });

  // ── Obstacle panel ──
  const obstacle = reactive({
    type: 'barrel',
    scale: 1,
    rotation: 0,
    weight: 22,
    color: 'yellow',
    placementActive: false,
    options: [
      { value: 'barrel', label: 'Barrel' },
      { value: 'hayBale', label: 'Hay Bale' },
      { value: 'tireStack', label: 'Tire Stack' },
      { value: 'softWall', label: 'Soft Wall' },
    ],
    colorOptions: [
      { value: 'white', label: 'White' },
      { value: 'red', label: 'Red' },
      { value: 'blue', label: 'Blue' },
      { value: 'yellow', label: 'Yellow' },
      { value: 'black', label: 'Black' },
    ],
  });

  // ── Mesh grid panel ──
  const meshGrid = reactive({
    cols: 9,
    rows: 9,
    width: 160,
    depth: 160,
    maxWidth: 160,
    maxDepth: 160,
    smoothing: 0,
    angle: 0,
    falloff: 15,
    regional: false,
    stepSize: 0.5,
    hasSelection: false,
    pointHeight: 0,
  });

  // ── Bridge Mesh panel ──
  const bridgeMesh = reactive({
    cols: 4,
    rows: 2,
    width: 20,
    depth: 20,
    rotation: 0,
    thickness: 0.4,
    layerId: 1,
    stepSize: 0.5,
    hasSelection: false,
    pointHeight: 0,
  });

  // ── Poly wall panel ──
  const polyWall = reactive({
    hasSelection: false,
    canHaveRadius: false,
    radius: 0,
    maxRadius: Infinity,
    smoothing: 1,
    height: 2,
    collisionHeight: 2,
    thickness: 0.5,
    closed: false,
    style: 'red_white',
  });

  // ── Poly hill panel ──
  const polyHill = reactive({
    hasSelection: false,
    canHaveRadius: false,
    canDeletePoint: false,
    radius: 0,
    height: 3,
    width: 5,
    terrainType: 'none',
    blendWidth: 0,
    closed: false,
    filled: false,
    waterLevelOffset: 2,
    canHaveWater: false,
  });

  // ── Flag panel ──
  const flag = reactive({
    color: 'red',
  });

  // ── Decoration panel (flags + banner strings)
  const decoration = reactive({
    type: 'flag',
    color: 'red',
    width: 8,
    poleHeight: 4.2,
    heading: 0,
  });

  // ── Track Sign panel ──
  const trackSign = reactive({
    name: 'Track Name',
    rotation: 0,   // degrees
    contentType: 'text', // 'text' | 'brand'
    brandImage: 'energizer-racing.png',
    background: 'black', // 'black' | 'white'
    primaryColor: 'red',
    scale: 1,
    heightOffset: 0,
    width: 10,
  });

  // ── Banner String panel ──
  const bannerString = reactive({
    width: 8,
    poleHeight: 4.2,
    heading: 0,   // degrees, display only
  });

  // ── Action Zone panel ──
  const actionZone = reactive({
    zoneType: 'pickupSpawn',
    shape: 'circle',
    radius: 15,
    pointCount: 0,
    selectedPointIndex: -1,
    boostStrength: 1.5,
    boostDuration: 1.5,
  });

  // ── Poly Curb panel ──
  const polyCurb = reactive({
    hasSelection: false,
    canHaveRadius: false,
    radius: 0,
    maxRadius: Infinity,
    height: 0.22,
    width: 0.9,
    closed: false,
    style: 'red_white',
  });

  // ── Track defaults ──
  const trackSettingsOpen = ref(false);
  const trackSettings = reactive({
    name: 'Untitled Track',
    id: 'untitled-track',
    width: 160,
    depth: 160,
    hidden: true,
    packId: '',
    dirtChunks: true,
  });
  const trackDefaultTerrain = ref('packed_dirt');
  const trackBorderTerrain = ref('packed_dirt');

  // ── Test mode (back button) ──
  const testModeActive = ref(false);
  const testModeReturnKey = ref(null);

  // ── AI path editor panel actions ──
  function openAiPath() {
    _bridge.value?.openAiPath?.();
    selectedType.value = 'aiPath';
  }

  function closeAiPath() {
    _bridge.value?.closeAiPath?.();
    selectedType.value = null;
  }

  const aiPathWear = reactive({
    enabled: true,
    width: 4.0,
    intensity: 0.8,
    laneSpacing: 2.0,
    pathWander: 0.7,
    edgeSoftness: 1.0,
    secondaryPathCount: 60,
    secondaryPathStrength: 0.8,
    secondaryPathSpacing: 0.04,
  });

  const aiPathBranch = reactive({
    editingMainPath: true,
    activeBranchId: null,
    activeBranchWeight: 1,
    activeBranchFromMainIndex: null,
    activeBranchToMainIndex: null,
    mainWaypointCount: 0,
  });
  const aiPathBranches = ref([]);

  function editMainAiPath()                 { aiPathBranch.editingMainPath = true; aiPathBranch.activeBranchId = null; _bridge.value?.editMainAiPath?.(); }
  function selectAiPathBranch(id)           { aiPathBranch.editingMainPath = !id; aiPathBranch.activeBranchId = id ?? null; _bridge.value?.selectAiPathBranch?.(id ?? null); }
  function setActiveAiPathBranchWeight(val) { aiPathBranch.activeBranchWeight = val; _bridge.value?.setActiveAiPathBranchWeight?.(val); }
  function setActiveAiPathBranchRejoinIndex(val) { aiPathBranch.activeBranchToMainIndex = val; _bridge.value?.setActiveAiPathBranchRejoinIndex?.(val); }

  // ── Terrain path panel ──
  const terrainPath = reactive({
    width: 8,
    blendWidth: 0,
    cornerRadius: 0,
    closed: false,
    terrainType: 'mud',
  });


  // ── Vue panel bridge (set to EditorController instance on activate) ──
  const _bridge = shallowRef(null);
  function setBridge(controller) {
    _bridge.value = controller;
    if (!controller) { snapEnabled.value = false; snapSize.value = 1; }
  }

  const snapSizes = [0.5, 1, 2, 5];
  const isEditorActive = computed(() => _bridge.value !== null);
  function toggleSnap()    { snapEnabled.value = !snapEnabled.value; }
  function cycleSnapSize() { const idx = snapSizes.indexOf(snapSize.value); snapSize.value = snapSizes[(idx + 1) % snapSizes.length]; snapEnabled.value = true; }
  function toggleGizmosVisible() { gizmosVisible.value = !gizmosVisible.value; _bridge.value?.toggleGizmosVisible(); }
  function quickTestTrack() { _bridge.value?.quickTestTrack(); }
  function rebuildScene() { _bridge.value?.rebuildScene?.(); }
  function openTrackSettings() { trackSettingsOpen.value = true; }
  function closeTrackSettings() { trackSettingsOpen.value = false; }
  function toggleTrackSettings() { trackSettingsOpen.value = !trackSettingsOpen.value; }
  function setTrackName(name) {
    trackSettings.name = name;
    _bridge.value?.changeTrackName?.(name);
  }
  function setTrackId(id) {
    trackSettings.id = id;
    _bridge.value?.changeTrackId?.(id);
  }
  function setTrackHidden(hidden) {
    trackSettings.hidden = !!hidden;
    _bridge.value?.changeTrackHidden?.(!!hidden);
  }
  function setTrackPackId(packId) {
    trackSettings.packId = packId;
    _bridge.value?.changeTrackPackId?.(packId);
  }
  function setTrackDirtChunks(enabled) {
    trackSettings.dirtChunks = !!enabled;
    _bridge.value?.changeTrackDirtChunks?.(!!enabled);
  }
  function _normalizeTrackDimension(val, fallback) {
    const numeric = Number(val);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(320, Math.max(80, Math.round(numeric)));
  }
  function setTrackWidth(width) {
    const next = _normalizeTrackDimension(width, trackSettings.width);
    trackSettings.width = next;
    _bridge.value?.changeTrackWidth?.(next);
  }
  function setTrackDepth(depth) {
    const next = _normalizeTrackDimension(depth, trackSettings.depth);
    trackSettings.depth = next;
    _bridge.value?.changeTrackDepth?.(next);
  }

  // ── Checkpoint actions ──

  // ── Hill actions ──
  function setHillRadius(val)           { hill.radiusX = val; hill.radiusZ = val; _bridge.value?.changeHillRadius(val); }

  // ── Square Hill actions ──
  function setSquareHillHeightMin(val)  { squareHill.heightAtMin = val; _bridge.value?.changeSquareHillHeightMin(val); }
  function setSquareHillHeightMax(val)  { squareHill.heightAtMax = val; _bridge.value?.changeSquareHillHeightMax(val); }
  function setSquareHillMode(sloped)    { squareHill.slopeMode = sloped; _bridge.value?.changeSquareHillMode(sloped); }

  // ── Terrain Shape actions ──

  // ── Normal Map Decal actions ──

  // ── Poly Wall actions ──

  // ── Poly Hill actions ──

  // ── Flag actions ──

  function setDecorationColor(val)       { decoration.color = val; _bridge.value?.changeFlagColor(val); }
  function setDecorationWidth(val)       { decoration.width = val; _bridge.value?.changeBannerStringWidth(val); }
  function setDecorationPoleHeight(val)  { decoration.poleHeight = val; _bridge.value?.changeBannerStringPoleHeight(val); }
  function setDecorationHeading(val)     { decoration.heading = val; _bridge.value?.changeBannerStringHeading(val); }

  // ── Track Sign actions ──

  // ── Banner String actions ──

  // ── Action Zone actions ──
  function setActionZoneType(val)     { actionZone.zoneType = val; _bridge.value?.changeActionZoneType(val); }

  // ── Poly Curb actions ──

  // ── Mesh grid actions ──
  function setMeshGridPointHeight(v) { meshGrid.pointHeight = v; _bridge.value?.setMeshGridPointHeight(v); }
  function setMeshGridDensity(v)     { meshGrid.cols = v; meshGrid.rows = v; }
  function setMeshGridWidth(v)       { meshGrid.width = v; }
  function setMeshGridDepth(v)       { meshGrid.depth = v; }
  function applyMeshGridSettings()   { _bridge.value?.applyMeshGridChanges(meshGrid.cols, meshGrid.rows, meshGrid.width, meshGrid.depth); }

  // ── Bridge Mesh actions ──
  function setBridgeMeshPointHeight(v) { bridgeMesh.pointHeight = v; _bridge.value?.setBridgeMeshPointHeight(v); }
  function setBridgeMeshThickness(v) {
    const next = Math.max(0.1, v);
    bridgeMesh.thickness = next;
    _bridge.value?.changeBridgeMeshThickness(next);
  }
  function setBridgeMeshLayerId(v) {
    const next = Math.max(0, Math.round(v));
    bridgeMesh.layerId = next;
    _bridge.value?.changeBridgeMeshLayerId(next);
  }
  function applyBridgeMeshSettings()   { _bridge.value?.applyBridgeMeshChanges(bridgeMesh.cols, bridgeMesh.rows, bridgeMesh.width, bridgeMesh.depth); }

  function setTrackDefaultTerrain(name) { trackDefaultTerrain.value = name; _bridge.value?.changeTrackDefaultTerrain(name); }
  function setTrackBorderTerrain(name) { trackBorderTerrain.value = name; _bridge.value?.changeTrackBorderTerrain(name); }

  // ── Test mode ──
  function setActiveTool(val)           { activeTool.value = val; }

  // ── Add-entity menu ──
  function openAddMenu()       { addMenuOpen.value = true; }
  function closeAddMenu()      { addMenuOpen.value = false; }
  function toggleAddMenu()     { addMenuOpen.value = !addMenuOpen.value; }

  // ── Add entity actions ──
  function setObstacleType(val) {
    obstacle.type = val;
    obstacle.weight = getObstacleSpec(val).mass;
    _bridge.value?.changeObstacleType?.(val);
  }

  // ── Surface decal stamp ──
  const surfaceDecal = reactive({ decalType: 'gouge', decalTypes: ['gouge', 'holes', 'rough'], imageName: '', angle: 0, randomRotation: true, width: 4, depth: 4, opacity: 0.8 });

  // ── Generic panel plumbing ──────────────────────────────────────────────
  // Regular property setters and feature actions route through these two
  // generics instead of one named store action per property:
  //   setFeatureProp('hill', 'radiusX', v) mirrors v into the panel state
  //     object and forwards to EditorController.setFeatureProp, which
  //     dispatches to changeHillRadiusX by naming convention.
  //   featureAction('deleteSelectedHill') forwards a named controller call.
  // Only irregular setters (composite, normalizing, or convention-breaking
  // names) keep explicit actions above. New panels need zero store edits.
  const _panels = {
    checkpoint, hill, squareHill, terrainShape, normalMapDecal, obstacle,
    meshGrid, bridgeMesh, polyWall, polyHill, flag, decoration, trackSign,
    bannerString, actionZone, polyCurb, aiPathWear, terrainPath, surfaceDecal,
  };
  function setFeatureProp(panelKey, prop, val) {
    const panel = _panels[panelKey];
    if (panel && prop in panel) panel[prop] = val;
    _bridge.value?.setFeatureProp?.(panelKey, prop, val);
  }
  function featureAction(method, ...args) { _bridge.value?.[method]?.(...args); }

  return {
    setFeatureProp, featureAction,
    selectedType,
    activeTool,
    addMenuOpen,
    snapEnabled, snapSize, snapSizes,
    isEditorActive,
    checkpoint,
    hill,
    squareHill,
    terrainShape,
    normalMapDecal,
    obstacle,
    meshGrid,
    bridgeMesh,
    polyWall,
    polyHill,
    flag,
    testModeActive, testModeReturnKey,
    setBridge,
    setHillRadius, setSquareHillHeightMin, setSquareHillHeightMax, setSquareHillMode,
    decoration,
    setDecorationColor, setDecorationWidth,
    setDecorationPoleHeight, setDecorationHeading, trackSign,
    bannerString,
    actionZone,
    setActionZoneType, polyCurb,
    trackSettingsOpen, trackSettings,
    openTrackSettings, closeTrackSettings, toggleTrackSettings, setTrackName, setTrackId, setTrackHidden, setTrackPackId, setTrackDirtChunks, setTrackWidth, setTrackDepth,
    trackDefaultTerrain, setTrackDefaultTerrain,
    trackBorderTerrain, setTrackBorderTerrain,
    setActiveTool,
    gizmosVisible, toggleGizmosVisible,
    toggleSnap, cycleSnapSize, quickTestTrack,
    rebuildScene,
    openAddMenu, closeAddMenu, toggleAddMenu,
    setObstacleType, openAiPath, closeAiPath,
    aiPathWear,
    aiPathBranch, aiPathBranches,
    editMainAiPath, selectAiPathBranch, setActiveAiPathBranchWeight, setActiveAiPathBranchRejoinIndex, terrainPath,
    surfaceDecal,
    setMeshGridPointHeight,
    setMeshGridDensity, setMeshGridWidth, setMeshGridDepth,
    applyMeshGridSettings, setBridgeMeshPointHeight, setBridgeMeshThickness, setBridgeMeshLayerId,
    applyBridgeMeshSettings, };
});
