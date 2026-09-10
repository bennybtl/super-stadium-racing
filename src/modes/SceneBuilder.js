import {
  Scene,
  HavokPlugin,
  Vector3,
  HemisphericLight,
  PointLight,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  PhysicsAggregate,
  PhysicsShapeType,
  FreeCamera,
  Texture,
  VertexBuffer,
  RawTexture,
} from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import { TerrainManager, TERRAIN_TYPES } from "../world/terrain.js";
import { Track } from "../world/track.js";
import { CameraController } from "../managers/CameraController.js";
import { CheckpointManager } from "../managers/CheckpointManager.js";
import { WallManager } from "../managers/WallManager.js";
import { ObstacleManager } from "../managers/ObstacleManager.js";
import { TrackSignManager } from "../managers/TrackSignManager.js";
import { DecorationManager } from "../managers/DecorationManager.js";
import { isModelFeature } from "../decorations/decorations-registry.js";
import { PickupManager } from "../managers/PickupManager.js";
import { BridgeMeshManager } from "../managers/BridgeMeshManager.js";
import { DriveSurfaceManager } from "../managers/DriveSurfaceManager.js";
import { SurfaceTopologyGraph } from "../managers/SurfaceTopologyGraph.js";
import { SteepSlopeColliderManager } from "../managers/SteepSlopeColliderManager.js";
import { DecalManager } from "../managers/DecalManager.js";
import { buildWaterBodies } from "../objects/Water.js";
import { createWakeField } from "../managers/WakeFieldManager.js";
import { createWaterDepthSampler } from "../objects/water-field.js";
import { scatterDirtChunks } from "../objects/DirtChunks.js";
import { scatterGrassBlades } from "../objects/GrassBlades.js";
import { buildBorderWalls } from "../objects/BorderWall.js";
import { buildOutskirts, OUTSKIRTS_MATERIAL_NAME } from "../objects/Outskirts.js";
import {
  buildTerrainIdTexturePixelData,
  buildTerrainWearOverlayPixelData,
  buildBridgeDeckWearOverlayPixelData,
  buildTerrainTypePropertyTexturePixelData,
  applySteepGrassTerrainRemap,
  applySteepWaterTerrainRemap,
} from "../world/terrain-utils.js";
import { loadDisplaySettings } from "../settingsStorage.js";
import { ShadowCasterGroup } from "./ShadowCasterGroup.js";

/**
 * Builds the shared Babylon scene used by both RaceMode and EditorMode:
 * physics, lighting, shadows, ground mesh, terrain texture, and all
 * feature managers (checkpoints, walls, tires).
 *
 * Returns an object with every constructed resource so the calling mode
 * can hold references for updates / disposal.
 */
