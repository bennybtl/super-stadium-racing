// Procedural rock generator sanity: `npm run check:rocks`
//
// src/decorations/lib/rock/RockGen.js is engine-free, so it can be checked
// headless (ROCKS.md). For every preset × a spread of seeds × LOD details:
//   - deterministic: same seed → identical arrays
//   - all values finite, every index in range, colours in [0, 1]
//   - winding agrees with the supplied normals (Babylon's own
//     VertexData.ComputeNormals follows its front-face convention)
//   - normals point outward from the rock's centre (single rocks)
//   - the flat bottom sits at y = −embed (no floating, no deep burial)
//   - the radius field is positive everywhere (star-shaped)
// Prints triangle counts and sizes so budget changes are visible.

import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { ROCK_PRESET_IDS, rockOptions, growRock, meshRock, rockRadius } from '../src/decorations/lib/rock/RockGen.js';

const DETAILS = { full: { subdivisions: 4 }, lod1: { subdivisions: 3 }, lod2: { subdivisions: 2 } };
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

let failures = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };

function checkBuffers(label, b) {
  const nv = b.verts.length / 3;
  if (b.normals.length !== b.verts.length || b.uvs.length !== nv * 2 || b.colors.length !== nv * 4) return fail(`${label}: attribute lengths`);
  if (![...b.verts, ...b.normals, ...b.uvs, ...b.colors].every(Number.isFinite)) return fail(`${label}: non-finite value`);
  if (!b.colors.every((c) => c >= 0 && c <= 1)) return fail(`${label}: colour out of [0, 1]`);
  if (!b.indices.every((i) => Number.isInteger(i) && i >= 0 && i < nv)) return fail(`${label}: index out of range`);
  const computed = [];
  VertexData.ComputeNormals(b.verts, b.indices, computed);
  let agree = 0, counted = 0;
  for (let i = 0; i < computed.length; i += 3) {
    if (Math.hypot(computed[i], computed[i + 1], computed[i + 2]) < 1e-6) continue;
    counted++;
    if (computed[i] * b.normals[i] + computed[i + 1] * b.normals[i + 1] + computed[i + 2] * b.normals[i + 2] > 0) agree++;
  }
  const pct = (100 * agree) / Math.max(1, counted);
  if (pct < 97) fail(`${label}: only ${pct.toFixed(1)}% of normals agree with the winding`);
}

const same = (a, b) => ['verts', 'normals', 'uvs', 'colors', 'indices'].every((k) => a[k].length === b[k].length && a[k].every((v, i) => Object.is(v, b[k][i])));

for (const preset of ROCK_PRESET_IDS) {
  const tris = {};
  const heights = [], widths = [];
  for (const seed of SEEDS) {
    const opts = rockOptions(preset, seed);
    const sk = growRock(opts);
    // Outcrops are several rocks: check each part's field, and the pile's
    // bottom only loosely (parts are scaled, so each sits at its own depth).
    const singles = sk.parts ? sk.parts.map((p) => p.sk) : [sk];
    const embed = sk.parts ? null : opts.preset.embed * sk.size;

    // Star-shaped: sample the field on a Fibonacci sphere.
    for (const one of singles) for (let i = 0; i < 2000; i++) {
      const y = 1 - (2 * (i + 0.5)) / 2000, s = Math.sqrt(1 - y * y), a = i * 2.399963;
      const r = rockRadius(one, { x: s * Math.cos(a), y, z: s * Math.sin(a) });
      if (!(r > 0)) { fail(`${preset}#${seed}: radius ${r} at sample ${i}`); break; }
    }

    for (const [name, detail] of Object.entries(DETAILS)) {
      const m = meshRock(sk, opts, detail);
      checkBuffers(`${preset}#${seed} ${name}`, m);
      (tris[name] ??= []).push(m.indices.length / 3);

      let minY = Infinity, maxY = -Infinity, maxW = 0, outward = 0;
      const cy = sk.parts ? 0 : sk.lift * sk.size;
      for (let i = 0; i < m.verts.length; i += 3) {
        const [x, y, z] = [m.verts[i], m.verts[i + 1], m.verts[i + 2]];
        minY = Math.min(minY, y); maxY = Math.max(maxY, y); maxW = Math.max(maxW, Math.hypot(x, z));
        if (x * m.normals[i] + (y - cy) * m.normals[i + 1] + z * m.normals[i + 2] > 0) outward++;
      }
      if (!sk.parts && outward / (m.verts.length / 3) < 0.97) fail(`${preset}#${seed} ${name}: only ${outward} normals point outward`);
      if (embed !== null && Math.abs(minY + embed) > 1e-6) fail(`${preset}#${seed} ${name}: bottom at ${minY.toFixed(4)}, expected ${(-embed).toFixed(4)}`);
      if (embed === null && !(minY < 0 && minY > -0.1)) fail(`${preset}#${seed} ${name}: pile bottom at ${minY.toFixed(4)}`);

      if (name === 'full') {
        heights.push(maxY); widths.push(2 * maxW);
        if (!same(m, meshRock(growRock(rockOptions(preset, seed)), opts, detail))) fail(`${preset}#${seed}: not deterministic`);
      }
    }
  }
  const stat = (a, f = 0) => `${Math.min(...a).toFixed(f)}–${Math.max(...a).toFixed(f)}`;
  console.log(`${preset}: ${SEEDS.length} seeds; height ${stat(heights, 2)}, width ${stat(widths, 2)}; tris ` +
    Object.entries(tris).map(([k, v]) => `${k} ${stat(v)}`).join(', '));
}

console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
process.exit(failures ? 1 : 0);
