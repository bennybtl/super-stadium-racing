// Water + footprint regression checks: `npm run check:water`
//
// Bundles the water geometry with a Babylon stub (esbuild) so it runs headless.
// Everything here is pure geometry — the Babylon half (Water.js) only turns
// these results into meshes, so the parts worth pinning are all reachable.
//
//   1. footprint  — a feature's footprint covers exactly where that feature
//                   changes terrain height. Track.getHeightAt and
//                   featureFootprint compute different answers from the same
//                   shape, so the arithmetic is written twice; this is what
//                   stops them drifting apart.
//   2. bodies     — overlapping water merges into one shared-level surface;
//                   nested pools don't draw a second surface below the first;
//                   islands get their own shoreline facing the right way; a
//                   pool dug into a hill rides up with it.
//   3. shoreline  — loops close, sit on the waterline of the sampled terrain,
//                   and their foam UVs tile a whole number of times.
//   4. depth      — the per-vertex depth the shading reads matches the field
//                   within the run-merge tolerance.
//   5. resample   — downscaling a seamless texture keeps it seamless.
//
// Exits non-zero on any failure.

import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// ── Bundle for node ──────────────────────────────────────────────────────────
const cacheDir = join(root, 'node_modules', '.cache', 'check-water');
mkdirSync(cacheDir, { recursive: true });
const entry = join(cacheDir, 'entry.mjs');
const bundlePath = join(cacheDir, 'water-bundle.mjs');

const { writeFileSync } = await import('node:fs');
writeFileSync(entry, `
export { Track } from ${JSON.stringify(join(root, 'src', 'track.js'))};
export { featureFootprint } from ${JSON.stringify(join(root, 'src', 'feature-geometry.js'))};
export { resampleWrapped } from ${JSON.stringify(join(root, 'src', 'terrain-blend-utils.js'))};
export * from ${JSON.stringify(join(root, 'src', 'objects', 'water-field.js'))};
export { traceAiPathWearStamps, WEAR_WATER_FADE_END } from ${JSON.stringify(join(root, 'src', 'terrain-utils.js'))};
`);

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { '@babylonjs/core': join(__dirname, 'babylon-stub.mjs') },
  outfile: bundlePath,
  logLevel: 'silent',
});

const {
  Track, featureFootprint, resampleWrapped,
  createTerrainSampler, groupIntoBodies, rasterizeBody, buildSurfaceGeometry,
  traceShorelines, decimateLoop, foamSide, foamWidths, foamTiling,
  isWaterFeature, FOAM_NOMINAL_WIDTH, createWaterDepthSampler, traceAiPathWearStamps,
  WEAR_WATER_FADE_END,
} = await import(pathToFileURL(bundlePath).href);

// ── Harness ──────────────────────────────────────────────────────────────────
let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) { console.log(`ok   ${name} ${detail}`); return; }
  failures++;
  console.log(`FAIL ${name} ${detail}`);
};

const trackWith = (features, size = 400) => {
  const t = new Track('check');
  t.width = size; t.depth = size;
  t.features = features;
  return t;
};

const waterHill = (cx, cz, r, height, extra = {}) => ({
  type: 'hill', centerX: cx, centerZ: cz, radiusX: r, radiusZ: r,
  height, terrainType: 'water', ...extra,
});

/** Run the whole geometry pipeline for a track, as Water.js would. */
function buildBodies(track) {
  const sample = createTerrainSampler(track);
  return groupIntoBodies(track, (track.features ?? []).filter(isWaterFeature)).map((body) => {
    const grid = rasterizeBody(body, sample);
    const loops = traceShorelines(grid)
      .map((raw) => decimateLoop(raw, Math.max(grid.cell, FOAM_NOMINAL_WIDTH * 0.55)))
      .filter((loop) => loop.length >= 4);
    return { body, grid, sample, loops, surface: buildSurfaceGeometry(grid, body.level) };
  });
}

const signedArea = (pts) => {
  let a = 0;
  for (let p = pts.length - 1, q = 0; q < pts.length; p = q++) {
    a += pts[p].x * pts[q].z - pts[q].x * pts[p].z;
  }
  return a * 0.5;
};

