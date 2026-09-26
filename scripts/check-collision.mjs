// Drive-box collision check: `npm run check:collision`
//
// Drives the REAL Truck.update() into real DriveBox decks and colliders — the
// deck heights answered by DriveSurfaceManager/TerrainQuery surface layers, the
// faces by StaticBodyCollisionManager — in the game's order (truck step, then
// collision), at SIM_DT. Each scenario asserts an outcome: the truck climbs,
// crests, gets blocked, and whether the collider had to push it at all.
//
// Covers the ramp cases that regressed while the truck's collision box learned
// to tilt with the chassis: a ramp running into a flat box (a false hit on the
// box face), and steep ramps (the collider fighting the lagging pitch until the
// truck stalled and slid back).
//
// Babylon runs on a NullEngine; PhysicsAggregate is stubbed (collision here is
// StaticBodyCollisionManager's own, not Havok's).

import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// ── Bundle ───────────────────────────────────────────────────────────────────
const cacheDir = join(root, 'node_modules', '.cache', 'check-collision');
mkdirSync(cacheDir, { recursive: true });
const src = (p) => JSON.stringify(join(root, 'src', p));
const shimPath = join(cacheDir, 'babylon-shim.mjs');
writeFileSync(shimPath, `export * from '@babylonjs/core/index.js';
export class PhysicsAggregate { constructor() {} dispose() {} }
`);
const entry = join(cacheDir, 'entry.mjs');
writeFileSync(entry, `
export { Truck } from ${src('truck/truck.js')};
export { TerrainPhysics } from ${src('truck/TerrainPhysics.js')};
export { DriftPhysics } from ${src('truck/DriftPhysics.js')};
export { Controls } from ${src('truck/Controls.js')};
export { Track } from ${src('world/track.js')};
export { SIM_DT } from ${src('modes/fixed-step.js')};
export { TRUCK_WIDTH, TRUCK_HEIGHT, TRUCK_DEPTH, TRUCK_COLLISION_STEP_LIFT } from ${src('constants.js')};
export { DriveSurfaceManager } from ${src('managers/DriveSurfaceManager.js')};
export { TerrainQuery } from ${src('managers/TerrainQuery.js')};
export { StaticBodyCollisionManager } from ${src('managers/StaticBodyCollisionManager.js')};
export { BridgeMeshManager } from ${src('managers/BridgeMeshManager.js')};
export { TunnelManager } from ${src('managers/TunnelManager.js')};
export { deriveTunnel } from ${src('world/tunnel-geometry.js')};
export { NullEngine, Scene, MeshBuilder, Vector3, Logger } from '@babylonjs/core';
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
  plugins: [{
    name: 'stub-physics-aggregate',
    setup(build) {
      build.onResolve({ filter: /^@babylonjs\/core$/ }, (a) => (a.importer === shimPath ? undefined : { path: shimPath }));
    },
  }],
  outfile: bundlePath,
  logLevel: 'error',
});
const M = await import(pathToFileURL(bundlePath).href);
const { Truck, TerrainPhysics, DriftPhysics, Controls, Track, SIM_DT, Vector3 } = M;

// ── Determinism shims (as check-physics) ─────────────────────────────────────
let simTimeMs = 0;
Date.now = () => simTimeMs;
let rngState = 0;
Math.random = () => {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
M.Logger.LogLevels = M.Logger.WarningLogLevel | M.Logger.ErrorLogLevel; // no engine banner

// ── World ────────────────────────────────────────────────────────────────────
// A flat track with the features built the way SceneBuilder builds them: the
// ground registered as a lattice layer, decks/colliders via BridgeMeshManager.
function makeWorld(features) {
  const track = Track.fromJSON(JSON.stringify({
    name: 'collision-check', width: 120, depth: 120, defaultTerrainType: 'packed_dirt', features,
  }));
  const scene = new M.Scene(new M.NullEngine());
  const dsm = new M.DriveSurfaceManager(scene);
  scene.metadata = { driveSurfaceManager: dsm };
  const lattice = track.getGroundLattice();
  const ground = M.MeshBuilder.CreateGround('ground', {
    width: lattice.width, height: lattice.depth, subdivisions: lattice.subdivisions, updatable: true,
  }, scene);
  // Raised to the track's heights, as SceneBuilder does.
  const positions = ground.getVerticesData('position');
  for (let i = 0; i < positions.length; i += 3) positions[i + 1] = track.getHeightAt(positions[i], positions[i + 2]);
  ground.setVerticesData('position', positions);
  ground.createNormals(true);
  dsm.register(ground, { kind: 'ground', lattice });
  const bridges = new M.BridgeMeshManager(scene, track, null, dsm, null);
  for (const f of track.features) if (f.type === 'driveBox' || f.type === 'bridgeMesh') bridges.create(f);
  new M.TunnelManager(scene, track, dsm).rebuild();
  // A rendered frame would compute these; the collision broadphase reads the
  // colliders' world bounds.
  for (const mesh of scene.meshes) mesh.computeWorldMatrix(true);
  return { track, dsm, terrainQuery: new M.TerrainQuery(scene), collision: new M.StaticBodyCollisionManager(scene) };
}

/**
 * A player Truck with only its simulation parts, as check-physics' makeTruck,
 * plus the chassis box the constructor sets up for static collision.
 */
function makeTruck(world, { x, z, heading }) {
  const { track, terrainQuery, dsm } = world;
  const t = Object.create(Truck.prototype);
  Object.assign(t, {
    scene: { metadata: {} }, driver: null, vehicleDef: null, vehicleName: 'Truck', upgrades: {},
    width: M.TRUCK_WIDTH, height: M.TRUCK_HEIGHT, depth: M.TRUCK_DEPTH,
  });
  t.halfHeight = t.height / 2;
  t.radius = Math.hypot(t.width / 2, t.depth / 2);
  t.chassisBox = {
    halfHeight: t.halfHeight - M.TRUCK_COLLISION_STEP_LIFT / 2,
    offsetY: M.TRUCK_COLLISION_STEP_LIFT / 2,
  };
  t.mesh = {
    // Placed as a respawn would be: on a tunnel floor inside one.
    position: new Vector3(x, terrainQuery.respawnHeightAt(x, z, track) + t.halfHeight, z),
    rotation: new Vector3(0, heading, 0),
    metadata: {},
    uniqueId: 1,
  };
  t.physics = null;
  t.state = t.createState();
  t.state.heading = heading;
  t.particles = { update() {} };
  t.audioController = null;
  t.terrainPhysics = new TerrainPhysics(t.state, t.halfHeight, terrainQuery, {
    normalSampleInterval: 0,
    multiProbeSurfaceSampling: true,
    multiProbeHalfTrack: t.width * 0.42,
    multiProbeMaxLift: t.height * 0.35,
  });
  t._driveSurfaceManager = dsm;
  t._aiMultiProbeSticky = 0;
  t.driftPhysics = new DriftPhysics(t.state);
  t.controls = new Controls(t.state);
  t._forward = new Vector3();
  t._surfaceSampleTrack = null;
  t._surfaceSampleFallback = 0;
  t._surfaceSampler = (sx, sz, fromY, fallback = t._surfaceSampleFallback) =>
    t.terrainPhysics.sampleSurfaceYFastAt(sx, sz, fromY, t._surfaceSampleTrack, fallback);
  for (const k of ['_particleUpdateInterval', '_particleUpdateAccumulator', '_bodyUpdateInterval',
    '_bodyUpdateIntervalMid', '_bodyUpdateIntervalFar', '_bodyUpdateAccumulator']) t[k] = 0;
  t.body = { update() {} };
  t.tireMarks = { update() {} };
  t.wakeRibbon = { update() {} };
  t.headlights = [];
  world.collision.notifyTeleport(t);
  return t;
}

/**
 * Full throttle for `seconds` from `start` (default: x = -20 heading +X);
 * `setup(truck)` can adjust the truck first. Returns what happened, plus the
 * truck's track of y against x (`path`) for the tunnel checks.
 */
function driveAt(features, seconds, { start = { x: -20, z: 0, heading: Math.PI / 2 }, setup = null } = {}) {
  simTimeMs = 0;
  rngState = 12345;
  const world = makeWorld(features);
  const truck = makeTruck(world, start);
  setup?.(truck);
  const terrain = { getTerrainAt: (p) => world.track.getTerrainTypeAt(p.x, p.z) ?? world.track.defaultTerrainType };
  const gas = { forward: true, back: false, left: false, right: false };
  const out = { pushes: 0, maxPush: 0, maxY: -Infinity, minVx: Infinity /* never rolled back */, maxAbsZ: 0, path: [] };
  const afterSim = new Vector3();
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    truck.update(gas, SIM_DT, terrain, world.track, false, null, null);
    afterSim.copyFrom(truck.mesh.position);
    world.collision.update([truck], SIM_DT);
    simTimeMs += SIM_DT * 1000;
    const push = Vector3.Distance(afterSim, truck.mesh.position);
    if (push > 1e-4) { out.pushes++; out.maxPush = Math.max(out.maxPush, push); }
    out.maxY = Math.max(out.maxY, truck.mesh.position.y);
    out.minVx = Math.min(out.minVx, truck.state.velocity.x);
    out.maxAbsZ = Math.max(out.maxAbsZ, Math.abs(truck.mesh.position.z));
    out.path.push({ x: truck.mesh.position.x, y: truck.mesh.position.y, top: truck.mesh.position.y + truck.halfHeight });
  }
  out.x = truck.mesh.position.x;
  return out;
}

// ── Scenarios ────────────────────────────────────────────────────────────────
const wedge = (rise, extra = {}) => ({
  type: 'driveBox', centerX: 0, centerZ: 0, width: 8, depth: 6, rotation: 0, heightAtMin: 0, heightAtMax: rise, ...extra,
});
const box = (height, extra = {}) => ({
  type: 'driveBox', centerX: 0, centerZ: 0, width: 8, depth: 8, rotation: 0, height, ...extra,
});

const SCENARIOS = [
  {
    name: 'ramp into flat box: drives onto the box, no push',
    features: [wedge(2, { width: 10 }), box(2, { centerX: 8, width: 6, depth: 6 })],
    seconds: 4,
    expect: (r) => r.pushes === 0 && r.x > 20 && r.maxY > 2,
  },
  ...[3, 5, 7].map((rise) => ({
    name: `steep ramp ${Math.round(Math.atan(rise / 8) * 180 / Math.PI)}°: climbs and crests, no push`,
    features: [wedge(rise)],
    seconds: 4,
    expect: (r) => r.pushes === 0 && r.maxY > rise && r.x > 10 && r.minVx > -0.1,
  })),
  {
    name: 'ramp taken diagonally: no push',
    features: [wedge(2, { width: 10, depth: 10, rotation: 35 })],
    seconds: 3.2,
    expect: (r) => r.pushes === 0 && r.x > 20,
  },
  {
    name: '3 m box side: blocked',
    features: [box(3)],
    seconds: 3.2,
    expect: (r) => r.pushes > 0 && r.x < -5,
  },
  {
    name: "3 m wedge's back face: blocked",
    features: [wedge(3, { width: 8, depth: 8, rotation: 180 })],
    seconds: 3.2,
    expect: (r) => r.pushes > 0 && r.x < -5,
  },
  {
    // Taller than the chassis box's lifted bottom, so its face catches the truck.
    name: '0.6 m box side: blocked',
    features: [box(0.6)],
    seconds: 3.2,
    expect: (r) => r.pushes > 0 && r.x < -5,
  },
];

// A 12 m square hill across x = 0 (40 m along the tunnel), and a tunnel
// through it along the x axis, drawn out to flat ground at both ends: floor
// at 0, crown at 6.
const hill = { type: 'squareHill', centerX: 0, centerZ: 0, width: 40, depth: 60, height: 12, angle: 0 };
const tunnel = { type: 'tunnel', points: [{ x: -52, z: 0 }, { x: 52, z: 0 }], width: 10, height: 6, cover: 2 };
const HALF_HEIGHT = M.TRUCK_HEIGHT / 2;
const inside = (p) => Math.abs(p.x) < 18; // well inside the hill (faces at |x| ≈ 18.9)

SCENARIOS.push(
  {
    name: 'tunnel: drives through on the floor, never onto the hill',
    features: [hill, tunnel],
    seconds: 6,
    start: { x: -48, z: 0, heading: Math.PI / 2 },
    expect: (r) => r.x > 30 && r.path.filter(inside).every((p) => p.y < HALF_HEIGHT + 0.6) && r.pushes === 0,
  },
  {
    name: 'tunnel: a wall stops a truck steering into it',
    features: [hill, tunnel],
    seconds: 3,
    start: { x: -12, z: 0, heading: Math.PI / 2 - 0.6 },
    expect: (r) => r.pushes > 0 && r.maxAbsZ < 5,
  },
  {
    name: 'tunnel: the roof stops a truck launched up inside',
    features: [hill, tunnel],
    seconds: 1.5,
    start: { x: 0, z: 0, heading: Math.PI / 2 },
    setup: (t) => { t.state.velocity.y = 20; },
    expect: (r) => r.path.every((p) => p.top <= 6 + 1e-6) && r.path.some((p) => p.top > 5.9),
  },
  {
    name: 'tunnel: the headwall beside the mouth blocks',
    features: [hill, tunnel],
    seconds: 3,
    start: { x: -36, z: -8.5, heading: Math.PI / 2 },
    expect: (r) => r.pushes > 0 && r.x < -20,
  },
);

let failures = 0;
for (const s of SCENARIOS) {
  const r = driveAt(s.features, s.seconds, { start: s.start, setup: s.setup });
  const detail = `end x=${r.x.toFixed(2)}, max y=${r.maxY.toFixed(2)}, pushes=${r.pushes}` +
    (r.pushes ? ` (max ${r.maxPush.toFixed(2)} m)` : '');
  if (s.expect(r)) {
    console.log(`ok    ${s.name}`);
  } else {
    failures++;
    console.log(`FAIL  ${s.name}\n        ${detail}`);
  }
}

// Respawn height (AI recovery): the tunnel floor inside a tunnel's footprint,
// the hill beside it, and the hilltop when not over the tunnel.
{
  const world = makeWorld([hill, tunnel]);
  const at = (x, z) => world.terrainQuery.respawnHeightAt(x, z, world.track);
  const checks = [
    ['respawn inside a tunnel lands on its floor', Math.abs(at(0, 0) - 0.1) < 0.05, at(0, 0)],
    ['respawn on the hill beside a tunnel stays on the hill', Math.abs(at(0, 20) - 12) < 0.05, at(0, 20)],
    ['respawn in a cutting lands on its floor', Math.abs(at(-30, 0)) < 0.15, at(-30, 0)],
  ];
  for (const [name, ok, y] of checks) {
    if (ok) console.log(`ok    ${name}`);
    else { failures++; console.log(`FAIL  ${name}\n        y=${y.toFixed(2)}`); }
  }
}

if (failures) {
  console.log(`\n${failures} collision check(s) failed`);
  process.exit(1);
}
console.log('\nall collision checks pass');
