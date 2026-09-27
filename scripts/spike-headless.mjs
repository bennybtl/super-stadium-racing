// Phase 0 spike (docs/MULTIPLAYER.md): does the real physics stack run in Node?
//
//   node scripts/spike-headless.mjs [trackKey] [trucks]
//
// NullEngine + Havok (WASM) + a real track JSON from disk + the displaced ground
// mesh (Havok MESH body + drive-surface registry) + N real `Truck`s built through
// the normal constructor. Steps 600 ticks at SIM_DT with full throttle and a
// gentle weave, then prints a hash of every truck's final state plus timing and
// memory. Run it twice: identical hashes = same-machine determinism.
//
// Throwaway — the answers feed Phase 1/2, the script itself isn't kept up to date.

import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const trackKey = process.argv[2] ?? 'apple_river';
const truckCount = Number(process.argv[3] ?? 1);
const STEPS = 600;

// ── Bundle ───────────────────────────────────────────────────────────────────
const cacheDir = join(root, 'node_modules', '.cache', 'spike-headless');
mkdirSync(cacheDir, { recursive: true });
const entry = join(cacheDir, 'entry.mjs');
const src = (p) => JSON.stringify(join(root, 'src', p));
writeFileSync(entry, `
export { Truck } from ${src('truck/truck.js')};
export { Track } from ${src('world/track.js')};
export { TerrainManager } from ${src('world/terrain.js')};
export { DriveSurfaceManager } from ${src('managers/DriveSurfaceManager.js')};
export { SIM_DT } from ${src('modes/fixed-step.js')};
export { gridSlotXZ, DEFAULT_START_GRID, CHECKPOINT_GRID_BACK_OFFSET } from ${src('utils/start-grid.js')};
export { TRUCK_HALF_HEIGHT } from ${src('constants.js')};
export {
  NullEngine, Scene, Vector3, MeshBuilder, VertexBuffer,
  PhysicsAggregate, PhysicsShapeType, HavokPlugin,
} from '@babylonjs/core';
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
  define: { 'import.meta.glob': '__viteGlobStub' },
  banner: { js: 'globalThis.__viteGlobStub = () => ({});' },
  outfile: bundlePath,
  logLevel: 'error',
});

// ── Determinism shims (Phase 2 replaces these with a seeded sim RNG + sim clock)
let simTimeMs = 0;
Date.now = () => simTimeMs;
performance.now = () => simTimeMs;
let rngState = 1;
Math.random = () => {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Visual-only construction (TruckBody contact shadow → DynamicTexture) wants a
// canvas; a no-op 2D context is enough. Phase 1 moves these out of the sim path.
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop });
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return noop; } };

const m = await import(pathToFileURL(bundlePath).href);
const mem0 = process.memoryUsage();

// ── Havok ────────────────────────────────────────────────────────────────────
let t0 = process.hrtime.bigint();
const { default: HavokPhysics } = await import('@babylonjs/havok');
const wasmBinary = readFileSync(join(root, 'node_modules', '@babylonjs', 'havok', 'lib', 'esm', 'HavokPhysics.wasm'));
const havok = await HavokPhysics({ wasmBinary });
const engine = new m.NullEngine();
const scene = new m.Scene(engine);
scene.enablePhysics(new m.Vector3(0, -9.81, 0), new m.HavokPlugin(true, havok));
const msHavok = Number(process.hrtime.bigint() - t0) / 1e6;

// ── Track, terrain, ground (the sim-relevant slice of SceneBuilder.buildScene) ──
t0 = process.hrtime.bigint();
const track = m.Track.fromJSON(readFileSync(join(root, 'src', 'tracks', `${trackKey}.json`), 'utf8'));
track.setReverse(false);
const terrainSize = Math.max(track.width ?? 160, track.depth ?? 160) + 20;
const { width: gw, depth: gd, subdivisions } = track.getGroundLattice();
const cellSize = terrainSize <= 192 ? 1 : Math.max(2, Math.ceil(terrainSize / 192));
const terrainManager = new m.TerrainManager(terrainSize, cellSize, gw, gd);
for (let row = 0; row < terrainManager.cellsPerSide; row++) {
  for (let col = 0; col < terrainManager.cellsPerSide; col++) {
    const x = ((col + 0.5) / terrainManager.cellsPerSide) * gw - gw / 2;
    const z = ((row + 0.5) / terrainManager.cellsPerSide) * gd - gd / 2;
    terrainManager.setTerrainCell(col, row, track.getTerrainTypeAt(x, z));
  }
}
const driveSurfaceManager = new m.DriveSurfaceManager(scene);
scene.metadata = { ...(scene.metadata ?? {}), driveSurfaceManager };
const ground = m.MeshBuilder.CreateGround('ground', { width: gw, height: gd, subdivisions }, scene);
const pos = ground.getVerticesData(m.VertexBuffer.PositionKind);
for (let i = 0; i < pos.length; i += 3) pos[i + 1] = track.getHeightAt(pos[i], pos[i + 2]);
ground.setVerticesData(m.VertexBuffer.PositionKind, pos);
ground.createNormals(true);
driveSurfaceManager.register(ground, { kind: 'ground', lattice: track.getGroundLattice() });
new m.PhysicsAggregate(ground, m.PhysicsShapeType.MESH, { mass: 0 }, scene);
const msTrack = Number(process.hrtime.bigint() - t0) / 1e6;

// ── Trucks on the start grid ─────────────────────────────────────────────────
t0 = process.hrtime.bigint();
const gate = track.features.find((f) => f.type === 'checkpoint' && f.checkpointNumber === 1)
  ?? track.features.find((f) => f.type === 'checkpoint');
const trucks = [];
for (let i = 0; i < truckCount; i++) {
  const truck = new m.Truck(scene, null);
  const { x, z } = gate
    ? m.gridSlotXZ(i, { x: gate.centerX, z: gate.centerZ, heading: gate.heading, ...m.DEFAULT_START_GRID, backOffset: m.CHECKPOINT_GRID_BACK_OFFSET })
    : { x: (i % 2) * 3, z: Math.floor(i / 2) * 3 };
  const heading = gate?.heading ?? 0;
  truck.mesh.position.set(x, track.getHeightAt(x, z) + m.TRUCK_HALF_HEIGHT, z);
  truck.state.heading = heading;
  truck.mesh.rotation.y = heading;
  trucks.push(truck);
}
const msTrucks = Number(process.hrtime.bigint() - t0) / 1e6;

// ── Step ─────────────────────────────────────────────────────────────────────
const tickMs = [];
for (let i = 0; i < STEPS; i++) {
  const s = process.hrtime.bigint();
  const weave = Math.floor(i / 90) % 2 === 0;
  for (const truck of trucks) {
    truck.update({ forward: true, back: false, left: weave, right: !weave }, m.SIM_DT, terrainManager, track, false, null, null);
  }
  scene.getPhysicsEngine().step?.(m.SIM_DT) ?? scene.getPhysicsEngine()._step(m.SIM_DT);
  simTimeMs += m.SIM_DT * 1000;
  tickMs.push(Number(process.hrtime.bigint() - s) / 1e6);
}

// ── Report ───────────────────────────────────────────────────────────────────
const hash = createHash('sha256');
for (const t of trucks) {
  const p = t.mesh.position, v = t.state.velocity;
  hash.update(new Float64Array([p.x, p.y, p.z, v.x, v.y, v.z, t.state.heading]));
}
const first = trucks[0];
tickMs.sort((a, b) => a - b);
const mem = process.memoryUsage();
const mb = (b) => (b / 1048576).toFixed(1);
console.log(`track ${trackKey}  trucks ${truckCount}  steps ${STEPS}`);
console.log(`truck0 pos (${first.mesh.position.x.toFixed(4)}, ${first.mesh.position.y.toFixed(4)}, ${first.mesh.position.z.toFixed(4)})  speed ${first.state.velocity.length().toFixed(3)} m/s`);
console.log(`state hash ${hash.digest('hex').slice(0, 16)}`);
console.log(`init ms: havok ${msHavok.toFixed(0)}  track+ground ${msTrack.toFixed(0)}  trucks ${msTrucks.toFixed(0)}`);
console.log(`tick ms: median ${tickMs[STEPS >> 1].toFixed(3)}  p99 ${tickMs[Math.floor(STEPS * 0.99)].toFixed(3)}  max ${tickMs[STEPS - 1].toFixed(3)}`);
console.log(`rss ${mb(mem.rss)} MB (+${mb(mem.rss - mem0.rss)} after bundle load)  heap ${mb(mem.heapUsed)} MB  external ${mb(mem.external)} MB`);
process.exit(0);
