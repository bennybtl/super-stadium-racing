// Truck-physics regression check: `npm run check:physics`
//
// Drives the REAL Truck.update() — terrain physics, controls, drift, drag,
// integration, yaw pivot — through scripted scenarios on small synthetic
// tracks, at the game's fixed SIM_DT, and compares a handful of outcome
// numbers (speeds, distances, heading change, airtime…) to a golden file.
//
// Any change to handling shows up here as numbers, so a tuning tweak is a
// conscious `--update` rather than something noticed three sessions later.
// If a diff is intended: `npm run check:physics -- --update` and commit the
// golden alongside the change.
//
// Determinism: the sim runs on fixed steps, Math.random is replaced with a
// seeded PRNG (TerrainPhysics roughness bumps), and Date.now follows sim time
// (Controls' steer/drive lockout timers). Tracks are synthetic and defined
// here, so editing the real tracks never touches this check.
//
// Besides the goldens, a few invariants are checked outright: no NaN, the
// truck never sinks into the ground, speed stays within top-speed limits.

import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const goldenPath = join(__dirname, 'physics-golden.json');
const update = process.argv.includes('--update');

// ── Bundle the real truck + track modules for node ───────────────────────────
// Real @babylonjs/core (its math runs fine in node); asset imports are stubbed —
// the truck's visual subsystems are never constructed here.
const cacheDir = join(root, 'node_modules', '.cache', 'check-physics');
mkdirSync(cacheDir, { recursive: true });
const entry = join(cacheDir, 'entry.mjs');
writeFileSync(entry, `
export { Truck } from ${JSON.stringify(join(root, 'src', 'truck', 'truck.js'))};
export { TerrainPhysics } from ${JSON.stringify(join(root, 'src', 'truck', 'TerrainPhysics.js'))};
export { DriftPhysics } from ${JSON.stringify(join(root, 'src', 'truck', 'DriftPhysics.js'))};
export { Controls, SOFT_CAP_FACTOR } from ${JSON.stringify(join(root, 'src', 'truck', 'Controls.js'))};
export { Track } from ${JSON.stringify(join(root, 'src', 'world', 'track.js'))};
export { SIM_DT } from ${JSON.stringify(join(root, 'src', 'modes', 'fixed-step.js'))};
export { TRUCK_WIDTH, TRUCK_HEIGHT, TRUCK_DEPTH } from ${JSON.stringify(join(root, 'src', 'constants.js'))};
export { Vector3 } from '@babylonjs/core';
`);
const bundlePath = join(cacheDir, 'bundle.mjs');
const empty = Object.fromEntries(
  ['.png', '.jpg', '.jpeg', '.obj', '.mtl', '.glb', '.mp3', '.wav', '.ogg', '.svg'].map((e) => [e, 'empty']),
);
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  loader: empty,
  // Vite's import.meta.glob (texture/model tables in visual modules) → empty.
  define: { 'import.meta.glob': '__viteGlobStub' },
  banner: { js: 'globalThis.__viteGlobStub = () => ({});' },
  outfile: bundlePath,
  logLevel: 'silent',
});
const {
  Truck, TerrainPhysics, DriftPhysics, Controls, SOFT_CAP_FACTOR, Track, SIM_DT, Vector3,
  TRUCK_WIDTH, TRUCK_HEIGHT, TRUCK_DEPTH,
} =
  await import(pathToFileURL(bundlePath).href);

