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
import { Track } from "./track.js";
import { UIManager } from "./managers/UIManager.js";
import { GameState } from "./managers/GameState.js";
import { CameraController } from "./managers/CameraController.js";
import { InputManager } from "./managers/InputManager.js";
import { CheckpointManager } from "./managers/CheckpointManager.js";
import { WallManager } from "./managers/WallManager.js";
import { TireStackManager } from "./managers/TireStackManager.js";
import { MenuManager } from "./managers/MenuManager.js";
import { AIDriver } from "./ai/AIDriver.js";
import { TrackLoader } from "./managers/TrackLoader.js";
import { EditorController } from "./managers/EditorController.js";

const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true);

// Create MenuManager once globally (not recreated with scene)
const menuManager = new MenuManager();

// Create TrackLoader globally
const trackLoader = new TrackLoader();
window.trackLoader = trackLoader; // Make available to MenuManager

// Create a global input state (will be connected to InputManager instances)
let globalInputManager = null;
let globalEditorController = null;

// Race state
let raceStarted = false;
let raceStartTime = null;
let totalLaps = 3; // Will be set from menu selection
let lapStartTime = null;

// Editor state
let isEditorMode = false;

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
  // Create a track - load from JSON or create new
  const trackKey = window.selectedTrack || 'hills';
  totalLaps = window.selectedLaps || 3;
  isEditorMode = window.isEditorMode || false;
  
  let currentTrack;
  if (trackKey === 'new') {
    currentTrack = new Track('New Track');
  } else {
    currentTrack = trackLoader.getTrack(trackKey);
    if (!currentTrack) {
      console.warn(`Track ${trackKey} not found, creating empty track`);
      currentTrack = new Track(trackKey);
    }
  }
  
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
  groundMat.specularColor = new Color3(0.2, 0.2, 0.2 );   // no specular shine
  groundMat.specularPower = 10;
  
  // Generate texture from terrain grid with per-pixel dirt noise
  const texSize = 512;
  const groundTex = new DynamicTexture("groundTex", { width: texSize, height: texSize }, scene);
  const ctx = groundTex.getContext();
  const pixelsPerCell = texSize / terrainManager.cellsPerSide;
  
  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      const index = row * terrainManager.cellsPerSide + col;
      const color = terrainManager.grid[index].color;
      
      const baseR = Math.floor(color.r * 255);
      const baseG = Math.floor(color.g * 255);
      const baseB = Math.floor(color.b * 255);

      // Fill cell pixel-by-pixel with subtle noise for a dirt look
      const px = Math.ceil(pixelsPerCell);
      const x0 = Math.floor(col * pixelsPerCell);
      const y0 = Math.floor(row * pixelsPerCell);
      for (let py = 0; py < px; py++) {
        for (let pxx = 0; pxx < px; pxx++) {
          const n = (Math.random() - 0.5) * 18; // ±9 noise range
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
  // MESH shape follows the actual displaced vertices so dynamic objects (tires etc.)
  // land on the real terrain surface rather than a bounding box.
  new PhysicsAggregate(ground, PhysicsShapeType.MESH, { mass: 0 }, scene);

  // -- Initialize Managers (needed before creating trucks) --
  const checkpointManager = new CheckpointManager(scene, currentTrack, shadows);
  const wallManager = new WallManager(scene, currentTrack, shadows);
  const tireStackManager = new TireStackManager(scene, currentTrack, shadows);
  
  // Create track features
  checkpointManager.createCheckpoints();
  wallManager.createWalls();
  tireStackManager.createTireStacks();

  // -- AI Driver --
  const aiDriver1 = new AIDriver(currentTrack, checkpointManager, wallManager, scene);
  const aiDriver2 = new AIDriver(currentTrack, checkpointManager, wallManager, scene);

  // -- Trucks --
  const playerTruck = createTruck(scene, shadows); // Player truck
  const aiTruck1 = createTruck(scene, shadows, new Color3(0.2, 0.2, 0.8), aiDriver1); // AI truck
  const aiTruck2 = createTruck(scene, shadows, new Color3(0.9, 0.9, 0.9), aiDriver2); // AI truck
  
  // Set truck reference for AI respawn capability
  aiDriver1.setTruck(aiTruck1);
  aiDriver2.setTruck(aiTruck2);
  
  // Position AI truck slightly offset
  aiTruck1.mesh.position.x = 3;
  aiTruck1.mesh.position.z = 3;

  aiTruck1.mesh.position.x = 6;
  aiTruck1.mesh.position.z = 6;


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
    },
    {
      truck: aiTruck2,
      gameState: new GameState(0), // AI doesn't use boosts
      isPlayer: false,
      name: 'AI 2',
      id: 'ai2'
    }
  ];
  
  const playerTruckData = trucks[0]; // Reference for player-specific operations

  // -- Initialize UI Managers --
  // Note: menuManager is global, created once
  const uiManager = new UIManager();
  
  // Initialize lap display with total laps (only in game mode)
  if (!isEditorMode) {
    uiManager.updateLaps(0, totalLaps);
  }
  
  // -- Editor Controller or Input Manager --
  if (isEditorMode) {
    // Editor mode - camera controls
    if (globalEditorController) {
      globalEditorController.dispose();
    }
    
    const editorController = new EditorController(camera, scene);
    editorController.activate(currentTrack, checkpointManager, menuManager);
    globalEditorController = editorController;
    
    // Store current track for saving
    window.currentEditorTrack = currentTrack;
    window.currentEditorScene = scene;
    
    // Hide trucks and racing UI in editor mode
    playerTruck.mesh.setEnabled(false);
    aiTruck1.mesh.setEnabled(false);
    document.getElementById('checkpoint-display').style.display = 'none';
    document.getElementById('lap-display').style.display = 'none';
    document.getElementById('boost-display').style.display = 'none';
    
    console.log('[Editor] Track editor mode active');
  } else {
    // Game mode - truck controls
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
  }
  
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
    if (aiDriver1) {
      aiDriver1.reset();
    }
    if (aiDriver2) {
      aiDriver2.reset();
    }
    
    // Reset managers
    checkpointManager.reset();
    wallManager.reset();
    tireStackManager.reset();

    // Update UI
    uiManager.updateBoosts(playerTruckData.gameState.boostCount);
    uiManager.updateLaps(0, totalLaps);
    uiManager.updateCheckpoints(0);
  };
  
  // Handle reset (only in game mode)
  if (!isEditorMode && globalInputManager) {
    globalInputManager.onReset(() => {
      resetGame();
    });
  }
  
  // Store scene-specific reset function globally so menu can access it
  window.currentResetGame = resetGame;

  // -- Game loop --
  scene.onBeforeRenderObservable.add(() => {
    // Skip game updates if paused or menu is active
    if (menuManager.isMenuActive()) {
      return;
    }
    
    const dt = engine.getDeltaTime() / 1000;
    
    // Editor mode - update camera controller
    if (isEditorMode && globalEditorController) {
      globalEditorController.update(dt);
      return; // Skip game logic in editor mode
    }
    
    // Game mode updates below
    
    // Update race timer if race has started
    if (raceStarted && raceStartTime !== null) {
      const elapsedTime = Date.now() - raceStartTime;
      uiManager.updateTimer(elapsedTime);
    }
    
    // Get movement input from InputManager (for player only)
    const input = globalInputManager ? globalInputManager.getMovementInput() : { forward: false, back: false, left: false, right: false };
    
    // Pre-clamp wall-ward velocity before trucks move
    wallManager.preUpdate(trucks, dt);

    // Update all trucks (skip finished ones)
    trucks.forEach((truckData) => {
      if (truckData.gameState.raceFinished) {
        return; // Don't update finished trucks
      }
      // For player, use input from InputManager. For AI, pass empty input (truck will get AI input internally)
      const truckInput = truckData.isPlayer ? input : { forward: false, back: false, left: false, right: false };
      updateTruck(truckData.truck, truckInput, dt, terrainManager, currentTrack);
    });
    
    // Update managers
    wallManager.update(trucks);
    tireStackManager.update(trucks);
    
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
        
        // Notify AI driver if this is an AI truck
        if (!truckData.isPlayer && truckData.truck.aiDriver) {
          truckData.truck.aiDriver.onCheckpointPassed(
            checkpointResult.index,
            { x: truckData.truck.mesh.position.x, z: truckData.truck.mesh.position.z }
          );
        }
        
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

// Editor mode callbacks
menuManager.onStartEditor = () => {
  window.selectedTrack = menuManager.selectedTrack;
  window.isEditorMode = true;
  menuManager.editorMode = true;
  menuManager.hideMenu();
  
  // Recreate scene in editor mode
  engine.stopRenderLoop();
  createScene().then(newScene => {
    engine.runRenderLoop(() => {
      newScene.render();
    });
  });
};

menuManager.onEditorResume = () => {
  menuManager.hideMenu();
};

menuManager.onEditorSave = () => {
  if (window.currentEditorTrack) {
    const track = window.currentEditorTrack;
    trackLoader.downloadTrack(track);
    trackLoader.saveTrackToStorage(menuManager.selectedTrack || 'custom', track);
  }
  menuManager.hideMenu();
};

menuManager.onEditorExit = () => {
  window.isEditorMode = false;
  menuManager.editorMode = false;
  menuManager.gameStarted = false;
  menuManager.showStartMenu();
  
  // Return to start menu
  engine.stopRenderLoop();
  window.selectedTrack = 'hills';
  createScene().then(newScene => {
    engine.runRenderLoop(() => {
      newScene.render();
    });
  });
};

// Load tracks then start
trackLoader.loadAllTracks().then(() => {
  console.log('Tracks loaded, starting game');
  createScene().then((scene) => {
    engine.runRenderLoop(() => scene.render());
  });
});

window.addEventListener("resize", () => engine.resize());
