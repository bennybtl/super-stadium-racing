import {
  Scene,
  HavokPlugin,
  Vector3,
  HemisphericLight,
  PointLight,
  ShadowGenerator,
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
import { TerrainManager, TERRAIN_TYPES } from "../terrain.js";
import { Track } from "../track.js";
import { CameraController } from "../managers/CameraController.js";
import { CheckpointManager } from "../managers/CheckpointManager.js";
import { WallManager } from "../managers/WallManager.js";
import { ObstacleManager } from "../managers/ObstacleManager.js";
import { FlagManager } from "../managers/FlagManager.js";
import { TrackSignManager } from "../managers/TrackSignManager.js";
import { BannerStringManager } from "../managers/BannerStringManager.js";
import { PickupManager } from "../managers/PickupManager.js";
import { BridgeManager } from "../managers/BridgeManager.js";
import { DriveSurfaceManager } from "../managers/DriveSurfaceManager.js";
import { SteepSlopeColliderManager } from "../managers/SteepSlopeColliderManager.js";
import { SurfaceDecalManager } from "../managers/SurfaceDecalManager.js";
import { createHill } from "../objects/Hill.js";
import {
  buildTerrainIdTexturePixelData,
  buildTerrainWearOverlayPixelData,
  buildTerrainTypePropertyTexturePixelData,
  applySteepGrassTerrainRemap,
} from "../terrain-utils.js";
import {
  createTerrainDiffuseOverlayTexture,
  updateTerrainDiffuseOverlayTexture,
} from "../shaders/ground-shader.js";
import { loadDisplaySettings } from "../settingsStorage.js";

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

  // Shared registry for all drivable surfaces (ground, bridges, ramps, etc.).
  const driveSurfaceManager = new DriveSurfaceManager(scene);

  // -- Physics --
  const havok = await HavokPhysics();
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));

  // -- Camera --
  const camera = new FreeCamera("cam", new Vector3(0, 28, -20), scene);
  camera.setTarget(Vector3.Zero());
  const cameraController = new CameraController(camera, new Vector3(0, 28, -20));

  // --- Ambient ---
  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.35;
  ambient.groundColor = new Color3(0.2, 0.15, 0.1);

  // -- Track --
  let currentTrack;
  if (trackKey === "new") {
    currentTrack = new Track("New Track");
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
  const groundWidth = trackWidth + 20;
  const groundDepth = trackDepth + 20;

  // -- Stadium lights --
  // 4 point lights at the corners of the track, elevated like stadium floodlights.
  const _lightHeight = 60;
  const _lightSpread = terrainSize * 0.55;
  const _stadiumPositions = [
    new Vector3(-_lightSpread, _lightHeight, -_lightSpread),
    new Vector3( _lightSpread, _lightHeight, -_lightSpread),
    new Vector3( _lightSpread, _lightHeight,  _lightSpread),
    new Vector3(-_lightSpread, _lightHeight,  _lightSpread),
  ];
  const _stadiumLights = _stadiumPositions.map((pos, i) => {
    const light = new PointLight(`stadiumLight${i}`, pos, scene);
    light.intensity = 0.85;
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

  // One light casts shadows (cube-map ShadowGenerator).
  const shadows = new ShadowGenerator(1024, _stadiumLights[0]);
  shadows.useBlurExponentialShadowMap = true;
  shadows.blurKernel = 16;
  shadows.bias = 0.005;
  shadows.normalBias = 0.02;

  const applyDisplaySettings = (settings) => {
    const shadowDetail = settings?.shadow ?? 'medium';
    const lightCount = settings?.lights ?? 4;

    // Keep enabled corner lights spatially balanced at lower counts.
    const enabledLightIndices =
      lightCount === 2 ? [0, 2] :
      [0, 1, 2, 3];

    if (lightCount === 1) {
      _centerFloodLight.setEnabled(true);
      _stadiumLights.forEach((light, index) => {
        // Keep corner light #0 alive as shadow caster but with no visible contribution.
        light.setEnabled(index === 0);
        light.intensity = index === 0 ? 0 : 1.30;
      });
    } else {
      _centerFloodLight.setEnabled(false);
      const perLightIntensity = lightCount === 2 ? 1.10 : 0.85;
      _stadiumLights.forEach((light, index) => {
        light.setEnabled(enabledLightIndices.includes(index));
        light.intensity = perLightIntensity;
      });
    }

    const shadowCasterLight = _stadiumLights[0];
    const shadowMap = shadows.getShadowMap?.();
    if (!shadowCasterLight || !shadowMap) return;

    const shadowsEnabled = shadowDetail !== 'off' && shadowCasterLight.isEnabled();
    shadowCasterLight.shadowEnabled = shadowsEnabled;

    if (!shadowsEnabled) {
      // Keep map updates cheap when shadows are disabled.
      shadowMap.refreshRate = 0;
      return;
    }

    if (shadowDetail === 'low') {
      shadows.useBlurExponentialShadowMap = false;
      shadows.usePoissonSampling = true;
      shadows.blurKernel = 4;
      shadowMap.refreshRate = 2;
      return;
    }

    shadows.usePoissonSampling = false;
    shadows.useBlurExponentialShadowMap = true;
    if (shadowDetail === 'high') {
      shadows.blurKernel = 24;
      shadowMap.refreshRate = 1;
      return;
    }

    // Medium
    shadows.blurKernel = 16;
    shadowMap.refreshRate = 2;
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
  // Use 1m terrain cells for smoother visual blending between terrain types.
  // Physics still samples from this grid, but the finer resolution reduces
  // visible blockiness and better matches authored terrain feature boundaries.
  const terrainManager = new TerrainManager(terrainSize, 1, groundWidth, groundDepth);
  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      const worldX = ((col + 0.5) / terrainManager.cellsPerSide) * groundWidth - groundWidth / 2;
      const worldZ = ((row + 0.5) / terrainManager.cellsPerSide) * groundDepth - groundDepth / 2;
      const terrainType = currentTrack.getTerrainTypeAt(worldX, worldZ);
      terrainManager.setTerrainCell(col, row, terrainType);
    }
  }

  applySteepGrassTerrainRemap(terrainManager, currentTrack);

  // -- Ground mesh --
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: groundWidth, height: groundDepth, subdivisions: Math.floor(Math.max(groundWidth, groundDepth) / 2) },
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
  // Keep this divisible by terrainManager.cellsPerSide (40) to avoid
  // floor/ceil cell raster overlap seams in terrain texture painting.
  const texSize = 2000;
  const pixelsPerCell = texSize / terrainManager.cellsPerSide;

  const {
    createCompositeNormalMap,
    createTerrainMaterial,
    createWaterDepthOverlayTexture,
    updateWaterDepthOverlayTexture,
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

  const terrainDiffuseOverlayTex = await createTerrainDiffuseOverlayTexture(scene, terrainManager, texSize, groundWidth, groundDepth);
  terrainDiffuseOverlayTex.wrapU = Texture.CLAMP_ADDRESSMODE;
  terrainDiffuseOverlayTex.wrapV = Texture.CLAMP_ADDRESSMODE;
  terrainDiffuseOverlayTex.gammaSpace = false;

  const groundTex = null;
  const specularTex = null;

  // -- Normal map with decals for surface detail (divots, holes, bumps) --
  const normalMapDecals = currentTrack.features.filter(f => f.type === 'normalMapDecal');
  const compositeNormalMap = await createCompositeNormalMap(scene, normalMapDecals, terrainManager, currentTrack, texSize, groundWidth, groundDepth);
  const waterDepthOverlayTex = await createWaterDepthOverlayTexture(scene, terrainManager, texSize, groundWidth, groundDepth);
  const rebakeTerrainTexture = () => {
    const wearOverlayData = buildTerrainWearOverlayPixelData(currentTrack, texSize, groundWidth, groundDepth);
    terrainWearOverlayTex.update(wearOverlayData.data);
    updateTerrainDiffuseOverlayTexture(terrainDiffuseOverlayTex, terrainManager, groundWidth, groundDepth);
    updateWaterDepthOverlayTexture(waterDepthOverlayTex, terrainManager, groundWidth, groundDepth);
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
    terrainDiffuseOverlayTex,
    terrainTypePropertyData.width,
    terrainManager.cellsPerSide,
    groundWidth / 2,
    groundDepth / 2
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

  ground.material = groundMat;
  ground.metadata = {
    ...(ground.metadata ?? {}),
    terrainIdTexture: terrainIdTex,
    terrainPropertyTexture: terrainPropertyTex,
    terrainWaterOverlayTexture: waterDepthOverlayTex,
    terrainWearOverlayTexture: terrainWearOverlayTex,
    terrainDiffuseOverlayTexture: terrainDiffuseOverlayTex,
  };
  ground.receiveShadows = true;
  // Register as canonical drivable surface for TerrainQuery and nav layers.
  driveSurfaceManager.register(ground, { surfaceType: "ground", level: 0 });
  // MESH shape follows displaced vertices so dynamic objects land on real terrain
  new PhysicsAggregate(ground, PhysicsShapeType.MESH, { mass: 0 }, scene);

  // Ensure rigid wall boundaries block driving off-grid
  const wallManager = new WallManager(scene, currentTrack, shadows);

  const createBorderWall = (name, x, z, width, depth) => {
    const wall = MeshBuilder.CreateBox(name, { width, height: 24, depth }, scene);
    wall.position = new Vector3(x, 0, z); // Center relative to 0 y-height
    wall.metadata = {
      ...(wall.metadata ?? {}),
      truckCollider: true,
      truckColliderFriction: 0.9,
    };
    
    const mat = new StandardMaterial(name + "Mat", scene);
    mat.diffuseColor = new Color3(0.5, 0.5, 0.5);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    wall.material = mat;
    
    new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0 }, scene);

    // Also add to wallManager so they show up on the track editor grid and can be optionally hidden
    let heading, halfLength, halfThick;
    if (width > depth) {
      heading = 0;
      halfLength = width / 2;
      halfThick = depth / 2;
    } else {
      heading = Math.PI / 2;
      halfLength = depth / 2;
      halfThick = width / 2;
    }

    wallManager._walls.push({
      segments: [{
        position: { x, z },
        heading,
        halfLength,
        halfThick,
        friction: 0.1
      }],
      dispose() {},   // no Babylon meshes — required by WallManager.dispose()
    });
  };
  
  const paddingX = trackWidth / 2 + 10;
  const paddingZ = trackDepth / 2 + 10;

  createBorderWall("borderNorth", 0,  paddingZ + 1, trackWidth + 24, 2);
  createBorderWall("borderSouth", 0, -paddingZ - 1, trackWidth + 24, 2);
  createBorderWall("borderEast",  paddingX + 1,  0, 2, trackDepth + 20);
  createBorderWall("borderWest", -paddingX - 1,  0, 2, trackDepth + 20);

  // -- Feature managers --
  const checkpointManager = new CheckpointManager(scene, currentTrack, shadows);
  // wallManager already created above
  const obstacleManager = new ObstacleManager(scene, currentTrack, shadows);
  const flagManager     = new FlagManager(scene, currentTrack, shadows);
  const trackSignManager = new TrackSignManager(scene, currentTrack, shadows);
  const bannerStringManager = new BannerStringManager(scene, currentTrack, shadows);
  const pickupManager = new PickupManager(scene, currentTrack, shadows, 0); // Spawning disabled by default inside shared scene
  const bridgeManager = new BridgeManager(scene, currentTrack, shadows, driveSurfaceManager);
  const surfaceDecalManager = new SurfaceDecalManager(scene, currentTrack, ground);
  const steepSlopeColliderManager = new SteepSlopeColliderManager(scene, currentTrack, {
    enabled: true,
    sampleStep: 3,
    maxSlopeDeg: 60,
    wallAbove: 4,
    wallBelow: 1,
    padding: 0.15,
  });
  steepSlopeColliderManager.rebuild();
  checkpointManager.createCheckpoints();

  // Create movable obstacles, flags, and track signs from track features.
  for (const feature of currentTrack.features) {
    if (feature.type === "obstacle") {
      obstacleManager.createStack(feature);
    } else if (feature.type === "polyWall") {
      wallManager.createPolyWall(feature);
    } else if (feature.type === "polyCurb") {
      wallManager.createPolyCurb(feature);
    } else if (feature.type === "flag") {
      flagManager.createFlag(feature);
    } else if (feature.type === "trackSign") {
      trackSignManager.createSign(feature);
    } else if (feature.type === "bannerString") {
      bannerStringManager.createBanner(feature);
    } else if (feature.type === "bridge") {
      bridgeManager.createBridge(feature);
    } else if (feature.type === "surfaceDecal") {
      surfaceDecalManager.createDecal(feature);
    } else if (feature.type === 'hill' || feature.type === 'squareHill') {
      createHill(feature, currentTrack, scene);
    }
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
    pixelsPerCell,
    compositeNormalMap,
    checkpointManager,
    wallManager,
    obstacleManager,
    flagManager,
    trackSignManager,
    bannerStringManager,
    pickupManager,
    bridgeManager,
    steepSlopeColliderManager,
    surfaceDecalManager,
    driveSurfaceManager,
  };
}
