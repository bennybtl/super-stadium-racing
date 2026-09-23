// ez-tree port fidelity: `npm run check:eztree`
//
// src/decorations/lib/ez-tree/EzTree.js is a Three-free port of the ez-tree
// generator. A tree's shape depends on the exact Euler/quaternion round-trips
// of the original, so the port must reproduce it exactly — otherwise every
// placed tree silently re-rolls. eztree-golden.json was captured from the
// ORIGINAL Three version (ez-tree dcf309b, three r186): vertex/index counts
// plus weighted checksums of position/normal/uv (Float32, as Three stores
// them) for every preset × 2 seeds × {full, lod} detail.
//
// At port time a full per-value diff was bit-exact (15 presets × 5 seeds ×
// 3 detail levels); this is the cheap regression guard for that.

import fs from 'node:fs';
import { treeOptions, growSkeleton, meshSkeleton } from '../src/decorations/lib/ez-tree/EzTree.js';

const presetDir = new URL('../src/decorations/lib/ez-tree/presets/', import.meta.url);
const { lod, cases } = JSON.parse(fs.readFileSync(new URL('./eztree-golden.json', import.meta.url)));

const sig = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * ((i % 7) + 1); return s; };
const close = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

let failures = 0;
for (const [key, want] of Object.entries(cases)) {
  const [preset, seed, detail] = key.split('|');
  const json = JSON.parse(fs.readFileSync(new URL(`${preset}.json`, presetDir)));
  const opts = treeOptions({ ...json, seed: Number(seed) });
  const mesh = meshSkeleton(growSkeleton(opts), opts, detail === 'lod' ? lod : {});

  const bad = [];
  for (const part of ['branches', 'leaves']) {
    const b = mesh[part], w = want[part];
    if (b.verts.length / 3 !== w.verts) bad.push(`${part}.verts ${b.verts.length / 3}≠${w.verts}`);
    if (b.indices.length !== w.indices) bad.push(`${part}.indices ${b.indices.length}≠${w.indices}`);
    for (const [k, arr] of [['pos', b.verts], ['nrm', b.normals], ['uv', b.uvs]]) {
      const got = sig(Float32Array.from(arr));
      if (!close(got, w[k])) bad.push(`${part}.${k} ${got}≠${w[k]}`);
    }
  }
  if (bad.length) failures++;
  console.log(`${bad.length ? 'FAIL' : 'ok  '}  ${key}${bad.length ? `  ${bad.join(', ')}` : ''}`);
}

// Determinism: same options → identical arrays on a second run.
{
  const json = JSON.parse(fs.readFileSync(new URL('oak_medium.json', presetDir)));
  const opts = treeOptions({ ...json, seed: 7 });
  const a = meshSkeleton(growSkeleton(opts), opts), b = meshSkeleton(growSkeleton(opts), opts);
  const same = ['verts', 'normals', 'uvs', 'indices'].every((k) =>
    a.leaves[k].every((v, i) => Object.is(v, b.leaves[k][i])) &&
    a.branches[k].every((v, i) => Object.is(v, b.branches[k][i])));
  if (!same) failures++;
  console.log(`${same ? 'ok  ' : 'FAIL'}  deterministic rerun`);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
process.exit(failures ? 1 : 0);
