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
  PhysicsMotionType,
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

  // -- Checkpoints --
  let checkpointCount = 0;
  let lapCount = 0;
  let lastCheckpointPassed = -1; // Track index of last checkpoint passed
  const checkpointMeshes = [];
  const hayBales = []; // Track hay bales to keep them at terrain level
  
  // Create visual representation for each checkpoint
  for (const feature of currentTrack.features) {
    if (feature.type === "checkpoint") {
      const terrainHeight = currentTrack.getHeightAt(feature.centerX, feature.centerZ);
      
      // Calculate positions for the two barrels
      const halfWidth = feature.width / 2;
      const perpX = Math.cos(feature.heading); // Perpendicular to heading
      const perpZ = -Math.sin(feature.heading);
      
      const pos1 = new Vector3(
        feature.centerX + perpX * halfWidth,
        terrainHeight + 1,
        feature.centerZ + perpZ * halfWidth
      );
      const pos2 = new Vector3(
        feature.centerX - perpX * halfWidth,
        terrainHeight + 1,
        feature.centerZ - perpZ * halfWidth
      );
      
      // Create barrels (cylinders)
      const barrel1 = MeshBuilder.CreateCylinder("barrel1", { height: 2, diameter: 1 }, scene);
      barrel1.position = pos1;
      const barrel2 = MeshBuilder.CreateCylinder("barrel2", { height: 2, diameter: 1 }, scene);
      barrel2.position = pos2;
      
      const barrelMat = new StandardMaterial("barrelMat", scene);
      barrelMat.diffuseColor = new Color3(0.8, 0.5, 0.1);
      barrel1.material = barrelMat;
      barrel2.material = barrelMat;
      
      // Create arrow mesh between barrels
      const arrowLength = feature.width - 2;
      const arrow = MeshBuilder.CreateBox("arrow", { width: arrowLength, height: 0.2, depth: 1.5 }, scene);
      arrow.position = new Vector3(feature.centerX, terrainHeight + 2.5, feature.centerZ);
      arrow.rotation.y = feature.heading;
      
      const arrowMat = new StandardMaterial("arrowMat", scene);
      arrowMat.diffuseColor = new Color3(1, 1, 0);
      arrowMat.emissiveColor = new Color3(0.3, 0.3, 0);
      arrow.material = arrowMat;
      
      // Create arrow head (triangle)
      const arrowHead = MeshBuilder.CreateCylinder("arrowHead", { 
        diameterTop: 0, 
        diameterBottom: 2, 
        height: 2 
      }, scene);
      arrowHead.rotation.x = Math.PI / 2;
      arrowHead.rotation.y = feature.heading;
      const forwardX = Math.sin(feature.heading);
      const forwardZ = Math.cos(feature.heading);
      arrowHead.position = new Vector3(
        feature.centerX + forwardX * (arrowLength / 2 + 1),
        terrainHeight + 2.5,
        feature.centerZ + forwardZ * (arrowLength / 2 + 1)
      );
      arrowHead.material = arrowMat;
      
      // Create checkpoint number display if numbered
      let numberPlane = null;
      if (feature.checkpointNumber !== null) {
        const planeSize = 3;
        numberPlane = MeshBuilder.CreatePlane("numberPlane", { size: planeSize }, scene);
        numberPlane.position = new Vector3(
          feature.centerX,
          terrainHeight + 4,
          feature.centerZ
        );
        numberPlane.billboardMode = 7; // Always face camera
        
        // Create dynamic texture for the number
        const numberTexture = new DynamicTexture("numberTexture", { width: 256, height: 256 }, scene);
        const ctx = numberTexture.getContext();
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, 256, 256);
        ctx.font = "bold 180px Arial";
        ctx.fillStyle = "yellow";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(feature.checkpointNumber.toString(), 128, 128);
        numberTexture.update();
        
        const numberMat = new StandardMaterial("numberMat", scene);
        numberMat.diffuseTexture = numberTexture;
        numberMat.emissiveTexture = numberTexture;
        numberMat.opacityTexture = numberTexture;
        numberPlane.material = numberMat;
      }
      
      checkpointMeshes.push({ feature, barrel1, barrel2, arrow, arrowHead, numberPlane });
    }
  }

  // -- Barriers --
  // Create visual and physics representation for barriers
  for (const feature of currentTrack.features) {
    if (feature.type === "concreteBarrier") {
      const terrainHeight = currentTrack.getHeightAt(feature.centerX, feature.centerZ);
      
      // Create concrete barrier mesh
      const barrier = MeshBuilder.CreateBox("concreteBarrier", {
        width: feature.length,
        height: feature.height,
        depth: 0.5
      }, scene);
      
      barrier.position = new Vector3(
        feature.centerX,
        terrainHeight + feature.height / 2,
        feature.centerZ
      );
      barrier.rotation.y = feature.heading;
      
      // Concrete material
      const concreteMat = new StandardMaterial("concreteMat", scene);
      concreteMat.diffuseColor = new Color3(0.6, 0.6, 0.6);
      concreteMat.specularColor = new Color3(0.2, 0.2, 0.2);
      barrier.material = concreteMat;
      barrier.receiveShadows = true;
      shadows.addShadowCaster(barrier);
      
      // Static physics body (immovable)
      new PhysicsAggregate(barrier, PhysicsShapeType.BOX, {
        mass: 0,
        restitution: 0.1,
        friction: 0.8
      }, scene);
    }
    
    if (feature.type === "hayBales") {
      const terrainHeight = currentTrack.getHeightAt(feature.centerX, feature.centerZ);
      
      // Create hay bale mesh
      const hayBale = MeshBuilder.CreateBox("hayBale", {
        width: feature.length,
        height: feature.height,
        depth: feature.depth,
      }, scene);
      
      hayBale.position = new Vector3(
        feature.centerX,
        terrainHeight + feature.height / 2,
        feature.centerZ
      );
      hayBale.rotation.y = feature.heading;
      
      // Hay material (golden yellow)
      const hayMat = new StandardMaterial("hayMat", scene);
      hayMat.diffuseColor = new Color3(0.8, 0.7, 0.3);
      hayMat.specularColor = new Color3(0.1, 0.1, 0.05);
      hayBale.material = hayMat;
      hayBale.receiveShadows = true;
      shadows.addShadowCaster(hayBale);
      
      // Dynamic physics body (can be pushed, but heavy and slow)
      const hayPhysics = new PhysicsAggregate(hayBale, PhysicsShapeType.BOX, {
        mass: 50, // Heavy so it's hard to push
        restitution: 0.1,
        friction: 2.5 // Very high friction makes it slow down quickly
      }, scene);
      
      // Set motion type to dynamic but keep them grounded
      hayPhysics.body.setMotionType(PhysicsMotionType.DYNAMIC);
      hayPhysics.body.setLinearDamping(3.0); // Heavy damping to stop sliding
      hayPhysics.body.setAngularDamping(5); // Prevent spinning
      
      // Keep hay bales at terrain level by locking Y position after physics
      hayBales.push({ mesh: hayBale, initialHeight: terrainHeight + feature.height / 2 });
      hayPhysics.body.setAngularDamping(2.0);
    }
  }

  // -- Input --
  const input = { forward: false, back: false, left: false, right: false };

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyW" || e.code === "ArrowUp")    input.forward = true;
    if (e.code === "KeyS" || e.code === "ArrowDown")  input.back    = true;
    if (e.code === "KeyA" || e.code === "ArrowLeft")  input.left    = true;
    if (e.code === "KeyD" || e.code === "ArrowRight") input.right   = true;
    
    // Reset truck position if stuck on wall
    if (e.code === "KeyR") {
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
    }
    
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
    
    // Check for checkpoint collisions
    for (let i = 0; i < checkpointMeshes.length; i++) {
      const checkpoint = checkpointMeshes[i];
      const feature = checkpoint.feature;
      
      // Check if this checkpoint is next in sequence (if numbered)
      let isNextInSequence = true;
      if (feature.checkpointNumber !== null) {
        // Must pass checkpoints in order: 1, 2, 3, 4, etc.
        const expectedNumber = checkpointCount + 1;
        isNextInSequence = feature.checkpointNumber === expectedNumber;
      }
      
      // Only allow triggering if it's not the last checkpoint that was passed AND it's next in sequence
      if (!feature.passed && i !== lastCheckpointPassed && isNextInSequence) {
        // Calculate if truck is crossing the checkpoint line
        const dx = truck.mesh.position.x - feature.centerX;
        const dz = truck.mesh.position.z - feature.centerZ;
        
        // Check if truck is within checkpoint width (perpendicular distance)
        const perpX = Math.cos(feature.heading);
        const perpZ = -Math.sin(feature.heading);
        const perpDist = Math.abs(dx * perpX + dz * perpZ);
        
        // Check if truck is near the checkpoint line (along the heading direction)
        const forwardX = Math.sin(feature.heading);
        const forwardZ = Math.cos(feature.heading);
        const forwardDist = dx * forwardX + dz * forwardZ;
        
        // Check if truck is moving in the correct direction (forward through the checkpoint)
        const velocityDotForward = truck.state.velocity.x * forwardX + truck.state.velocity.z * forwardZ;
        
        // Trigger only if truck is within width, crosses the line, AND moving in correct direction
        if (perpDist < feature.width / 2 && Math.abs(forwardDist) < 2 && velocityDotForward > 0) {
          feature.passed = true;
          checkpointCount++;
          lastCheckpointPassed = i; // Track this checkpoint
          
          // Visual feedback - change arrow color temporarily
          checkpoint.arrow.material.diffuseColor = new Color3(0, 1, 0);
          checkpoint.arrowHead.material.diffuseColor = new Color3(0, 1, 0);
          
          setTimeout(() => {
            checkpoint.arrow.material.diffuseColor = new Color3(1, 1, 0);
            checkpoint.arrowHead.material.diffuseColor = new Color3(1, 1, 0);
          }, 1000);
          
          // Update counter display
          document.getElementById('checkpoint-counter').textContent = checkpointCount;
        }
      }
    }
    
    // Check if all checkpoints are passed (lap completed)
    const totalCheckpoints = currentTrack.features.filter(f => f.type === 'checkpoint').length;
    if (checkpointCount === totalCheckpoints) {
      lapCount++;
      checkpointCount = 0;
      document.getElementById('lap-counter').textContent = lapCount;
      document.getElementById('checkpoint-counter').textContent = checkpointCount;
      
      // Reset all checkpoints for next lap
      for (const cp of checkpointMeshes) {
        cp.feature.passed = false;
      }
    }
    
    // Keep hay bales at terrain level
    for (const bale of hayBales) {
      bale.mesh.position.y = bale.initialHeight;
    }
    
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
