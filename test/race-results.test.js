import { describe, it, expect } from 'vitest';
import { buildRaceResultRows } from '../src/modes/race-results.js';

const truck = (id, { finished = true, time = null, fastest = null, vehicle = 'baja', color = { r: 1, g: 0, b: 0 } } = {}) => ({
  id,
  name: id.toUpperCase(),
  isPlayer: id === 'player',
  truck: { diffuseColor: color, vehicleDef: vehicle ? { id: vehicle } : null },
  gameState: { raceFinished: finished, totalRaceTime: time, fastestLap: fastest },
});

describe('buildRaceResultRows', () => {
  it('lists finishers in finish order, then non-finishers as DNF', () => {
    const p = truck('player', { time: 95000, fastest: 30000 });
    const a = truck('ai1', { time: 90000, fastest: 29000 });
    const b = truck('ai2', { finished: false });
    const rows = buildRaceResultRows([a, p], [p, a, b]);
    expect(rows.map(r => [r.id, r.finishPosition, r.dnf, r.totalRaceTimeMs])).toEqual([
      ['ai1', 1, false, 90000],
      ['player', 2, false, 95000],
      ['ai2', 3, true, null],
    ]);
    expect(rows[1]).toMatchObject({ name: 'PLAYER', isPlayer: true, fastestLapMs: 30000 });
  });

  it('carries vehicle key and colour as plain data for the podium', () => {
    const t = truck('ai1', { vehicle: 'rodeo', color: { r: 0.1, g: 0.2, b: 0.3 } });
    expect(buildRaceResultRows([t], [t])[0]).toMatchObject({ vehicleKey: 'rodeo', color: [0.1, 0.2, 0.3] });
    const bare = truck('ai2', { vehicle: null, color: null });
    expect(buildRaceResultRows([bare], [bare])[0]).toMatchObject({ vehicleKey: null, color: null });
  });

  it('marks trucks timed out by the DNF grace as DNF, after the real finishers', () => {
    // _handleDNF finishes stragglers with a null time and appends them to finishOrder.
    const winner = truck('ai1', { time: 90000 });
    const timedOut = truck('player', { time: null });
    const rows = buildRaceResultRows([winner, timedOut], [timedOut, winner]);
    expect(rows.map(r => [r.id, r.finishPosition, r.dnf])).toEqual([
      ['ai1', 1, false],
      ['player', 2, true],
    ]);
  });

  it('handles a race with no finishers', () => {
    const a = truck('ai1', { finished: false });
    expect(buildRaceResultRows([], [a])).toEqual([
      expect.objectContaining({ id: 'ai1', finishPosition: 1, dnf: true }),
    ]);
  });
});
