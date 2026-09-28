// Sim determinism check: `npm run check:determinism`
//
// Builds the real sim scene (sim/sim-scene.js) under NullEngine for a few
// tracks, puts four human-driven trucks on the grid, and runs RaceSimulation
// for 15 s of scripted input. Checks:
//
//   1. same seed + same inputs → bit-identical final state, across fresh
//      scenes (a new Havok instance each run);
//   2. nothing in a sim step touches Math.random, Date.now or performance.now —
//      they throw while stepping, so an unseeded draw or a wall-clock timer
//      creeping back into the sim fails here, not as a desync in a race.
//
// AI drivers aren't covered yet: AIDriver pulls in the Vue debug store, so it
// doesn't construct headless (docs/MULTIPLAYER.md, Phase 2 notes).

import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { installHeadlessEnv } from '../server/lobby/headless-env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const TRACKS = ['apple_river', 'quarry_run', 'the_road'];
const SECONDS = 15;
const TRUCKS = 4;

// ── Bundle ───────────────────────────────────────────────────────────────────
const cacheDir = join(root, 'node_modules', '.cache', 'check-sim-determinism');
mkdirSync(cacheDir, { recursive: true });
const entry = join(cacheDir, 'entry.mjs');
const src = (p) => JSON.stringify(join(root, 'src', p));
writeFileSync(entry, `
export { Track } from ${src('world/track.js')};
export { createRace } from ${src('sim/headless-race.js')};
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
  loader: Object.fromEntries(
    ['.png', '.jpg', '.jpeg', '.obj', '.mtl', '.glb', '.mp3', '.wav', '.ogg', '.svg'].map((e) => [e, 'empty']),
  ),
  define: { 'import.meta.glob': '__viteGlobStub' },
  banner: { js: 'globalThis.__viteGlobStub = () => ({});' },
  outfile: bundlePath,
  logLevel: 'error',
});

// ── Headless environment ─────────────────────────────────────────────────────
installHeadlessEnv();
const quietDebug = console.debug;
console.debug = () => {};

const m = await import(pathToFileURL(bundlePath).href);
const { default: HavokPhysics } = await import('@babylonjs/havok');
const wasmBinary = readFileSync(join(root, 'node_modules', '@babylonjs', 'havok', 'lib', 'esm', 'HavokPhysics.wasm'));

// Obstacle definitions straight from disk (no model: physics only).
const obstacleDir = join(root, 'src', 'obstacles');
const obstacleDefs = new Map(readdirSync(obstacleDir).filter((f) => f.endsWith('.json')).map((f) => {
  const def = JSON.parse(readFileSync(join(obstacleDir, f), 'utf8'));
  return [def.id ?? f.slice(0, -5), def];
}));
m.setObstacleLoader({ getObstacle: (id) => obstacleDefs.get(id) ?? null, obstacleList: [...obstacleDefs.keys()] });

// ── Forbid unseeded time/randomness while stepping ───────────────────────────
const real = { random: Math.random, dateNow: Date.now, perfNow: performance.now.bind(performance) };
let forbidden = null;
const guard = (name, fn) => (...a) => {
  if (forbidden) throw new Error(`${name} called inside a sim step`);
  return fn(...a);
};
Math.random = guard('Math.random', real.random);
Date.now = guard('Date.now', real.dateNow);
performance.now = guard('performance.now', real.perfNow);

/** Scripted input for truck `i` at step `n`: throttle, a weave of its own
 *  period, and (truck 3) a periodic brake. */
function inputFor(i, n) {
  const period = 70 + i * 25;
  const left = Math.floor(n / period) % 2 === 0;
  const brake = i === 3 && n % 240 > 200;
  return { forward: !brake, back: brake, left, right: !left };
}

async function runRace(trackKey, seed) {
  const engine = new m.NullEngine();
  const scene = new m.Scene(engine);
  const track = m.Track.fromJSON(readFileSync(join(root, 'src', 'tracks', `${trackKey}.json`), 'utf8'));
  track.setReverse(false);
  const players = Array.from({ length: TRUCKS }, (_, i) => ({ id: `p${i}` }));
  const { sim, trucks } = await m.createRace({ scene, track, players, laps: 3, seed, havokOptions: { wasmBinary } });
  sim.go();

  const steps = Math.round(SECONDS / m.SIM_DT);
  forbidden = true;
  try {
    for (let n = 0; n < steps; n++) {
      const inputs = {};
      trucks.forEach((td, i) => { inputs[td.id] = inputFor(i, n); });
      sim.step(m.SIM_DT, inputs);
    }
  } finally {
    forbidden = null;
  }

  const hash = createHash('sha256');
  for (const td of trucks) {
    const p = td.truck.mesh.position, v = td.truck.state.velocity;
    hash.update(new Float64Array([p.x, p.y, p.z, v.x, v.y, v.z, td.truck.state.heading, td.gameState.checkpointCount]));
  }
  scene.dispose();
  engine.dispose();
  return hash.digest('hex').slice(0, 16);
}

let failures = 0;
for (const trackKey of TRACKS) {
  try {
    const a = await runRace(trackKey, 1234);
    const b = await runRace(trackKey, 1234);
    if (a !== b) {
      failures++;
      console.log(`FAIL  ${trackKey}: same seed diverged (${a} vs ${b})`);
    } else {
      // Informational: a different seed should usually differ (roughness bumps
      // draw from it); a track with no rough ground legitimately won't.
      const other = await runRace(trackKey, 99);
      console.log(`ok    ${trackKey}  ${a}${other === a ? '  (seed-independent: no rough ground hit)' : ''}`);
    }
  } catch (err) {
    failures++;
    console.log(`FAIL  ${trackKey}: ${err.message}`);
    console.log(err.stack.split('\n').slice(1, 6).join('\n'));
  }
}

console.debug = quietDebug;
console.log(failures ? `\n${failures} track(s) failed` : `\nsim is deterministic on ${TRACKS.length} tracks`);
process.exit(failures ? 1 : 0);
