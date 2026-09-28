/**
 * Client side of a server-authoritative race (server/lobby/index.js;
 * docs/MULTIPLAYER.md Phase 5).
 *
 * The client simulates nothing: it sends one input frame per server tick and
 * draws every truck — its own included — from snapshots, interpolated
 * INTERP_DELAY_TICKS behind the newest state that can have arrived (server
 * clock minus one-way latency) as a jitter buffer.
 *
 * The pieces with logic are small pure classes, unit-tested in
 * test/net-client.test.js:
 *   ServerClock     — server tick estimate + RTT from ping/pong
 *   SnapshotBuffer  — keeps recent snapshots, samples one truck at any tick
 *   InputStamper    — which ticks to send input for, so each lands in time
 */

export const TICK_RATE = 60;
// ~100 ms behind the newest server state: two snapshot intervals (20 Hz) of
// slack, so a late packet doesn't leave a truck frozen.
export const INTERP_DELAY_TICKS = 6;
// Ticks of input sent ahead of the one-way latency (server window: +8).
const INPUT_LEAD_TICKS = 2;
const PING_INTERVAL_MS = 1000;
const CLOCK_SAMPLES = 8;
const SNAPSHOT_KEEP_TICKS = 120;
// Past the newest snapshot, trucks extrapolate by velocity this far, then hold.
const MAX_EXTRAPOLATE_TICKS = 6;

/**
 * Server tick estimate from ping/pong samples. Each pong gives an RTT and the
 * server tick when it was sent; the lowest-RTT recent sample is the most
 * trustworthy (least queueing), NTP-style.
 */
export class ServerClock {
  constructor(tickRate = TICK_RATE) {
    this.tickRate = tickRate;
    this._samples = [];
    this.offset = null; // server tick - local ms * rate/1000
    this.rttMs = null;
  }

  /** A pong: sent at `sentAtMs`, received at `nowMs`, stamped server tick `t`. */
  addSample(sentAtMs, nowMs, t) {
    const rtt = Math.max(0, nowMs - sentAtMs);
    // The server stamped it ~half an RTT before we received it.
    const offset = t + (rtt / 2) * (this.tickRate / 1000) - nowMs * (this.tickRate / 1000);
    this._samples.push({ rtt, offset });
    if (this._samples.length > CLOCK_SAMPLES) this._samples.shift();
    const best = this._samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.offset;
    this.rttMs = best.rtt;
  }

  /** Seed from the welcome message before any pong has arrived. */
  seed(t, nowMs) {
    if (this.offset === null) this.offset = t - nowMs * (this.tickRate / 1000);
  }

  get ready() {
    return this.offset !== null;
  }

  /** Estimated server tick now (fractional). */
  tickAt(nowMs) {
    return nowMs * (this.tickRate / 1000) + (this.offset ?? 0);
  }

  /** One-way latency in ticks (half the RTT). */
  get oneWayTicks() {
    return ((this.rttMs ?? 0) / 2) * (this.tickRate / 1000);
  }
}

const lerp = (a, b, f) => a + (b - a) * f;
const lerpAngle = (a, b, f) => {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * f;
};

/** Recent snapshots, sampled per truck at a (fractional) tick. */
export class SnapshotBuffer {
  constructor() {
    this._snaps = []; // ascending by t
  }

  push(snap) {
    const last = this._snaps.at(-1);
    if (last && snap.t <= last.t) return; // out of order / duplicate: drop
    this._snaps.push(snap);
    const cutoff = snap.t - SNAPSHOT_KEEP_TICKS;
    while (this._snaps.length > 2 && this._snaps[0].t < cutoff) this._snaps.shift();
  }

  get latest() {
    return this._snaps.at(-1) ?? null;
  }

  /**
   * Truck `id` at tick `tick`: interpolated between the snapshots around it;
   * before the first, the first; past the newest, extrapolated along its
   * velocity for up to MAX_EXTRAPOLATE_TICKS. Discrete fields (flags, lap…)
   * come from the earlier snapshot. Null if the truck isn't in any snapshot.
   */
  sample(id, tick, out = {}) {
    const snaps = this._snaps;
    if (!snaps.length) return null;
    let i = snaps.length - 1;
    while (i > 0 && snaps[i].t > tick) i--;
    const a = snaps[i].trucks.find((t) => t.id === id);
    if (!a) return null;
    const next = snaps[i + 1];
    const b = next?.trucks.find((t) => t.id === id);
    Object.assign(out, a);
    if (b && tick > snaps[i].t) {
      const f = Math.min(1, (tick - snaps[i].t) / (next.t - snaps[i].t));
      for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'p', 'rl', 'sl', 'th', 'st']) out[k] = lerp(a[k], b[k], f);
      out.h = lerpAngle(a.h, b.h, f);
    } else if (!b && tick > snaps[i].t) {
      const dt = Math.min(tick - snaps[i].t, MAX_EXTRAPOLATE_TICKS) / TICK_RATE;
      out.x = a.x + a.vx * dt;
      out.y = a.y + a.vy * dt;
      out.z = a.z + a.vz * dt;
    }
    return out;
  }

  /**
   * Obstacle poses at `tick`, interpolated like trucks: position lerped,
   * rotation normalised-lerped (short way round). An obstacle absent from the
   * later snapshot keeps the earlier pose. Returns [{ i, x, y, z, qx, qy, qz, qw }].
   */
  sampleObstacles(tick) {
    const snaps = this._snaps;
    if (!snaps.length) return [];
    let i = snaps.length - 1;
    while (i > 0 && snaps[i].t > tick) i--;
    const a = snaps[i];
    const b = snaps[i + 1];
    const f = b && tick > a.t ? Math.min(1, (tick - a.t) / (b.t - a.t)) : 0;
    return (a.obs ?? []).map((pa) => {
      const pb = f > 0 ? b.obs?.find((o) => o.i === pa.i) : null;
      if (!pb) return pa;
      const sign = pa.qx * pb.qx + pa.qy * pb.qy + pa.qz * pb.qz + pa.qw * pb.qw < 0 ? -1 : 1;
      let qx = lerp(pa.qx, sign * pb.qx, f);
      let qy = lerp(pa.qy, sign * pb.qy, f);
      let qz = lerp(pa.qz, sign * pb.qz, f);
      let qw = lerp(pa.qw, sign * pb.qw, f);
      const len = Math.hypot(qx, qy, qz, qw) || 1;
      qx /= len; qy /= len; qz /= len; qw /= len;
      return { i: pa.i, x: lerp(pa.x, pb.x, f), y: lerp(pa.y, pb.y, f), z: lerp(pa.z, pb.z, f), qx, qy, qz, qw };
    });
  }
}