// ── 1. Footprint ≡ where the feature changes the terrain ─────────────────────
//
// Points *on* the boundary are skipped: the falloff reaches zero continuously
// there, so whether a rim point "contributes" is floating-point dust — and on an
// axis-aligned feature a whole row of samples lands there at once. A point is on
// the boundary if containment flips within one step of it.
function footprintAgreement(feature, { span = 60, step = 0.4, eps = 1e-6 } = {}) {
  const track = trackWith([feature]);
  const fp = featureFootprint(feature);
  let heightOutside = 0, footprintWithoutHeight = 0, covered = 0;

  for (let z = -span; z <= span; z += step) {
    for (let x = -span; x <= span; x += step) {
      const contains = fp.contains(x, z);
      const onBoundary = contains !== fp.contains(x + step, z)
        || contains !== fp.contains(x - step, z)
        || contains !== fp.contains(x, z + step)
        || contains !== fp.contains(x, z - step);
      if (onBoundary) continue;

      const h = Math.abs(track.getHeightAt(x, z));
      if (contains) covered++;
      if (contains && h <= eps) footprintWithoutHeight++;
      if (!contains && h > eps) heightOutside++;
    }
  }
  return { heightOutside, footprintWithoutHeight, covered };
}

const footprintCases = [
  ['hill', { type: 'hill', centerX: 0, centerZ: 0, radiusX: 20, radiusZ: 20, height: -6 }],
  ['hill rotated', { type: 'hill', centerX: 4, centerZ: -3, radiusX: 26, radiusZ: 9, angle: 37, height: 5 }],
  ['hill negative angle', { type: 'hill', centerX: -6, centerZ: 5, radiusX: 18, radiusZ: 7, angle: -64, height: -4 }],
  ['squareHill', { type: 'squareHill', centerX: 0, centerZ: 0, width: 30, depth: 20, transition: 4, height: -5 }],
  ['squareHill rotated', { type: 'squareHill', centerX: 3, centerZ: 2, width: 34, depth: 12, transition: 6, angle: 41, height: -5 }],
  ['squareHill default transition', { type: 'squareHill', centerX: 0, centerZ: 0, width: 24, depth: 24, height: 3 }],
  ['polyHill convex', { type: 'polyHill', closed: true, filled: true, height: -6, width: 8,
    points: [{ x: -18, z: -12 }, { x: 16, z: -14 }, { x: 20, z: 10 }, { x: -6, z: 16 }, { x: -20, z: 4 }] }],
  ['polyHill concave', { type: 'polyHill', closed: true, filled: true, height: -5, width: 10,
    points: [{ x: -20, z: -14 }, { x: 18, z: -16 }, { x: 20, z: 12 }, { x: 2, z: -2 }, { x: -16, z: 14 }] }],
  ['polyHill slope key', { type: 'polyHill', closed: true, filled: true, height: -4, slope: 7,
    points: [{ x: -14, z: -10 }, { x: 14, z: -10 }, { x: 14, z: 10 }, { x: -14, z: 10 }] }],
];

for (const [name, feature] of footprintCases) {
  const r = footprintAgreement(feature);
  check(`footprint ${name}: covers all height`, r.heightOutside === 0, `(${r.heightOutside} stray)`);
  check(`footprint ${name}: no reach without height`, r.footprintWithoutHeight === 0, `(${r.footprintWithoutHeight} stray)`);
  check(`footprint ${name}: non-empty`, r.covered > 100, `(${r.covered} points)`);
}

check('footprint: unmodelled types report no reach', featureFootprint({ type: 'meshGrid' }) === null);

