// Measures the per-slider-tick cost of EditorMode's rebuild.terrain at several
// ground-lattice densities, to size up raising the 64-subdivision cap.
//
// Mirrors the real sequence exactly (EditorMode.js:126-135):
//   getVerticesData → vertex loop (dirty-region gated getHeightAt)
//   → setVerticesData → createNormals(true)
//
// Real Babylon under NullEngine, real Track height math (bundled with the same
// stub check-terrain.mjs uses). Not covered: the GL buffer upload (no-op under
// NullEngine) and the Havok physics shape (race-mode load cost, not per-tick).

import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import esbuild from 'esbuild';
import { NullEngine, Scene, MeshBuilder, VertexBuffer } from '@babylonjs/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = '/Users/benjaminlloyd/offroad';

// ── Track (bundled for node, same trick as check-terrain.mjs) ────────────────
const cacheDir = join(root, 'node_modules', '.cache', 'bench-terrain');
mkdirSync(cacheDir, { recursive: true });
const bundlePath = join(cacheDir, 'track-bundle.mjs');
await esbuild.build({
  entryPoints: [join(root, 'src', 'track.js')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { '@babylonjs/core': join(root, 'scripts', 'babylon-stub.mjs') },
  outfile: bundlePath,
  logLevel: 'silent',
});
const { Track } = await import(pathToFileURL(bundlePath).href);

const trackName = process.argv[2] ?? 'apple_river';
const track = Track.fromJSON(readFileSync(join(root, 'src', 'tracks', `${trackName}.json`), 'utf8'));

const { width: groundWidth, depth: groundDepth } = track.getGroundLattice();

// Pick a hill to "drag" — its bounds become the dirty region, as in a radius drag.
const hill = track.features.find(f => f.type === 'hill') ?? null;
const region = hill ? track.getFeatureHeightBounds(hill) : null;

const engine = new NullEngine();
const scene = new Scene(engine);

const ITERS = 40;
const WARMUP = 8;

function bench(subdivisions) {
  const ground = MeshBuilder.CreateGround('ground',
    { width: groundWidth, height: groundDepth, subdivisions }, scene);

  // Initial full displacement (load-time cost), so the mesh starts realistic.
  const p0 = ground.getVerticesData(VertexBuffer.PositionKind);
  const tLoad0 = performance.now();
  for (let i = 0; i < p0.length; i += 3) p0[i + 1] = track.getHeightAt(p0[i], p0[i + 2]);
  ground.setVerticesData(VertexBuffer.PositionKind, p0);
  ground.createNormals(true);
  const loadMs = performance.now() - tLoad0;

  const vertexCount = p0.length / 3;
  const triCount = ground.getIndices().length / 3;

  // Per-tick, dirty-region (what a hill slider drag actually does).
  const phase = { get: 0, loop: 0, set: 0, normals: 0 };
  let heightCalls = 0;
  for (let it = 0; it < ITERS + WARMUP; it++) {
    const record = it >= WARMUP;
    let t = performance.now();
    const positions = ground.getVerticesData(VertexBuffer.PositionKind);
    if (record) phase.get += performance.now() - t;

    t = performance.now();
    let calls = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], z = positions[i + 2];
      if (region && (x < region.minX || x > region.maxX ||
                     z < region.minZ || z > region.maxZ)) continue;
      positions[i + 1] = track.getHeightAt(x, z);
      calls++;
    }
    if (record) { phase.loop += performance.now() - t; heightCalls = calls; }

    t = performance.now();
    ground.setVerticesData(VertexBuffer.PositionKind, positions);
    if (record) phase.set += performance.now() - t;

    t = performance.now();
    ground.createNormals(true);
    if (record) phase.normals += performance.now() - t;
  }

  // Same again with no dirty region (full recompute — first tick on a feature,
  // and every tick for edits that don't name one).
  let fullLoop = 0;
  for (let it = 0; it < ITERS + WARMUP; it++) {
    const positions = ground.getVerticesData(VertexBuffer.PositionKind);
    const t = performance.now();
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] = track.getHeightAt(positions[i], positions[i + 2]);
    }
    if (it >= WARMUP) fullLoop += performance.now() - t;
  }

  ground.dispose();

  const per = v => v / ITERS;
  const tick = per(phase.get + phase.loop + phase.set + phase.normals);
  return {
    subdivisions, vertexCount, triCount, loadMs, heightCalls,
    get: per(phase.get), loop: per(phase.loop), set: per(phase.set),
    normals: per(phase.normals), tick,
    fullTick: tick - per(phase.loop) + per(fullLoop),
  };
}

console.log(`track: ${trackName}  ground ${groundWidth}x${groundDepth}`);
console.log(`dirty region: ${region ? `${(region.maxX - region.minX).toFixed(1)} x ${(region.maxZ - region.minZ).toFixed(1)} units (hill r=${hill.radius ?? hill.width ?? '?'})` : 'none (full rebuild only)'}`);
console.log(`${ITERS} timed iterations after ${WARMUP} warmup\n`);

const header = ['sub', 'verts', 'tris', 'cell', 'get', 'loop', 'set', 'normals', 'TICK', 'full', 'load'];
const rows = [64, 128].map(bench).map(r => [
  String(r.subdivisions),
  String(r.vertexCount),
  String(r.triCount),
  (groundWidth / r.subdivisions).toFixed(2),
  r.get.toFixed(2), r.loop.toFixed(2), r.set.toFixed(2), r.normals.toFixed(2),
  r.tick.toFixed(2), r.fullTick.toFixed(2), r.loadMs.toFixed(1),
]);

const widths = header.map((h, i) => Math.max(h.length, ...rows.map(row => row[i].length)));
const fmt = cells => cells.map((c, i) => c.padStart(widths[i])).join('  ');
console.log(fmt(header));
console.log(widths.map(w => '-'.repeat(w)).join('  '));
for (const row of rows) console.log(fmt(row));
console.log('\nall times ms; TICK = one slider tick (dirty region), full = tick with no dirty region');
console.log('60fps budget = 16.7ms/frame');
