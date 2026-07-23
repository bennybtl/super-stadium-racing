import { defineStore } from 'pinia';
import { ref, reactive, computed, shallowRef } from 'vue';
import { DEFAULT_STRIPE_COLORS } from '../../objects/stripeColors.js';
import { getObstacleSpec } from '../../objects/Obstacle.js';

// ─── Editor store ─────────────────────────────────────────────────────────────
export const useEditorStore = defineStore('editor', () => {
  // Which entity type is currently selected (null | 'checkpoint' | 'hill' | 'squareHill' | 'terrainShape' | 'meshGrid' | 'polyWall' | 'flag' | 'obstacle')
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
    alternative: false,     // shares a step with the previous checkpoint
    canBeAlternative: false, // false for the first checkpoint (nothing before it)
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
    colors: [...DEFAULT_STRIPE_COLORS],
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
    type: 'flag',      // 'flag' | 'bannerString' | 'model'
    model: null,       // decoration id when type === 'model' (e.g. 'tent', 'tree')
    color: 'red',
    width: 8,
    poleHeight: 4.2,
    heading: 0,
    scale: 1,
    mirrorX: false,    // model decorations: mirror across the X axis
    mirrorZ: false,    // model decorations: mirror across the Z axis
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
    slowStrength: 3,
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
    colors: [...DEFAULT_STRIPE_COLORS],
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
  function selectAiPathBranch(id) {
    // "Main Path" (null) rebuilds the main handles via editMainAiPath — the
    // branch selector can't match a null id, so it would no-op and leave the
    // previous branch's gizmos showing.
    if (!id) { editMainAiPath(); return; }
    aiPathBranch.editingMainPath = false;
    aiPathBranch.activeBranchId = id;
    _bridge.value?.selectAiPathBranch?.(id);
  }
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
  function captureScreenshot() { _bridge.value?.captureTrackScreenshot?.(); }
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

  // Type dropdown value is 'flag', 'bannerString', or 'model:<id>'. Mirror the
  // chosen kind into panel state, then let the bridge rebuild the decoration
  // (which re-selects and repopulates the rest of the panel fields).
  function setDecorationType(raw) {
    if (typeof raw === 'string' && raw.startsWith('model:')) {
      decoration.type = 'model';
      decoration.model = raw.slice('model:'.length);
    } else {
      decoration.type = raw;
      decoration.model = null;
    }
    _bridge.value?.changeDecorationType(raw);
  }
  function setDecorationColor(val)       { decoration.color = val; _bridge.value?.changeFlagColor(val); }
  function setDecorationWidth(val)       { decoration.width = val; _bridge.value?.changeBannerStringWidth(val); }
  function setDecorationPoleHeight(val)  { decoration.poleHeight = val; _bridge.value?.changeBannerStringPoleHeight(val); }
  function setDecorationHeading(val)     { decoration.heading = val; _bridge.value?.changeBannerStringHeading(val); }
  function setDecorationScale(val)        { decoration.scale = val; _bridge.value?.changeDecorationScale(val); }
  function setDecorationMirrorX(val)      { decoration.mirrorX = val; _bridge.value?.changeDecorationMirrorX(val); }
  function setDecorationMirrorZ(val)      { decoration.mirrorZ = val; _bridge.value?.changeDecorationMirrorZ(val); }

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
  const surfaceDecal = reactive({ shape: 'arrow', shapes: ['arrow'], count: 3, hasCount: false, outline: false, hasOutline: false, color: 'white', colors: ['white'], angle: 0, width: 4, depth: 4, opacity: 1 });


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
    checkpoint, hill, squareHill, terrainShape, obstacle,
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
    setDecorationType, setDecorationColor, setDecorationWidth,
    setDecorationPoleHeight, setDecorationHeading, setDecorationScale,
    setDecorationMirrorX, setDecorationMirrorZ, trackSign,
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
    rebuildScene, captureScreenshot,
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
