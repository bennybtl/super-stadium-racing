import { describe, it, expect, beforeEach } from 'vitest';
import { LobbyRegistry, LobbyError } from '../server/lobbies/LobbyRegistry.js';

let now;
let spawned;
let spawnError;
const make = () => new LobbyRegistry({
  spawnRace: (race) => { if (spawnError) throw spawnError; spawned.push(race); },
  isTrack: (k) => k === 'apple_river' || k === 'the_road',
  isVehicle: (k) => k === 'baja',
  now: () => now,
});

const err = (fn) => { try { fn(); } catch (e) { return e; } return null; };

beforeEach(() => {
  now = 1_000_000;
  spawned = [];
  spawnError = null;
});

describe('LobbyRegistry', () => {
  it('creates a lobby with the creator as host and validates settings', () => {
    const reg = make();
    const { code, playerId, secret } = reg.create({ trackKey: 'apple_river', laps: 99, player: { name: 'Ann', vehicleKey: 'baja' } });
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    const view = reg.view(code, secret);
    expect(view).toMatchObject({ hostId: playerId, you: playerId, laps: 20, status: 'waiting', race: null });
    expect(view.players).toEqual([{ id: playerId, name: 'Ann', vehicleKey: 'baja' }]);
    expect(err(() => reg.create({ trackKey: '../etc/passwd' }))).toMatchObject({ status: 400 });
  });

  it('never exposes secrets or tokens in views', () => {
    const reg = make();
    const { code, secret } = reg.create({ trackKey: 'apple_river' });
    const b = reg.join(code, { name: 'Bo' });
    reg.start(code, secret);
    reg.raceReady(spawned[0].raceId, 22001);
    const text = JSON.stringify(reg.view(code, b.secret));
    expect(text).not.toContain(secret);
    expect(text).not.toContain(spawned[0].players[0].token);
    expect(reg.view(code, b.secret).race).toEqual({ path: `/race/${spawned[0].raceId}`, token: spawned[0].players[1].token });
    expect(reg.view(code).race).toBeNull(); // no secret, no endpoint
  });

  it('only the host changes settings or starts; bad secrets are 401', () => {
    const reg = make();
    const { code, secret } = reg.create({ trackKey: 'apple_river' });
    const b = reg.join(code, {});
    expect(err(() => reg.start(code, b.secret))).toMatchObject({ status: 403 });
    expect(err(() => reg.updateSettings(code, b.secret, { laps: 2 }))).toMatchObject({ status: 403 });
    expect(err(() => reg.start(code, 'forged'))).toMatchObject({ status: 401 });
    reg.updateSettings(code, secret, { trackKey: 'the_road', laps: 5 });
    expect(reg.view(code)).toMatchObject({ trackKey: 'the_road', laps: 5 });
  });

  it('starts a race with a fresh token per player, then closes on the result', () => {
    const reg = make();
    const { code, secret } = reg.create({ trackKey: 'apple_river', laps: 2 });
    reg.join(code, { vehicleKey: 'nope' });
    reg.start(code, secret);
    expect(spawned).toHaveLength(1);
    const race = spawned[0];
    expect(race).toMatchObject({ trackKey: 'apple_river', laps: 2 });
    expect(race.players.map((p) => p.vehicleKey)).toEqual([null, null]);
    expect(new Set(race.players.map((p) => p.token)).size).toBe(2);
    expect(reg.view(code).status).toBe('starting');
    expect(err(() => reg.join(code, {}))).toMatchObject({ status: 409 });

    reg.raceReady(race.raceId, 22000);
    expect(reg.view(code).status).toBe('racing');
    reg.raceFinished(race.raceId, { rows: [{ id: 'p1' }] });
    expect(reg.view(code, secret)).toMatchObject({ status: 'finished', results: { rows: [{ id: 'p1' }] }, race: null });
  });

  it('goes back to waiting when no race can be spawned', () => {
    const reg = make();
    const { code, secret } = reg.create({ trackKey: 'apple_river' });
    spawnError = new Error('no free race port');
    expect(err(() => reg.start(code, secret))).toMatchObject({ status: 503 });
    expect(reg.view(code).status).toBe('waiting');
  });

  it('marks a lobby failed when its race dies', () => {
    const reg = make();
    const { code, secret } = reg.create({ trackKey: 'apple_river' });
    reg.start(code, secret);
    reg.raceFailed(spawned[0].raceId, 'race process stalled');
    expect(reg.view(code)).toMatchObject({ status: 'failed', failure: 'race process stalled' });
  });

  it('hands host over when the host leaves, deletes empty lobbies', () => {
    const reg = make();
    const a = reg.create({ trackKey: 'apple_river' });
    const b = reg.join(a.code, {});
    reg.leave(a.code, a.secret);
    expect(reg.view(a.code).hostId).toBe(b.playerId);
    reg.leave(a.code, b.secret);
    expect(err(() => reg.view(a.code))).toBeInstanceOf(LobbyError);
  });

  it('drops players who stop polling, and expires closed lobbies', () => {
    const reg = make();
    const a = reg.create({ trackKey: 'apple_river' });
    const b = reg.join(a.code, {});
    now += 20_000;
    reg.view(a.code, a.secret); // a polls, b doesn't
    now += 15_000;
    reg.sweep();
    expect(reg.view(a.code).players.map((p) => p.id)).toEqual([a.playerId]);
    expect(reg.list()).toHaveLength(1);

    reg.start(a.code, a.secret);
    reg.raceFinished(spawned[0].raceId, { rows: [] });
    now += 11 * 60_000;
    reg.sweep();
    expect(reg.size).toBe(0);
    expect(b.playerId).toBe('p2');
  });

  it('refuses joins past maxPlayers', () => {
    const reg = make();
    const { code } = reg.create({ trackKey: 'apple_river', maxPlayers: 2 });
    reg.join(code, {});
    expect(err(() => reg.join(code, {}))).toMatchObject({ status: 409 });
    expect(reg.list()).toHaveLength(0); // full lobbies aren't listed
  });
});
