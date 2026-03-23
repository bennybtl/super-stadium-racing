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
import { MenuManager } from "./managers/MenuManager.js";
import { AIDriver } from "./ai/AIDriver.js";

const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true);

// Create MenuManager once globally (not recreated with scene)
const menuManager = new MenuManager();

// Create a global input state (will be connected to InputManager instances)
let globalInputManager = null;

// Race state
let raceStarted = false;
let raceStartTime = null;
let totalLaps = 3; // Will be set from menu selection
let lapStartTime = null;

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
  const trackKey = window.selectedTrack || 'hills';
  totalLaps = window.selectedLaps || 3;
  const currentTrack = EXAMPLE_TRACKS[trackKey]();
  
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

  // -- Initialize Managers (needed before creating trucks) --
  const checkpointManager = new CheckpointManager(scene, currentTrack, shadows);
  const barrierManager = new BarrierManager(scene, currentTrack, shadows);
  
  // Create track features
  checkpointManager.createCheckpoints();
  barrierManager.createBarriers();

  // -- AI Driver --
  const aiDriver = new AIDriver(currentTrack, checkpointManager, barrierManager, scene);

  // -- Trucks --
  const playerTruck = createTruck(scene, shadows); // Player truck
  const aiTruck1 = createTruck(scene, shadows, aiDriver); // AI truck
  
  // Position AI truck slightly offset
  aiTruck1.mesh.position.x = 3;
  aiTruck1.mesh.position.z = 3;

  // -- Truck State Management --
  const trucks = [
    {
      truck: playerTruck,
      gameState: new GameState(playerTruck.state.maxBoosts),
      isPlayer: true,
      name: 'Player',
      id: 'player'
    },
    {
      truck: aiTruck1,
      gameState: new GameState(0), // AI doesn't use boosts
      isPlayer: false,
      name: 'AI 1',
      id: 'ai1'
    }
  ];
  
  const playerTruckData = trucks[0]; // Reference for player-specific operations

  // -- Initialize UI Managers --
  // Note: menuManager is global, created once
  const uiManager = new UIManager();
  
  // Initialize lap display with total laps
  uiManager.updateLaps(0, totalLaps);
  
  // -- Input Manager --
  // Dispose old input manager if it exists to remove old event listeners
  if (globalInputManager) {
    globalInputManager.dispose();
  }
  
  const inputManager = new InputManager(playerTruckData.truck, cameraController);
  globalInputManager = inputManager;
  
  // Handle pause/menu toggle
  inputManager.onPause(() => {
    menuManager.togglePause();
  });
  
  // Handle boost activation
  inputManager.onBoost(() => {
    if (playerTruckData.gameState.useBoost() && !playerTruckData.truck.state.boostActive) {
      playerTruckData.truck.state.boostActive = true;
      playerTruckData.truck.state.boostTimer = playerTruckData.truck.state.boostDuration;
      uiManager.updateBoosts(playerTruckData.gameState.boostCount);
    }
  });
  
  // Function to reset game state
  const resetGame = () => {
    // Reset race state
    raceStarted = false;
    raceStartTime = null;
    lapStartTime = null;
    uiManager.hideRaceTimer();
    
    // Reset all trucks
    trucks.forEach((truckData, index) => {
      const offsetX = index * 3;
      const offsetZ = index * 3;
      
      truckData.truck.mesh.position = new Vector3(offsetX, 5, offsetZ);
      truckData.truck.state.velocity = Vector3.Zero();
      truckData.truck.state.verticalVelocity = 0;
      truckData.truck.state.heading = 0;
      truckData.truck.state.boostActive = false;
      truckData.truck.state.boostTimer = 0;
      truckData.gameState.reset();
    });
    
    // Reset AI driver path following
    if (aiDriver) {
      aiDriver.reset();
    }
    
    // Reset managers
    checkpointManager.reset();
    barrierManager.reset();
    
    // Update UI
    uiManager.updateBoosts(playerTruckData.gameState.boostCount);
    uiManager.updateLaps(0, totalLaps);
    uiManager.updateCheckpoints(0);
  };
  
  // Handle reset
  inputManager.onReset(() => {
    resetGame();
  });
  
  // Store scene-specific reset function globally so menu can access it
  window.currentResetGame = resetGame;
  
  // Old reset handler - now using resetGame function
  /*
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
  */

  // -- Game loop --
  scene.onBeforeRenderObservable.add(() => {
    // Skip game updates if paused or menu is active
    if (menuManager.isMenuActive()) {
      return;
    }
    
    const dt = engine.getDeltaTime() / 1000;
    
    // Update race timer if race has started
    if (raceStarted && raceStartTime !== null) {
      const elapsedTime = Date.now() - raceStartTime;
      uiManager.updateTimer(elapsedTime);
    }
    
    // Get movement input from InputManager (for player only)
    const input = inputManager.getMovementInput();
    
    // Update all trucks (skip finished ones)
    trucks.forEach((truckData) => {
      if (truckData.gameState.raceFinished) {
        return; // Don't update finished trucks
      }
      const truckInput = truckData.isPlayer ? input : { forward: false, back: false, left: false, right: false };
      updateTruck(truckData.truck, truckInput, dt, terrainManager, currentTrack);
    });
    
    // Update managers
    barrierManager.update();
    
    // Update UI with player truck info
    const playerDebugInfo = trucks[0].truck._truckInstance.state;
    uiManager.updateDebugPanel(playerTruckData.truck.state, terrainManager.getTerrainAt(
      playerTruckData.truck.mesh.position.x,
      playerTruckData.truck.mesh.position.z
    ));
    uiManager.updatePosition(playerTruckData.truck.mesh.position);
    uiManager.setBoostActive(playerTruckData.truck.state.boostActive);
    
    // Check checkpoint passage for all trucks
    trucks.forEach((truckData) => {
      // Skip updates for finished trucks
      if (truckData.gameState.raceFinished) {
        return;
      }
      
      const checkpointResult = checkpointManager.update(
        truckData.truck.mesh.position,
        truckData.truck.state.velocity,
        truckData.gameState.lastCheckpointPassed,
        truckData.id
      );
      
      if (checkpointResult && checkpointResult.passed) {
        // Start race when first truck passes first checkpoint
        if (!raceStarted && checkpointResult.index === 1) {
          raceStarted = true;
          raceStartTime = Date.now();
          lapStartTime = Date.now();
          uiManager.showRaceTimer();
          console.log('Race started!');
        }
        
        const newCount = truckData.gameState.incrementCheckpoint(checkpointResult.index);
        
        // Update UI for player only
        if (truckData.isPlayer) {
          uiManager.updateCheckpoints(newCount);
        } else {
          console.log(`[${truckData.name}] Passed checkpoint ${checkpointResult.index}, count: ${newCount}/${checkpointManager.getTotalCheckpoints()}`);
        }
        
        // Check if lap completed
        if (newCount === checkpointManager.getTotalCheckpoints()) {
          const currentTime = Date.now();
          const lapTime = lapStartTime ? currentTime - lapStartTime : 0;
          lapStartTime = currentTime; // Start timing next lap
          
          const lapCount = truckData.gameState.completeLap(lapTime);
          
          // Reset checkpoints for this specific truck
          checkpointManager.resetForTruck(truckData.id);
          
          if (truckData.isPlayer) {
            uiManager.updateLaps(lapCount, totalLaps);
            uiManager.updateCheckpoints(0);
            console.log(`Lap ${lapCount} completed in ${(lapTime / 1000).toFixed(2)}s`);
          } else {
            console.log(`[${truckData.name}] Completed lap ${lapCount} in ${(lapTime / 1000).toFixed(2)}s!`);
          }
          
          // Check if race is finished
          if (lapCount >= totalLaps) {
            const totalTime = currentTime - raceStartTime;
            truckData.gameState.finishRace(totalTime);
            
            // Stop the truck
            truckData.truck.state.velocity = Vector3.Zero();
            truckData.truck.state.verticalVelocity = 0;
            
            if (truckData.isPlayer) {
              console.log('\n=== RACE FINISHED ===');
              console.log(`Total Time: ${(totalTime / 1000).toFixed(2)}s`);
              console.log('Lap Times:');
              truckData.gameState.lapTimes.forEach((time, i) => {
                console.log(`  Lap ${i + 1}: ${(time / 1000).toFixed(2)}s`);
              });
            } else {
              console.log(`[${truckData.name}] Finished race! Total time: ${(totalTime / 1000).toFixed(2)}s`);
            }
          }
        }
      }
    });
    
    // Update camera to follow player truck
    cameraController.update(playerTruckData.truck.mesh.position);
  });

  return scene;
}

// Setup menu callbacks once (outside createScene)
menuManager.onStartGame = () => {
  // Store selected track and laps globally
  window.selectedTrack = menuManager.selectedTrack;
  window.selectedLaps = menuManager.selectedLaps;
  menuManager.gameStarted = true;
  menuManager.hideMenu();
  
  // Recreate scene with selected track
  engine.stopRenderLoop();
  createScene().then(newScene => {
    engine.runRenderLoop(() => {
      newScene.render();
    });
  });
};

menuManager.onResume = () => {
  menuManager.hideMenu();
};

menuManager.onReset = () => {
  if (window.currentResetGame) {
    window.currentResetGame();
  }
  menuManager.hideMenu();
};

menuManager.onExit = () => {
  menuManager.gameStarted = false;
  menuManager.showStartMenu();
  if (window.currentResetGame) {
    window.currentResetGame();
  }
};

createScene().then((scene) => {
  engine.runRenderLoop(() => scene.render());
});

window.addEventListener("resize", () => engine.resize());
