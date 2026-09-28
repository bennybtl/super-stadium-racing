// Lobby child: one server-authoritative race (docs/MULTIPLAYER.md, Phase 3).
//
//   LOBBY_CONFIG='{"trackKey":…,"laps":…,"seed":…,"port":…,"players":[{id,name,vehicleKey,token}]}' \
//     node server/lobby/index.js
//
// Normally forked by the parent (Phase 4), which mints the tokens and hands
// each client `{ host, port, token }`. Needs `npm run build:server-sim` first.
//
// Lifecycle: boot the headless race → open a WebSocket server → each client
// authenticates with its token → once everyone is in (or JOIN_TIMEOUT_MS
// passes) a 3 s countdown → 60 Hz ticks until the race ends or MAX_RACE_MS →
// results + input log to the parent → exit.
//
// Wire protocol (JSON for now; shapes are fixed so a binary encoding can
// replace the snapshot later without touching the flow):
//   client → { type: 'hello', token }
//            { type: 'input', t, s, g, b, r }            see inputs.js
//   server → { type: 'welcome', playerId, tick, tickRate, snapshotRate, seed, trackKey, laps, players }
//            { type: 'countdown', goTick }
//            { type: 'snapshot', t, ack: { [playerId]: lastInputTick }, trucks: [{ id, x, y, z, h, vx, vy, vz, flags }] }
//            { type: 'event', event: 'raceStart'|'checkpoint'|'lap'|'finish', …, t }
//            { type: 'results', rows: [{ id, name, position, timeMs, dnf, bestLapMs }] }
// IPC to the parent: { type: 'ready' | 'heartbeat' | 'result' | 'error', … }.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { installHeadlessEnv } from './headless-env.js';
import { PlayerInputs, toTruckInput, NEUTRAL_FRAME } from './inputs.js';
import { takeToken } from '../validate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const TICK_RATE = 60;
const SNAPSHOT_EVERY = 3;             // ticks → 20 Hz
const COUNTDOWN_TICKS = 3 * TICK_RATE;
const MAX_CATCHUP_STEPS = 5;          // a stalled process drops time rather than spiral
const HEARTBEAT_MS = 1000;
const HELLO_TIMEOUT_MS = 5000;
const DEFAULT_JOIN_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RACE_MS = 15 * 60_000;
const RESPAWN_COOLDOWN_SEC = 3;
// Per-connection message budget: 60 inputs/s plus slack for resends.
const MSG_RATE = 120;
const MSG_BURST = 60;
const EXIT_DELAY_MS = 1000;
const KEY_RE = /^[a-z0-9_]+$/i;

// ── Config ───────────────────────────────────────────────────────────────────
const log = (...a) => console.log(`[lobby ${config?.lobbyId ?? '?'}]`, ...a);
let config;
try {
  config = JSON.parse(process.env.LOBBY_CONFIG ?? '');
} catch {
  fail('LOBBY_CONFIG is missing or not JSON');
}
const { trackKey, laps = 3, seed = 1, port, players: playerConfig = [] } = config;
const reverse = config.reverse === true;
const joinTimeoutMs = config.joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT_MS;
const maxRaceMs = config.maxRaceMs ?? DEFAULT_MAX_RACE_MS;
if (!KEY_RE.test(trackKey ?? '')) fail(`bad trackKey ${JSON.stringify(trackKey)}`);
if (!Number.isInteger(port)) fail('port must be an integer');
if (!playerConfig.length || playerConfig.some((p) => !p.id || !p.token)) fail('players need an id and a token');

function fail(message) {
  console.error(`[lobby] ${message}`);
  process.send?.({ type: 'error', message });
  process.exit(1);
}

// ── Boot the headless race ───────────────────────────────────────────────────
installHeadlessEnv();
const simPath = join(root, 'server', 'build', 'sim.mjs');
if (!existsSync(simPath)) fail('server/build/sim.mjs missing — run `npm run build:server-sim`');
const quietDebug = console.debug;
console.debug = () => {}; // the sim's debug chatter
const m = await import(pathToFileURL(simPath).href);
const { default: HavokPhysics } = await import('@babylonjs/havok');

