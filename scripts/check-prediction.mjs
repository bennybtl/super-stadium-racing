// Client-prediction check: `npm run check:prediction`
//
// Runs a server race (createRace, as server/lobby does) and a predicting
// client (src/net/Prediction.js on its own sim scene) side by side, fed the
// same scripted input — throttle, weaving, nitro taps — and checks:
//
//   1. in lockstep from the same freshly placed truck, the client's predicted
//      truck equals the server's exactly, tick for tick (same code, input
//      mapping and seeded roughness stream);
//   2. with snapshots arriving late (as over a network) and reconciled, no
//      correction is needed;
//   3. after the client is knocked off (a forced 1.5 m error), it's corrected
//      and stays corrected (the run's last 3 s: p90 < 2 cm, never > 25 cm). (Not exact: a snapshot carries
//      the pose, not the truck's internal smoothing state, which diverged
//      while it was off — the same reason a real client starting mid-race
//      sees the odd small correction.)
//
// Server respawns (out of bounds) aren't predicted — the snapshot corrects
// them — so (1) compares up to the first one and (2)/(3) allow for them.
//
// If (1) fails, client and server simulate the truck differently — every
// online race would show constant corrections.

import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installHeadlessEnv } from '../server/lobby/headless-env.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS = ['apple_river', 'quarry_run', 'the_road'];
const SECONDS = 20;
const GO_TICK = 60;
const LATENCY_TICKS = 9; // snapshot age when it arrives (~150 ms)

const cacheDir = join(root, 'node_modules', '.cache', 'check-prediction');
mkdirSync(cacheDir, { recursive: true });
const entry = join(cacheDir, 'entry.mjs');
const src = (p) => JSON.stringify(join(root, 'src', p));
writeFileSync(entry, `
export { Track } from ${src('world/track.js')};
export { Truck } from ${src('truck/truck.js')};
export { createRace } from ${src('sim/headless-race.js')};
export { buildSimScene } from ${src('sim/sim-scene.js')};
export { Prediction } from ${src('net/Prediction.js')};
export { rngStream } from ${src('sim/rng.js')};
export { toTruckInput } from ${src('sim/input-frame.js')};
export { wireTruck } from ${src('sim/snapshot-wire.js')};
export { StaticBodyCollisionManager } from ${src('managers/StaticBodyCollisionManager.js')};
export { setObstacleLoader } from ${src('objects/Obstacle.js')};
export { SIM_DT } from ${src('modes/fixed-step.js')};
export { NullEngine, Scene } from '@babylonjs/core';
`);
const bundlePath = join(cacheDir, 'bundle.mjs');
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  loader: Object.fromEntries(['.png', '.jpg', '.jpeg', '.obj', '.mtl', '.glb', '.mp3', '.wav', '.ogg', '.svg'].map((e) => [e, 'empty'])),
  define: { 'import.meta.glob': '__viteGlobStub' },
  banner: { js: 'globalThis.__viteGlobStub = () => ({});' },
  outfile: bundlePath,
  logLevel: 'error',
});

installHeadlessEnv();
console.debug = () => {};
const m = await import(pathToFileURL(bundlePath).href);
const wasmBinary = readFileSync(join(root, 'node_modules', '@babylonjs', 'havok', 'lib', 'esm', 'HavokPhysics.wasm'));
const obstacleDir = join(root, 'src', 'obstacles');
const obstacleDefs = new Map(readdirSync(obstacleDir).filter((f) => f.endsWith('.json'))
  .map((f) => { const d = JSON.parse(readFileSync(join(obstacleDir, f), 'utf8')); return [d.id ?? f.slice(0, -5), d]; }));
m.setObstacleLoader({ getObstacle: (id) => obstacleDefs.get(id) ?? null, obstacleList: [...obstacleDefs.keys()] });

const SEED = 777;
const ID = 'p0';
const loadTrack = (key) => {
  const t = m.Track.fromJSON(readFileSync(join(root, 'src', 'tracks', `${key}.json`), 'utf8'));
  t.setReverse(false);
  return t;
};

/** Scripted player input for a tick: throttle, a weave, nitro taps. */
function frameAt(tick) {
  const s = Math.sin(tick / 45) > 0.2 ? 1 : Math.sin(tick / 45) < -0.2 ? -1 : 0;
  return { s, g: tick % 400 < 360 ? 1 : -1, b: tick % 300 >= 240 && tick % 300 < 244, r: false };
}

/** The server: a real headless race, driven the way server/lobby/index.js drives it. */
async function makeServer(trackKey) {
  const race = await m.createRace({
    scene: new m.Scene(new m.NullEngine()), track: loadTrack(trackKey),
    players: [{ id: ID }], laps: 3, seed: SEED, havokOptions: { wasmBinary },
  });
  let prev = { b: false };
  return {
    race,
    initial: m.wireTruck(race.sim.getSnapshot().trucks[0]),
    step(tick) {
      const frame = frameAt(tick);
      const inputs = {};
      if (tick >= GO_TICK) {
        if (frame.b && !prev.b) race.sim.requestBoost(ID);
        inputs[ID] = m.toTruckInput(frame);
      }
      prev = frame;
      if (tick === GO_TICK) race.sim.go();
      race.step(m.SIM_DT, inputs);
      return m.wireTruck(race.sim.getSnapshot().trucks[0]);
    },
  };
}