export async function buildScene(engine, trackLoader, trackKey) {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.15, 0.12, 0.1, 1);

  // Truck spray particles (splash/mud/deep/rooster) live in rendering group 1 so
  // they draw after the translucent water surface in group 0. By default Babylon
  // clears the depth buffer before each rendering group, which would let those
  // particles paint straight over the truck, walls and bridges (all group 0).
  // Keeping group 1's depth means the particles still test against that solid
  // geometry and get occluded by it, while remaining on top of the water (which
  // is alpha-blended and never wrote depth anyway). The checkpoint arrow keeps
  // its own group 2 with the default depth-clear, so it stays a HUD-style cue.
  scene.setRenderingAutoClearDepthStencil(1, false);

  // Shared registry for all drivable surfaces (ground, bridges, ramps, etc.).
  const driveSurfaceManager = new DriveSurfaceManager(scene);
  const surfaceTopologyGraph = new SurfaceTopologyGraph(scene);
  scene.metadata = {
    ...(scene.metadata ?? {}),
    driveSurfaceManager,
    surfaceTopologyGraph,
  };

  // -- Physics --
  const havok = await HavokPhysics();
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));

  // -- Camera --
  const camera = new FreeCamera("cam", new Vector3(0, 28, -20), scene);
  camera.setTarget(Vector3.Zero());
  const cameraController = new CameraController(camera, new Vector3(0, 28, -20));

  // --- Ambient ---
  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  // Lower ambient fill deepens shadows: the hemispheric light is never occluded,
  // so it sets the brightness floor inside every shadowed area.
  ambient.intensity = 0.35;
  ambient.groundColor = new Color3(0.1, 0.1, 0.1);

  // -- Track --
  let currentTrack;
  if (trackKey === "new") {
    const suffix = Date.now().toString(36);
    currentTrack = new Track(`New Track ${suffix}`);
  } else {
    currentTrack = trackLoader.getTrack(trackKey);
    if (!currentTrack) {
      console.warn(`Track ${trackKey} not found, creating empty track`);
      currentTrack = new Track(trackKey);
    }
  }

  const trackWidth = currentTrack.width ?? 160;
  const trackDepth = currentTrack.depth ?? 160;
  const maxTrackDim = Math.max(trackWidth, trackDepth);
  const terrainSize = maxTrackDim + 20;
  const {
    width: groundWidth,
    depth: groundDepth,
    subdivisions: groundSubdivisions,
  } = currentTrack.getGroundLattice();
  const terrainResolutionTarget = 192;
  const terrainCellSize = terrainSize <= terrainResolutionTarget
    ? 1
    : Math.max(2, Math.ceil(terrainSize / terrainResolutionTarget));

  // -- Stadium lights --
  // 4 point lights arranged in a square, elevated like stadium floodlights.
  // Inset from the track edge (not at the far corners) so the key light strikes
  // the play area at a steeper angle and fill is more even across it.
  const _lightHeight = 60;
  const _lightSpread = maxTrackDim * 0.30;
  const _stadiumPositions = [
    new Vector3(-_lightSpread, _lightHeight, -_lightSpread),
    new Vector3( _lightSpread, _lightHeight, -_lightSpread),
    new Vector3( _lightSpread, _lightHeight,  _lightSpread),
    new Vector3(-_lightSpread, _lightHeight,  _lightSpread),
  ];
  const _stadiumLights = _stadiumPositions.map((pos, i) => {
    const light = new PointLight(`stadiumLight${i}`, pos, scene);
    light.range = terrainSize * 2.2;
    light.diffuse  = new Color3(1.0, 0.97, 1.00);
    light.specular = new Color3(1.0, 0.97, 1.00);
    return light;
  });

  const _centerFloodLight = new PointLight(
    "stadiumLightCenter",
    new Vector3(0, _lightHeight, 0),
    scene
  );
  _centerFloodLight.intensity = 1.8;
  _centerFloodLight.range = terrainSize * 2.4;
  _centerFloodLight.diffuse = new Color3(1.0, 0.98, 1.0);
  _centerFloodLight.specular = new Color3(1.0, 0.98, 1.0);
  _centerFloodLight.setEnabled(false);

  // Shadow-casting lights: the primary key (corner 0) always, plus the opposite
  // corner (light 2) on the "high" tier for a two-key stadium look. Both cube
  // maps are built now; the secondary sits parked (its light's shadowEnabled
  // off) until applyDisplaySettings calls setActiveCount(2), so it's ~free on
  // the lower tiers. Every caster is registered with both via the group.
  const shadows = ShadowCasterGroup.create([_stadiumLights[0], _stadiumLights[2]], { mapSize: 1024 });
  shadows.configure({ bias: 0.005, normalBias: 0.02 });
  // NOTE: forceBackFacesOnly is deliberately OFF. It was tried to kill the
  // "double shadow" from double-sided caster materials, but under this single
  // *point* light it renders each solid's FAR side into the cube depth map, and
  // the heavy ESM blur then smears that far-face depth back under the caster —
  // reading as a second shadow lobe pointing the "wrong" way. The real fix is to
  // make every caster a single-sided, outward-wound closed solid (poly-ribbon
  // walls/curbs and the bridge/driveBox slab all are now), so a plain front-face
  // shadow pass yields one clean silhouette.

  const applyDisplaySettings = (settings) => {
    const shadowDetail = settings?.shadow ?? 'medium';
    const lightCount = settings?.lights ?? 4;

    // Keep enabled corner lights spatially balanced at lower counts.
    const enabledLightIndices =
      lightCount === 2 ? [0, 2] :
      [0, 1, 2, 3];

    // Two shadow-casting keys (opposite corners 0 and 2) only on 'high', and
    // only when both of those corners are actually lit.
    const twoKeys = shadowDetail === 'high' && lightCount >= 2;

    if (lightCount === 1) {
      _centerFloodLight.setEnabled(true);
      _stadiumLights.forEach((light, index) => {
        // Keep corner light #0 alive as shadow caster but with no visible contribution.
        light.setEnabled(index === 0);
        light.intensity = index === 0 ? 0 : 1.30;
      });
    } else {
      _centerFloodLight.setEnabled(false);
      // Rebalance toward the shadow-casting light(s): occluding a key light then
      // removes a large slice of the illumination, so its shadow reads dark,
      // while the dimmer fill lights keep the rest of the scene lit. With two
      // keys each carries less of the total, so the per-key boost is smaller.
      const keyIndices = twoKeys ? [0, 2] : [0];
      const casterIntensity = twoKeys ? 1.35 : 1.7;
      const fillIntensity   = lightCount === 2 ? 0.6 : 0.5;
      _stadiumLights.forEach((light, index) => {
        light.setEnabled(enabledLightIndices.includes(index));
        light.intensity = keyIndices.includes(index) ? casterIntensity : fillIntensity;
      });
    }

    const shadowsEnabled = shadowDetail !== 'off' && _stadiumLights[0].isEnabled();
    const wantCasters = !shadowsEnabled
      ? 0
      : (twoKeys && _stadiumLights[2].isEnabled() ? 2 : 1);
    shadows.setActiveCount(wantCasters);
    if (wantCasters === 0) return;

    if (shadowDetail === 'low') {
      shadows.configure({
        useBlurExponentialShadowMap: false,
        usePoissonSampling: true,
        blurKernel: 4,
        refreshRate: 2,
      });
      return;
    }

    shadows.configure({
      useBlurExponentialShadowMap: true,
      usePoissonSampling: false,
      blurKernel: shadowDetail === 'high' ? 24 : 16,
      // Single key on 'high' keeps its every-frame update; with two maps, drop
      // both to every-other-frame so the added cost is ~half a map, not a whole
      // one. (True odd/even frame stagger would need manual RTT control.)
      refreshRate: shadowDetail === 'high' && wantCasters < 2 ? 1 : 2,
    });
  };

  applyDisplaySettings(loadDisplaySettings());
  const onDisplaySettingsChanged = (event) => {
    applyDisplaySettings(event?.detail ?? loadDisplaySettings());
  };
  window.addEventListener('offroad:display-settings-changed', onDisplaySettingsChanged);
  scene.onDisposeObservable.add(() => {
    window.removeEventListener('offroad:display-settings-changed', onDisplaySettingsChanged);
  });

  // -- Terrain manager --
  // Use 1m terrain cells for the common case, then scale the cell size up for
  // larger tracks so terrain baking and lookup work do not grow without bound.
  const terrainManager = new TerrainManager(terrainSize, terrainCellSize, groundWidth, groundDepth);
  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      const worldX = ((col + 0.5) / terrainManager.cellsPerSide) * groundWidth - groundWidth / 2;
      const worldZ = ((row + 0.5) / terrainManager.cellsPerSide) * groundDepth - groundDepth / 2;
      const terrainType = currentTrack.getTerrainTypeAt(worldX, worldZ);
      terrainManager.setTerrainCell(col, row, terrainType);
    }
  }

  applySteepGrassTerrainRemap(terrainManager, currentTrack);
  applySteepWaterTerrainRemap(terrainManager, currentTrack);

  // -- Ground mesh --
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: groundWidth, height: groundDepth, subdivisions: groundSubdivisions },
    scene
  );
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    positions[i + 1] = currentTrack.getHeightAt(x, z);
  }
  ground.setVerticesData(VertexBuffer.PositionKind, positions);
  ground.createNormals(true);

  // -- Ground texture --
  // Need not divide evenly by terrainManager.cellsPerSide — that count varies
  // per track anyway, so it rarely did. The cell painters snap their rects to
  // whole pixels instead (see _fillTerrainCell in ground-shader.js), which is
  // what keeps the raster from seaming.
  const texSize = 2000;
  const pixelsPerCell = texSize / terrainManager.cellsPerSide;

  const {
    createCompositeNormalMap,
    createTerrainMaterial,
    createWaterDepthOverlayTexture,
    updateWaterDepthOverlayTexture,
    createTerrainDetailTextureArray,
    createTerrainDetailNormalArray,
    setTerrainOutsideType,
    TerrainBlendPlugin,
    getTerrainTypeIndexByName,
  } = await import('../shaders/ground-shader.js');

  const terrainIdData = buildTerrainIdTexturePixelData(terrainManager);
  const terrainIdTex = RawTexture.CreateRGBATexture(
    terrainIdData.data,
    terrainIdData.width,
    terrainIdData.height,
    scene,
    false,
    false,
    Texture.NEAREST_SAMPLINGMODE
  );
  terrainIdTex.wrapU = Texture.CLAMP_ADDRESSMODE;
  terrainIdTex.wrapV = Texture.CLAMP_ADDRESSMODE;
  terrainIdTex.gammaSpace = false;

  const terrainTypePropertyData = buildTerrainTypePropertyTexturePixelData();
  const terrainPropertyTex = RawTexture.CreateRGBATexture(
    terrainTypePropertyData.data,
    terrainTypePropertyData.width,
    terrainTypePropertyData.height,
    scene,
    false,
    false,
    Texture.NEAREST_SAMPLINGMODE
  );
  terrainPropertyTex.wrapU = Texture.CLAMP_ADDRESSMODE;
  terrainPropertyTex.wrapV = Texture.CLAMP_ADDRESSMODE;
  terrainPropertyTex.gammaSpace = false;

  const terrainWearOverlayData = buildTerrainWearOverlayPixelData(currentTrack, texSize, groundWidth, groundDepth);
  const terrainWearOverlayTex = RawTexture.CreateRGBATexture(
    terrainWearOverlayData.data,
    terrainWearOverlayData.width,
    terrainWearOverlayData.height,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE
  );
  terrainWearOverlayTex.wrapU = Texture.CLAMP_ADDRESSMODE;
  terrainWearOverlayTex.wrapV = Texture.CLAMP_ADDRESSMODE;
  terrainWearOverlayTex.gammaSpace = false;

  // Deck-only wear (racing line where it's ON a bridge deck). Bridge deck
  // materials sample this instead of the terrain overlay, so a path running
  // under a deck doesn't smear its ruts onto the deck above.
  const bridgeDeckWearOverlayData = buildBridgeDeckWearOverlayPixelData(currentTrack, texSize, groundWidth, groundDepth);
  const bridgeDeckWearOverlayTex = RawTexture.CreateRGBATexture(
    bridgeDeckWearOverlayData.data,
    bridgeDeckWearOverlayData.width,
    bridgeDeckWearOverlayData.height,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE
  );
  bridgeDeckWearOverlayTex.wrapU = Texture.CLAMP_ADDRESSMODE;
  bridgeDeckWearOverlayTex.wrapV = Texture.CLAMP_ADDRESSMODE;
  bridgeDeckWearOverlayTex.gammaSpace = false;

  // Per-type detail textures, tiled in world space by the shader. Static across
  // tracks and never rebaked — unlike the overlays above, its resolution does not
  // depend on the track's size.
  const terrainDetailTex = await createTerrainDetailTextureArray(scene);
  const terrainDetailNormalTex = await createTerrainDetailNormalArray(scene);

  const groundTex = null;
  const specularTex = null;

  // -- Normal map with decals for surface detail (divots, holes, bumps) --
  const normalMapDecals = currentTrack.features.filter(f => f.type === 'normalMapDecal');
  const compositeNormalMap = await createCompositeNormalMap(scene, normalMapDecals, terrainManager, currentTrack, texSize, groundWidth, groundDepth);
  const waterDepthOverlayTex = await createWaterDepthOverlayTexture(scene, terrainManager, texSize, groundWidth, groundDepth);
  // `wear: false` skips the AI-path wear bake (independent of terrain types);
  // `overlays: false` skips the grid-driven water overlay (independent of the
  // aiPath). Default rebakes everything. Per-type surface texture is no longer
  // baked at all — the shader tiles it live from the detail array.
  const rebakeTerrainTexture = (opts = null) => {
    if (opts?.wear ?? true) {
      const wearOverlayData = buildTerrainWearOverlayPixelData(currentTrack, texSize, groundWidth, groundDepth);
      terrainWearOverlayTex.update(wearOverlayData.data);
      bridgeDeckWearOverlayTex.update(
        buildBridgeDeckWearOverlayPixelData(currentTrack, texSize, groundWidth, groundDepth).data
      );
    }
    if (opts?.overlays ?? true) {
      updateWaterDepthOverlayTexture(waterDepthOverlayTex, terrainManager, groundWidth, groundDepth);
    }
  };

  // Build StandardMaterial + TerrainBlendPlugin.
  // StandardMaterial handles CSM shadow receiving, lighting, and normal mapping.
  // The plugin injects 8-neighbor terrain blending per-fragment.
  const groundMat = createTerrainMaterial(
    scene,
    terrainIdTex,
    terrainPropertyTex,
    waterDepthOverlayTex,
    terrainWearOverlayTex,
    terrainDetailTex,
    terrainTypePropertyData.width,
    terrainManager.cellsPerSide,
    groundWidth / 2,
    groundDepth / 2,
    { detailNormalTexture: terrainDetailNormalTex }
  );
  groundMat.bumpTexture = compositeNormalMap;
  // Composite normals are now baked in track-aligned world space, so sample
  // full [0,1] UVs (with V flip for orientation) instead of square->rect crop.
  groundMat.bumpTexture.uScale = 1;
  groundMat.bumpTexture.uOffset = 0;
  groundMat.bumpTexture.vScale = -1;
  groundMat.bumpTexture.vOffset = 1;
  groundMat.bumpTexture.level = 0.75;
  groundMat.invertNormalMapY = true;

  // Same terrain shader for the outskirt plain, so the join with the ground is
  // invisible: identical colour blend, detail tiling and specular. Deliberately
  // no bumpTexture — the composite normal map is a whole-track bake addressed by
  // the ground mesh's own UVs, which would smear across the plain's quads.
  // The outside-fade type is what the plain settles to once the grid's clamped
  // edge cells have died out, so the border terrain is the right answer.
  const borderTerrainName =
    currentTrack.borderTerrainType?.name ?? currentTrack.defaultTerrainType?.name ?? 'packed_dirt';
  const outskirtsMat = createTerrainMaterial(
    scene,
    terrainIdTex,
    terrainPropertyTex,
    waterDepthOverlayTex,
    terrainWearOverlayTex,
    terrainDetailTex,
    terrainTypePropertyData.width,
    terrainManager.cellsPerSide,
    groundWidth / 2,
    groundDepth / 2,
    {
      outsideTerrainTypeIndex: getTerrainTypeIndexByName(borderTerrainName),
      detailNormalTexture: terrainDetailNormalTex,
    }
  );
  // Named so the editor's in-place perimeter rebuild can find it again — it has
  // no terrain textures on hand to build a replacement. Named even when the wall
  // is on and no plain is built, since the wall can be toggled off later.
  outskirtsMat.name = OUTSKIRTS_MATERIAL_NAME;

  ground.material = groundMat;
  ground.metadata = {
    ...(ground.metadata ?? {}),
    terrainIdTexture: terrainIdTex,
    terrainPropertyTexture: terrainPropertyTex,
    terrainWaterOverlayTexture: waterDepthOverlayTex,
    terrainWearOverlayTexture: terrainWearOverlayTex,
    terrainDetailTexture: terrainDetailTex,
    surfaceDecalTarget: true, // DecalManager projects flat decals onto this by downward ray
  };
  // The ground receives shadows (object/wall/hill shadows land on it) but is
  // NOT a shadow caster: a large flat caster self-shadows under the single
  // shadow-casting key light, which left the terrain stuck in its own shadow
  // and unresponsive to that light.
  ground.receiveShadows = true;
  // Register as canonical drivable surface for TerrainQuery and nav layers.
  driveSurfaceManager.register(ground, {
    surfaceType: "ground",
    level: 0,
    tags: {
      surfaceKind: "ground-base",
    },
  });
  surfaceTopologyGraph.registerNode(ground, {
    mesh: ground,
    surfaceId: ground.metadata?.surfaceId ?? null,
    layerId: 0,
    role: 'drive',
    kind: 'ground-base',
    tags: {
      surfaceKind: 'ground-base',
    },
  });
  // MESH shape follows displaced vertices so dynamic objects land on real terrain
  new PhysicsAggregate(ground, PhysicsShapeType.MESH, { mass: 0 }, scene);

  // Ensure rigid wall boundaries block driving off-grid
  const wallManager = new WallManager(scene, currentTrack, shadows);

  // Perimeter walls follow the track's borderWall settings (on/off, thickness,
  // height, colour) — see src/objects/BorderWall.js. With the wall off, the
  // border terrain carries on to the horizon instead of ending at a visible edge.
  buildBorderWalls(scene, currentTrack, wallManager);
  buildOutskirts(scene, currentTrack, driveSurfaceManager, outskirtsMat);

  // -- Feature managers --
  const checkpointManager = new CheckpointManager(scene, currentTrack, shadows);
  // wallManager already created above
  const obstacleManager = new ObstacleManager(scene, currentTrack, shadows);
  const trackSignManager = new TrackSignManager(scene, currentTrack, shadows);
  const decorationManager = new DecorationManager(scene, currentTrack, shadows);
  const pickupManager = new PickupManager(scene, currentTrack, shadows); // Pickups spawn lap-by-lap in RaceMode
  const bridgeMeshManager = new BridgeMeshManager(
    scene,
    currentTrack,
    shadows,
    driveSurfaceManager,
    {
      pluginClass: TerrainBlendPlugin,
      resolveTerrainTypeIndex: getTerrainTypeIndexByName,
      terrainIdTexture: terrainIdTex,
      terrainPropertyTexture: terrainPropertyTex,
      terrainWaterOverlayTexture: waterDepthOverlayTex,
      terrainWearOverlayTexture: terrainWearOverlayTex,
      terrainDeckWearOverlayTexture: bridgeDeckWearOverlayTex,
      terrainDetailTexture: terrainDetailTex,
      terrainDetailNormalTexture: terrainDetailNormalTex,
      terrainTypeCount: terrainTypePropertyData.width,
      terrainCellCount: terrainManager.cellsPerSide,
      terrainWorldHalfWidth: groundWidth / 2,
      terrainWorldHalfDepth: groundDepth / 2,
    }
  );
  const decalManager = new DecalManager(scene, currentTrack, ground);
  // Stuck-on decals resolve their parent decoration / obstacle by feature id.
  decalManager.setAttachResolver((attachTo) =>
    attachTo?.kind === "obstacle"
      ? obstacleManager.findById(attachTo.id)
      : decorationManager.findById(attachTo.id));
  const steepSlopeColliderManager = new SteepSlopeColliderManager(scene, currentTrack, {
    enabled: true,
    sampleStep: 3,
    maxSlopeDeg: 60,
    wallAbove: 4,
    wallBelow: 1,
    // Negative = inset: thinner slab that hugs the steep band (see manager).
    padding: -0.5,
  });
  steepSlopeColliderManager.rebuild();
  checkpointManager.createCheckpoints();

  // Build bridge drive surfaces first so downstream terrain-following features
  // (poly walls/curbs) can sample across all bridge meshes in one pass.
  for (const feature of currentTrack.features) {
    if (feature.type === "bridgeMesh" || feature.type === "driveBox") {
      bridgeMeshManager.create(feature);
    }
  }
  bridgeMeshManager.rebuildAutoConnectorLinks();

  // Create movable obstacles, walls, flags, and track signs from track features.
  for (const feature of currentTrack.features) {
    if (feature.type === "obstacle") {
      obstacleManager.createStack(feature);
    } else if (feature.type === "polyWall") {
      wallManager.createPolyWall(feature);
    } else if (feature.type === "polyCurb") {
      wallManager.createPolyCurb(feature);
    } else if (feature.type === "trackSign") {
      trackSignManager.createSign(feature);
    } else if (isModelFeature(feature)) {
      decorationManager.createDecoration(feature);
    }
  }

  // Decals run after the feature loop so every surface they can land on exists:
  //  1. flat (ground / bridge decks)   2. wall-ish (perimeter + poly walls)
  //  3. attached — stuck to a decoration / obstacle built above.
  for (const feature of currentTrack.features) {
    if (feature.type === "decal" && !feature.attachTo && decalManager.isFlatFeature(feature)) {
      decalManager.createDecal(feature);
    }
  }
  for (const feature of currentTrack.features) {
    if (feature.type === "decal" && !feature.attachTo && !decalManager.isFlatFeature(feature)) {
      decalManager.createDecal(feature);
    }
  }
  for (const feature of currentTrack.features) {
    if (feature.type === "decal" && feature.attachTo) {
      decalManager.createDecal(feature);
    }
  }

  // Water is built per *body*, not per feature — overlapping water features share
  // one surface — so it runs once over the whole track rather than in the loop.
  buildWaterBodies(currentTrack, scene);
  // Published for anything that needs to know how deep the water is at a point —
  // splash effects, most of all. Shared so each truck doesn't build its own, and
  // scene-scoped so it can never outlive the track it was built from.
  scene.metadata.waterDepthAt = createWaterDepthSampler(currentTrack);
  // The wake field the trucks stamp into while wading. Published the same way
  // and for the same reason; empty on a track with no water.
  createWakeField(currentTrack, scene);

  // Procedural dirt-chunk scatter (along walls / outside the AI drive path).
  // Disabled per-track for on-road / paved tracks.
  if (currentTrack.dirtChunks !== false) {
    scatterDirtChunks(scene, currentTrack);
  }

  // Procedural grass-blade scatter — same idea, but only over grass terrain.
  // Fire-and-forget: the OBJ load is async and nothing downstream depends on it.
  if (currentTrack.grassBlades !== false) {
    scatterGrassBlades(scene, currentTrack).catch((err) =>
      console.warn("[GrassBlades] scatter failed:", err),
    );
  }

  return {
    scene,
    camera,
    cameraController,
    shadows,
    currentTrack,
    terrainManager,
    ground,
    groundTex,
    specularTex,
    rebakeTerrainTexture,
    terrainIdTex,
    terrainPropertyTex,
    terrainWearOverlayTex,
    bridgeDeckWearOverlayTex,
    pixelsPerCell,
    compositeNormalMap,
    checkpointManager,
    wallManager,
    obstacleManager,
    trackSignManager,
    decorationManager,
    pickupManager,
    bridgeMeshManager,
    steepSlopeColliderManager,
    decalManager,
    driveSurfaceManager,
    surfaceTopologyGraph,
  };
}
