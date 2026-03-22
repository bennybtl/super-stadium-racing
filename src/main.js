import {
  Engine,
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
import { createTruck, updateTruck } from "./truck.js";
import { TerrainManager, TERRAIN_TYPES } from "./terrain.js";
import { Track, EXAMPLE_TRACKS } from "./track.js";

const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true);

async function createScene() {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.15, 0.12, 0.1, 1);

  // -- Physics --
  const havok = await HavokPhysics();
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));

  // -- Camera: fixed isometric offset, slides with the truck --
  const BASE_CAM_OFFSET = new Vector3(0, 28, -20);
  let zoomLevel = 2.0; // Current zoom multiplier
  const MIN_ZOOM = 0.5; // Closest zoom (50% of base distance)
  const MAX_ZOOM = 2.5; // Farthest zoom (200% of base distance)
  const ZOOM_STEP = 0.1; // Zoom increment per key press
  
  const camera = new FreeCamera("cam", BASE_CAM_OFFSET.clone(), scene);
  camera.setTarget(Vector3.Zero());

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

  // -- Track System --
  // Create a track - you can switch between example tracks or create your own
  const currentTrack = EXAMPLE_TRACKS.hills();
  
  // Can save track to JSON
  console.log("Track JSON:", currentTrack.toJSON());
  
  // Can load track from JSON
  // const loadedTrack = Track.fromJSON(jsonString);

  // -- Terrain System --
  const terrainManager = new TerrainManager(160, 2);
  
  // Apply track terrain types to terrain manager
  // Sample the track at each terrain grid cell center
  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      // Sample at the center of each cell
      const worldX = (col - terrainManager.cellsPerSide / 2 + 0.5) * terrainManager.cellSize;
      const worldZ = (row - terrainManager.cellsPerSide / 2 + 0.5) * terrainManager.cellSize;
      
      const terrainType = currentTrack.getTerrainTypeAt(worldX, worldZ);
      if (terrainType) {
        terrainManager.setTerrainCell(col, row, terrainType);
      }
    }
  }

  // -- Ground --
  const ground = MeshBuilder.CreateGround("ground", { width: 160, height: 160, subdivisions: 80 }, scene);
  
  // Apply terrain height to ground vertices
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    positions[i + 1] = currentTrack.getHeightAt(x, z);
  }
  ground.setVerticesData(VertexBuffer.PositionKind, positions);
  ground.createNormals(true);
  
  const groundMat = new StandardMaterial("groundMat", scene);
  
  // Generate texture from terrain grid
  const texSize = 512;
  const groundTex = new DynamicTexture("groundTex", { width: texSize, height: texSize }, scene);
  const ctx = groundTex.getContext();
  const pixelsPerCell = texSize / terrainManager.cellsPerSide;
  
  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      const index = row * terrainManager.cellsPerSide + col;
      const terrain = terrainManager.grid[index];
      const color = terrain.color;
      
      // Convert Color3 to hex string
      const r = Math.floor(color.r * 255);
      const g = Math.floor(color.g * 255);
      const b = Math.floor(color.b * 255);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      
      // Flip Y for texture (canvas Y is inverted from world Z)
      const textureRow = terrainManager.cellsPerSide - 1 - row;
      // Also flip X (canvas X needs to be inverted from world X)
      const textureCol = terrainManager.cellsPerSide - 1 - col;
      ctx.fillRect(
        textureCol * pixelsPerCell,
        textureRow * pixelsPerCell,
        pixelsPerCell,
        pixelsPerCell
      );
    }
  }
  
  groundTex.update();
  groundMat.diffuseTexture = groundTex;
  groundMat.diffuseTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
  groundMat.diffuseTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
  ground.material = groundMat;
  ground.receiveShadows = true;
  new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, scene);

  // -- Truck --
  const truck = createTruck(scene, shadows);

  // -- Input --
  const input = { forward: false, back: false, left: false, right: false };

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyW" || e.code === "ArrowUp")    input.forward = true;
    if (e.code === "KeyS" || e.code === "ArrowDown")  input.back    = true;
    if (e.code === "KeyA" || e.code === "ArrowLeft")  input.left    = true;
    if (e.code === "KeyD" || e.code === "ArrowRight") input.right   = true;
    
    // Zoom controls
    if (e.code === "Minus" || e.code === "NumpadSubtract") {
      zoomLevel = Math.min(MAX_ZOOM, zoomLevel + ZOOM_STEP);
    }
    if (e.code === "Equal" || e.code === "NumpadAdd") {
      zoomLevel = Math.max(MIN_ZOOM, zoomLevel - ZOOM_STEP);
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyW" || e.code === "ArrowUp")    input.forward = false;
    if (e.code === "KeyS" || e.code === "ArrowDown")  input.back    = false;
    if (e.code === "KeyA" || e.code === "ArrowLeft")  input.left    = false;
    if (e.code === "KeyD" || e.code === "ArrowRight") input.right   = false;
  });

  // -- Game loop --
  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    
    // Update truck physics (vertical + horizontal)
    const debugInfo = updateTruck(truck, input, dt, terrainManager, currentTrack);
    
    // Update debug panel
    document.getElementById('debug-compression').textContent = debugInfo.compression.toFixed(3);
    document.getElementById('debug-groundedness').textContent = debugInfo.groundedness.toFixed(3);
    document.getElementById('debug-penetration').textContent = debugInfo.penetration.toFixed(3);
    document.getElementById('debug-vvel').textContent = debugInfo.verticalVelocity.toFixed(2);
    document.getElementById('debug-speed').textContent = debugInfo.speed.toFixed(2);
    document.getElementById('debug-grip').textContent = debugInfo.effectiveGrip.toFixed(4);
    document.getElementById('debug-slip').textContent = (debugInfo.slipAngle * 57.3).toFixed(1) + '°';
    document.getElementById('debug-terrain').textContent = debugInfo.terrainGripMultiplier.toFixed(2) + 'x';
    document.getElementById('debug-x').textContent = debugInfo.x.toFixed(2);
    document.getElementById('debug-y').textContent = debugInfo.y.toFixed(2);
    document.getElementById('debug-z').textContent = debugInfo.z.toFixed(2);
    
    // Slide the camera in the XZ plane to follow the truck, keeping the fixed offset
    const CAM_OFFSET = BASE_CAM_OFFSET.scale(zoomLevel);
    const targetCamPos = truck.mesh.position.add(CAM_OFFSET);
    camera.position = Vector3.Lerp(camera.position, targetCamPos, 0.08);
    camera.setTarget(truck.mesh.position);
  });

  return scene;
}

createScene().then((scene) => {
  engine.runRenderLoop(() => scene.render());
});

window.addEventListener("resize", () => engine.resize());
