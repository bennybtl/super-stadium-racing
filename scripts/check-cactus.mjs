// Procedural cactus generator sanity: `npm run check:cactus`
//
// src/decorations/lib/cactus/CactusGen.js is engine-free, so it can be checked
// headless (CACTUS.md). For every preset × a spread of seeds × LOD details:
//   - deterministic: same seed → identical arrays
//   - all values finite, every index in range, no NaN normals
//   - winding agrees with the analytic normals: Babylon's own
//     VertexData.ComputeNormals (which follows Babylon's front-face
//     convention) must point the same way as the supplied normals
//   - trunk base at/below ground; arm tips finish near-vertical
// Prints triangle counts so budget changes are visible.

import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { CACTUS_PRESET_IDS, cactusOptions, growCactus, meshCactus } from '../src/decorations/lib/cactus/CactusGen.js';

const DETAILS = { full: {}, lod1: { sectionStride: 2, segmentFactor: 0.5 }, lod2: { sectionStride: 4, segmentFactor: 0.5 } };
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

let failures = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };

function checkBuffers(label, b) {
  const nv = b.verts.length / 3;
  if (b.normals.length !== b.verts.length || b.uvs.length !== nv * 2) return fail(`${label}: attribute lengths`);
  if (![...b.verts, ...b.normals, ...b.uvs].every(Number.isFinite)) return fail(`${label}: non-finite value`);
  if (!b.indices.every((i) => Number.isInteger(i) && i >= 0 && i < nv)) return fail(`${label}: index out of range`);
  if (!b.indices.length) return;
  // Winding vs supplied normals. Ignore near-zero computed normals (apex fans).
  const computed = [];
  VertexData.ComputeNormals(b.verts, b.indices, computed);
  let agree = 0, counted = 0;
  for (let i = 0; i < computed.length; i += 3) {
    const cl = Math.hypot(computed[i], computed[i + 1], computed[i + 2]);
    if (cl < 1e-6) continue;
    counted++;
    if (computed[i] * b.normals[i] + computed[i + 1] * b.normals[i + 1] + computed[i + 2] * b.normals[i + 2] > 0) agree++;
  }
  const pct = (100 * agree) / Math.max(1, counted);
  if (pct < 97) fail(`${label}: only ${pct.toFixed(1)}% of normals agree with the winding`);
}

const same = (a, b) => ['verts', 'normals', 'uvs', 'indices'].every((k) => a[k].length === b[k].length && a[k].every((v, i) => Object.is(v, b[k][i])));

for (const preset of CACTUS_PRESET_IDS) {
  const tris = {};
  let armsTotal = 0, maxH = 0;
  for (const seed of SEEDS) {
    const opts = cactusOptions(preset, seed);
    const sk = growCactus(opts);
    armsTotal += sk.arms.length;

    if (sk.trunk.sections[0].p.y > 0) fail(`${preset}#${seed}: trunk base above ground`);
    for (const [i, arm] of (opts.preset.kind === 'pads' ? [] : sk.arms).entries()) {
      const tip = arm.sections.filter((s) => !s.dome).at(-1);
      if (tip.t.y < 0.9) fail(`${preset}#${seed}: arm ${i} tip not vertical (t.y=${tip.t.y.toFixed(2)})`);
    }

    for (const [name, detail] of Object.entries(DETAILS)) {
      const m = meshCactus(sk, opts, detail);
      checkBuffers(`${preset}#${seed} ${name} trunk`, m.trunk);
      checkBuffers(`${preset}#${seed} ${name} arms`, m.arms);
      const t = (m.trunk.indices.length + m.arms.indices.length) / 3;
      (tris[name] ??= []).push(t);
      if (name === 'full') {
        for (const b of [m.trunk, m.arms]) for (let i = 1; i < b.verts.length; i += 3) maxH = Math.max(maxH, b.verts[i]);
        const again = meshCactus(growCactus(cactusOptions(preset, seed)), opts, detail);
        if (!same(m.trunk, again.trunk) || !same(m.arms, again.arms)) fail(`${preset}#${seed}: not deterministic`);
      }
    }
  }
  const stat = (a) => `${Math.min(...a)}–${Math.max(...a)}`;
  console.log(`${preset}: ${SEEDS.length} seeds, ${armsTotal} arms, max height ${maxH.toFixed(1)}; tris ` +
    Object.entries(tris).map(([k, v]) => `${k} ${stat(v)}`).join(', '));
}

console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
process.exit(failures ? 1 : 0);
