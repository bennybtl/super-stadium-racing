import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from '@babylonjs/core';
import { RaceSimulation, DNF_GRACE_MS, NO_INPUT } from '../src/sim/RaceSimulation.js';
import { GameState } from '../src/managers/GameState.js';

const DT = 1 / 60;
const GATES = 3; // checkpoints 1..3, 3 is start/finish

/** A truck that doesn't move; the stub checkpoint manager decides crossings. */
function makeTruckData(id, isPlayer = false) {
  return {
    id,
    name: id,
    isPlayer,
    hasStarted: false,
    lapStartTime: null,
    gameState: new GameState(3),
    truck: {
      mesh: { position: new Vector3() },
      state: { velocity: new Vector3(), rubberBandSpeedMult: 1 },
      driver: null,
      updateSim: vi.fn(),
      teleportTo: vi.fn(),
    },
  };
}

/**
 * Checkpoint manager stub: `cross(id)` makes that truck pass its next gate on
 * the following step (start/finish first, then 1, 2, 3 per lap).
 */
function makeCheckpoints() {
  const pending = new Set();
  return {
    checkpointMeshes: [],
    cross: (id) => pending.add(id),
    update(_pos, _vel, lastPassed, id) {
      if (!pending.delete(id)) return null;
      return { passed: true, index: lastPassed === GATES - 1 && lastPassed !== 0 ? GATES : lastPassed + 1 };
    },
    resetForTruck() {},
    getTotalCheckpoints: () => GATES,
  };
}

function makeSim(trucks, events = {}) {
  const checkpoints = makeCheckpoints();
  const noop = { preUpdate() {}, update() {} };
  const sim = new RaceSimulation({
    trucks,
    track: { features: [] },
    terrainManager: { getTerrainAt: () => ({ gripMultiplier: 1 }) },
    checkpointManager: checkpoints,
    truckCollisionManager: noop,
    staticBodyCollisionManager: { update() {}, notifyTeleport() {} },
    obstacleManager: noop,
    pickupManager: { update() {}, spawnForLap() {} },
    totalLaps: 2,
    maxCheckpointNumber: GATES,
    getGridSpawn: () => ({ pos: new Vector3(), heading: 0 }),
    focusId: 'player',
    events,
  });
  return { sim, checkpoints };
}

/** Drive truck `id` through start/finish and `laps` full laps, one gate per step. */
function runLaps(sim, checkpoints, id, laps) {
  const crossings = 1 + laps * GATES;
  for (let i = 0; i < crossings; i++) {
    checkpoints.cross(id);
    sim.step(DT);
  }
}

describe('RaceSimulation', () => {
  it('primes trucks to cross start/finish first', () => {
    const td = makeTruckData('player', true);
    makeSim([td]);
    expect(td.gameState.lastCheckpointPassed).toBe(GATES - 1);
  });

  it('starts the clock on the first start-line crossing and counts laps', () => {
    const player = makeTruckData('player', true);
    const events = { onRaceStart: vi.fn(), onLap: vi.fn(), onFinish: vi.fn(), onRaceEnd: vi.fn() };
    const { sim, checkpoints } = makeSim([player], events);

    sim.step(DT);
    expect(sim.started).toBe(false);
    runLaps(sim, checkpoints, 'player', 2);

    expect(events.onRaceStart).toHaveBeenCalledTimes(1);
    expect(events.onLap).toHaveBeenCalledTimes(2);
    expect(events.onFinish).toHaveBeenCalledTimes(1);
    expect(events.onRaceEnd).toHaveBeenCalledWith([player]);
    expect(sim.ended).toBe(true);
    expect(player.gameState.lapTimes).toHaveLength(2);
    // Sim time only: 6 gate steps after the start at 3 steps per lap.
    expect(player.gameState.totalRaceTime).toBeCloseTo(6 * DT * 1000, 6);
  });

  it('passes the player input through and gives AI / finished trucks none', () => {
    const player = makeTruckData('player', true);
    const ai = makeTruckData('ai1');
    ai.truck.driver = {};
    const { sim } = makeSim([player, ai]);
    const gas = { forward: true, back: false, left: false, right: false };
    sim.step(DT, { player: gas });
    expect(player.truck.updateSim.mock.calls[0][0]).toBe(gas);
    expect(ai.truck.updateSim.mock.calls[0][0]).toBe(NO_INPUT);
  });

  it('DNFs the rest of the field when the grace after the first finish runs out', () => {
    const player = makeTruckData('player', true);
    const ai = makeTruckData('ai1');
    const onRaceEnd = vi.fn();
    const { sim, checkpoints } = makeSim([player, ai], { onRaceEnd });

    runLaps(sim, checkpoints, 'ai1', 2);
    expect(sim.dnfDeadlineMs).not.toBeNull();
    expect(onRaceEnd).not.toHaveBeenCalled();

    const steps = Math.ceil(DNF_GRACE_MS / 1000 / DT) + 1;
    for (let i = 0; i < steps && !sim.ended; i++) sim.step(DT);

    expect(onRaceEnd).toHaveBeenCalledTimes(1);
    expect(sim.finishOrder.map(td => td.id)).toEqual(['ai1', 'player']);
    expect(player.gameState.raceFinished).toBe(true);
    expect(player.gameState.totalRaceTime).toBeNull();
  });

  it('grants a collected nitro and announces pickups', () => {
    const player = makeTruckData('player', true);
    const onPickup = vi.fn();
    const onPickupSpawn = vi.fn();
    const { sim } = makeSim([player], { onPickup, onPickupSpawn });
    const before = player.gameState.boostCount;
    sim.pickupManager.onPickupCollected('boost', player, 2, 7);
    expect(player.gameState.boostCount).toBe(before + 2);
    expect(onPickup).toHaveBeenCalledWith(player, 'boost', 2, 7);
    sim.pickupManager.onPickupSpawned({ id: 8, position: { x: 1, z: 2 }, type: 'boost', value: 1 });
    expect(onPickupSpawn).toHaveBeenCalledWith({ id: 8, x: 1, z: 2, type: 'boost', value: 1 });
  });

  it('reset clears the race and re-primes the grid', () => {
    const player = makeTruckData('player', true);
    const { sim, checkpoints } = makeSim([player]);
    runLaps(sim, checkpoints, 'player', 2);
    sim.reset();
    expect(sim.started).toBe(false);
    expect(sim.ended).toBe(false);
    expect(sim.finishOrder).toHaveLength(0);
    expect(player.hasStarted).toBe(false);
    expect(player.gameState.lapCount).toBe(0);
    expect(player.gameState.lastCheckpointPassed).toBe(GATES - 1);
    expect(player.truck.teleportTo).toHaveBeenCalled();
  });
});