const readJson = (...p) => JSON.parse(readFileSync(join(root, ...p), 'utf8'));
const obstacleDefs = new Map(readdirSync(join(root, 'src', 'obstacles'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => { const d = readJson('src', 'obstacles', f); return [d.id ?? f.slice(0, -5), d]; }));
m.setObstacleLoader({ getObstacle: (id) => obstacleDefs.get(id) ?? null, obstacleList: [...obstacleDefs.keys()] });

const vehicleDef = (key) => {
  if (!key || !KEY_RE.test(key)) return null;
  const file = join(root, 'src', 'vehicles', `${key}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};

const track = m.Track.fromJSON(readFileSync(join(root, 'src', 'tracks', `${trackKey}.json`), 'utf8'));
track.setReverse(reverse && track.allowReverse !== false);

const players = playerConfig.map((p) => ({
  id: String(p.id),
  name: String(p.name ?? p.id).slice(0, 24),
  vehicleKey: p.vehicleKey ?? null,
  token: Buffer.from(String(p.token)),
  inputs: new PlayerInputs(),
  socket: null,
  msgBucket: {},
}));
const byId = new Map(players.map((p) => [p.id, p]));

let tick = 0;                 // next tick to simulate
const pendingEvents = [];     // sim events raised during a step, sent after it
const engine = new m.NullEngine();
const scene = new m.Scene(engine);
const { sim } = await m.createRace({
  scene,
  track,
  players: players.map((p) => ({ id: p.id, name: p.name, vehicleDef: vehicleDef(p.vehicleKey) })),
  laps,
  seed,
  havokOptions: { wasmBinary: readFileSync(join(root, 'node_modules', '@babylonjs', 'havok', 'lib', 'esm', 'HavokPhysics.wasm')) },
  respawnCooldownSec: RESPAWN_COOLDOWN_SEC,
  events: {
    onRaceStart: () => pendingEvents.push({ event: 'raceStart' }),
    onCheckpoint: (td, index, count) => pendingEvents.push({ event: 'checkpoint', id: td.id, index, count }),
    onLap: (td, lap, lapTimeMs) => pendingEvents.push({ event: 'lap', id: td.id, lap, lapTimeMs }),
    onFinish: (td, timeMs) => pendingEvents.push({ event: 'finish', id: td.id, timeMs }),
    onRaceEnd: () => { raceOver = true; },
  },
});
console.debug = quietDebug;
log(`race ready: ${trackKey}, ${laps} laps, ${players.length} players, seed ${seed}`);

// ── Networking ───────────────────────────────────────────────────────────────
let phase = 'waiting';        // waiting → countdown → racing → done
let raceOver = false;
let goTick = null;

const send = (ws, msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); };
const broadcast = (msg) => {
  const data = JSON.stringify(msg);
  for (const p of players) if (p.socket?.readyState === 1) p.socket.send(data);
};

function authenticate(token) {
  const given = Buffer.from(String(token ?? ''));
  return players.find((p) => p.token.length === given.length && timingSafeEqual(p.token, given)) ?? null;
}

const wss = new WebSocketServer({ port, maxPayload: 4096 });
wss.on('connection', (ws) => {
  let player = null;
  const helloTimer = setTimeout(() => ws.close(4001, 'no hello'), HELLO_TIMEOUT_MS);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!player) {
      if (msg?.type !== 'hello') return;
      player = authenticate(msg.token);
      if (!player) { ws.close(4003, 'bad token'); return; }
      clearTimeout(helloTimer);
      // One live connection per player: a reconnect replaces the old one.
      if (player.socket && player.socket !== ws) player.socket.close(4000, 'replaced');
      player.socket = ws;
      send(ws, {
        type: 'welcome', playerId: player.id, tick, tickRate: TICK_RATE,
        snapshotRate: TICK_RATE / SNAPSHOT_EVERY, seed, trackKey, laps, reverse,
        players: players.map((p) => ({ id: p.id, name: p.name, vehicleKey: p.vehicleKey })),
      });
      if (goTick !== null) send(ws, { type: 'countdown', goTick });
      log(`${player.id} joined`);
      maybeStartCountdown();
      return;
    }
    if (!takeToken(player.msgBucket, Date.now(), MSG_RATE, MSG_BURST)) return;
    if (msg?.type === 'input') player.inputs.offer(msg, tick);
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (player?.socket === ws) {
      player.socket = null;
      log(`${player.id} disconnected`);
      // Their truck keeps its last input (reconnect is out of scope for now).
      if (phase !== 'waiting' && players.every((p) => !p.socket)) endRace('abandoned');
    }
  });
});
// 'ready' only once clients can actually connect — the parent hands out the
// port as soon as it hears it.
wss.on('listening', () => {
  log(`listening on :${port}`);
  process.send?.({ type: 'ready' });
});
wss.on('error', (err) => fail(`ws server: ${err.message}`));

const joinTimer = setTimeout(() => startCountdown('join timeout'), joinTimeoutMs);
function maybeStartCountdown() {
  if (phase === 'waiting' && players.every((p) => p.socket)) startCountdown('all joined');
}
function startCountdown(reason) {
  if (phase !== 'waiting') return;
  clearTimeout(joinTimer);
  if (!players.some((p) => p.socket)) { endRace('nobody joined'); return; }
  phase = 'countdown';
  goTick = tick + COUNTDOWN_TICKS;
  log(`countdown (${reason}), go at tick ${goTick}`);
  broadcast({ type: 'countdown', goTick });
  startTicking();
}

// ── Tick loop ────────────────────────────────────────────────────────────────
// Input log: one entry per player whenever their applied frame changes —
// [tick, playerIndex, s, g, b, r]. Replaying it (holding each value until the
// next entry) through the same sim reproduces the race (Phase 7).
const inputLog = [];
const lastLogged = players.map(() => NEUTRAL_FRAME);

function stepOnce() {
  const inputs = {};
  players.forEach((p, i) => {
    const { frame, boostPressed, respawnPressed } = p.inputs.take(tick);
    if (tick < goTick) return; // grid: handbrake on, no controls until GO
    const prev = lastLogged[i];
    if (frame.s !== prev.s || frame.g !== prev.g || frame.b !== prev.b || frame.r !== prev.r) {
      inputLog.push([tick, i, frame.s, frame.g, frame.b ? 1 : 0, frame.r ? 1 : 0]);
      lastLogged[i] = frame;
    }
    if (boostPressed) sim.requestBoost(p.id);
    if (respawnPressed) sim.requestRespawn(p.id);
    inputs[p.id] = toTruckInput(frame);
  });
  if (tick === goTick) {
    sim.go();
    phase = 'racing';
  }
  sim.step(1 / TICK_RATE, inputs);
  for (const e of pendingEvents.splice(0)) broadcast({ type: 'event', ...e, t: tick });
  if (tick % SNAPSHOT_EVERY === 0) broadcastSnapshot();
  tick++;
  if (raceOver) endRace('finished');
  else if (goTick !== null && (tick - goTick) * (1000 / TICK_RATE) > maxRaceMs) endRace('time limit');
}

function broadcastSnapshot() {
  const snap = sim.getSnapshot();
  const ack = Object.fromEntries(players.map((p) => [p.id, p.inputs.lastProcessedTick]));
  broadcast({
    type: 'snapshot',
    t: tick,
    ack,
    trucks: snap.trucks.map(({ id, x, y, z, h, vx, vy, vz, flags }) => ({ id, x, y, z, h, vx, vy, vz, flags })),
  });
}

let loopTimer = null;
function startTicking() {
  const stepMs = 1000 / TICK_RATE;
  let nextAt = performance.now();
  const loop = () => {
    if (phase === 'done') return;
    const now = performance.now();
    let steps = 0;
    while (now >= nextAt && steps < MAX_CATCHUP_STEPS && phase !== 'done') {
      stepOnce();
      nextAt += stepMs;
      steps++;
    }
    if (now - nextAt > stepMs * MAX_CATCHUP_STEPS) {
      log(`behind by ${(now - nextAt).toFixed(0)} ms — dropping time`);
      nextAt = now;
    }
    loopTimer = setTimeout(loop, Math.max(0, nextAt - performance.now()));
  };
  loop();
}

// ── End ──────────────────────────────────────────────────────────────────────
function endRace(reason) {
  if (phase === 'done') return;
  phase = 'done';
  clearTimeout(loopTimer);
  clearTimeout(joinTimer);
  const rows = resultRows();
  log(`race over (${reason})`);
  broadcast({ type: 'results', reason, rows });
  process.send?.({ type: 'result', reason, trackKey, seed, laps, tick, rows, inputLog });
  setTimeout(() => {
    for (const p of players) p.socket?.close(1000, 'race over');
    wss.close();
    process.exit(0);
  }, EXIT_DELAY_MS);
}

function resultRows() {
  const finished = sim.finishOrder;
  const rest = sim.trucks.filter((td) => !finished.includes(td));
  return [...finished, ...rest].map((td, i) => ({
    id: td.id,
    name: td.name,
    position: i + 1,
    timeMs: td.gameState.raceFinished ? td.gameState.totalRaceTime : null,
    dnf: !td.gameState.raceFinished || td.gameState.totalRaceTime == null,
    bestLapMs: td.gameState.fastestLap,
  }));
}

// ── Parent link ──────────────────────────────────────────────────────────────
if (process.send) {
  setInterval(() => process.send({ type: 'heartbeat', tick, phase }), HEARTBEAT_MS).unref();
  process.on('disconnect', () => { log('parent gone'); process.exit(0); });
}
process.on('SIGTERM', () => endRace('terminated'));