// ── Determinism shims ────────────────────────────────────────────────────────
let simTimeMs = 0;
Date.now = () => simTimeMs;
let rngState = 0;
Math.random = () => {
  // mulberry32
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ── Synthetic tracks ─────────────────────────────────────────────────────────
const makeTrack = (defaultTerrainType, features = []) =>
  Track.fromJSON(JSON.stringify({ name: 'physics-check', width: 240, depth: 240, defaultTerrainType, features }));

const TRACKS = {
  flat: makeTrack('packed_dirt'),
  asphalt: makeTrack('asphalt'),
  looseDirt: makeTrack('loose_dirt'),
  // A smooth hill across the run-up line — a launch ramp at speed.
  ramp: makeTrack('packed_dirt', [
    { type: 'hill', centerX: 0, centerZ: 0, radiusX: 14, radiusZ: 9, angle: 0, height: 3.2 },
  ]),
};

// Stands in for the game's TerrainQuery: the ground mesh is a registered drive
// surface in-game, so rays hit the heightfield and return its real normal.
function terrainQueryFor(track) {
  const e = 0.25;
  return {
    tryHeightAtFast: (x, z) => track.getHeightAt(x, z),
    // Rays always hit here, so the analytic fallback never comes into play.
    surfaceHeightAt: (x, z) => track.getHeightAt(x, z),
    castDown: (x, z) => {
      const nx = track.getHeightAt(x - e, z) - track.getHeightAt(x + e, z);
      const nz = track.getHeightAt(x, z - e) - track.getHeightAt(x, z + e);
      return { y: track.getHeightAt(x, z), normal: new Vector3(nx, 2 * e, nz).normalize() };
    },
    getLastResolvedSurface: () => null,
  };
}

const NOOP = { update() {} };

/**
 * A player Truck with only its simulation parts. Mirrors the sim wiring in the
 * Truck constructor (state, TerrainPhysics options, DriftPhysics, Controls,
 * surface sampler); visual subsystems are no-op stubs. If the constructor's
 * sim wiring changes, change it here too.
 */
function makeTruck(track, { x = 0, z = -60, heading = 0 } = {}) {
  const t = Object.create(Truck.prototype);
  Object.assign(t, {
    scene: { metadata: {} },
    driver: null,
    vehicleDef: null,
    vehicleName: 'Truck',
    upgrades: {},
    // Dimensions as the constructor derives them without a vehicleDef.
    width: TRUCK_WIDTH, height: TRUCK_HEIGHT, depth: TRUCK_DEPTH,
  });
  t.halfHeight = t.height / 2;
  t.radius = Math.sqrt((t.width / 2) ** 2 + (t.depth / 2) ** 2);
  t.mesh = {
    position: new Vector3(x, track.getHeightAt(x, z) + t.halfHeight, z),
    rotation: { x: 0, y: heading, z: 0 },
    metadata: {},
  };
  t.physics = null;
  t.state = t.createState();
  t.state.heading = heading;
  t.particles = NOOP;
  t.audioController = null;
  t.terrainPhysics = new TerrainPhysics(t.state, t.halfHeight, terrainQueryFor(track), {
    normalSampleInterval: 0,
    multiProbeSurfaceSampling: true,
    multiProbeHalfTrack: t.width * 0.42,
    multiProbeMaxLift: t.height * 0.35,
  });
  t._driveSurfaceManager = null;
  t._aiMultiProbeSticky = 0;
  t.driftPhysics = new DriftPhysics(t.state);
  t.controls = new Controls(t.state);
  t._forward = new Vector3();
  t._simFrame = {};
  t._surfaceSampleTrack = null;
  t._surfaceSampleFallback = 0;
  t._surfaceSampler = (sx, sz, fromY, fallback = t._surfaceSampleFallback) =>
    t.terrainPhysics.sampleSurfaceYFastAt(sx, sz, fromY, t._surfaceSampleTrack, fallback);
  t._particleUpdateInterval = 0;
  t._particleUpdateAccumulator = 0;
  t._bodyUpdateInterval = 0;
  t._bodyUpdateIntervalMid = 0;
  t._bodyUpdateIntervalFar = 0;
  t._bodyUpdateAccumulator = 0;
  t.body = NOOP;
  t.tireMarks = NOOP;
  t.wakeRibbon = NOOP;
  t.headlights = [];
  return t;
}

// ── Runner ───────────────────────────────────────────────────────────────────
let failures = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };

const terrainManagerFor = (track) => ({
  getTerrainAt: (p) => track.getTerrainTypeAt(p.x, p.z) ?? track.defaultTerrainType,
});

/**
 * Run `truck` for `seconds` with `inputAt(t, truck)` giving each step's input.
 * `onStep(t, truck)` observes. Invariants are checked every step.
 */