// ── 2. Bodies ────────────────────────────────────────────────────────────────
{
  const [plain] = buildBodies(trackWith([waterHill(0, 0, 20, -6)]));
  check('body: one pool, one shoreline', plain.loops.length === 1, `(${plain.loops.length})`);
  check('body: level is floor + fill', Math.abs(plain.body.level + 4) < 1e-6, `(${plain.body.level})`);
  const ys = plain.surface.positions.filter((_, i) => i % 3 === 1);
  check('body: surface is one flat plane', ys.every((y) => Math.abs(y - plain.body.level) < 1e-9));

  // An island fully inside the pool must not move the level, and must get its
  // own shoreline with the foam facing outward.
  const [island] = buildBodies(trackWith([
    waterHill(0, 0, 20, -6),
    { type: 'hill', centerX: 1, centerZ: 0, radiusX: 5, radiusZ: 5, height: 8, terrainType: 'dirt' },
  ]));
  check('body: island leaves the level alone',
    Math.abs(island.body.level - plain.body.level) < 1e-9, `(${island.body.level})`);
  check('body: island adds a shoreline', island.loops.length === 2, `(${island.loops.length})`);
  const areas = island.loops.map((l) => Math.abs(signedArea(l)));
  const inner = island.loops[areas.indexOf(Math.min(...areas))];
  const outer = island.loops[areas.indexOf(Math.max(...areas))];
  const winding = (loop) => (signedArea(loop) > 0 ? 1 : -1);
  check('body: island foam faces out', foamSide(inner, island.grid) === -winding(inner));
  check('body: rim foam faces in', foamSide(outer, island.grid) === winding(outer));

  // A deeper pool inside another must not draw a second surface below the first.
  const nested = buildBodies(trackWith([waterHill(0, 0, 20, -6), waterHill(3, 2, 6, -10)]));
  check('body: nested pools merge', nested.length === 1 && nested[0].body.members.length === 2,
    `(${nested.length} bodies)`);
  check('body: nested keeps the outer level',
    Math.abs(nested[0].body.level - plain.body.level) < 1e-9, `(${nested[0].body.level})`);
  check('body: nested draws one shoreline', nested[0].loops.length === 1, `(${nested[0].loops.length})`);

  // Partial overlap shares one plane instead of intersecting at two heights.
  const overlap = buildBodies(trackWith([waterHill(-8, 0, 16, -6), waterHill(12, 0, 12, -5)]));
  check('body: overlapping pools merge', overlap.length === 1, `(${overlap.length} bodies)`);
  check('body: overlap draws one shoreline', overlap[0].loops.length === 1, `(${overlap[0].loops.length})`);
  const oys = overlap[0].surface.positions.filter((_, i) => i % 3 === 1);
  check('body: overlap is one plane', new Set(oys.map((y) => y.toFixed(6))).size === 1);

  // Disjoint pools stay separate.
  const apart = buildBodies(trackWith([waterHill(-60, 0, 12, -6), waterHill(60, 0, 12, -6)]));
  check('body: disjoint pools stay apart', apart.length === 2, `(${apart.length})`);

  // A pool dug into a hill rides up with it — the level is read from the ambient
  // ground under the pool, not from its rim.
  const [raised] = buildBodies(trackWith([
    { type: 'hill', centerX: 0, centerZ: 0, radiusX: 45, radiusZ: 45, height: 12, terrainType: 'dirt' },
    waterHill(0, 0, 18, -6),
  ]));
  check('body: pool on a hill rides up', raised.body.level - plain.body.level > 6,
    `(lift ${(raised.body.level - plain.body.level).toFixed(2)})`);
  check('body: pool on a hill still has water', raised.loops.length === 1, `(${raised.loops.length})`);
}

