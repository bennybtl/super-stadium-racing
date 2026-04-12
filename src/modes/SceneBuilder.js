import {
  Scene,
  HavokPlugin,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  CascadedShadowGenerator,
  ShadowGenerator,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  PhysicsAggregate,
  PhysicsShapeType,
  FreeCamera,
  DynamicTexture,
  Texture,
  VertexBuffer,
} from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import { TerrainManager } from "../terrain.js";
import { Track } from "../track.js";
import { CameraController } from "../managers/CameraController.js";
import { CheckpointManager } from "../managers/CheckpointManager.js";
import { WallManager } from "../managers/WallManager.js";
import { TireStackManager } from "../managers/TireStackManager.js";
import { FlagManager } from "../managers/FlagManager.js";
import { TrackSignManager } from "../managers/TrackSignManager.js";
import { BannerStringManager } from "../managers/BannerStringManager.js";
import { PickupManager } from "../managers/PickupManager.js";
import { paintTerrainTexture, paintTerrainSpecularMap } from "../terrain-utils.js";

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

  // -- Physics --
  const havok = await HavokPhysics();
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));

  // -- Camera --
  const camera = new FreeCamera("cam", new Vector3(0, 28, -20), scene);
  camera.setTarget(Vector3.Zero());
  const cameraController = new CameraController(camera, new Vector3(0, 28, -20));

  // --- Lighting ---
  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.4;
  ambient.groundColor = new Color3(0.2, 0.15, 0.1);

  const sun = new DirectionalLight("sun", new Vector3(-1, -2, -1).normalize(), scene);
  sun.intensity = 1.2;
  sun.position = new Vector3(20, 60, 20);

  // -- Shadows --
  // Use CascadedShadowGenerator for huge outdoors over DirectionalLight to map automatically
  const shadows = new CascadedShadowGenerator(2048, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = 1; // 1 = Medium, 2 = High (for PCF)
  // Automatically configure cascades over the main camera clipping planes
  shadows.lambda = 0.8;
  shadows.cascadeBlendPercentage = 0.1;
  shadows.depthClamp = false;
  shadows.autoCalcDepthBounds = true;
  
  // Fix shadow acne / self-shadowing interference patterns on meshes
  shadows.bias = 0.005;
  shadows.normalBias = 0.02;

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

  // -- Terrain manager --
  const terrainManager = new TerrainManager(terrainSize, 2);
  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      const worldX =
        (col - terrainManager.cellsPerSide / 2 + 0.5) * terrainManager.cellSize;
      const worldZ =
        (row - terrainManager.cellsPerSide / 2 + 0.5) * terrainManager.cellSize;
      const terrainType = currentTrack.getTerrainTypeAt(worldX, worldZ);
      terrainManager.setTerrainCell(col, row, terrainType);
    }
  }

  // -- Ground mesh --
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: terrainSize, height: terrainSize, subdivisions: Math.floor(terrainSize / 2) },
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

  const groundMat = new StandardMaterial("groundMat", scene);
  // specularColor = max highlight colour; the specularTexture scales it per-pixel
  // so dry terrain stays matte while mud/water cells become shiny/wet.
  groundMat.specularColor = new Color3(1, 1, 1);
  groundMat.specularPower = 48; // tighter highlight → wet/glossy look

  // -- Ground texture --
  const texSize = 512;
  const groundTex = new DynamicTexture(
    "groundTex",
    { width: texSize, height: texSize },
    scene
  );
  const ctx = groundTex.getContext();
  const pixelsPerCell = texSize / terrainManager.cellsPerSide;

  paintTerrainTexture(ctx, terrainManager, pixelsPerCell);

  groundTex.update();
  groundMat.diffuseTexture = groundTex;
  groundMat.diffuseTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
  groundMat.diffuseTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
  // Flip texture vertically so canvas Y aligns with world Z
  groundMat.diffuseTexture.vScale = -1;
  groundMat.diffuseTexture.vOffset = 1;

  // -- Specular (wet) map -- bright where mud/water, dark everywhere else
  const specularTex = new DynamicTexture(
    "specularTex",
    { width: texSize, height: texSize },
    scene
  );
  paintTerrainSpecularMap(specularTex.getContext(), terrainManager, pixelsPerCell);
  specularTex.update();
  specularTex.wrapU = Texture.CLAMP_ADDRESSMODE;
  specularTex.wrapV = Texture.CLAMP_ADDRESSMODE;
  specularTex.vScale = -1;
  specularTex.vOffset = 1;
  groundMat.specularTexture = specularTex;
  
  // -- Normal map with decals for surface detail (divots, holes, bumps) --
  // Collect all normal map decal features from the track
  const normalMapDecals = currentTrack.features.filter(f => f.type === 'normalMapDecal');
  
  // Create composite normal map texture that blends base + decals
  const { createCompositeNormalMap } = await import('../shaders/ground-shader.js');
  const compositeNormalMap = await createCompositeNormalMap(scene, normalMapDecals, terrainManager, 2048, terrainSize);
  
  groundMat.bumpTexture = compositeNormalMap;
  groundMat.bumpTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
  groundMat.bumpTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
  // Flip vertically to match diffuse texture orientation
  groundMat.bumpTexture.vScale = -1;
  groundMat.bumpTexture.vOffset = 1;
  groundMat.bumpTexture.level = 0.25; // Adjust intensity as needed
  
  ground.material = groundMat;
  ground.receiveShadows = true;
  // MESH shape follows displaced vertices so dynamic objects land on real terrain
  new PhysicsAggregate(ground, PhysicsShapeType.MESH, { mass: 0 }, scene);

  // Ensure rigid wall boundaries block driving off-grid
  const wallManager = new WallManager(scene, currentTrack, shadows);

  const createBorderWall = (name, x, z, width, depth) => {
    const wall = MeshBuilder.CreateBox(name, { width, height: 24, depth }, scene);
    wall.position = new Vector3(x, 0, z); // Center relative to 0 y-height
    
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
      }]
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
  const tireStackManager = new TireStackManager(scene, currentTrack, shadows);
  const flagManager     = new FlagManager(scene, currentTrack, shadows);
  const trackSignManager = new TrackSignManager(scene, currentTrack);
  const bannerStringManager = new BannerStringManager(scene, currentTrack, shadows);
  const pickupManager = new PickupManager(scene, currentTrack, shadows, 0); // Spawning disabled by default inside shared scene
  checkpointManager.createCheckpoints();

  // Create Tire Stacks, Flags, and Track Signs from track features (must be after ground so we can query heights)
  for (const feature of currentTrack.features) {
    if (feature.type === "tireStack") {
      tireStackManager.createStack(feature);
    } else if (feature.type === "polyWall") {
      wallManager.createPolyWall(feature);
    } else if (feature.type === "flag") {
      flagManager.createFlag(feature);
    } else if (feature.type === "trackSign") {
      trackSignManager.createSign(feature);
    } else if (feature.type === "bannerString") {
      bannerStringManager.createBanner(feature);
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
    pixelsPerCell,
    compositeNormalMap,
    checkpointManager,
    wallManager,
    tireStackManager,
    flagManager,
    trackSignManager,
    bannerStringManager,
    pickupManager,
  };
}