function run(label, truck, track, seconds, inputAt, onStep = () => {}) {
  const tm = terrainManagerFor(track);
  const steps = Math.round(seconds / SIM_DT);
  // Throttle can push past maxSpeed up to the soft cap (see Controls); nitro
  // multiplies that. A little margin for gravity on down-slopes.
  const limit = truck.state.maxSpeed * truck.state.boostSpeedMult * SOFT_CAP_FACTOR * 1.05;
  for (let i = 0; i < steps; i++) {
    const t = i * SIM_DT;
    truck.update(inputAt(t, truck), SIM_DT, tm, track, false, null, null);
    simTimeMs += SIM_DT * 1000;
    const p = truck.mesh.position;
    const v = truck.state.velocity;
    if (![p.x, p.y, p.z, v.x, v.y, v.z, truck.state.heading].every(Number.isFinite)) {
      fail(`${label}: non-finite state at t=${t.toFixed(3)}`);
      return;
    }
    const floor = track.getHeightAt(p.x, p.z);
    if (p.y < floor - 0.25) {
      fail(`${label}: truck centre ${(floor - p.y).toFixed(2)} m below ground at t=${t.toFixed(3)}`);
      return;
    }
    const hs = Math.hypot(v.x, v.z);
    if (hs > limit) {
      fail(`${label}: speed ${hs.toFixed(1)} m/s over limit ${limit.toFixed(1)} at t=${t.toFixed(3)}`);
      return;
    }
    onStep(t + SIM_DT, truck);
  }
}

const input = (o = {}) => ({ forward: false, back: false, left: false, right: false, ...o });
const GAS = input({ forward: true });
const hSpeed = (tr) => Math.hypot(tr.state.velocity.x, tr.state.velocity.z);
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const fresh = (track, opts) => {
  simTimeMs = 0;
  rngState = 12345;
  return makeTruck(track, opts);
};

const results = {};

// 1. Straight-line acceleration from rest.
{
  const tr = fresh(TRACKS.flat);
  const out = {};
  run('accel', tr, TRACKS.flat, 6, () => GAS, (t, tk) => {
    for (const s of [1, 2, 4, 6]) if (Math.abs(t - s) < SIM_DT / 2) out[`speed@${s}s`] = r4(hSpeed(tk));
  });
  out.distance = r4(tr.mesh.position.z + 60);
  results.accel = out;
}

// 2. Braking to a stop from 6 s of throttle.
{
  const tr = fresh(TRACKS.flat);
  run('brake', tr, TRACKS.flat, 6, () => GAS);
  const z0 = tr.mesh.position.z;
  const v0 = hSpeed(tr);
  let stopT = null;
  run('brake', tr, TRACKS.flat, 8, () => input({ back: true }), (t, tk) => {
    if (stopT === null && hSpeed(tk) < 0.5) stopT = t;
  });
  results.brake = { startSpeed: r4(v0), stopTime: stopT === null ? null : r4(stopT), stopDistance: null };
  // Re-run to measure the distance at the stop instant exactly.
  const tr2 = fresh(TRACKS.flat);
  run('brake', tr2, TRACKS.flat, 6, () => GAS);
  let stopZ = null;
  run('brake', tr2, TRACKS.flat, 8, () => input({ back: true }), (t, tk) => {
    if (stopZ === null && hSpeed(tk) < 0.5) stopZ = tk.mesh.position.z;
  });
  results.brake.stopDistance = stopZ === null ? null : r4(stopZ - z0);
}

// 3. Coasting: drag alone for 3 s after reaching speed.
{
  const tr = fresh(TRACKS.flat);
  run('coast', tr, TRACKS.flat, 5, () => GAS);
  const v0 = hSpeed(tr);
  run('coast', tr, TRACKS.flat, 3, () => input());
  results.coast = { startSpeed: r4(v0), speedAfter3s: r4(hSpeed(tr)) };
}

// 4. Sustained right turn under throttle — drift, scrub, heading rate.
{
  const tr = fresh(TRACKS.flat, { x: 0, z: -80 });
  run('turn', tr, TRACKS.flat, 3, () => GAS);
  const h0 = tr.state.heading;
  let maxSlip = 0;
  run('turn', tr, TRACKS.flat, 2.5, () => input({ forward: true, right: true }), (t, tk) => {
    maxSlip = Math.max(maxSlip, tk.state.slipAngle ?? 0);
  });
  results.turn = {
    headingChange: r4(tr.state.heading - h0),
    maxSlipAngle: r4(maxSlip),
    endSpeed: r4(hSpeed(tr)),
    endX: r4(tr.mesh.position.x),
    endZ: r4(tr.mesh.position.z),
  };
}

