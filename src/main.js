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
import { TerrainManager } from "./terrain.js";
import { EXAMPLE_TRACKS } from "./track.js";
import { UIManager } from "./managers/UIManager.js";
import { GameState } from "./managers/GameState.js";
import { CameraController } from "./managers/CameraController.js";
import { InputManager } from "./managers/InputManager.js";
import { CheckpointManager } from "./managers/CheckpointManager.js";
import { BarrierManager } from "./managers/BarrierManager.js";

const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true);

async function createScene() {
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
      
      // Direct mapping - no flips needed
      ctx.fillRect(
        col * pixelsPerCell,
        row * pixelsPerCell,
        pixelsPerCell,
        pixelsPerCell
      );
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
  new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, scene);

  // -- Truck --
  const truck = createTruck(scene, shadows);

  // -- Initialize Managers --
  const uiManager = new UIManager();
  const gameState = new GameState(truck.state.maxBoosts);
  const checkpointManager = new CheckpointManager(scene, currentTrack, shadows);
  const barrierManager = new BarrierManager(scene, currentTrack, shadows);
  
  // Create track features
  checkpointManager.createCheckpoints();
  barrierManager.createBarriers();
  
  // -- Input Manager --
  const inputManager = new InputManager(truck, cameraController);
  
  // Handle boost activation
  inputManager.onBoost(() => {
    if (gameState.useBoost() && !truck.state.boostActive) {
      truck.state.boostActive = true;
      truck.state.boostTimer = truck.state.boostDuration;
      uiManager.updateBoosts(gameState.boostCount);
    }
  });
  
  // Handle reset
  inputManager.onReset(() => {
    // Find nearest barrier and push truck away from it
    let nearestBarrier = null;
    let nearestDistance = Infinity;
    
    scene.meshes.forEach(mesh => {
      if (mesh.physicsBody && (mesh.name.includes("concrete") || mesh.name.includes("hayBale"))) {
        const distance = Vector3.Distance(truck.mesh.position, mesh.position);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestBarrier = mesh;
        }
      }
    });
    
    if (nearestBarrier && nearestDistance < 10) {
      // Push truck away from nearest barrier
      const awayDirection = truck.mesh.position.subtract(nearestBarrier.position);
      awayDirection.y = 0;
      awayDirection.normalize();
      truck.mesh.position.addInPlace(awayDirection.scale(3)); // Push 3 units away
      truck.mesh.position.y += 5; // Lift truck up to drop back down
      truck.state.velocity.scaleInPlace(0); // Stop all velocity
    } else {
      // No nearby barrier, just lift and stop the truck
      truck.mesh.position.y += 5; // Lift truck up to drop back down
      truck.state.velocity.scaleInPlace(0);
    }
  });

  // -- Game loop --
  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    
    // Get movement input from InputManager
    const input = inputManager.getMovementInput();
    
    // Update truck physics
    const debugInfo = updateTruck(truck, input, dt, terrainManager, currentTrack);
    
    // Update managers
    barrierManager.update();
    
    // Update UI
    uiManager.updateDebugPanel(truck.state, debugInfo.terrainType);
    uiManager.updatePosition(truck.mesh.position);
    uiManager.setBoostActive(truck.state.boostActive);
    
    // Check for checkpoint passage
    const checkpointResult = checkpointManager.update(
      truck.mesh.position, 
      truck.state.velocity,
      gameState.lastCheckpointPassed
    );
    
    if (checkpointResult && checkpointResult.passed) {
      const newCount = gameState.incrementCheckpoint(checkpointResult.index);
      uiManager.updateCheckpoints(newCount);
      
      // Check if lap completed
      if (newCount === checkpointManager.getTotalCheckpoints()) {
        const lapCount = gameState.completeLap();
        uiManager.updateLaps(lapCount);
        uiManager.updateCheckpoints(0);
        checkpointManager.reset();
      }
    }
    
    // Update camera to follow truck
    cameraController.update(truck.mesh.position);
  });

  return scene;
}

createScene().then((scene) => {
  engine.runRenderLoop(() => scene.render());
});

window.addEventListener("resize", () => engine.resize());
