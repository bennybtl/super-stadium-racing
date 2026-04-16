import { defineStore } from 'pinia';
import { ref, reactive, computed, shallowRef } from 'vue';

// ─── Menu store ───────────────────────────────────────────────────────────────
export const useMenuStore = defineStore('menu', () => {
  // UI state — drives MenuOverlay.vue rendering. null = hidden.
  const screen = ref('start');
  const isPaused = ref(false);
  const trackList = ref([]); // [{ key, name }]
  const vehicleList = ref([]); // [{ key, name }]

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
    _bridge.value.showVehicleSelectMenu('race');
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
    _bridge.value.showVehicleSelectMenu('practice');
  }

  function selectVehicle(key) { _bridge.value?.selectVehicle(key); }
  function vehicleSelectBack() { _bridge.value?.onVehicleSelectBack(); }

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
  function startSeason(laps) {
    if (!_bridge.value) return;
    _bridge.value.selectedLaps = laps;
    _bridge.value.showVehicleSelectMenu('season');
  }
  function continueSeason()        { _bridge.value?.onContinueSeason(); }
  function retireFromSeason()      { _bridge.value?.onRetireFromSeason(); }
  function goToPit()               { _bridge.value?.onGoToPit(); }
  function purchaseUpgrade(id)     { _bridge.value?.onPurchaseUpgrade(id); }
  function exitSeason()            { postRaceData.value = null; pitData.value = null; seasonFinalData.value = null; _bridge.value?.onRetireFromSeason(); }
  function singleRaceExit()        { singleRaceData.value = null; _bridge.value?.onExit(); }

  return {
    screen, isPaused, trackList, vehicleList,
    postRaceData, pitData, seasonFinalData, singleRaceData,
    setBridge,
    showTrackSelect, showPracticeTrackSelect, showEditorTrackSelect, selectTrack,
    startGame, startPractice, startEditor,
    selectVehicle, vehicleSelectBack,
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
    normalMap: '6481-normal.jpg',
    repeatU: 1,
    repeatV: 1,
    intensity: 0.5,
  });

  // ── Mesh grid panel ──
  const meshGrid = reactive({
    cols: 9,
    rows: 9,
    width: 160,
    depth: 160,
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

  // ── Action Zone panel ──
  const actionZone = reactive({
    zoneType: 'pickupSpawn',
    radius: 15,
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
  });

  // ── Bridge panel ──
  const bridge = reactive({
    width:     20,
    depth:     8,
    height:    5,
    thickness: 0.4,
    angle:     0,
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
  function duplicatePolyWall()          { _bridge.value?.duplicatePolyWall(); }
  function closePolyWall()              { _bridge.value?.deselectPolyWall(); }

  // ── Poly Hill actions ──
  function setPolyHillRadius(val)       { polyHill.radius = val;  _bridge.value?.changePolyHillRadius(val); }
  function setPolyHillHeight(val)       { polyHill.height = val;  _bridge.value?.changePolyHillHeight(val); }
  function setPolyHillWidth(val)        { polyHill.width = val;   _bridge.value?.changePolyHillWidth(val); }
  function setPolyHillClosed(val)       { polyHill.closed = val;  _bridge.value?.changePolyHillClosed(val); }
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

  // ── Track Sign actions ──
  function setTrackSignName(val)        { trackSign.name = val;     _bridge.value?.changeTrackSignName(val); }
  function setTrackSignRotation(val)    { trackSign.rotation = val; _bridge.value?.changeTrackSignRotation(val); }
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
  function deleteActionZone()         { _bridge.value?.deleteActionZone(); }
  function duplicateActionZone()      { _bridge.value?.duplicateActionZone(); }
  function closeActionZone()          { _bridge.value?.deselectActionZone(); }

  // ── Poly Curb actions ──
  function setPolyCurbRadius(val)  { polyCurb.radius = val;  _bridge.value?.changePolyCurbRadius(val); }
  function setPolyCurbHeight(val)  { polyCurb.height = val;  _bridge.value?.changePolyCurbHeight(val); }
  function setPolyCurbWidth(val)   { polyCurb.width  = val;  _bridge.value?.changePolyCurbWidth(val); }
  function setPolyCurbClosed(val)  { polyCurb.closed = val;  _bridge.value?.changePolyCurbClosed(val); }
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
  function addActionZone()     { _bridge.value?.addActionZoneEntity(); }
  function addPolyCurb()       { _bridge.value?.addPolyCurbEntity(); }
  function addBridge()         { _bridge.value?.addBridgeEntity(); }

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
    setTerrainShapeShape, setTerrainShapeWidth, setTerrainShapeDepth, setTerrainShapeRotation,
    setTerrainShapeTerrainType, duplicateTerrainShape, deleteTerrainShape, closeTerrainShape,
    setNormalMapDecalWidth, setNormalMapDecalDepth, setNormalMapDecalAngle,
    setNormalMapDecalNormalMap, setNormalMapDecalRepeatU, setNormalMapDecalRepeatV,
    setNormalMapDecalIntensity, duplicateNormalMapDecal, deleteNormalMapDecal, closeNormalMapDecal,
    setPolyWallRadius, setPolyWallHeight, setPolyWallThickness, setPolyWallClosed,
    insertPolyWallPoint, deletePolyWallPoint, deletePolyWall, duplicatePolyWall, closePolyWall,
    setPolyHillRadius, setPolyHillHeight, setPolyHillWidth, setPolyHillClosed,
    insertPolyHillPoint, deletePolyHillPoint, deletePolyHill, duplicatePolyHill, closePolyHill,
    setBezierWallHeight, setBezierWallThickness, setBezierWallClosed,
    insertBezierWallPoint, deleteBezierWallPoint, deleteBezierWall, duplicateBezierWall, closeBezierWall,
    setFlagColor, deleteFlag, duplicateFlag,
    trackSign,
    setTrackSignName, setTrackSignRotation, deleteTrackSign, duplicateTrackSign, closeTrackSign,
    bannerString,
    setBannerStringWidth, setBannerStringPoleHeight, setBannerStringHeading, deleteBannerString, duplicateBannerString, closeBannerString,
    actionZone,
    setActionZoneRadius, setActionZoneType, deleteActionZone, duplicateActionZone, closeActionZone,
    polyCurb,
    setPolyCurbRadius, setPolyCurbHeight, setPolyCurbWidth, setPolyCurbClosed,
    insertPolyCurbPoint, deletePolyCurbPoint, deletePolyCurb, duplicatePolyCurb, closePolyCurb,
    bridge,
    setBridgeWidth, setBridgeDepth, setBridgeHeight, setBridgeThickness, setBridgeAngle,
    duplicateBridge, deleteBridge, closeBridge,
    trackDefaultTerrain, setTrackDefaultTerrain,
    setActiveTool,
    toggleSnap, cycleSnapSize, quickTestTrack,
    openAddMenu, closeAddMenu, toggleAddMenu,
    addCheckpoint, addHill, addSquareHill, addTerrain,
    addNormalMapDecal, addTireStack, addFlag,
    addMeshGrid, addPolyWall, addPolyHill, addBezierWall, addTrackSign, addBannerString,
    addActionZone, addPolyCurb, addBridge,
    setMeshGridSmoothing, setMeshGridStepSize, setMeshGridPointHeight,
    setMeshGridDensity, setMeshGridWidth, setMeshGridDepth,
    meshGridAdjustUp, meshGridAdjustDown,
    applyMeshGridSettings, flattenMeshGrid, deleteMeshGrid, duplicateMeshGrid, closeMeshGrid,
  };
});