// 5. Slalom — alternating steer; sensitive to every stage of the integration.
{
  const tr = fresh(TRACKS.flat, { x: 0, z: -90 });
  run('slalom', tr, TRACKS.flat, 2, () => GAS);
  run('slalom', tr, TRACKS.flat, 6, (t) => input({
    forward: true,
    left: Math.floor(t / 0.8) % 2 === 0,
    right: Math.floor(t / 0.8) % 2 === 1,
  }));
  results.slalom = {
    endX: r4(tr.mesh.position.x),
    endZ: r4(tr.mesh.position.z),
    endHeading: r4(tr.state.heading),
    endSpeed: r4(hSpeed(tr)),
  };
}

// 6. Nitro: 3 s of throttle, fire the boost, 3 s more.
{
  const tr = fresh(TRACKS.flat, { x: 0, z: -100 });
  run('nitro', tr, TRACKS.flat, 3, () => GAS);
  const v0 = hSpeed(tr);
  tr.state.boostActive = true;
  tr.state.boostTimer = tr.state.boostDuration;
  let peak = 0;
  run('nitro', tr, TRACKS.flat, 3, () => GAS, (t, tk) => { peak = Math.max(peak, hSpeed(tk)); });
  results.nitro = { speedAtFire: r4(v0), peakSpeed: r4(peak), speedAfter3s: r4(hSpeed(tr)) };
}

// 7. Surface grip/drag: 3 s of throttle on other surfaces.
for (const name of ['asphalt', 'looseDirt']) {
  const tr = fresh(TRACKS[name]);
  run(name, tr, TRACKS[name], 3, () => GAS);
  results[`surface_${name}`] = { speed: r4(hSpeed(tr)), distance: r4(tr.mesh.position.z + 60) };
}

// 8. Jump: full throttle over the hill. Airtime, apex, and horizontal speed
//    kept through the landing (the old airborne-momentum bug lost it here).
{
  const tr = fresh(TRACKS.ramp, { x: 0, z: -70 });
  let air = 0, apex = 0, preTakeoff = null, postLanding = null, wasAir = false;
  run('jump', tr, TRACKS.ramp, 6, () => GAS, (t, tk) => {
    const p = tk.mesh.position;
    const clearance = p.y - tk.halfHeight - TRACKS.ramp.getHeightAt(p.x, p.z);
    const airborne = clearance > 0.15;
    if (airborne) {
      if (!wasAir && preTakeoff === null) preTakeoff = hSpeed(tk);
      air += SIM_DT;
      apex = Math.max(apex, clearance);
    } else if (wasAir && postLanding === null) {
      postLanding = hSpeed(tk);
    }
    wasAir = airborne;
  });
  results.jump = {
    airtime: r4(air),
    apex: r4(apex),
    takeoffSpeed: preTakeoff === null ? null : r4(preTakeoff),
    landingSpeed: postLanding === null ? null : r4(postLanding),
    endZ: r4(tr.mesh.position.z),
  };
}

// ── Compare / record ─────────────────────────────────────────────────────────
if (update) {
  writeFileSync(goldenPath, JSON.stringify(results, null, 2) + '\n');
  console.log(`recorded ${Object.keys(results).length} scenarios → scripts/physics-golden.json`);
  for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(18)} ${JSON.stringify(v)}`);
  process.exit(failures ? 1 : 0);
}

if (!existsSync(goldenPath)) {
  console.log('no golden yet — run: npm run check:physics -- --update');
  process.exit(1);
}
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
const TOL = 1e-3;
for (const [scenario, metrics] of Object.entries(results)) {
  const g = golden[scenario];
  if (!g) { fail(`${scenario}: no golden entry — run with --update`); continue; }
  const diffs = [];
  for (const [k, v] of Object.entries(metrics)) {
    const gv = g[k];
    const same = v === gv || (typeof v === 'number' && typeof gv === 'number' && Math.abs(v - gv) <= TOL);
    if (!same) diffs.push(`${k}: ${gv} → ${v}`);
  }
  if (diffs.length) fail(`${scenario}\n        ${diffs.join('\n        ')}`);
  else console.log(`ok    ${scenario}`);
}
console.log(failures
  ? `\n${failures} physics check(s) failed — if the handling change is intended, re-record with --update`
  : '\nall physics checks pass');
process.exit(failures ? 1 : 0);
