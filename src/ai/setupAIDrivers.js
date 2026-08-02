import { AIDriver } from "./AIDriver.js";
import { Truck } from "../truck/truck.js";
import { GameState } from "../managers/GameState.js";
import { TelemetryPlayer } from "../managers/TelemetryPlayer.js";
import { basicColors } from "../constants.js";
/**
 * AI driver colour palette keys — cycled through for each AI slot.
 */
export const AI_COLOR_KEYS = [
  'blue',
  'yellow',
  'gray',
  'white',
  'cyan',
  'magenta',
  'orange',
  'red',
  'green',
  'black',
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
 * @param {Function} [opts.getAIDriver]  (i) => AIDriver instance (optional preset factory)
 * @param {string}   opts.trackKey       Track key for telemetry lookup.
 * @param {string}   [opts.aiVehicleKey] Vehicle key for AI trucks, or 'random'.
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
  getAIDriver,
  getAIColorKey = null,
  getAIVehicleKey = null,
  getAIUpgrades = null,
  getAIGridSlot = null,
  trackKey,
  aiVehicleKey = 'random',
  telemetryCheckpoints,
  excludeColorKey = null,
}) {
  // Grid slot 0 is reserved for the player; AI starts at slot 1.
  const AI_GRID_OFFSET = 1;

  // ── Create drivers and trucks ──────────────────────────────────────────
  const aiDrivers = [];
  const aiTrucks  = [];

  const availableAIColors = AI_COLOR_KEYS
    .filter(key => key !== excludeColorKey)
    .map(key => basicColors[key]?.diffuse)
    .filter(Boolean);

  const availableAIVehicleKeys = window.vehicleLoader?.getVehicleList?.().map(vehicle => vehicle.key) ?? [];
  const selectedAIVehicleDef = aiVehicleKey !== 'random'
    ? window.vehicleLoader?.getVehicle(aiVehicleKey) ?? null
    : null;

  for (let i = 0; i < count; i++) {
    const skillConfig = getAISkill(i);
    const presetDriver = typeof getAIDriver === 'function' ? getAIDriver(i) : null;
    const driver = presetDriver ?? new AIDriver(
      currentTrack,
      checkpointManager,
      wallManager,
      scene,
      skillConfig,
    );

    // A caller (e.g. a championship) may pin each AI's colour/vehicle for a
    // stable identity; otherwise fall back to the cycling palette / random pick.
    const overrideColorKey = typeof getAIColorKey === 'function' ? getAIColorKey(i) : null;
    const color = (overrideColorKey && basicColors[overrideColorKey]?.diffuse)
      ? basicColors[overrideColorKey].diffuse
      : availableAIColors[i % availableAIColors.length];
    // Championship grids order by standings; otherwise AI fill slots behind the
    // player (grid slot 0 is the player).
    const gridSlot = typeof getAIGridSlot === 'function' ? getAIGridSlot(i) : (AI_GRID_OFFSET + i);
    const spawn  = getGridSpawn(gridSlot);
    let aiVehicleDef = selectedAIVehicleDef;
    const overrideVehicleKey = typeof getAIVehicleKey === 'function' ? getAIVehicleKey(i) : null;
    if (overrideVehicleKey) {
      aiVehicleDef = window.vehicleLoader?.getVehicle(overrideVehicleKey) ?? aiVehicleDef;
    }
    if (!aiVehicleDef && availableAIVehicleKeys.length > 0) {
      const randomVehicleKey = availableAIVehicleKeys[Math.floor(Math.random() * availableAIVehicleKeys.length)];
      aiVehicleDef = window.vehicleLoader?.getVehicle(randomVehicleKey) ?? null;
    }
    if (!aiVehicleDef) aiVehicleDef = vehicleDef;

    const aiUpgrades = typeof getAIUpgrades === 'function' ? getAIUpgrades(i) : null;
    const truck  = new Truck(scene, shadows, color, driver, aiVehicleDef, aiUpgrades);
    truck.mesh.position.copyFrom(spawn.pos);
    truck.state.heading   = spawn.heading;
    truck.mesh.rotation.y = spawn.heading;

    driver.setTruck(truck);

    aiDrivers.push(driver);
    aiTrucks.push({ driver, truck, spawn, gridSlot });
  }

  // ── Cross-awareness: each driver knows about every other truck ─────────
  // playerTruck is null in AI-only fields (the attract-mode demo), so drop it.
  const allOtherTrucksFor = (driverIndex) => [
    playerTruck,
    ...aiTrucks
      .filter((_, j) => j !== driverIndex)
      .map(t => t.truck),
  ].filter(Boolean);

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
  const aiTruckDataList = aiTrucks.map(({ truck, gridSlot }, i) => ({
    truck,
    gameState: new GameState(truck.state.maxBoosts ?? 5),
    isPlayer: false,
    name: getAIName(i),
    id:   getAIId(i),
    gridSlot,
    hasStarted: false,
  }));

  return { aiTruckDataList, aiDrivers };
}
