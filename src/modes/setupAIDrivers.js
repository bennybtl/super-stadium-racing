import { Color3 } from "@babylonjs/core";
import { AIDriver } from "../ai/AIDriver.js";
import { Truck } from "../truck/truck.js";
import { GameState } from "../managers/GameState.js";
import { TelemetryPlayer } from "../managers/TelemetryPlayer.js";

/**
 * AI driver colour palette — cycled through for each AI slot.
 */
const AI_COLORS = [
  new Color3(0.2, 0.2, 0.8), // blue
  new Color3(0.8, 0.8, 0.2), // yellow
  new Color3(0.3, 0.3, 0.3), // grey
  new Color3(0.9, 0.9, 0.9), // white
  new Color3(0.2, 0.8, 0.8), // cyan
  new Color3(0.8, 0.2, 0.8), // magenta
  new Color3(0.8, 0.5, 0.2), // orange
  new Color3(0.8, 0.2, 0.2), // red
  new Color3(0.2, 0.8, 0.2), // green
  new Color3(0.1, 0.1, 0.1), // black
];

/**
 * Create and fully wire up N AI drivers + trucks for a race.
 *
 * @param {object} opts
 * @param {number}   opts.count          Number of AI competitors to create.
 * @param {object}   opts.scene          Babylon scene.
 * @param {object}   opts.shadows        ShadowGenerator (passed to Truck).
 * @param {object}   opts.currentTrack   Loaded track object.
 * @param {object}   opts.checkpointManager
 * @param {object}   opts.wallManager
 * @param {object}   opts.vehicleDef     Vehicle definition (shared with player).
 * @param {object}   opts.playerTruck    Player's Truck instance (for avoidance awareness).
 * @param {Function} opts.getGridSpawn   (index) => { pos: Vector3, heading: number }
 * @param {Function} opts.getAIName      (i) => string
 * @param {Function} opts.getAIId        (i) => string
 * @param {Function} opts.getAISkill     (i) => skillConfig object
 * @param {string}   opts.trackKey       Track key for telemetry lookup.
 * @param {Array}    opts.telemetryCheckpoints  Checkpoint list for telemetry replay.
 *
 * @returns {{ aiTruckDataList: Array, aiDrivers: Array }}
 *   aiTruckDataList — ready-to-push entries for the `trucks` array (without the player).
 *   aiDrivers       — raw AIDriver instances (for pause/unpause during countdown).
 */
export function setupAIDrivers({
  count,
  scene,
  shadows,
  currentTrack,
  checkpointManager,
  wallManager,
  vehicleDef,
  playerTruck,
  getGridSpawn,
  getAIName,
  getAIId,
  getAISkill,
  trackKey,
  telemetryCheckpoints,
}) {
  // Grid slot 0 is reserved for the player; AI starts at slot 1.
  const AI_GRID_OFFSET = 1;

  // ── Create drivers and trucks ──────────────────────────────────────────
  const aiDrivers = [];
  const aiTrucks  = [];

  for (let i = 0; i < count; i++) {
    const driver = new AIDriver(
      currentTrack,
      checkpointManager,
      wallManager,
      scene,
      getAISkill(i),
    );

    const color  = AI_COLORS[i % AI_COLORS.length];
    const spawn  = getGridSpawn(AI_GRID_OFFSET + i);
    const truck  = new Truck(scene, shadows, color, driver, vehicleDef);
    truck.mesh.position.copyFrom(spawn.pos);
    truck.state.heading   = spawn.heading;
    truck.mesh.rotation.y = spawn.heading;

    driver.setTruck(truck);

    aiDrivers.push(driver);
    aiTrucks.push({ driver, truck, spawn });
  }

  // ── Cross-awareness: each driver knows about every other truck ─────────
  const allOtherTrucksFor = (driverIndex) => [
    playerTruck,
    ...aiTrucks
      .filter((_, j) => j !== driverIndex)
      .map(t => t.truck),
  ];

  aiDrivers.forEach((driver, i) => {
    driver.setOtherTrucks(allOtherTrucksFor(i));
  });

  // ── Build precomputed paths ────────────────────────────────────────────
  aiTrucks.forEach(({ driver, spawn }) => {
    driver.calculateFullPath({ x: spawn.pos.x, z: spawn.pos.z });
  });

  // ── Load telemetry for any driver that can use it ──────────────────────
  const savedTelemetry = window._telemetryStore?.[trackKey] ?? null;
  if (savedTelemetry && telemetryCheckpoints?.length) {
    const player = new TelemetryPlayer(trackKey, telemetryCheckpoints);
    if (player.loadFromObject(savedTelemetry)) {
      const waypoints = player.buildWaypoints();
      aiDrivers.forEach(driver => driver.loadTelemetry(waypoints));
    }
  }

  // ── Build truckData entries (ready for the `trucks` array) ────────────
  const aiTruckDataList = aiTrucks.map(({ truck }, i) => ({
    truck,
    gameState: new GameState(0),
    isPlayer: false,
    name: getAIName(i),
    id:   getAIId(i),
    hasStarted: false,
  }));

  return { aiTruckDataList, aiDrivers };
}