/**
 * Picks the ticks to send input for so each arrives before the server
 * simulates it: up to now + one-way latency + a small lead, one frame per
 * tick, never re-sending a tick. After a stall it skips ahead rather than
 * flooding stale ticks the server would drop anyway.
 */
export class InputStamper {
  constructor() {
    this.lastSent = -1;
  }

  /** Ticks to send now, ascending. */
  ticksToSend(clock, nowMs) {
    const serverNow = clock.tickAt(nowMs);
    const target = Math.floor(serverNow + clock.oneWayTicks + INPUT_LEAD_TICKS);
    const earliest = Math.ceil(serverNow + clock.oneWayTicks); // anything sooner lands late
    let from = Math.max(this.lastSent + 1, earliest);
    const ticks = [];
    for (let t = from; t <= target; t++) ticks.push(t);
    if (ticks.length) this.lastSent = target;
    return ticks;
  }
}

/**
 * The race socket. Events (subscribe with `on`): welcome, countdown, snapshot,
 * event, results, close.
 */
export class NetClient {
  constructor({ host, port, token, WebSocketImpl = globalThis.WebSocket, now = () => performance.now() }) {
    this._now = now;
    this.clock = new ServerClock();
    this.snapshots = new SnapshotBuffer();
    this.stamper = new InputStamper();
    this.welcome = null;
    this.playerId = null;
    this.goTick = null;
    this.acks = {};
    this._listeners = new Map();
    this._pingTimer = null;

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocketImpl(`${proto}://${host}:${port}`);
    this.ws.onopen = () => this._send({ type: 'hello', token });
    this.ws.onmessage = (e) => this._onMessage(e.data);
    this.ws.onclose = (e) => {
      clearInterval(this._pingTimer);
      this._emit('close', { code: e.code, reason: e.reason });
    };
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event)?.delete(fn);
  }

  _emit(event, payload) {
    for (const fn of this._listeners.get(event) ?? []) fn(payload);
  }

  _send(msg) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  _onMessage(data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    const now = this._now();
    switch (msg.type) {
      case 'welcome':
        this.welcome = msg;
        this.playerId = msg.playerId;
        this.clock.seed(msg.tick, now);
        this._ping();
        this._pingTimer = setInterval(() => this._ping(), PING_INTERVAL_MS);
        this._emit('welcome', msg);
        break;
      case 'pong':
        this.clock.addSample(msg.c, now, msg.t);
        break;
      case 'countdown':
        this.goTick = msg.goTick;
        this._emit('countdown', msg);
        break;
      case 'snapshot':
        this.snapshots.push(msg);
        this.acks = msg.ack ?? {};
        this._emit('snapshot', msg);
        break;
      case 'event':
        this._emit('event', msg);
        break;
      case 'results':
        this._emit('results', msg);
        break;
    }
  }

  _ping() {
    this._send({ type: 'ping', c: this._now() });
  }

  /** Estimated server tick now. */
  serverTick() {
    return this.clock.tickAt(this._now());
  }

  /**
   * The tick trucks are drawn at: the server state arriving now (server clock
   * minus the one-way latency), minus the jitter buffer.
   */
  renderTick() {
    return this.serverTick() - this.clock.oneWayTicks - INTERP_DELAY_TICKS;
  }

  /**
   * Send `frame` ({ s, g, b, r }) for every tick that's now due. Call once per
   * rendered frame; the same held input covers each tick in between.
   */
  sendInput(frame) {
    if (!this.welcome || !this.clock.ready) return;
    for (const t of this.stamper.ticksToSend(this.clock, this._now())) {
      this._send({ type: 'input', t, s: frame.s, g: frame.g, b: frame.b, r: frame.r });
    }
  }

  close() {
    clearInterval(this._pingTimer);
    try { this.ws.close(1000, 'leaving'); } catch { /* already closed */ }
  }
}
