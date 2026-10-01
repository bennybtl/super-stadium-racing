// Lobby child smoke test: `npm run check:lobby`
//
// Forks server/lobby/index.js for a short race, connects two WebSocket
// clients (plus one with a bad token), drives them, and checks the lifecycle:
// ready → welcome → countdown → 20 Hz snapshots with acks → results over the
// socket and a result + input log over IPC → clean exit. Player B goes quiet
// after 3 s to exercise last-input extrapolation.

import { fork } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Always rebuild: a stale bundle would test old sim code.
await import('./build-server-sim.mjs');

const TRACK = process.argv[2] ?? 'apple_river';
const PORT = 21000 + Math.floor(Math.random() * 2000);
const RACE_MS = 8000;
const players = [
  { id: 'a', name: 'Alice', vehicleKey: 'baja', token: randomBytes(16).toString('hex') },
  { id: 'b', name: 'Bob', vehicleKey: 'gila', token: randomBytes(16).toString('hex') },
  { id: 'c', name: 'Cat', vehicleKey: 'coati', token: randomBytes(16).toString('hex') },
];

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const ipc = [];
const child = fork(join(root, 'server', 'lobby', 'index.js'), [], {
  env: {
    ...process.env,
    LOBBY_CONFIG: JSON.stringify({ lobbyId: 'smoke', trackKey: TRACK, laps: 3, seed: 42, port: PORT, players, joinTimeoutMs: 10_000, maxRaceMs: RACE_MS }),
  },
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
child.on('message', (msg) => ipc.push(msg));
const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('child never became ready')), 30_000);
  child.on('message', (msg) => { if (msg.type === 'ready') { clearTimeout(t); resolve(); } });
});

// ── A client with a wrong token gets closed ──────────────────────────────────
const badClose = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: 'nope' })));
  ws.on('close', (code) => resolve(code));
});
check('bad token rejected', badClose === 4003, `(close ${badClose})`);

// ── Two real clients ─────────────────────────────────────────────────────────
function client(p, { quietAfterMs = Infinity } = {}) {
  const state = { welcome: null, goTick: null, snapshots: [], events: [], results: null, sent: 0 };
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  let sendTimer = null;
  const startedAt = Date.now();
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: p.token })));
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'welcome') {
      state.welcome = msg;
      // Stamp inputs with our estimate of the server tick (+2 lead), like a
      // real client would; this one just counts from the welcome tick.
      const t0 = Date.now();
      sendTimer = setInterval(() => {
        if (Date.now() - startedAt > quietAfterMs) return;
        const t = msg.tick + Math.floor(((Date.now() - t0) / 1000) * msg.tickRate) + 2;
        const s = Math.sin(t / 40);
        ws.send(JSON.stringify({ type: 'input', t, s, g: 1, b: t % 300 === 0, r: false }));
        state.sent++;
      }, 1000 / 60);
      // Junk the server must shrug off.
      ws.send(JSON.stringify({ type: 'input', t: 'soon', s: 'left' }));
      ws.send('not json');
    } else if (msg.type === 'countdown') state.goTick = msg.goTick;
    else if (msg.type === 'snapshot') state.snapshots.push(msg);
    else if (msg.type === 'event') state.events.push(msg);
    else if (msg.type === 'results') state.results = msg;
  });
  state.closed = new Promise((resolve) => ws.on('close', () => { clearInterval(sendTimer); resolve(); }));
  return state;
}

// ── The game's own client (src/net/NetClient.js) over a laggy socket ────────
// 50 ms each way + up to 20 ms jitter: its inputs must still land on their
// ticks, and it must still be interpolating (not extrapolating) when it draws.
globalThis.window = { location: { protocol: 'http:' } };
const { NetClient } = await import('../src/net/NetClient.js');
const LAG_MS = 50;
const JITTER_MS = 20;
class LaggySocket {
  constructor(url) {
    const later = (fn) => setTimeout(fn, LAG_MS + Math.random() * JITTER_MS);
    this.ws = new WebSocket(url);
    this.ws.on('open', () => later(() => this.onopen?.()));
    this.ws.on('message', (d) => { const text = d.toString(); later(() => this.onmessage?.({ data: text })); });
    this.ws.on('close', (code) => later(() => this.onclose?.({ code })));
    this._later = later;
  }
  get readyState() { return this.ws.readyState; }
  send(data) { this._later(() => { if (this.ws.readyState === 1) this.ws.send(data); }); }
  close(...args) { this.ws.close(...args); }
}
function netClient(p) {
  const net = new NetClient({ host: '127.0.0.1', port: PORT, token: p.token, WebSocketImpl: LaggySocket });
  const stats = { missed: [], margin: [] };
  let over = false;
  net.on('results', () => { over = true; }); // snapshots stop; stop measuring
  const frame = setInterval(() => {
    net.sendInput({ s: 0.3, g: 1, b: false, r: false });
    const latest = net.snapshots.latest;
    if (over || !latest || latest.t < 120) return; // let the clock settle
    stats.missed.push(latest.t - (net.acks[p.id] ?? -1));
    if (net.snapshots.sample(p.id, net.renderTick(), {})) stats.margin.push(latest.t - net.renderTick());
  }, 1000 / 60);
  stats.closed = new Promise((resolve) => net.on('close', () => { clearInterval(frame); resolve(); }));
  stats.net = net;
  return stats;
}

