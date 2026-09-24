import { describe, it, expect } from 'vitest';
import {
  cleanText, cleanKey, cleanMaxClients, cleanLaps, cleanState,
  isValidLap, cleanTimeMs, takeToken, STATE_BURST, STATE_RATE,
} from '../server/validate.js';
import { makeRoom } from './helpers/drive-room.js';

describe('server validate helpers', () => {
  it('cleans display text', () => {
    expect(cleanText('  Ben\u0007  ', 'Racer')).toBe('Ben');
    expect(cleanText(42, 'Racer')).toBe('Racer');
    expect(cleanText('   ', 'Racer')).toBe('Racer');
    expect(cleanText('x'.repeat(100), 'Racer')).toHaveLength(24);
  });

  it('accepts filename-ish keys, rejects junk', () => {
    expect(cleanKey('dust_devil')).toBe('dust_devil');
    expect(cleanKey('My Track (2)')).toBe('My Track (2)');
    expect(cleanKey({ evil: true })).toBeNull();
    expect(cleanKey('')).toBeNull();
    expect(cleanKey('a\nb')).toBeNull();
    expect(cleanKey('k'.repeat(65))).toBeNull();
  });

  it('clamps room size and laps', () => {
    expect(cleanMaxClients(1e6, 8)).toBe(8);
    expect(cleanMaxClients(0, 8)).toBe(2);
    expect(cleanMaxClients('lots', 8)).toBe(8);
    expect(cleanLaps(NaN, 3)).toBe(3);
    expect(cleanLaps(1000, 3)).toBe(20);
    expect(cleanLaps(2.6, 3)).toBe(3);
  });

  it('whitelists truck state', () => {
    const s = cleanState({ x: 1, y: 2, z: 3, heading: 0.5, hack: 'x', vx: 1e9 });
    expect(s).toEqual({ x: 1, y: 2, z: 3, heading: 0.5, vx: 200, vy: 0, vz: 0 });
    expect(cleanState({ x: NaN, y: 0, z: 0, heading: 0 })).toBeNull();
    expect(cleanState({ x: 1e7, y: 0, z: 0, heading: 0 })).toBeNull();
    expect(cleanState({ x: '1', y: 0, z: 0, heading: 0 })).toBeNull();
    expect(cleanState(null)).toBeNull();
  });

  it('only accepts the next lap', () => {
    expect(isValidLap(1, 0, 3)).toBe(true);
    expect(isValidLap(3, 0, 3)).toBe(false); // skipping
    expect(isValidLap(1, 1, 3)).toBe(false); // replay
    expect(isValidLap(4, 3, 3)).toBe(false); // past the end
    expect(isValidLap(1.5, 0, 3)).toBe(false);
  });

  it('sanity-checks times', () => {
    expect(cleanTimeMs(61234)).toBe(61234);
    expect(cleanTimeMs(-5)).toBeNull();
    expect(cleanTimeMs(Infinity)).toBeNull();
    expect(cleanTimeMs('fast')).toBeNull();
  });

  it('rate-limits with a token bucket', () => {
    const b = {};
    let ok = 0;
    for (let i = 0; i < 50; i++) if (takeToken(b, 0)) ok++;
    expect(ok).toBe(STATE_BURST); // a burst at one instant
    ok = 0;
    for (let t = 1; t <= 1000; t++) if (takeToken(b, t)) ok++; // 1 kHz flood for 1 s
    expect(ok).toBeLessThanOrEqual(STATE_RATE + 1);
    const steady = {};
    let sent = 0, tries = 0;
    for (let t = 0; t < 10000; t += 1000 / 15, tries++) sent += takeToken(steady, t) ? 1 : 0; // real 15 Hz
    expect(sent).toBe(tries); // a well-behaved client never loses an update
  });
});


describe('DriveRoom input hygiene', () => {
  it('sanitises create options', () => {
    const { room } = makeRoom({ maxClients: 9999, laps: 'x', name: { a: 1 }, trackKey: 5 });
    expect(room.maxClients).toBe(8);
    expect(room.settings.laps).toBe(3);
    expect(room.metadata.name).toBe('Lobby');
    expect(room.settings.trackKey).toBeNull();
  });

  it('relays only whitelisted state fields', () => {
    const { room, sent, client, msg } = makeRoom();
    const a = client('a');
    room.onJoin(a, { playerName: 'A' });
    sent.length = 0;
    msg(a, 'state', { x: 1, y: 2, z: 3, heading: 0, __proto__: null, admin: true });
    expect(sent[0].payload).toEqual({ id: 'a', x: 1, y: 2, z: 3, heading: 0, vx: 0, vy: 0, vz: 0 });
    msg(a, 'state', { x: 'nope', y: 0, z: 0, heading: 0 });
    expect(sent).toHaveLength(1);
  });

  it('rejects lap skipping and early finishes', () => {
    const { room, client, msg } = makeRoom({ laps: 2 });
    const a = client('a');
    room.onJoin(a, {});
    msg(a, 'start');
    msg(a, 'finished', { totalTimeMs: 1000 });
    expect(room.race.get('a').finished).toBe(false);
    msg(a, 'lapCompleted', { lap: 2 });
    expect(room.race.get('a').lap).toBe(0);
    msg(a, 'lapCompleted', { lap: 1 });
    msg(a, 'lapCompleted', { lap: 2 });
    msg(a, 'finished', { totalTimeMs: 90000, fastestLapMs: 'x' });
    const p = room.race.get('a');
    expect(p.finished).toBe(true);
    expect(p.totalTimeMs).toBe(90000);
    expect(p.fastestLapMs).toBeNull();
  });
});
