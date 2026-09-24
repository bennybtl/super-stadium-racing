import { describe, it, expect, afterEach, vi } from 'vitest';
import { makeRoom } from './helpers/drive-room.js';

// Race lifecycle: host handover, finish order, the DNF grace, and who ends up
// in the results. Input validation lives in server-validate.test.js.

const LAPS = 2;
const DNF_GRACE_MS = 45_000; // DriveRoom.js

/** A lobby with `ids` joined in order (the first is host). */
function lobby(ids, options = { laps: LAPS }) {
  const r = makeRoom(options);
  const clients = Object.fromEntries(ids.map((id) => [id, r.client(id)]));
  for (const id of ids) r.room.onJoin(clients[id], { playerName: id.toUpperCase() });
  return { ...r, c: clients };
}

/** Report every lap, then finish, with the given total time. */
function finish({ msg }, c, totalTimeMs, laps = LAPS) {
  for (let lap = 1; lap <= laps; lap++) msg(c, 'lapCompleted', { lap });
  msg(c, 'finished', { totalTimeMs, fastestLapMs: totalTimeMs / laps });
}

const ofType = (sent, type) => sent.filter((m) => m.type === type).map((m) => m.payload);

afterEach(() => vi.useRealTimers());

describe('DriveRoom host handover', () => {
  it('passes host to the longest-connected player when the host leaves', () => {
    const r = lobby(['a', 'b', 'c']);
    expect(r.room.hostId).toBe('a');
    r.room.onLeave(r.c.a);
    expect(r.room.hostId).toBe('b');
    expect(ofType(r.sent, 'hostChanged')).toEqual([{ hostId: 'b' }]);
    expect(r.room.metadata.hostName).toBe('B'); // lobby list shows the new host
  });

  it('gives the new host the host powers, and only them', () => {
    const r = lobby(['a', 'b', 'c']);
    r.room.onLeave(r.c.a);
    r.msg(r.c.c, 'updateSettings', { laps: 7 });
    expect(r.room.settings.laps).toBe(LAPS);
    r.msg(r.c.b, 'updateSettings', { laps: 7 });
    expect(r.room.settings.laps).toBe(7);
    r.msg(r.c.b, 'start');
    expect(r.room.started).toBe(true);
  });

  it('does not change host when someone else leaves', () => {
    const r = lobby(['a', 'b']);
    r.room.onLeave(r.c.b);
    expect(r.room.hostId).toBe('a');
    expect(ofType(r.sent, 'hostChanged')).toEqual([]);
  });

  it('empties cleanly when the last player leaves', () => {
    const r = lobby(['a']);
    r.room.onLeave(r.c.a);
    expect(r.room.hostId).toBeNull();
  });
});

describe('DriveRoom race results', () => {
  it('orders finishers by arrival and ends when everyone is done', () => {
    const r = lobby(['a', 'b']);
    r.msg(r.c.a, 'start');
    finish(r, r.c.b, 90_000);
    expect(ofType(r.sent, 'raceOver')).toHaveLength(0);
    finish(r, r.c.a, 95_000);
    const [over] = ofType(r.sent, 'raceOver');
    expect(over.rows.map((row) => [row.id, row.finishPosition, row.totalTimeMs]))
      .toEqual([['b', 1, 90_000], ['a', 2, 95_000]]);
  });

  it('DNFs stragglers after the grace period from the first finish', () => {
    vi.useFakeTimers();
    const r = lobby(['a', 'b']);
    r.msg(r.c.a, 'start');
    finish(r, r.c.a, 60_000);
    vi.advanceTimersByTime(DNF_GRACE_MS - 1);
    expect(ofType(r.sent, 'raceOver')).toHaveLength(0);
    vi.advanceTimersByTime(1);
    const [over] = ofType(r.sent, 'raceOver');
    expect(over.rows.map((row) => [row.id, row.finishPosition, row.totalTimeMs]))
      .toEqual([['a', 1, 60_000], ['b', 2, null]]);
  });

  it('fires raceOver once — a normal finish cancels the DNF timer', () => {
    vi.useFakeTimers();
    const r = lobby(['a', 'b']);
    r.msg(r.c.a, 'start');
    finish(r, r.c.a, 60_000);
    finish(r, r.c.b, 70_000);
    vi.advanceTimersByTime(DNF_GRACE_MS * 2);
    expect(ofType(r.sent, 'raceOver')).toHaveLength(1);
  });

  it('keeps a finisher who disconnects afterwards in the results', () => {
    const r = lobby(['a', 'b']);
    r.msg(r.c.a, 'start');
    finish(r, r.c.a, 60_000);
    r.room.onLeave(r.c.a); // closes the tab right after the line
    finish(r, r.c.b, 70_000);
    const [over] = ofType(r.sent, 'raceOver');
    expect(over.rows.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('does not wait for a racer who left without finishing', () => {
    const r = lobby(['a', 'b']);
    r.msg(r.c.a, 'start');
    r.room.onLeave(r.c.b);
    finish(r, r.c.a, 60_000);
    const [over] = ofType(r.sent, 'raceOver');
    expect(over.rows.map((row) => row.id)).toEqual(['a']);
  });

  it('a solo race ends on finish with no DNF timer', () => {
    vi.useFakeTimers();
    const r = lobby(['a']);
    r.msg(r.c.a, 'start');
    finish(r, r.c.a, 60_000);
    expect(ofType(r.sent, 'raceOver')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