const a = client(players[0]);
const b = client(players[1], { quietAfterMs: 3000 });
const c = netClient(players[2]);
await Promise.race([Promise.all([a.closed, b.closed, c.closed]), new Promise((r) => setTimeout(r, RACE_MS + 20_000))]);
const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);

// ── Checks ───────────────────────────────────────────────────────────────────
check('both welcomed', a.welcome?.playerId === 'a' && b.welcome?.playerId === 'b');
check('countdown announced', a.goTick != null && a.goTick === b.goTick, `(go at ${a.goTick})`);
const snaps = a.snapshots;
const span = snaps.length > 1 ? (snaps.at(-1).t - snaps[0].t) / 60 : 0;
check('snapshots ~20 Hz', snaps.length > 1 && Math.abs(snaps.length / span - 20) < 2, `(${snaps.length} over ${span.toFixed(1)} s sim)`);
const last = snaps.at(-1);
check('snapshot carries every truck', last?.trucks?.length === 3 && last.trucks.every((t) => Number.isFinite(t.x)));
check('snapshot carries obstacle poses', Array.isArray(last?.obs));
check('acks track a live player', last?.ack?.a > last.t - 10, `(ack ${last?.ack?.a} at t ${last?.t})`);
check('quiet player acks stall', last?.ack?.b < last.t - 60, `(ack ${last?.ack?.b})`);
// Distance along the path, not start-to-end: a truck holding one steer input circles.
const moved = (id) => {
  let d = 0;
  let prev = null;
  for (const snap of snaps.filter((x) => x.t >= a.goTick)) {
    const t = snap.trucks.find((tr) => tr.id === id);
    if (prev) d += Math.hypot(t.x - prev.x, t.z - prev.z);
    prev = t;
  }
  return d;
};
check('player A drove', moved('a') > 20, `(${moved('a').toFixed(1)} m)`);
check('quiet player B kept driving (extrapolated)', moved('b') > 20, `(${moved('b').toFixed(1)} m)`);
check('results sent', a.results?.rows?.length === 3 && a.results.reason === 'time limit', `(${a.results?.reason})`);
const result = ipc.find((m) => m.type === 'result');
check('IPC: heartbeats', ipc.filter((m) => m.type === 'heartbeat').length >= 3);
check('IPC: result with input log', result?.inputLog?.length > 0 && result.seed === 42, `(${result?.inputLog?.length} entries)`);
check('child exited cleanly', code === 0, `(exit ${code})`);

const sorted = (xs) => [...xs].sort((x, y) => x - y);
const missed = sorted(c.missed);
const margin = sorted(c.margin);
const pct = (xs, q) => xs[Math.min(xs.length - 1, Math.floor(xs.length * q))];
check('NetClient: clock synced over lag', Math.abs(c.net.clock.rttMs - 2 * LAG_MS) < 2 * JITTER_MS + 10, `(rtt ${c.net.clock.rttMs?.toFixed(0)} ms)`);
check('NetClient: inputs land on their ticks', missed.length > 100 && pct(missed, 0.95) <= 1, `(95th pct ${pct(missed, 0.95)} ticks behind)`);
check('NetClient: draws by interpolation', margin.length > 100 && pct(margin, 0.05) > 0, `(5th pct ${pct(margin, 0.05)?.toFixed(1)} ticks of margin)`);

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nlobby smoke test passed');
if (code === 'timeout') child.kill();
process.exit(failures.length ? 1 : 0);
