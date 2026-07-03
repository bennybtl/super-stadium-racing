// Terrain regression checks: `npm run check:terrain`
//
// Bundles src/track.js with a Babylon stub (esbuild) so it runs headless, then
// verifies every track in public/tracks/:
//
//   1. golden  — heights + terrain types sampled on a 2m grid hash to the values
//                recorded in scripts/terrain-golden.json. Catches unintended
//                changes to the terrain math. After an INTENDED change, re-record
//                with: npm run check:terrain -- --update
//   2. roundtrip — Track.fromJSON(track.toJSON()) samples identically to the
//                original, and a second serialization is byte-stable.
//   3. patch   — after mutating a height feature, recomputing only the union of
//                its getFeatureHeightBounds before/after the mutation matches a
//                full recompute (the editor's dirty-region rebuild invariant).
//
// Exits non-zero on any failure.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const goldenPath = join(__dirname, 'terrain-golden.json');
const update = process.argv.includes('--update');

// ── Bundle Track for node ────────────────────────────────────────────────────
const cacheDir = join(root, 'node_modules', '.cache', 'check-terrain');
mkdirSync(cacheDir, { recursive: true });
const bundlePath = join(cacheDir, 'track-bundle.mjs');
await esbuild.build({
  entryPoints: [join(root, 'src', 'track.js')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { '@babylonjs/core': join(__dirname, 'babylon-stub.mjs') },
  outfile: bundlePath,
  logLevel: 'silent',
});
const { Track } = await import(pathToFileURL(bundlePath).href);

// ── Helpers ──────────────────────────────────────────────────────────────────
const SAMPLE_STEP = 2; // metres between samples

function sampleTrack(track) {
  const halfW = (track.width ?? 160) / 2 + 10;
  const halfD = (track.depth ?? 160) / 2 + 10;
  const lines = [];
  for (let z = -halfD; z <= halfD; z += SAMPLE_STEP) {
    for (let x = -halfW; x <= halfW; x += SAMPLE_STEP) {
      const h = track.getHeightAt(x, z);
      const t = track.getTerrainTypeAt(x, z);
      lines.push(`${x},${z},${h.toFixed(6)},${t?.name ?? 'null'}`);
    }
  }
  return lines;
}

function hashOf(lines) {
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

// A handful of fixed probes recorded with exact values, so a golden-hash
// mismatch shows immediately whether the drift is global or localized.
function spotSamples(track) {
  const spots = [[0, 0], [-30, -30], [30, 30], [-55, 40], [48, -52]];
  return spots.map(([x, z]) =>
    `${x},${z} h=${track.getHeightAt(x, z).toFixed(6)} t=${track.getTerrainTypeAt(x, z)?.name}`);
}

// Mirrors window.rebuildTerrain's dirty-region logic in EditorMode.js.
function checkPatchInvariant(track, fail) {
  const GRID = 65;
  const halfW = (track.width ?? 160) / 2;
  const halfD = (track.depth ?? 160) / 2;
  const pts = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      pts.push({ x: (c / (GRID - 1)) * 2 * halfW - halfW, z: (r / (GRID - 1)) * 2 * halfD - halfD, y: 0 });
    }
  }
  for (const p of pts) p.y = track.getHeightAt(p.x, p.z);

  const lastBounds = new Map();
  const patch = (f) => {
    const bounds = track.getFeatureHeightBounds(f);
    const prev = lastBounds.get(f);
    if (bounds) lastBounds.set(f, bounds);
    const region = bounds && prev ? {
      minX: Math.min(prev.minX, bounds.minX), maxX: Math.max(prev.maxX, bounds.maxX),
      minZ: Math.min(prev.minZ, bounds.minZ), maxZ: Math.max(prev.maxZ, bounds.maxZ),
    } : null;
    for (const p of pts) {
      if (region && (p.x < region.minX || p.x > region.maxX || p.z < region.minZ || p.z > region.maxZ)) continue;
      p.y = track.getHeightAt(p.x, p.z);
    }
  };
  const verify = (f, label) => {
    let stale = 0;
    for (const p of pts) if (p.y !== track.getHeightAt(p.x, p.z)) stale++;
    if (stale > 0) fail(`patch invariant: ${f.type} ${label} left ${stale} stale vertices`);
  };

  const MUTATIONS = {
    hill: [
      ['grow', f => { f.radius = (f.radius ?? f.radiusX ?? 10) * 1.6; }],
      ['shrink', f => { f.radius = (f.radius ?? f.radiusX ?? 10) * 0.3; }],
      ['move', f => { f.centerX += 30; f.centerZ -= 25; }],
    ],
    squareHill: [
      ['shrink', f => { f.width *= 0.25; }],
      ['rotate', f => { f.angle = (f.angle ?? 0) + 37; }],
      ['move', f => { f.centerX -= 20; f.centerZ += 15; }],
    ],
    polyHill: [
      ['narrow', f => { f.width = (f.width ?? f.slope ?? 5) * 0.3; }],
      ['drag point', f => { f.points[0].x += 18; f.points[0].z -= 12; }],
    ],
    meshGrid: [
      ['point height', f => { f.heights[Math.floor(f.heights.length / 2)] += 5; }],
      ['rotate', f => { f.angle = (f.angle ?? 0) + 20; }],
    ],
  };

  for (const f of track.features) {
    for (const [label, mutate] of MUTATIONS[f.type] ?? []) {
      mutate(f);
      patch(f);
      verify(f, label);
    }
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────
const tracksDir = join(root, 'public', 'tracks');
const trackFiles = readdirSync(tracksDir).filter(f => f.endsWith('.json')).sort();
const golden = update ? {} : JSON.parse(readFileSync(goldenPath, 'utf8'));

let failures = 0;
for (const file of trackFiles) {
  const key = file.replace(/\.json$/, '');
  const json = readFileSync(join(tracksDir, file), 'utf8');
  const problems = [];
  const fail = (msg) => problems.push(msg);

  // 1. golden samples
  const track = Track.fromJSON(json);
  const lines = sampleTrack(track);
  const hash = hashOf(lines);
  if (update) {
    golden[key] = { hash, spots: spotSamples(track) };
  } else {
    const want = golden[key];
    if (!want) {
      fail(`no golden entry — run: npm run check:terrain -- --update`);
    } else if (want.hash !== hash) {
      fail(`golden hash mismatch (${want.hash} → ${hash}); if the terrain change is intended, re-record with --update`);
      const now = spotSamples(track);
      want.spots.forEach((s, i) => { if (s !== now[i]) fail(`  spot: ${s}  →  ${now[i]}`); });
    }
  }

  // 2. serialization round-trip
  const serialized = track.toJSON();
  const track2 = Track.fromJSON(serialized);
  if (hashOf(sampleTrack(track2)) !== hash) fail('round-trip: fromJSON(toJSON()) samples differently');
  if (track2.toJSON() !== serialized) fail('round-trip: second toJSON() is not byte-stable');

  // 3. dirty-region patch invariant (mutates — use a fresh instance)
  checkPatchInvariant(Track.fromJSON(json), fail);

  if (problems.length) {
    failures++;
    console.log(`FAIL ${key}`);
    for (const p of problems) console.log(`     ${p}`);
  } else {
    console.log(`ok   ${key}`);
  }
}

if (update) {
  writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + '\n');
  console.log(`\nrecorded golden values for ${trackFiles.length} tracks → scripts/terrain-golden.json`);
} else {
  console.log(failures ? `\n${failures} track(s) failed` : `\nall ${trackFiles.length} tracks pass`);
  process.exit(failures ? 1 : 0);
}
