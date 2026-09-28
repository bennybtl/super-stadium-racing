import {
  Vector3,
  MeshBuilder,
  VertexBuffer,
  PhysicsAggregate,
  PhysicsShapeType,
  HavokPlugin,
} from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import { TerrainManager } from "../world/terrain.js";
import { applySteepGrassTerrainRemap, applySteepWaterTerrainRemap } from "../world/terrain-utils.js";
import { DriveSurfaceManager } from "../managers/DriveSurfaceManager.js";
import { CheckpointManager } from "../managers/CheckpointManager.js";
import { WallManager } from "../managers/WallManager.js";
import { ObstacleManager } from "../managers/ObstacleManager.js";
import { PickupManager } from "../managers/PickupManager.js";
import { BridgeMeshManager } from "../managers/BridgeMeshManager.js";
import { TunnelManager } from "../managers/TunnelManager.js";
import { SteepSlopeColliderManager } from "../managers/SteepSlopeColliderManager.js";
import { buildBorderWalls } from "../objects/BorderWall.js";
import { buildOutskirts } from "../objects/Outskirts.js";

/**
 * The simulation half of a track scene: everything the truck physics and race
 * rules touch — Havok, the terrain-type grid, the displaced ground, drive
 * surfaces, walls, checkpoints, obstacles, pickups, bridges, tunnels, steep-slope
 * blockers. No lights, shadows, textures, water, decorations or scatter; those
 * are SceneBuilder's buildScene (docs/MULTIPLAYER.md, Phase 1).
 *
 * The browser interleaves these with its visuals (the terrain textures need the
 * grid, and bridges want those textures for their material), so it calls the
 * two halves itself; a headless race calls buildSimScene().
 *
 * The managers still create meshes and materials — harmless under NullEngine —
 * but never require the visual-only arguments, which all default to null:
 *   shadows            ShadowCasterGroup the created meshes register with
 *   bridgeBlendConfig  terrain-blend textures for bridge/driveBox decks
 *   outskirtsMaterial  material for the outskirt plain beyond the ground
 */

/**
 * Enable Havok on `scene`. `havokOptions` goes to HavokPhysics() — Node passes
 * `{ wasmBinary }`, the browser fetches the WASM itself.
 */
export async function enableSimPhysics(scene, havokOptions = undefined) {
  const havok = await HavokPhysics(havokOptions);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
}

/**
 * Terrain-type grid, displaced ground mesh (registered as the canonical drive
 * surface, with a static MESH body), and the scene's DriveSurfaceManager.
 * Physics must already be enabled.
 */
export function buildSimTerrain(scene, track) {
  // Shared registry for all drivable surfaces (ground, bridges, ramps, etc.).
  const driveSurfaceManager = new DriveSurfaceManager(scene);
  scene.metadata = { ...(scene.metadata ?? {}), driveSurfaceManager };

  const terrainSize = Math.max(track.width ?? 160, track.depth ?? 160) + 20;
  const { width: groundWidth, depth: groundDepth, subdivisions } = track.getGroundLattice();

  // Use 1m terrain cells for the common case, then scale the cell size up for
  // larger tracks so terrain baking and lookup work do not grow without bound.
  const terrainResolutionTarget = 192;
  const terrainCellSize = terrainSize <= terrainResolutionTarget
    ? 1
    : Math.max(2, Math.ceil(terrainSize / terrainResolutionTarget));
  const terrainManager = new TerrainManager(terrainSize, terrainCellSize, groundWidth, groundDepth);
  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      const worldX = ((col + 0.5) / terrainManager.cellsPerSide) * groundWidth - groundWidth / 2;
      const worldZ = ((row + 0.5) / terrainManager.cellsPerSide) * groundDepth - groundDepth / 2;
      terrainManager.setTerrainCell(col, row, track.getTerrainTypeAt(worldX, worldZ));
    }
  }
  applySteepGrassTerrainRemap(terrainManager, track);
  applySteepWaterTerrainRemap(terrainManager, track);

  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: groundWidth, height: groundDepth, subdivisions },
    scene
  );
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] = track.getHeightAt(positions[i], positions[i + 2]);
  }
  ground.setVerticesData(VertexBuffer.PositionKind, positions);
  ground.createNormals(true);

  // Register as canonical drivable surface for TerrainQuery and nav layers.
  driveSurfaceManager.register(ground, { kind: "ground", lattice: track.getGroundLattice() });
  // MESH shape follows displaced vertices so dynamic objects land on real terrain
  new PhysicsAggregate(ground, PhysicsShapeType.MESH, { mass: 0 }, scene);

  return { driveSurfaceManager, terrainManager, ground, terrainSize, groundWidth, groundDepth };
}

/**
 * Walls (poly + perimeter), outskirts, checkpoints, obstacles, pickups,
 * tunnels, steep-slope blockers and bridge/driveBox decks, built from the
 * track's features. `terrain` is buildSimTerrain()'s result.
 */
export function buildSimFeatures(scene, track, terrain, {
  shadows = null,
  bridgeBlendConfig = null,
  outskirtsMaterial = null,
} = {}) {
  const { driveSurfaceManager } = terrain;

  // Ensure rigid wall boundaries block driving off-grid
  const wallManager = new WallManager(scene, track, shadows);
  // Perimeter walls follow the track's borderWall settings (on/off, thickness,
  // height, colour) — see src/objects/BorderWall.js. With the wall off, the
  // border terrain carries on to the horizon instead of ending at a visible edge.
  buildBorderWalls(scene, track, wallManager);
  buildOutskirts(scene, track, driveSurfaceManager, outskirtsMaterial);

  const checkpointManager = new CheckpointManager(scene, track, shadows);
  const obstacleManager = new ObstacleManager(scene, track, shadows);
  const pickupManager = new PickupManager(scene, track, shadows); // Pickups spawn lap-by-lap in RaceMode
  const bridgeMeshManager = new BridgeMeshManager(scene, track, shadows, driveSurfaceManager, bridgeBlendConfig);

  // Tunnels before the steep-slope blockers, which stay out of the bores the
  // tunnels publish (scene.metadata.tunnelBore).
  const tunnelManager = new TunnelManager(scene, track, driveSurfaceManager);
  tunnelManager.rebuild();
  const steepSlopeColliderManager = new SteepSlopeColliderManager(scene, track, {
    enabled: true,
    maxSlopeDeg: 60,
  });
  steepSlopeColliderManager.rebuild();
  checkpointManager.createCheckpoints();

  // Build bridge drive surfaces first so downstream terrain-following features
  // (poly walls/curbs) can sample across all bridge meshes in one pass.
  for (const feature of track.getFeatures()) {
    if (feature.type === "bridgeMesh" || feature.type === "driveBox") {
      bridgeMeshManager.create(feature);
    }
  }

  // Movable obstacles and poly walls/curbs.
  for (const feature of track.getFeatures()) {
    if (feature.type === "obstacle") {
      obstacleManager.createStack(feature);
    } else if (feature.type === "polyWall") {
      wallManager.createPolyWall(feature);
    } else if (feature.type === "polyCurb") {
      wallManager.createPolyCurb(feature);
    }
  }

  return {
    wallManager,
    checkpointManager,
    obstacleManager,
    pickupManager,
    bridgeMeshManager,
    tunnelManager,
    steepSlopeColliderManager,
  };
}

/** The whole simulation scene on an existing Scene (headless / server). */
export async function buildSimScene(scene, track, { havokOptions } = {}) {
  await enableSimPhysics(scene, havokOptions);
  const terrain = buildSimTerrain(scene, track);
  return { ...terrain, ...buildSimFeatures(scene, track, terrain) };
}
