// Race-lobby end-to-end check: `npm run check:lobbies`
//
// Starts the real server (server/index.js) on a spare port, then drives the
// whole Phase 4 flow over HTTP + WebSocket: create a lobby, join it, pick a
// vehicle, host-only start, poll until each player gets their race endpoint,
// race two ws clients against the spawned race process, and read the stored
// result back. Races are capped at a few seconds (RACE_MAX_MS).
//
// LOBBIES_URL=http://host:2567 runs the same flow against a server that's
// already up (e.g. the Docker image, started with RACE_MAX_MS=6000).

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const external = process.env.LOBBIES_URL ?? null;
if (!external) await import('./build-server-sim.mjs'); // never race a stale sim bundle

const PORT = 24000 + Math.floor(Math.random() * 1000);
const RACE_PORT = PORT + 1000;
const base = external ?? `http://127.0.0.1:${PORT}`;

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

let cleanup = () => {};
if (!external) {
  const dataDir = mkdtempSync(join(root, 'node_modules', '.cache', 'race-data-'));
  const server = spawn(process.execPath, [join(root, 'server', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      RACE_PORT_MIN: String(RACE_PORT),
      RACE_PORT_MAX: String(RACE_PORT + 1),
      RACE_DATA_DIR: dataDir,
      RACE_MAX_MS: '6000',
      RACE_JOIN_TIMEOUT_MS: '10000',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  cleanup = () => {
    server.kill('SIGTERM');
    rmSync(dataDir, { recursive: true, force: true });
  };
}

async function api(method, path, { body, secret } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await sleep(250);
  }
}

try {
  await until(async () => (await api('GET', '/race-lobbies').catch(() => ({}))).status === 200, 15_000, 'server');

  // ── Lobby flow ─────────────────────────────────────────────────────────────
  const created = await api('POST', '/race-lobbies', {
    body: { name: 'Smoke', trackKey: 'apple_river', laps: 2, player: { name: 'Alice', vehicleKey: 'baja' } },
  });
  check('create lobby', created.status === 201 && /^[A-Z2-9]{5}$/.test(created.body?.code), `(${created.body?.code})`);
  const { code } = created.body;
  const alice = created.body;
  check('bad track refused', (await api('POST', '/race-lobbies', { body: { trackKey: 'nope' } })).status === 400);

  const joined = await api('POST', `/race-lobbies/${code}/join`, { body: { player: { name: 'Bob' } } });
  check('join lobby', joined.status === 200 && joined.body.playerId === 'p2');
  const bob = joined.body;
  await api('PATCH', `/race-lobbies/${code}/me`, { secret: bob.secret, body: { vehicleKey: 'gila' } });

  const listed = await api('GET', '/race-lobbies');
  check('lobby listed', listed.body.some((l) => l.code === code && l.players === 2));
  const view = await api('GET', `/race-lobbies/${code}`, { secret: bob.secret });
  check('view shows players + host', view.body.hostId === 'p1' && view.body.you === 'p2'
    && view.body.players.map((p) => p.vehicleKey).join() === 'baja,gila');
  check('no secrets in views', !JSON.stringify(view.body).includes(alice.secret));

  check('non-host cannot start', (await api('POST', `/race-lobbies/${code}/start`, { secret: bob.secret })).status === 403);
  check('forged secret refused', (await api('POST', `/race-lobbies/${code}/start`, { secret: 'x'.repeat(48) })).status === 401);
  check('host starts', (await api('POST', `/race-lobbies/${code}/start`, { secret: alice.secret })).status === 200);

  // ── Race ───────────────────────────────────────────────────────────────────
  const endpoint = async (p) => until(async () => {
    const v = await api('GET', `/race-lobbies/${code}`, { secret: p.secret });
    return v.body?.race ?? null;
  }, 30_000, 'race endpoint');
  const [ea, eb] = await Promise.all([endpoint(alice), endpoint(bob)]);
  check('each player gets their own token', (external || ea.port === RACE_PORT) && eb.port === ea.port && ea.token !== eb.token);

  const race = (e) => new Promise((resolve) => {
    const out = { snapshots: 0, results: null };
    const ws = new WebSocket(`ws://${e.host}:${e.port}`);
    let timer = null;
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: e.token })));
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'welcome') {
        const t0 = Date.now();
        timer = setInterval(() => {
          const t = msg.tick + Math.floor(((Date.now() - t0) / 1000) * msg.tickRate) + 2;
          ws.send(JSON.stringify({ type: 'input', t, s: 0, g: 1, b: false, r: false }));
        }, 1000 / 60);
      } else if (msg.type === 'snapshot') out.snapshots++;
      else if (msg.type === 'results') out.results = msg;
    });
    ws.on('close', () => { clearInterval(timer); resolve(out); });
  });
  const [ra, rb] = await Promise.all([race(ea), race(eb)]);
  check('both raced', ra.snapshots > 50 && rb.snapshots > 50, `(${ra.snapshots} / ${rb.snapshots} snapshots)`);
  check('results over the socket', ra.results?.rows?.length === 2);

  // ── Stored result ──────────────────────────────────────────────────────────
  const finished = await until(async () => {
    const v = await api('GET', `/race-lobbies/${code}`, { secret: alice.secret });
    return v.body?.status === 'finished' ? v.body : null;
  }, 10_000, 'lobby finished');
  check('lobby finished with results', finished.results?.rows?.length === 2 && finished.race === null);
  const recent = await api('GET', '/races');
  const stored = recent.body.find((r) => r.raceId === finished.results.raceId);
  check('result stored', !!stored && stored.trackKey === 'apple_river' && stored.inputEntries > 0,
    `(${stored?.inputEntries} input entries)`);
  check('race record readable', (await api('GET', `/races/${finished.results.raceId}`)).status === 200);
  check('input log not served', !('inputLog' in (stored ?? {})));
} catch (err) {
  check(`flow completed`, false, err.message);
} finally {
  cleanup();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nrace-lobby flow passed');
process.exit(failures.length ? 1 : 0);
