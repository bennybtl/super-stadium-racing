import { defineStore } from 'pinia';
import { ref, reactive, computed, shallowRef } from 'vue';
import { getObstacleSpec } from '../objects/Obstacle.js';

// ─── Menu store ───────────────────────────────────────────────────────────────
export const useMenuStore = defineStore('menu', () => {
  // UI state — drives MenuOverlay.vue rendering. null = hidden.
  const screen = ref('title');
  const isPaused = ref(false);
  const trackList = ref([]); // [{ key, name }]
  const vehicleList = ref([]); // [{ key, name }]
  const selectedTrack = ref(null);
  const selectedLaps = ref(3);
  const selectedAIDrivers = ref(9);
  const selectedVehicle = ref('default_truck');

  // Season overlay data (null when not showing)
  const postRaceData    = ref(null);
  const pitData         = ref(null);
  const seasonFinalData = ref(null);
  const singleRaceData  = ref(null);
  const loadingVisible = ref(false);
  const loadingMessage = ref('Loading…');
  
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
  function showPitMenu(mode = 'singleRace') { _bridge.value?.showPitMenu(mode); }
  function startPracticeMode() {
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

  // ── Season actions (called by Vue overlays) ──────────────────────────────
  function startSeasonMode() {
    _bridge.value?.onSeasonStart(selectedLaps.value);
  }
  function continueSeason()        { _bridge.value?.onContinueSeason(); }
  function retireFromSeason()      { _bridge.value?.onRetireFromSeason(); }
  function goToPit()               { _bridge.value?.onGoToPit(); }
  function purchaseUpgrade(id)     { _bridge.value?.onPurchaseUpgrade(id); }
  function selectPlayerColor(key)  { if (!_bridge.value) return; _bridge.value.setSelectedPlayerColor(key); }
  function startSingleRace()        { _bridge.value?.onStartSingleRace(); }
  function exitSeason()            { postRaceData.value = null; pitData.value = null; seasonFinalData.value = null; _bridge.value?.onRetireFromSeason(); }
  function singleRaceExit()        { singleRaceData.value = null; _bridge.value?.onExit(); }

  function setLoading(visible, message = null) {
    loadingVisible.value = !!visible;
    if (typeof message === 'string' && message.length) loadingMessage.value = message;
  }

  return {
    screen, isPaused, trackList, vehicleList, selectedTrack, selectedLaps, selectedAIDrivers, selectedVehicle,
    postRaceData, pitData, seasonFinalData, singleRaceData,
    loadingVisible, loadingMessage,
    setBridge,
    showEditorTrackSelect,
    startEditor,
    selectPlayerVehicle, setSelectedTrack, setSelectedLaps, setSelectedAIDrivers, showPitMenu, startPracticeMode,
    resume, reset, exit,
    editorResume, editorSave, editorLoad, editorExit,
    settings, back,
    continueSeason, retireFromSeason, goToPit, purchaseUpgrade, selectPlayerColor, startSingleRace, startSeasonMode, exitSeason, singleRaceExit,
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
  const data = reactive({
    compression: '-', groundedness: '-', penetration: '-',
    vvel: '-', speed: '-', grip: '-', slip: '-',
    terrain: '-', slope: '-', x: '0.00', y: '0.00', z: '0.00',
    nx: '0.000', ny: '1.000', nz: '0.000',
  });
  const recording  = ref(false);
  const frameCount = ref(0);
  const _bridge = shallowRef(null);
  function setBridge(mgr) { _bridge.value = mgr; }
  function startRecording() { _bridge.value?.startRecording(); }
  function stopRecording()  { _bridge.value?.stopRecording();  }
  function dumpLog()        { _bridge.value?.dumpLog();        }
  return { visible, data, recording, frameCount, setBridge, startRecording, stopRecording, dumpLog };
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
  });

  // ── Terrain shape panel (rect + circle/ellipse) ──
  const terrainShape = reactive({
    shape: 'rect',
    width: 10,
    depth: 10,
    rotation: 0,
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
    closed: false,
    filled: false,
  });

  // ── Bezier wall panel ──
  const bezierWall = reactive({
    hasSelection: false,
    height: 2,
    thickness: 0.5,
    closed: false,
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

  // ── Bridge panel ──
  const bridge = reactive({
    width:            20,
    depth:            8,
    height:           5,
    thickness:        0.4,
    angle:            0,
    materialType:     'packed_dirt',
    transitionEnabled: true,
    transitionDepth:  10,
    collisionEndCaps: false,
    collisionEndCapsOnDepth: true,
    collisionEndCapsOnWidth: false,
    collisionEndCapThickness: 1.2,
    collisionEndCapDrop: 30,
  });

  // ── Track defaults ──
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
    width: 3.2,
    intensity: 0.8,
    laneSpacing: 1.3,
    alphaBreakup: 0.28,
    pathWander: 0.5,
    edgeSoftness: 0.75,
    secondaryPathCount: 4,
    secondaryPathStrength: 0.62,
    secondaryPathSpacing: 0.1,
  });

  function setAiPathWearEnabled(val)      { aiPathWear.enabled = val;      _bridge.value?.changeAiPathWearEnabled?.(val); }
  function setAiPathWearWidth(val)        { aiPathWear.width = val;        _bridge.value?.changeAiPathWearWidth?.(val); }
  function setAiPathWearIntensity(val)    { aiPathWear.intensity = val;    _bridge.value?.changeAiPathWearIntensity?.(val); }
  function setAiPathWearLaneSpacing(val)  { aiPathWear.laneSpacing = val;  _bridge.value?.changeAiPathWearLaneSpacing?.(val); }
  function setAiPathWearAlphaBreakup(val) { aiPathWear.alphaBreakup = val; _bridge.value?.changeAiPathWearAlphaBreakup?.(val); }
  function setAiPathWearPathWander(val)    { aiPathWear.pathWander = val;   _bridge.value?.changeAiPathWearPathWander?.(val); }
  function setAiPathWearEdgeSoftness(val) { aiPathWear.edgeSoftness = val; _bridge.value?.changeAiPathWearEdgeSoftness?.(val); }
  function setAiPathWearSecondaryPathCount(val) { aiPathWear.secondaryPathCount = val; _bridge.value?.changeAiPathWearSecondaryPathCount?.(val); }
  function setAiPathWearSecondaryPathStrength(val) { aiPathWear.secondaryPathStrength = val; _bridge.value?.changeAiPathWearSecondaryPathStrength?.(val); }
  function setAiPathWearSecondaryPathSpacing(val) { aiPathWear.secondaryPathSpacing = val; _bridge.value?.changeAiPathWearSecondaryPathSpacing?.(val); }

  // ── Terrain path panel ──
  const terrainPath = reactive({
    width: 8,
    cornerRadius: 0,
    terrainType: 'mud',
  });

  function openTerrainPath()                  { _bridge.value?.openTerrainPath?.(); }
  function closeTerrainPath()                 { _bridge.value?.closeTerrainPath?.(); }
  function setTerrainPathWidth(val)           { terrainPath.width = val;         _bridge.value?.changeTerrainPathWidth?.(val); }
  function setTerrainPathCornerRadius(val)    { terrainPath.cornerRadius = val;  _bridge.value?.changeTerrainPathCornerRadius?.(val); }
  function setTerrainPathTerrainType(val)     { terrainPath.terrainType = val;   _bridge.value?.changeTerrainPathTerrainType?.(val); }
  function deleteTerrainPathWaypoint()        { _bridge.value?.deleteTerrainPathWaypoint?.(); }
  function clearTerrainPath()                 { _bridge.value?.clearTerrainPath?.(); }
  function addTerrainPath()                   { _bridge.value?.addTerrainPathEntity?.(); }

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

  // ── Checkpoint actions ──
  function setCheckpointWidth(val)      { checkpoint.width = val;      _bridge.value?.changeCheckpointWidth(val); }
  function setCheckpointHeading(val)    { checkpoint.heading = val;    _bridge.value?.changeCheckpointHeading(val); }
  function shiftCheckpointOrder(dir)    { _bridge.value?.shiftCheckpointOrder(dir); }
  function duplicateCheckpoint()        { _bridge.value?.duplicateSelectedCheckpoint(); }
  function deleteCheckpoint()           { _bridge.value?.deleteSelectedCheckpoint(); }
  function closeCheckpoint()            { _bridge.value?.deselectCheckpoint(); }

  // ── Hill actions ──
  function setHillRadius(val)           { hill.radiusX = val; hill.radiusZ = val; _bridge.value?.changeHillRadius(val); }
  function setHillRadiusX(val)          { hill.radiusX = val; _bridge.value?.changeHillRadiusX(val); }
  function setHillRadiusZ(val)          { hill.radiusZ = val; _bridge.value?.changeHillRadiusZ(val); }
  function setHillRotation(val)         { hill.rotation = val; _bridge.value?.changeHillRotation(val); }
  function setHillHeight(val)           { hill.height = val;       _bridge.value?.changeHillHeight(val); }
  function setHillWaterLevelOffset(val) { hill.waterLevelOffset = val; _bridge.value?.changeHillWaterLevelOffset(val); }
  function setHillTerrainType(name)     { hill.terrainType = name; _bridge.value?.changeHillTerrainType(name); }
  function duplicateHill()              { _bridge.value?.duplicateSelectedHill(); }
  function deleteHill()                 { _bridge.value?.deleteSelectedHill(); }
  function closeHill()                  { _bridge.value?.deselectHill(); }

  // ── Square Hill actions ──
  function setSquareHillWidth(val)      { squareHill.width = val;       _bridge.value?.changeSquareHillWidth(val); }
  function setSquareHillDepth(val)      { squareHill.depth = val;       _bridge.value?.changeSquareHillDepth(val); }
  function setSquareHillTransition(val) { squareHill.transition = val;  _bridge.value?.changeSquareHillTransition(val); }
  function setSquareHillAngle(val)      { squareHill.angle = val;       _bridge.value?.changeSquareHillAngle(val); }
  function setSquareHillHeight(val)     { squareHill.height = val;      _bridge.value?.changeSquareHillHeight(val); }
  function setSquareHillWaterLevelOffset(val) { squareHill.waterLevelOffset = val; _bridge.value?.changeSquareHillWaterLevelOffset(val); }
  function setSquareHillHeightMin(val)  { squareHill.heightAtMin = val; _bridge.value?.changeSquareHillHeightMin(val); }
  function setSquareHillHeightMax(val)  { squareHill.heightAtMax = val; _bridge.value?.changeSquareHillHeightMax(val); }
  function setSquareHillMode(sloped)    { squareHill.slopeMode = sloped; _bridge.value?.changeSquareHillMode(sloped); }
  function setSquareHillTerrainType(n)  { squareHill.terrainType = n;   _bridge.value?.changeSquareHillTerrainType(n); }
  function duplicateSquareHill()        { _bridge.value?.duplicateSelectedSquareHill(); }
  function deleteSquareHill()           { _bridge.value?.deleteSelectedSquareHill(); }
  function closeSquareHill()            { _bridge.value?.deselectSquareHill(); }

  // ── Terrain Shape actions ──
  function setTerrainShapeShape(val)      { terrainShape.shape = val;       _bridge.value?.changeTerrainShapeShape(val); }
  function setTerrainShapeWidth(val)      { terrainShape.width = val;       _bridge.value?.changeTerrainShapeWidth(val); }
  function setTerrainShapeDepth(val)      { terrainShape.depth = val;       _bridge.value?.changeTerrainShapeDepth(val); }
  function setTerrainShapeRotation(val)   { terrainShape.rotation = val;    _bridge.value?.changeTerrainShapeRotation(val); }
  function setTerrainShapeTerrainType(n)  { terrainShape.terrainType = n;   _bridge.value?.changeTerrainShapeTerrainType(n); }
  function duplicateTerrainShape()        { _bridge.value?.duplicateSelectedTerrainShape(); }
  function deleteTerrainShape()           { _bridge.value?.deleteSelectedTerrainShape(); }
  function closeTerrainShape()            { _bridge.value?.deselectTerrainShape(); }

  // ── Normal Map Decal actions ──
  function setNormalMapDecalWidth(val)     { normalMapDecal.width = val;     _bridge.value?.changeNormalMapDecalWidth(val); }
  function setNormalMapDecalDepth(val)     { normalMapDecal.depth = val;     _bridge.value?.changeNormalMapDecalDepth(val); }
  function setNormalMapDecalAngle(val)     { normalMapDecal.angle = val;     _bridge.value?.changeNormalMapDecalAngle(val); }
  function setNormalMapDecalNormalMap(val) { normalMapDecal.normalMap = val; _bridge.value?.changeNormalMapDecalNormalMap(val); }
  function setNormalMapDecalRepeatU(val)   { normalMapDecal.repeatU = val;   _bridge.value?.changeNormalMapDecalRepeatU(val); }
  function setNormalMapDecalRepeatV(val)   { normalMapDecal.repeatV = val;   _bridge.value?.changeNormalMapDecalRepeatV(val); }
  function setNormalMapDecalIntensity(val) { normalMapDecal.intensity = val; _bridge.value?.changeNormalMapDecalIntensity(val); }
  function duplicateNormalMapDecal()       { _bridge.value?.duplicateSelectedNormalMapDecal(); }
  function deleteNormalMapDecal()          { _bridge.value?.deleteSelectedNormalMapDecal(); }
  function closeNormalMapDecal()           { _bridge.value?.deselectNormalMapDecal(); }

  // ── Poly Wall actions ──
  function setPolyWallRadius(val)       { polyWall.radius = val;     _bridge.value?.changePolyWallRadius(val); }
  function setPolyWallHeight(val)          { polyWall.height = val;          _bridge.value?.changePolyWallHeight(val); }
  function setPolyWallCollisionHeight(val) { polyWall.collisionHeight = val; _bridge.value?.changePolyWallCollisionHeight(val); }
  function setPolyWallThickness(val)       { polyWall.thickness = val;       _bridge.value?.changePolyWallThickness(val); }
  function setPolyWallClosed(val)          { polyWall.closed = val;          _bridge.value?.changePolyWallClosed(val); }
  function setPolyWallStyle(val)           { polyWall.style = val;           _bridge.value?.changePolyWallStyle(val); }
  function insertPolyWallPoint()        { _bridge.value?.insertPolyWallPoint(); }
  function deletePolyWallPoint()        { _bridge.value?.deletePolyWallPoint(); }
  function deletePolyWall()             { _bridge.value?.deletePolyWall(); }
  function duplicatePolyWall()          { _bridge.value?.duplicatePolyWall(); }
  function closePolyWall()              { _bridge.value?.deselectPolyWall(); }

  // ── Poly Hill actions ──
  function setPolyHillRadius(val)       { polyHill.radius = val;  _bridge.value?.changePolyHillRadius(val); }
  function setPolyHillHeight(val)       { polyHill.height = val;  _bridge.value?.changePolyHillHeight(val); }
  function setPolyHillWidth(val)        { polyHill.width = val;   _bridge.value?.changePolyHillWidth(val); }
  function setPolyHillTerrainType(name) { polyHill.terrainType = name; _bridge.value?.changePolyHillTerrainType(name); }
  function setPolyHillClosed(val)       { polyHill.closed = val;  _bridge.value?.changePolyHillClosed(val); }
  function setPolyHillFilled(val)       { polyHill.filled = val;  _bridge.value?.changePolyHillFilled(val); }
  function insertPolyHillPoint()        { _bridge.value?.insertPolyHillPoint(); }
  function deletePolyHillPoint()        { _bridge.value?.deletePolyHillPoint(); }
  function deletePolyHill()             { _bridge.value?.deletePolyHill(); }
  function duplicatePolyHill()          { _bridge.value?.duplicatePolyHill(); }
  function closePolyHill()              { _bridge.value?.deselectPolyHill(); }

  // ── Bezier Wall actions ──
  function setBezierWallHeight(val)     { bezierWall.height = val;     _bridge.value?.changeBezierWallHeight(val); }
  function setBezierWallThickness(val)  { bezierWall.thickness = val;  _bridge.value?.changeBezierWallThickness(val); }
  function setBezierWallClosed(val)     { bezierWall.closed = val;     _bridge.value?.changeBezierWallClosed(val); }
  function insertBezierWallPoint()      { _bridge.value?.insertBezierWallPoint(); }
  function deleteBezierWallPoint()      { _bridge.value?.deleteBezierWallPoint(); }
  function deleteBezierWall()           { _bridge.value?.deleteBezierWall(); }
  function duplicateBezierWall()        { _bridge.value?.duplicateBezierWall(); }
  function closeBezierWall()            { _bridge.value?.deselectBezierWall(); }

  // ── Flag actions ──
  function setFlagColor(val)            { flag.color = val; _bridge.value?.changeFlagColor(val); }
  function deleteFlag()                 { _bridge.value?.deleteFlag(); }
  function duplicateFlag()              { _bridge.value?.duplicateFlag(); }

  function setDecorationType(val)        { decoration.type = val; _bridge.value?.changeDecorationType(val); }
  function setDecorationColor(val)       { decoration.color = val; _bridge.value?.changeFlagColor(val); }
  function setDecorationWidth(val)       { decoration.width = val; _bridge.value?.changeBannerStringWidth(val); }
  function setDecorationPoleHeight(val)  { decoration.poleHeight = val; _bridge.value?.changeBannerStringPoleHeight(val); }
  function setDecorationHeading(val)     { decoration.heading = val; _bridge.value?.changeBannerStringHeading(val); }
  function deleteDecoration()            { _bridge.value?.deleteSelectedDecoration(); }
  function duplicateDecoration()         { _bridge.value?.duplicateSelectedDecoration(); }
  function closeDecoration()             { _bridge.value?.deselectDecoration(); }
  function addDecoration()               { _bridge.value?.addDecorationEntity(); }

  // ── Track Sign actions ──
  function setTrackSignName(val)        { trackSign.name = val;     _bridge.value?.changeTrackSignName(val); }
  function setTrackSignRotation(val)    { trackSign.rotation = val; _bridge.value?.changeTrackSignRotation(val); }
  function setTrackSignContentType(val) { trackSign.contentType = val; _bridge.value?.changeTrackSignContentType(val); }
  function setTrackSignBrandImage(val)  { trackSign.brandImage = val; _bridge.value?.changeTrackSignBrandImage(val); }
  function setTrackSignBackground(val)  { trackSign.background = val; _bridge.value?.changeTrackSignBackground(val); }
  function setTrackSignScale(val)       { trackSign.scale = val; _bridge.value?.changeTrackSignScale(val); }
  function setTrackSignHeightOffset(val){ trackSign.heightOffset = val; _bridge.value?.changeTrackSignHeightOffset(val); }
  function setTrackSignWidth(val)       { trackSign.width = val; _bridge.value?.changeTrackSignWidth(val); }
  function deleteTrackSign()            { _bridge.value?.deleteTrackSign(); }
  function duplicateTrackSign()         { _bridge.value?.duplicateTrackSign(); }
  function closeTrackSign()             { _bridge.value?.deselectTrackSign(); }

  // ── Banner String actions ──
  function setBannerStringWidth(val)      { bannerString.width = val;      _bridge.value?.changeBannerStringWidth(val); }
  function setBannerStringPoleHeight(val) { bannerString.poleHeight = val; _bridge.value?.changeBannerStringPoleHeight(val); }
  function setBannerStringHeading(val)    { bannerString.heading = val;   _bridge.value?.changeBannerStringHeading(val); }
  function deleteBannerString()           { _bridge.value?.deleteBannerString(); }
  function duplicateBannerString()        { _bridge.value?.duplicateBannerString(); }
  function closeBannerString()            { _bridge.value?.deselectBannerString(); }

  // ── Action Zone actions ──
  function setActionZoneRadius(val)   { actionZone.radius   = val; _bridge.value?.changeActionZoneRadius(val); }
  function setActionZoneType(val)     { actionZone.zoneType = val; _bridge.value?.changeActionZoneType(val); }
  function setActionZoneShape(val)    { actionZone.shape    = val; _bridge.value?.changeActionZoneShape(val); }
  function insertActionZonePoint()    { _bridge.value?.insertActionZonePoint(); }
  function deleteActionZonePoint()    { _bridge.value?.deleteActionZonePoint(); }
  function deleteActionZone()         { _bridge.value?.deleteActionZone(); }
  function duplicateActionZone()      { _bridge.value?.duplicateActionZone(); }
  function closeActionZone()          { _bridge.value?.deselectActionZone(); }

  // ── Poly Curb actions ──
  function setPolyCurbRadius(val)  { polyCurb.radius = val;  _bridge.value?.changePolyCurbRadius(val); }
  function setPolyCurbHeight(val)  { polyCurb.height = val;  _bridge.value?.changePolyCurbHeight(val); }
  function setPolyCurbWidth(val)   { polyCurb.width  = val;  _bridge.value?.changePolyCurbWidth(val); }
  function setPolyCurbClosed(val)  { polyCurb.closed = val;  _bridge.value?.changePolyCurbClosed(val); }
  function setPolyCurbStyle(val)   { polyCurb.style = val;   _bridge.value?.changePolyCurbStyle(val); }
  function insertPolyCurbPoint()   { _bridge.value?.insertPolyCurbPoint(); }
  function deletePolyCurbPoint()   { _bridge.value?.deletePolyCurbPoint(); }
  function deletePolyCurb()        { _bridge.value?.deletePolyCurb(); }
  function duplicatePolyCurb()     { _bridge.value?.duplicatePolyCurb(); }
  function closePolyCurb()         { _bridge.value?.deselectPolyCurb(); }

  // ── Bridge actions ──
  function setBridgeWidth(val)     { bridge.width = val;     _bridge.value?.changeBridgeWidth(val); }
  function setBridgeDepth(val)     { bridge.depth = val;     _bridge.value?.changeBridgeDepth(val); }
  function setBridgeHeight(val)    { bridge.height = val;    _bridge.value?.changeBridgeHeight(val); }
  function setBridgeThickness(val) { bridge.thickness = val; _bridge.value?.changeBridgeThickness(val); }
  function setBridgeAngle(val)     { bridge.angle = val;     _bridge.value?.changeBridgeAngle(val); }
  function setBridgeMaterialType(val) { bridge.materialType = val; _bridge.value?.changeBridgeMaterialType(val); }
  function setBridgeTransitionEnabled(val) { bridge.transitionEnabled = val; _bridge.value?.changeBridgeTransitionEnabled(val); }
  function setBridgeTransitionDepth(val)   { bridge.transitionDepth = val;   _bridge.value?.changeBridgeTransitionDepth(val); }
  function setBridgeCollisionEndCaps(val)         { bridge.collisionEndCaps = val;         _bridge.value?.changeBridgeCollisionEndCaps(val); }
  function setBridgeCollisionEndCapsOnDepth(val)  { bridge.collisionEndCapsOnDepth = val;  _bridge.value?.changeBridgeCollisionEndCapsOnDepth(val); }
  function setBridgeCollisionEndCapsOnWidth(val)  { bridge.collisionEndCapsOnWidth = val;  _bridge.value?.changeBridgeCollisionEndCapsOnWidth(val); }
  function setBridgeCollisionEndCapThickness(val) { bridge.collisionEndCapThickness = val; _bridge.value?.changeBridgeCollisionEndCapThickness(val); }
  function setBridgeCollisionEndCapDrop(val)      { bridge.collisionEndCapDrop = val;      _bridge.value?.changeBridgeCollisionEndCapDrop(val); }
  function duplicateBridge()       { _bridge.value?.duplicateSelectedBridge(); }
  function deleteBridge()          { _bridge.value?.deleteBridge(); }
  function closeBridge()           { _bridge.value?.deselectBridge(); }

  // ── Mesh grid actions ──
  function setMeshGridSmoothing(v)   { meshGrid.smoothing = v;  _bridge.value?.changeMeshGridSmoothing(v); }
  function setMeshGridStepSize(v)    { meshGrid.stepSize = v;   _bridge.value?.changeMeshGridStepSize(v); }
  function setMeshGridPointHeight(v) { meshGrid.pointHeight = v; _bridge.value?.setMeshGridPointHeight(v); }
  function setMeshGridDensity(v)     { meshGrid.cols = v; meshGrid.rows = v; }
  function setMeshGridWidth(v)       { meshGrid.width = v; }
  function setMeshGridDepth(v)       { meshGrid.depth = v; }
  function meshGridAdjustUp()        { _bridge.value?.meshGridAdjustUp(); }
  function meshGridAdjustDown()      { _bridge.value?.meshGridAdjustDown(); }
  function applyMeshGridSettings()   { _bridge.value?.applyMeshGridChanges(meshGrid.cols, meshGrid.rows, meshGrid.width, meshGrid.depth); }
  function flattenMeshGrid()         { _bridge.value?.flattenMeshGrid(); }
  function deleteMeshGrid()          { _bridge.value?.deleteMeshGrid(); }
  function duplicateMeshGrid()       { _bridge.value?.duplicateMeshGrid(); }
  function closeMeshGrid()           { _bridge.value?.closeMeshGrid(); }

  function setTrackDefaultTerrain(name) { trackDefaultTerrain.value = name; _bridge.value?.changeTrackDefaultTerrain(name); }
  function setTrackBorderTerrain(name) { trackBorderTerrain.value = name; _bridge.value?.changeTrackBorderTerrain(name); }

  // ── Test mode ──
  function setActiveTool(val)           { activeTool.value = val; }

  // ── Add-entity menu ──
  function openAddMenu()       { addMenuOpen.value = true; }
  function closeAddMenu()      { addMenuOpen.value = false; }
  function toggleAddMenu()     { addMenuOpen.value = !addMenuOpen.value; }

  // ── Add entity actions ──
  function addCheckpoint()     { _bridge.value?.addCheckpoint(); }
  function addHill()           { _bridge.value?.addHillEntity(); }
  function addSquareHill()     { _bridge.value?.addSquareHillEntity(); }
  function addTerrain()        { _bridge.value?.addTerrainEntity(); }
  function addNormalMapDecal() { _bridge.value?.addNormalMapDecalEntity(); }
  function addObstacle()       { _bridge.value?.addObstacleEntity(); }
  function setObstacleType(val) {
    obstacle.type = val;
    obstacle.weight = getObstacleSpec(val).mass;
    _bridge.value?.changeObstacleType?.(val);
  }
  function setObstacleScale(val) { obstacle.scale = val; _bridge.value?.changeObstacleScale?.(val); }
  function setObstacleRotation(val) { obstacle.rotation = val; _bridge.value?.changeObstacleRotation?.(val); }
  function setObstacleWeight(val) { obstacle.weight = val; _bridge.value?.changeObstacleWeight?.(val); }
  function setObstacleColor(val) { obstacle.color = val; _bridge.value?.changeObstacleColor?.(val); }
  function resetObstacleDefaults() { _bridge.value?.resetObstacleDefaults?.(); }
  function deleteSelectedObstacle() { _bridge.value?.deleteSelectedObstacle?.(); }
  function setObstaclePlacementActive(val) {
    obstacle.placementActive = !!val;
    _bridge.value?.setObstaclePlacementActive?.(!!val);
  }
  function closeObstacle()     { _bridge.value?.closeObstacle?.(); }
  function addFlag()           { _bridge.value?.addFlagEntity(); }
  function addMeshGrid()       { _bridge.value?.addMeshGridEntity(); }
  function addPolyWall()       { _bridge.value?.addPolyWallEntity(); }
  function addPolyHill()       { _bridge.value?.addPolyHillEntity(); }
  function addBezierWall()     { _bridge.value?.addBezierWallEntity(); }
  function addTrackSign()      { _bridge.value?.addTrackSignEntity(); }
  function addBannerString()   { _bridge.value?.addBannerStringEntity(); }
  function addActionZone()     { _bridge.value?.addActionZoneEntity(); }
  function addPolyCurb()       { _bridge.value?.addPolyCurbEntity(); }
  function addBridge()         { _bridge.value?.addBridgeEntity(); }
  function addAiWaypoint()     { _bridge.value?.addAiWaypointEntity(); }
  function deleteAiWaypoint()  { _bridge.value?.deleteAiWaypoint(); }
  function clearAiPath()       { _bridge.value?.clearAiPath(); }

  // ── Surface decal stamp ──
  const surfaceDecal = reactive({ decalType: 'gouge', decalTypes: ['gouge', 'holes', 'rough'], imageName: '', angle: 0, randomRotation: true, width: 4, depth: 4, opacity: 0.8 });
  function openSurfaceDecalStamp()   { _bridge.value?.openSurfaceDecalStamp(); }
  function closeSurfaceDecalStamp()  { _bridge.value?.closeSurfaceDecalStamp(); }
  function setSurfaceDecalType(v)    { _bridge.value?.setSurfaceDecalType(v); }
  function setSurfaceDecalRandomRotation(v) { _bridge.value?.setSurfaceDecalRandomRotation(v); }
  function setSurfaceDecalAngle(v)   { _bridge.value?.setSurfaceDecalAngle(v); }
  function setSurfaceDecalOpacity(v) { _bridge.value?.setSurfaceDecalOpacity(v); }
  function setSurfaceDecalWidth(v)   { _bridge.value?.setSurfaceDecalWidth(v); }
  function setSurfaceDecalDepth(v)   { _bridge.value?.setSurfaceDecalDepth(v); }


  return {
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
    polyWall,
    polyHill,
    bezierWall,
    flag,
    testModeActive, testModeReturnKey,
    setBridge,
    setCheckpointWidth, setCheckpointHeading, shiftCheckpointOrder, duplicateCheckpoint, deleteCheckpoint, closeCheckpoint,
    setHillRadius, setHillRadiusX, setHillRadiusZ, setHillRotation,
    setHillHeight, setHillWaterLevelOffset, setHillTerrainType, duplicateHill, deleteHill, closeHill,
    setSquareHillWidth, setSquareHillDepth, setSquareHillTransition, setSquareHillAngle,
    setSquareHillHeight, setSquareHillWaterLevelOffset, setSquareHillHeightMin, setSquareHillHeightMax, setSquareHillMode,
    setSquareHillTerrainType, duplicateSquareHill, deleteSquareHill, closeSquareHill,
    setTerrainShapeShape, setTerrainShapeWidth, setTerrainShapeDepth, setTerrainShapeRotation,
    setTerrainShapeTerrainType, duplicateTerrainShape, deleteTerrainShape, closeTerrainShape,
    setNormalMapDecalWidth, setNormalMapDecalDepth, setNormalMapDecalAngle,
    setNormalMapDecalNormalMap, setNormalMapDecalRepeatU, setNormalMapDecalRepeatV,
    setNormalMapDecalIntensity, duplicateNormalMapDecal, deleteNormalMapDecal, closeNormalMapDecal,
    setPolyWallRadius, setPolyWallHeight, setPolyWallCollisionHeight, setPolyWallThickness, setPolyWallClosed, setPolyWallStyle,
    insertPolyWallPoint, deletePolyWallPoint, deletePolyWall, duplicatePolyWall, closePolyWall,
    setPolyHillRadius, setPolyHillHeight, setPolyHillWidth, setPolyHillTerrainType, setPolyHillClosed, setPolyHillFilled,
    insertPolyHillPoint, deletePolyHillPoint, deletePolyHill, duplicatePolyHill, closePolyHill,
    setBezierWallHeight, setBezierWallThickness, setBezierWallClosed,
    insertBezierWallPoint, deleteBezierWallPoint, deleteBezierWall, duplicateBezierWall, closeBezierWall,
    setFlagColor, deleteFlag, duplicateFlag,
    decoration,
    setDecorationType, setDecorationColor, setDecorationWidth,
    setDecorationPoleHeight, setDecorationHeading, deleteDecoration,
    duplicateDecoration, closeDecoration, addDecoration,
    trackSign,
    setTrackSignName, setTrackSignRotation,
    setTrackSignContentType, setTrackSignBrandImage, setTrackSignBackground,
    setTrackSignScale, setTrackSignHeightOffset, setTrackSignWidth,
    deleteTrackSign, duplicateTrackSign, closeTrackSign,
    bannerString,
    setBannerStringWidth, setBannerStringPoleHeight, setBannerStringHeading, deleteBannerString, duplicateBannerString, closeBannerString,
    actionZone,
    setActionZoneRadius, setActionZoneType, setActionZoneShape,
    insertActionZonePoint, deleteActionZonePoint,
    deleteActionZone, duplicateActionZone, closeActionZone,
    polyCurb,
    setPolyCurbRadius, setPolyCurbHeight, setPolyCurbWidth, setPolyCurbClosed, setPolyCurbStyle,
    insertPolyCurbPoint, deletePolyCurbPoint, deletePolyCurb, duplicatePolyCurb, closePolyCurb,
    bridge,
    setBridgeWidth, setBridgeDepth, setBridgeHeight, setBridgeThickness, setBridgeAngle,
    setBridgeMaterialType, setBridgeTransitionEnabled, setBridgeTransitionDepth,
    setBridgeCollisionEndCaps, setBridgeCollisionEndCapsOnDepth, setBridgeCollisionEndCapsOnWidth,
    setBridgeCollisionEndCapThickness, setBridgeCollisionEndCapDrop,
    duplicateBridge, deleteBridge, closeBridge,
    trackDefaultTerrain, setTrackDefaultTerrain,
    trackBorderTerrain, setTrackBorderTerrain,
    setActiveTool,
    gizmosVisible, toggleGizmosVisible,
    toggleSnap, cycleSnapSize, quickTestTrack,
    openAddMenu, closeAddMenu, toggleAddMenu,
    addCheckpoint, addHill, addSquareHill, addTerrain,
    addNormalMapDecal, addObstacle,
    setObstacleType, setObstacleScale, setObstacleRotation, setObstacleWeight, setObstacleColor,
    setObstaclePlacementActive, resetObstacleDefaults, deleteSelectedObstacle, closeObstacle,
    addFlag,
    addMeshGrid, addPolyWall, addPolyHill, addBezierWall, addTrackSign, addBannerString,
    addActionZone, addPolyCurb, addBridge, addAiWaypoint, deleteAiWaypoint, clearAiPath,
    openAiPath, closeAiPath,
    aiPathWear,
    setAiPathWearEnabled, setAiPathWearWidth, setAiPathWearIntensity,
    setAiPathWearLaneSpacing, setAiPathWearAlphaBreakup, setAiPathWearPathWander, setAiPathWearEdgeSoftness,
    setAiPathWearSecondaryPathCount, setAiPathWearSecondaryPathStrength, setAiPathWearSecondaryPathSpacing,
    terrainPath,
    openTerrainPath, closeTerrainPath,
    setTerrainPathWidth, setTerrainPathCornerRadius, setTerrainPathTerrainType,
    deleteTerrainPathWaypoint, clearTerrainPath, addTerrainPath,
    surfaceDecal,
    openSurfaceDecalStamp, closeSurfaceDecalStamp,
    setSurfaceDecalType, setSurfaceDecalRandomRotation, setSurfaceDecalAngle,
    setSurfaceDecalOpacity, setSurfaceDecalWidth, setSurfaceDecalDepth,
    setMeshGridSmoothing, setMeshGridStepSize, setMeshGridPointHeight,
    setMeshGridDensity, setMeshGridWidth, setMeshGridDepth,
    meshGridAdjustUp, meshGridAdjustDown,
    applyMeshGridSettings, flattenMeshGrid, deleteMeshGrid, duplicateMeshGrid, closeMeshGrid,
  };
});
