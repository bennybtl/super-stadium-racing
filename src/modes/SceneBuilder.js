import {
  Scene,
  HavokPlugin,
  Vector3,
  HemisphericLight,
  DirectionalLight,
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

  // -- Lighting --
  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.4;
  ambient.groundColor = new Color3(0.2, 0.15, 0.1);

  const sun = new DirectionalLight("sun", new Vector3(-1, -2, -1), scene);
  sun.intensity = 1.2;
  sun.position = new Vector3(20, 40, 20);

  // -- Shadows --
  const shadows = new ShadowGenerator(1024, sun);
  shadows.useBlurExponentialShadowMap = true;

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

  // -- Terrain manager --
  const terrainManager = new TerrainManager(160, 2);
  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      const worldX =
        (col - terrainManager.cellsPerSide / 2 + 0.5) * terrainManager.cellSize;
      const worldZ =
        (row - terrainManager.cellsPerSide / 2 + 0.5) * terrainManager.cellSize;
      const terrainType = currentTrack.getTerrainTypeAt(worldX, worldZ);
      if (terrainType) terrainManager.setTerrainCell(col, row, terrainType);
    }
  }

  // -- Ground mesh --
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: 160, height: 160, subdivisions: 80 },
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
  groundMat.specularColor = new Color3(0.2, 0.2, 0.2);
  groundMat.specularPower = 10;

  // -- Ground texture --
  const texSize = 512;
  const groundTex = new DynamicTexture(
    "groundTex",
    { width: texSize, height: texSize },
    scene
  );
  const ctx = groundTex.getContext();
  const pixelsPerCell = texSize / terrainManager.cellsPerSide;

  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      const index = row * terrainManager.cellsPerSide + col;
      const color = terrainManager.grid[index].color;
      const baseR = Math.floor(color.r * 255);
      const baseG = Math.floor(color.g * 255);
      const baseB = Math.floor(color.b * 255);
      const px = Math.ceil(pixelsPerCell);
      const x0 = Math.floor(col * pixelsPerCell);
      const y0 = Math.floor(row * pixelsPerCell);
      for (let py = 0; py < px; py++) {
        for (let pxx = 0; pxx < px; pxx++) {
          const n = (Math.random() - 0.5) * 18;
          const r = Math.max(0, Math.min(255, baseR + n));
          const g = Math.max(0, Math.min(255, baseG + n * 0.9));
          const b = Math.max(0, Math.min(255, baseB + n * 0.8));
          ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
          ctx.fillRect(x0 + pxx, y0 + py, 1, 1);
        }
      }
    }
  }

  groundTex.update();
  groundMat.diffuseTexture = groundTex;
  groundMat.diffuseTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
  groundMat.diffuseTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
  // Flip texture vertically so canvas Y aligns with world Z
  groundMat.diffuseTexture.vScale = -1;
  groundMat.diffuseTexture.vOffset = 1;
  ground.material = groundMat;
  ground.receiveShadows = true;
  // MESH shape follows displaced vertices so dynamic objects land on real terrain
  new PhysicsAggregate(ground, PhysicsShapeType.MESH, { mass: 0 }, scene);

  // -- Feature managers --
  const checkpointManager = new CheckpointManager(scene, currentTrack, shadows);
  const wallManager = new WallManager(scene, currentTrack, shadows);
  const tireStackManager = new TireStackManager(scene, currentTrack, shadows);
  checkpointManager.createCheckpoints();

  // Create Tire Stacks from track features (must be after ground so we can query heights)
  for (const feature of currentTrack.features) {

    if (feature.type === "tireStack") {
      tireStackManager.createStack(feature);
    } else if (feature.type === "wall") {
      wallManager.createStraightWall(feature);
    } else if (feature.type === "curvedWall") {
      wallManager.createCurvedWall(feature);
    } else if (feature.type === "polyWall") {
      wallManager.createPolyWall(feature);
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
    pixelsPerCell,
    checkpointManager,
    wallManager,
    tireStackManager,
  };
}