// ── 3. Shorelines and foam ───────────────────────────────────────────────────
{
  const [b] = buildBodies(trackWith([waterHill(0, 0, 20, -6)]));
  const loop = b.loops[0];

  const worst = Math.max(...loop.map((p) => Math.abs(b.sample(p.x, p.z) - b.body.level)));
  check('shoreline: sits on the waterline', worst < 0.05, `(worst ${worst.toFixed(4)})`);

  const gaps = loop.map((p, i) => {
    const q = loop[(i + 1) % loop.length];
    return Math.hypot(q.x - p.x, q.z - p.z);
  });
  check('shoreline: closes with no gap', Math.max(...gaps) < 3, `(max ${Math.max(...gaps).toFixed(2)})`);

  // A fractional repeat count would leave the mask mid-stride at the seam.
  const { perimeter, tiles, uvScale } = foamTiling(loop, 6);
  check('foam: whole number of mask repeats', Number.isInteger(tiles) && tiles >= 1, `(${tiles})`);
  check('foam: u closes on a repeat boundary', Math.abs(perimeter * uvScale - tiles) < 1e-9);

  // The band must reach further over a gentle shelf than against a steep wall.
  const meanWidth = (features) => {
    const [body] = buildBodies(trackWith(features));
    const l = body.loops[0];
    const w = foamWidths(l, body.grid, foamSide(l, body.grid));
    return w.reduce((a, x) => a + x, 0) / w.length;
  };
  const steep = meanWidth([{ type: 'squareHill', centerX: 0, centerZ: 0, width: 34, depth: 34, transition: 2, height: -6, terrainType: 'water' }]);
  const gentle = meanWidth([{ type: 'squareHill', centerX: 0, centerZ: 0, width: 34, depth: 34, transition: 14, height: -6, terrainType: 'water' }]);
  check('foam: narrower on a steep shore', steep < gentle, `(steep ${steep.toFixed(2)} vs gentle ${gentle.toFixed(2)})`);
}

// ── 4. Depth stream ──────────────────────────────────────────────────────────
{
  const [b] = buildBodies(trackWith([waterHill(0, 0, 20, -6)]));
  const { positions, depths } = b.surface;
  check('depth: one per vertex', depths.length === positions.length / 3);
  check('depth: never negative', depths.every((d) => d >= 0));
  check('depth: shoreline vertices read zero', depths.filter((d) => d === 0).length > 20);

  // Merged runs interpolate depth between their ends; DEPTH_RUN_TOLERANCE caps
  // how far that can stray from the field the shading is meant to show.
  let worst = 0;
  for (let i = 0; i < depths.length; i++) {
    const x = positions[i * 3], z = positions[i * 3 + 2];
    worst = Math.max(worst, Math.abs(depths[i] - (b.body.level - b.sample(x, z))));
  }
  check('depth: matches the field', worst <= 0.25 + 1e-6, `(worst ${worst.toFixed(4)})`);
}

