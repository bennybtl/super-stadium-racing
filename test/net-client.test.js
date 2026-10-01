import { describe, it, expect } from 'vitest';
import { ServerClock, SnapshotBuffer, InputStamper } from '../src/net/NetClient.js';

const snap = (t, x, h = 0) => ({ t, trucks: [{ id: 'a', x, y: 0, z: 0, h, vx: 60, vy: 0, vz: 0, p: 0, rl: 0, sl: 0, th: 1, st: 0, flags: 1, lap: 0 }] });

describe('ServerClock', () => {
  it('estimates the server tick from a pong, compensating half the RTT', () => {
    const c = new ServerClock(60);
    // Sent at 1000 ms, back at 1100 ms (RTT 100), server stamped tick 600.
    c.addSample(1000, 1100, 600);
    expect(c.rttMs).toBe(100);
    expect(c.tickAt(1100)).toBeCloseTo(603, 6); // + 50 ms = 3 ticks
    expect(c.tickAt(2100)).toBeCloseTo(663, 6);
    expect(c.oneWayTicks).toBeCloseTo(3, 6);
  });

  it('trusts the lowest-RTT sample', () => {
    const c = new ServerClock(60);
    c.addSample(0, 400, 0);        // badly queued
    c.addSample(1000, 1020, 60);   // clean: server tick at 1010 ms ≈ 60
    expect(c.rttMs).toBe(20);
    expect(c.tickAt(1020)).toBeCloseTo(60.6, 6);
  });
});

describe('SnapshotBuffer', () => {
  it('interpolates between the snapshots around a tick', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 0));
    b.push(snap(3, 3));
    expect(b.sample('a', 1.5).x).toBeCloseTo(1.5, 6);
  });

  it('takes the short way round for heading', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 0, Math.PI - 0.1));
    b.push(snap(2, 0, -Math.PI + 0.1));
    expect(Math.abs(b.sample('a', 1).h)).toBeCloseTo(Math.PI, 6);
  });

  it('extrapolates briefly past the newest snapshot, then holds', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 0));
    expect(b.sample('a', 3).x).toBeCloseTo(3, 6);   // vx 60 m/s × 3 ticks
    expect(b.sample('a', 60).x).toBeCloseTo(6, 6);  // capped at 6 ticks
  });

  it('interpolates obstacle poses, holding ones missing from the later snapshot', () => {
    const b = new SnapshotBuffer();
    const q0 = { qx: 0, qy: 0, qz: 0, qw: 1 };
    const q90 = { qx: 0, qy: Math.SQRT1_2, qz: 0, qw: Math.SQRT1_2 };
    b.push({ t: 0, trucks: [], obs: [{ i: 2, x: 0, y: 1, z: 0, ...q0 }, { i: 5, x: 9, y: 1, z: 9, ...q0 }] });
    b.push({ t: 4, trucks: [], obs: [{ i: 2, x: 4, y: 1, z: 0, ...q90 }] });
    const [o2, o5] = b.sampleObstacles(2);
    expect(o2.x).toBeCloseTo(2, 6);
    expect(Math.hypot(o2.qx, o2.qy, o2.qz, o2.qw)).toBeCloseTo(1, 6); // stays a unit quaternion
    expect(o2.qy).toBeGreaterThan(0);
    expect(o2.qy).toBeLessThan(Math.SQRT1_2);
    expect(o5).toMatchObject({ i: 5, x: 9 });
  });

  it('drops out-of-order snapshots and unknown trucks', () => {
    const b = new SnapshotBuffer();
    b.push(snap(6, 6));
    b.push(snap(3, 3));
    expect(b.latest.t).toBe(6);
    expect(b.sample('zzz', 6)).toBeNull();
  });
});

describe('InputStamper', () => {
  const clockAt = (tick, oneWay = 0) => ({ tickAt: () => tick, oneWayTicks: oneWay });

  it('sends each tick once, ahead by latency + lead', () => {
    const s = new InputStamper();
    expect(s.ticksToSend(clockAt(100, 3), 0)).toEqual([103, 104, 105]);
    expect(s.ticksToSend(clockAt(100.5, 3), 0)).toEqual([]);
    expect(s.ticksToSend(clockAt(101.2, 3), 0)).toEqual([106]);
  });

  it('skips ahead after a stall instead of sending stale ticks', () => {
    const s = new InputStamper();
    s.ticksToSend(clockAt(100), 0);
    expect(s.ticksToSend(clockAt(200), 0)).toEqual([200, 201, 202]);
  });
});