/** The client: its own sim scene, one truck, Prediction. */
async function makeClient(trackKey) {
  const scene = new m.Scene(new m.NullEngine());
  const track = loadTrack(trackKey);
  const world = await m.buildSimScene(scene, track, { havokOptions: { wasmBinary } });
  const truck = new m.Truck(scene, null, null, null, null, null, { headless: true });
  truck.terrainPhysics.random = m.rngStream(SEED, `truck:${ID}`);
  const prediction = new m.Prediction({
    truck, track, terrainManager: world.terrainManager,
    staticBodyCollisionManager: new m.StaticBodyCollisionManager(scene),
  });
  prediction.goTick = GO_TICK;
  return { prediction, truck };
}

// A server-side jump (respawn) between consecutive snapshots.
const teleported = (a, b) => Math.hypot(b.x - a.x, b.z - a.z) > 3;

const same = (snap, truck) => {
  const p = truck.mesh.position, v = truck.state.velocity;
  return p.x === snap.x && p.y === snap.y && p.z === snap.z && truck.state.heading === snap.h
    && v.x === snap.vx && v.y === snap.vy && v.z === snap.vz;
};


let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

for (const trackKey of TRACKS) {
  const steps = Math.round(SECONDS / m.SIM_DT);

  // 1. Lockstep: predict tick t, compare with the server's tick t.
  {
    const server = await makeServer(trackKey);
    const { prediction, truck } = await makeClient(trackKey);
    prediction.start(server.initial, -1); // both fresh, before any step
    let firstDiff = null;
    let respawnAt = null;
    let prevSnap = server.initial;
    for (let t = 0; t < steps && firstDiff === null; t++) {
      const snap = server.step(t);
      prediction.predictTo(t, [[t, frameAt(t)]]);
      if (teleported(prevSnap, snap)) { respawnAt = t; break; }
      prevSnap = snap;
      if (!same(snap, truck)) firstDiff = { t, dx: truck.mesh.position.x - snap.x, dz: truck.mesh.position.z - snap.z };
    }
    check(`${trackKey}: prediction matches the server exactly`, firstDiff === null,
      firstDiff ? `(first differs at tick ${firstDiff.t}: dx ${firstDiff.dx.toExponential(2)}, dz ${firstDiff.dz.toExponential(2)})`
        : respawnAt !== null ? `(${respawnAt} ticks, until the server respawned the truck)` : `(${steps} ticks)`);
  }

  // 2 + 3. Late snapshots, reconciled; then a forced error mid-race.
  {
    const server = await makeServer(trackKey);
    const { prediction, truck } = await makeClient(trackKey);
    prediction.start(server.initial, -1);
    const snaps = [];
    const KNOCK_AT = Math.round(steps / 2);
    let correctionsBeforeKnock = null;
    let respawns = 0;
    let respawnsBeforeKnock = 0;
    const lateErrors = [];
    for (let t = 0; t < steps; t++) {
      snaps[t] = server.step(t);
      if (teleported(snaps[t - 1] ?? server.initial, snaps[t])) respawns++;
      prediction.predictTo(t, [[t, frameAt(t)]]);
      if (t === KNOCK_AT) {
        correctionsBeforeKnock = prediction.stats.corrections;
        respawnsBeforeKnock = respawns;
        truck.mesh.position.x += 1.5; // knocked off: the next snapshot must fix it
      }
      const arriving = t - LATENCY_TICKS;
      if (arriving > 0 && arriving % 3 === 0) prediction.reconcile(snaps[arriving], arriving);
      // The knock's effect must have died away by the last 3 s — unless the
      // server respawned the truck in the last snapshot latency.
      const recentRespawn = snaps.slice(Math.max(0, t - 60), t + 1)
        .some((sn, k, arr) => k > 0 && teleported(arr[k - 1], sn));
      if (t > steps - 180 && !recentRespawn) {
        const p = truck.mesh.position;
        lateErrors.push(Math.hypot(p.x - snaps[t].x, p.y - snaps[t].y, p.z - snaps[t].z));
      }
    }
    // A respawn costs up to two: snapshots come every 3 ticks, so the first one
    // after it can find a tick or two predicted without it.
    check(`${trackKey}: late snapshots need no correction (beyond server respawns)`, correctionsBeforeKnock <= 2 * respawnsBeforeKnock,
      `(${correctionsBeforeKnock} corrections, ${respawnsBeforeKnock} respawns)`);
    // After a knock the truck's internals differ slightly (a snapshot carries
    // the pose, not its smoothing state), which a landing can briefly amplify
    // before the next snapshot corrects it: small nearly always, never runaway.
    lateErrors.sort((x, y) => x - y);
    const p90 = lateErrors[Math.floor(lateErrors.length * 0.9)] ?? 0;
    const worst = lateErrors.at(-1) ?? 0;
    check(`${trackKey}: a knocked-off prediction is corrected`, prediction.stats.corrections > correctionsBeforeKnock && p90 < 0.02 && worst < 0.25,
      `(${prediction.stats.corrections - correctionsBeforeKnock} correction(s) since; last 3 s error p90 ${p90.toFixed(4)} m, max ${worst.toFixed(3)} m)`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nprediction matches the server');
process.exit(failures ? 1 : 0);
