import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { RaceSupervisor } from '../server/lobbies/RaceSupervisor.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-race.mjs', import.meta.url));

/** Run one fake race; resolves with what the supervisor reported. */
function run(mode, { ports = [23000, 23000] } = {}) {
  return new Promise((resolve) => {
    const seen = { ready: null };
    const sup = new RaceSupervisor({
      portMin: ports[0],
      portMax: ports[1],
      childScript: FAKE,
      childEnv: { FAKE_MODE: mode },
      onReady: (id, port) => { seen.ready = port; },
      onFinished: (id, result) => setTimeout(() => resolve({ sup, ...seen, finished: result }), 150),
      onFailed: (id, reason) => setTimeout(() => resolve({ sup, ...seen, failed: reason }), 150),
    });
    sup.spawn({ raceId: 'ABCDE-x', trackKey: 't', laps: 1, seed: 5, players: [] });
  });
}

describe('RaceSupervisor', () => {
  it('reports a finished race and frees its port', async () => {
    const r = await run('finish');
    expect(r.ready).toBe(23000);
    expect(r.finished).toMatchObject({ reason: 'finished', seed: 5 });
    expect(r.sup.activeCount).toBe(0);
    expect(() => r.sup.spawn({ raceId: 'ABCDE-y', players: [] })).not.toThrow(); // port is free again
    r.sup.stopAll();
  });

  it('reports a crash as a failure', async () => {
    const r = await run('crash');
    expect(r.failed).toMatch(/exited \(3\)/);
    r.sup.stopAll();
  });

  it('kills a race whose tick stops advancing', async () => {
    const r = await run('stall');
    expect(r.failed).toBe('race process stalled');
    expect(r.sup.activeCount).toBe(0);
    r.sup.stopAll();
  }, 15_000);

  it('kills a race that stops heartbeating', async () => {
    const r = await run('silent');
    expect(r.failed).toBe('race process stopped heartbeating');
    r.sup.stopAll();
  }, 15_000);

  it('refuses to spawn with no free port', () => {
    const sup = new RaceSupervisor({ portMin: 1, portMax: 0, onReady() {}, onFinished() {}, onFailed() {} });
    expect(() => sup.spawn({ raceId: 'ABCDE-z', players: [] })).toThrow('no free race port');
    sup.stopAll();
  });
});
