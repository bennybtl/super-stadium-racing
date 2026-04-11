import { defineStore } from 'pinia';
import { ref, reactive, computed, shallowRef } from 'vue';

// ─── Menu store ───────────────────────────────────────────────────────────────
export const useMenuStore = defineStore('menu', () => {
  // UI state — drives MenuOverlay.vue rendering. null = hidden.
  const screen = ref('start');
  const isPaused = ref(false);
  const trackList = ref([]); // [{ key, name }]

  // Season overlay data (null when not showing)
  const postRaceData    = ref(null);
  const pitData         = ref(null);
  const seasonFinalData = ref(null);
  const singleRaceData  = ref(null);
  
  // Settings state
  const truckMode = ref(localStorage.getItem('truckMode') || 'arcade');

  // Opaque reference to MenuManager; not observed deeply.
  const _bridge = shallowRef(null);
  function setBridge(manager) { _bridge.value = manager; }

  // ── Actions called by Vue components ──
  function showTrackSelect()       { _bridge.value?.showTrackSelectMenu(); }
  function showPracticeTrackSelect() { _bridge.value?.showPracticeTrackSelect(); }
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

  function startPractice(key) {
    if (!_bridge.value) return;
    _bridge.value.selectedTrack = key;
    _bridge.value.onStartPractice();
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

  // ── Season actions (called by Vue overlays) ──────────────────────────────
  function showSeasonSetup()       { _bridge.value?.showSeasonSetup(); }
  function startSeason(laps)       { _bridge.value?.onSeasonStart(laps); }
  function continueSeason()        { _bridge.value?.onContinueSeason(); }
  function retireFromSeason()      { _bridge.value?.onRetireFromSeason(); }
  function goToPit()               { _bridge.value?.onGoToPit(); }
  function purchaseUpgrade(id)     { _bridge.value?.onPurchaseUpgrade(id); }
  function exitSeason()            { postRaceData.value = null; pitData.value = null; seasonFinalData.value = null; _bridge.value?.onRetireFromSeason(); }
  function singleRaceExit()        { singleRaceData.value = null; _bridge.value?.onExit(); }

  return {
    screen, isPaused, trackList,
    postRaceData, pitData, seasonFinalData, singleRaceData,
    setBridge,
    showTrackSelect, showPracticeTrackSelect, showEditorTrackSelect, selectTrack,
    startGame, startPractice, startEditor,
    resume, reset, exit,
    editorResume, editorSave, editorLoad, editorExit,
    settings, back,
    showSeasonSetup, startSeason, continueSeason, retireFromSeason, goToPit, purchaseUpgrade, exitSeason, singleRaceExit,
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
  // Which entity type is currently selected (null | 'checkpoint' | 'hill' | 'squareHill' | 'terrainShape' | 'normalMapDecal' | 'meshGrid' | 'polyWall' | 'flag')
  const selectedType = ref(null);
  const activeTool = ref(null);

  // Add-entity menu
  const addMenuOpen = ref(false);

  // Snap
  const snapEnabled = ref(false);
  const snapSize = ref(1);

  // ── Checkpoint panel ──
  const checkpoint = reactive({
    width: 10,
    orderNum: 1,
    heading: 0,
  });

  // ── Hill panel ──
  const hill = reactive({
    radius: 10,
    height: 5,
    terrainType: 'none',
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
    terrainType: 'none',
  });

  // ── Terrain shape panel (rect + circle) ──
  const terrainShape = reactive({
    shape: 'rect',
    width: 10,
    depth: 10,
    rotation: 0,
    radius: 8,
    terrainType: 'mud',
  });

  // ── Normal Map Decal panel ──
  const normalMapDecal = reactive({
    width: 10,
    depth: 10,
    angle: 0,
    normalMap: '6481-normal.jpg',
    repeatU: 1,
    repeatV: 1,
    intensity: 0.5,
  });

  // ── Mesh grid panel ──
  const meshGrid = reactive({
    rows: 3,
    cols: 3,
    visible: false,
  });

  // ── Poly wall panel ──
  const polyWall = reactive({
    hasSelection: false,
    canHaveRadius: false,
    radius: 0,
    height: 2,
    thickness: 0.5,
    closed: false,
  });

  // ── Poly hill panel ──
  const polyHill = reactive({
    hasSelection: false,
    canHaveRadius: false,
    radius: 0,
    height: 3,
    width: 5,
    closed: false,
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

  // ── Track Sign panel ──
  const trackSign = reactive({
    name: 'Track Name',
    rotation: 0,   // degrees
  });

  // ── Banner String panel ──
  const bannerString = reactive({
    width: 8,
    poleHeight: 4.2,
    heading: 0,   // degrees, display only
  });

  // ── Track defaults ──
  const trackDefaultTerrain = ref('packed_dirt');

  // ── Test mode (back button) ──
  const testModeActive = ref(false);
  const testModeReturnKey = ref(null);

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
  function quickTestTrack() { _bridge.value?.quickTestTrack(); }

  // ── Checkpoint actions ──
  function setCheckpointWidth(val)      { checkpoint.width = val;      _bridge.value?.changeCheckpointWidth(val); }
  function setCheckpointHeading(val)    { checkpoint.heading = val;    _bridge.value?.changeCheckpointHeading(val); }
  function shiftCheckpointOrder(dir)    { _bridge.value?.shiftCheckpointOrder(dir); }
  function duplicateCheckpoint()        { _bridge.value?.duplicateSelectedCheckpoint(); }
  function deleteCheckpoint()           { _bridge.value?.deleteSelectedCheckpoint(); }
  function closeCheckpoint()            { _bridge.value?.deselectCheckpoint(); }

  // ── Hill actions ──
  function setHillRadius(val)           { hill.radius = val;       _bridge.value?.changeHillRadius(val); }
  function setHillHeight(val)           { hill.height = val;       _bridge.value?.changeHillHeight(val); }
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
  function setTerrainShapeRadius(val)     { terrainShape.radius = val;      _bridge.value?.changeTerrainShapeRadius(val); }
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
  function setPolyWallHeight(val)       { polyWall.height = val;     _bridge.value?.changePolyWallHeight(val); }
  function setPolyWallThickness(val)    { polyWall.thickness = val;  _bridge.value?.changePolyWallThickness(val); }
  function setPolyWallClosed(val)       { polyWall.closed = val;     _bridge.value?.changePolyWallClosed(val); }
  function insertPolyWallPoint()        { _bridge.value?.insertPolyWallPoint(); }
  function deletePolyWallPoint()        { _bridge.value?.deletePolyWallPoint(); }
  function deletePolyWall()             { _bridge.value?.deletePolyWall(); }
  function closePolyWall()              { _bridge.value?.deselectPolyWall(); }

  // ── Poly Hill actions ──
  function setPolyHillRadius(val)       { polyHill.radius = val;  _bridge.value?.changePolyHillRadius(val); }
  function setPolyHillHeight(val)       { polyHill.height = val;  _bridge.value?.changePolyHillHeight(val); }
  function setPolyHillWidth(val)        { polyHill.width = val;   _bridge.value?.changePolyHillWidth(val); }
  function setPolyHillClosed(val)       { polyHill.closed = val;  _bridge.value?.changePolyHillClosed(val); }
  function insertPolyHillPoint()        { _bridge.value?.insertPolyHillPoint(); }
  function deletePolyHillPoint()        { _bridge.value?.deletePolyHillPoint(); }
  function deletePolyHill()             { _bridge.value?.deletePolyHill(); }
  function closePolyHill()              { _bridge.value?.deselectPolyHill(); }

  // ── Bezier Wall actions ──
  function setBezierWallHeight(val)     { bezierWall.height = val;     _bridge.value?.changeBezierWallHeight(val); }
  function setBezierWallThickness(val)  { bezierWall.thickness = val;  _bridge.value?.changeBezierWallThickness(val); }
  function setBezierWallClosed(val)     { bezierWall.closed = val;     _bridge.value?.changeBezierWallClosed(val); }
  function insertBezierWallPoint()      { _bridge.value?.insertBezierWallPoint(); }
  function deleteBezierWallPoint()      { _bridge.value?.deleteBezierWallPoint(); }
  function deleteBezierWall()           { _bridge.value?.deleteBezierWall(); }
  function closeBezierWall()            { _bridge.value?.deselectBezierWall(); }

  // ── Flag actions ──
  function setFlagColor(val)            { flag.color = val; _bridge.value?.changeFlagColor(val); }
  function deleteFlag()                 { _bridge.value?.deleteFlag(); }

  // ── Track Sign actions ──
  function setTrackSignName(val)        { trackSign.name = val;     _bridge.value?.changeTrackSignName(val); }
  function setTrackSignRotation(val)    { trackSign.rotation = val; _bridge.value?.changeTrackSignRotation(val); }
  function deleteTrackSign()            { _bridge.value?.deleteTrackSign(); }
  function closeTrackSign()             { _bridge.value?.deselectTrackSign(); }

  // ── Banner String actions ──
  function setBannerStringWidth(val)      { bannerString.width = val;      _bridge.value?.changeBannerStringWidth(val); }
  function setBannerStringPoleHeight(val) { bannerString.poleHeight = val; _bridge.value?.changeBannerStringPoleHeight(val); }
  function deleteBannerString()           { _bridge.value?.deleteBannerString(); }
  function closeBannerString()            { _bridge.value?.deselectBannerString(); }

  function setTrackDefaultTerrain(name) { trackDefaultTerrain.value = name; _bridge.value?.changeTrackDefaultTerrain(name); }

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
  function addTireStack()      { _bridge.value?.addTireStackEntity(); }
  function addFlag()           { _bridge.value?.addFlagEntity(); }
  function addMeshGrid()       { _bridge.value?.addMeshGridEntity(); }
  function addPolyWall()       { _bridge.value?.addPolyWallEntity(); }
  function addPolyHill()       { _bridge.value?.addPolyHillEntity(); }
  function addBezierWall()     { _bridge.value?.addBezierWallEntity(); }
  function addTrackSign()      { _bridge.value?.addTrackSignEntity(); }
  function addBannerString()   { _bridge.value?.addBannerStringEntity(); }

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
    meshGrid,
    polyWall,
    polyHill,
    bezierWall,
    flag,
    testModeActive, testModeReturnKey,
    setBridge,
    setCheckpointWidth, setCheckpointHeading, shiftCheckpointOrder, duplicateCheckpoint, deleteCheckpoint, closeCheckpoint,
    setHillRadius, setHillHeight, setHillTerrainType, duplicateHill, deleteHill, closeHill,
    setSquareHillWidth, setSquareHillDepth, setSquareHillTransition, setSquareHillAngle,
    setSquareHillHeight, setSquareHillHeightMin, setSquareHillHeightMax, setSquareHillMode,
    setSquareHillTerrainType, duplicateSquareHill, deleteSquareHill, closeSquareHill,
    setTerrainShapeShape, setTerrainShapeWidth, setTerrainShapeDepth, setTerrainShapeRotation, setTerrainShapeRadius,
    setTerrainShapeTerrainType, duplicateTerrainShape, deleteTerrainShape, closeTerrainShape,
    setNormalMapDecalWidth, setNormalMapDecalDepth, setNormalMapDecalAngle,
    setNormalMapDecalNormalMap, setNormalMapDecalRepeatU, setNormalMapDecalRepeatV,
    setNormalMapDecalIntensity, duplicateNormalMapDecal, deleteNormalMapDecal, closeNormalMapDecal,
    setPolyWallRadius, setPolyWallHeight, setPolyWallThickness, setPolyWallClosed,
    insertPolyWallPoint, deletePolyWallPoint, deletePolyWall, closePolyWall,
    setPolyHillRadius, setPolyHillHeight, setPolyHillWidth, setPolyHillClosed,
    insertPolyHillPoint, deletePolyHillPoint, deletePolyHill, closePolyHill,
    setBezierWallHeight, setBezierWallThickness, setBezierWallClosed,
    insertBezierWallPoint, deleteBezierWallPoint, deleteBezierWall, closeBezierWall,
    setFlagColor, deleteFlag,
    trackSign,
    setTrackSignName, setTrackSignRotation, deleteTrackSign, closeTrackSign,
    bannerString,
    setBannerStringWidth, setBannerStringPoleHeight, deleteBannerString, closeBannerString,
    trackDefaultTerrain, setTrackDefaultTerrain,
    setActiveTool,
    toggleSnap, cycleSnapSize, quickTestTrack,
    openAddMenu, closeAddMenu, toggleAddMenu,
    addCheckpoint, addHill, addSquareHill, addTerrain,
    addNormalMapDecal, addTireStack, addFlag,
    addMeshGrid, addPolyWall, addPolyHill, addBezierWall, addTrackSign, addBannerString,
  };
});
