import { Vector3 } from "@babylonjs/core";
import { Truck } from "../truck/truck.js";
import { GameState } from "../managers/GameState.js";
import { TruckCollisionManager } from "../managers/TruckCollisionManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { TRUCK_HALF_HEIGHT } from "../constants.js";
import { gridSlotXZ, DEFAULT_START_GRID, CHECKPOINT_GRID_BACK_OFFSET } from "../utils/start-grid.js";
import { buildSimScene } from "./sim-scene.js";
import { RaceSimulation } from "./RaceSimulation.js";
import { getStartFinishCheckpoint } from "./race-rules.js";

/**
 * A complete race with no rendering: sim scene + headless trucks on the grid +
 * a RaceSimulation. Used by the lobby server (server/lobby) and
 * `npm run check:determinism`. Every truck is human-driven — inputs arrive
 * through `sim.step(dt, inputsById)`.
 *
 * Grid: behind the start/finish gate in `players` order (a track's
 * startPosition marker isn't applied yet), trucks placed and parked.
 *
 * @param {object} o
 * @param {import('@babylonjs/core').Scene} o.scene   an empty scene (NullEngine)
 * @param {object}   o.track      Track instance (reverse already applied)
 * @param {{ id: string, name?: string, vehicleDef?: object, upgrades?: object }[]} o.players
 * @param {number}   o.laps
 * @param {number}   o.seed
 * @param {object}   [o.havokOptions]   passed to HavokPhysics() — `{ wasmBinary }` in Node
 * @param {number}   [o.respawnCooldownSec]
 * @param {object}   [o.events]         RaceSimulation event callbacks
 * @returns {Promise<{ sim: RaceSimulation, trucks: object[], world: object }>}
 */
export async function createRace({
  scene, track, players, laps, seed, havokOptions, respawnCooldownSec = 0, events = {},
}) {
  const world = await buildSimScene(scene, track, { havokOptions });

  const gate = getStartFinishCheckpoint(world.checkpointManager);
  const getGridSpawn = (index) => {
    const { x, z } = gate
      ? gridSlotXZ(index, {
        x: gate.centerX, z: gate.centerZ, heading: gate.heading,
        ...DEFAULT_START_GRID, backOffset: CHECKPOINT_GRID_BACK_OFFSET,
      })
      : { x: (index % 2) * 3, z: Math.floor(index / 2) * 3 };
    return { pos: new Vector3(x, track.getHeightAt(x, z) + TRUCK_HALF_HEIGHT, z), heading: gate?.heading ?? 0 };
  };

  const trucks = players.map((p, i) => {
    const truck = new Truck(scene, null, null, null, p.vehicleDef ?? null, p.upgrades ?? null, { headless: true });
    return {
      id: p.id,
      name: p.name ?? p.id,
      isPlayer: false,
      truck,
      gameState: new GameState(truck.state.maxBoosts),
      gridSlot: i,
      hasStarted: false,
      lapStartTime: null,
    };
  });

  const maxCheckpointNumber = world.checkpointManager.checkpointMeshes
    .reduce((mx, cp) => Math.max(mx, cp.feature.checkpointNumber ?? 0), 0);

  const sim = new RaceSimulation({
    ...world,
    trucks,
    track,
    truckCollisionManager: new TruckCollisionManager(),
    staticBodyCollisionManager: new StaticBodyCollisionManager(scene),
    totalLaps: laps,
    maxCheckpointNumber,
    startFinishCp: gate,
    getGridSpawn,
    seed,
    respawnCooldownSec,
    events,
  });
  sim.placeOnGrid({ parked: true });

  return { sim, trucks, world };
}
