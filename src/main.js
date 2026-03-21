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
  const CAM_OFFSET = new Vector3(0, 28, -20);
  const camera = new FreeCamera("cam", CAM_OFFSET.clone(), scene);
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
  const currentTrack = EXAMPLE_TRACKS.bankedTurn();
  
  // Can save track to JSON
  console.log("Track JSON:", currentTrack.toJSON());
  
  // Can load track from JSON
  // const loadedTrack = Track.fromJSON(jsonString);

  // -- Terrain System --
  const terrainManager = new TerrainManager(80, 2);
  
  // Apply track terrain types to terrain manager
  // Sample the track at each terrain grid cell
  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      const worldX = (col - terrainManager.cellsPerSide / 2) * terrainManager.cellSize;
      const worldZ = (row - terrainManager.cellsPerSide / 2) * terrainManager.cellSize;
      
      const terrainType = currentTrack.getTerrainTypeAt(worldX, worldZ);
      if (terrainType) {
        terrainManager.setTerrainCell(col, row, terrainType);
      }
    }
  }

  // -- Ground --
  const ground = MeshBuilder.CreateGround("ground", { width: 80, height: 80, subdivisions: 80 }, scene);
  
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
    updateTruck(truck, input, dt, terrainManager);
    
    // Simple gravity
    const gravity = -30;
    truck.state.verticalVelocity += gravity * dt;
    
    // Move truck vertically
    truck.mesh.position.y += truck.state.verticalVelocity * dt;
    
    // Check ground collision
    const terrainHeight = currentTrack.getHeightAt(truck.mesh.position.x, truck.mesh.position.z);
    const truckBottomY = terrainHeight + 0.4; // 0.4 = half truck height
    
    // If on or near ground - relaxed threshold to allow easier takeoff
    if (truck.mesh.position.y <= truckBottomY + 0.2) {
      truck.mesh.position.y = Math.max(truck.mesh.position.y, truckBottomY);
      truck.state.onGround = true;
      
      // Calculate terrain slope in direction of travel (only when on ground)
      const forward = new Vector3(Math.sin(truck.state.heading), 0, Math.cos(truck.state.heading));
      const slopeCheckDist = 0.3;
      const heightAhead = currentTrack.getHeightAt(
        truck.mesh.position.x + forward.x * slopeCheckDist,
        truck.mesh.position.z + forward.z * slopeCheckDist
      );
      const heightBehind = currentTrack.getHeightAt(
        truck.mesh.position.x - forward.x * slopeCheckDist,
        truck.mesh.position.z - forward.z * slopeCheckDist
      );
      const terrainSlopeAngle = Math.atan2(heightAhead - heightBehind, slopeCheckDist * 2);
      
      // Convert horizontal velocity to vertical based on terrain slope
      const horizontalSpeed = truck.state.velocity.length();
      let expectedVerticalVelocity = horizontalSpeed * Math.sin(terrainSlopeAngle);
      
      // Amplify upward slopes (for jumping) but stick harder to downward slopes
      if (terrainSlopeAngle > 0) {
        // Going uphill - amplify for better jumping
        expectedVerticalVelocity *= 1.4;
      } else {
        // Going downhill - add extra downward force to stick to terrain
        expectedVerticalVelocity *= 2.8;
      }
      
      // Set vertical velocity to follow terrain, with some bounce on hard impacts
      if (truck.state.verticalVelocity < -2) {
        // Hard landing - bounce with suspension (relaxed from -5)
        const bounceAmount = Math.abs(truck.state.verticalVelocity) * 0.25;
        truck.state.verticalVelocity = bounceAmount;
        truck.state.suspensionCompression = -0.2;
        truck.state.suspensionVelocity = bounceAmount;
      } else {
        // Normal ground contact - follow terrain
        truck.state.verticalVelocity = expectedVerticalVelocity;
      }
      
      // Update pitch to match terrain slope
      truck.mesh.rotation.x = -terrainSlopeAngle; // Negative because forward is +Z
    } else {
      truck.state.onGround = false;
      // When in air, rotation.x is maintained from when truck left the ground
    }
    
    // Suspension visual spring (doesn't affect physics much)
    if (truck.state.onGround) {
      const suspensionStiffness = 80;
      const suspensionDamping = 10;
      const compressionForce = -truck.state.suspensionCompression * suspensionStiffness;
      const dampingForce = -truck.state.suspensionVelocity * suspensionDamping;
      truck.state.suspensionVelocity += (compressionForce + dampingForce) * dt;
      truck.state.suspensionCompression += truck.state.suspensionVelocity * dt;
      truck.state.suspensionCompression = Math.max(-0.25, Math.min(0.15, truck.state.suspensionCompression));
    } else {
      truck.state.suspensionCompression *= 0.95;
      truck.state.suspensionVelocity *= 0.95;
    }
    
    // Apply roll for leaning in turns
    truck.mesh.rotation.z = truck.state.currentRoll;
    
    // Slide the camera in the XZ plane to follow the truck, keeping the fixed offset
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