// ── 5. Water depth, and wear hidden beneath it ───────────────────────────────
{
  const pool = waterHill(0, 0, 20, -6);
  const track = trackWith([pool]);
  const depthAt = createWaterDepthSampler(track);

  check('depth: dry ground reads zero', depthAt(120, 120) === 0, `(${depthAt(120, 120)})`);
  check('depth: pool centre is level minus floor', Math.abs(depthAt(0, 0) - 2) < 0.05,
    `(${depthAt(0, 0).toFixed(3)})`);
  check('depth: shallows inside the rim', depthAt(8, 0) > 0.2 && depthAt(8, 0) < 1.5,
    `(${depthAt(8, 0).toFixed(3)})`);
  check('depth: dry inside the footprint but above the waterline', depthAt(13, 0) === 0,
    `(${depthAt(13, 0).toFixed(3)})`);
  check('depth: no water means a flat zero',
    createWaterDepthSampler(trackWith([{ type: 'hill', centerX: 0, centerZ: 0, radiusX: 10, radiusZ: 10, height: 4 }]))(0, 0) === 0);

  // An AI path straight through the pool. Wear fades by alpha, exactly like the
  // steep-slope fade — stamps are still laid down, they just carry nothing.
  const aiPath = {
    type: 'aiPath', closed: true,
    points: [{ x: -80, z: 0 }, { x: 80, z: 0 }, { x: 80, z: 60 }, { x: -80, z: 60 }],
  };
  const wet = traceAiPathWearStamps(trackWith([pool, aiPath]), 2048, 400, 400);
  check('wear: the path lays down stamps', wet.stamps.length > 100, `(${wet.stamps.length})`);

  const stampWorld = (stamp, worldSize = 400) => ({
    x: (stamp.sx / 2048) * worldSize - worldSize / 2,
    z: (stamp.sy / 2048) * worldSize - worldSize / 2,
  });
  const inDeepWater = wet.stamps.filter((s) => {
    const { x, z } = stampWorld(s);
    return depthAt(x, z) > WEAR_WATER_FADE_END;
  });
  check('wear: deep water has stamps to hide', inDeepWater.length > 5, `(${inDeepWater.length})`);
  check('wear: none of them carry any alpha',
    inDeepWater.every((s) => s.alpha === 0), `(max ${Math.max(0, ...inDeepWater.map((s) => s.alpha)).toFixed(4)})`);

  // Dry ground away from the pool must be untouched, alphas included.
  const dry = traceAiPathWearStamps(trackWith([aiPath]), 2048, 400, 400);
  const alphaNear = (list, z0) => list.stamps
    .filter((s) => Math.abs(stampWorld(s).z - z0) < 5)
    .reduce((a, s) => a + s.alpha, 0);
  check('wear: the far side of the loop is unchanged',
    Math.abs(alphaNear(wet, 60) - alphaNear(dry, 60)) < 1e-9,
    `(${alphaNear(wet, 60).toFixed(3)} vs ${alphaNear(dry, 60).toFixed(3)})`);

  // A ford — the same basin filled to a tenth of a metre — keeps its wear. The
  // pool still deforms the ground, so compare against a track with the same
  // depression and no water rather than against flat ground.
  const basin = { ...pool, terrainType: 'dirt' };
  const fordTrack = trackWith([waterHill(0, 0, 20, -6, { waterLevelOffset: 0.1 }), aiPath]);
  const ford = traceAiPathWearStamps(fordTrack, 2048, 400, 400);
  const noWater = traceAiPathWearStamps(trackWith([basin, aiPath]), 2048, 400, 400);
  const totalAlpha = (list) => list.stamps.reduce((a, s) => a + s.alpha, 0);
  check('wear: a shallow ford stays fully marked',
    Math.abs(totalAlpha(ford) - totalAlpha(noWater)) < 1e-9,
    `(${totalAlpha(ford).toFixed(2)} vs ${totalAlpha(noWater).toFixed(2)})`);

  // And the deep pool really does remove wear overall, not just locally.
  check('wear: deep water lowers total wear',
    totalAlpha(wet) < totalAlpha(noWater) * 0.98,
    `(${totalAlpha(wet).toFixed(1)} vs ${totalAlpha(noWater).toFixed(1)})`);
}

// ── 6. Wrap-preserving resample ──────────────────────────────────────────────
{
  const [sw, dw] = [512, 111];
  const src = new Uint8ClampedArray(sw * sw * 4);
  for (let y = 0; y < sw; y++) {
    for (let x = 0; x < sw; x++) {
      const k = (y * sw + x) * 4;
      const v = 128 + 100 * Math.sin((x / sw) * Math.PI * 6) * Math.cos((y / sw) * Math.PI * 4);
      src[k] = src[k + 1] = src[k + 2] = v;
      src[k + 3] = 255;
    }
  }
  const out = resampleWrapped(src, sw, sw, dw, dw);
  const col = (x) => Array.from({ length: dw }, (_, y) => out[(y * dw + x) * 4]);
  const meanAbs = (p, q) => p.reduce((a, v, i) => a + Math.abs(v - q[i]), 0) / p.length;
  const seam = meanAbs(col(0), col(dw - 1));
  const adjacent = meanAbs(col(55), col(56));
  check('resample: seamless source stays seamless', Math.abs(seam - adjacent) < adjacent * 0.5 + 1,
    `(seam ${seam.toFixed(2)} vs adjacent ${adjacent.toFixed(2)})`);

  const tiny = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) { tiny[i * 4] = i * 16; tiny[i * 4 + 3] = 255; }
  const halved = resampleWrapped(tiny, 4, 4, 2, 2);
  check('resample: exact on integer ratios', halved[0] === 40 && halved[3] === 255, `(${halved[0]})`);

  const flat = resampleWrapped(new Uint8ClampedArray(64 * 64 * 4).fill(200), 64, 64, 13, 13);
  check('resample: flat stays flat', Array.from(flat).every((v) => Math.abs(v - 200) <= 1));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall water checks pass');
process.exit(failures ? 1 : 0);
