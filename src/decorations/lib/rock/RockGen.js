/**
 * Procedural rock generator (ROCKS.md), built like the ez-tree / cactus ones:
 * draw every random choice into a small skeleton, then mesh it with no RNG at
 * any resolution. Engine-free — plain math and arrays — so it runs headless
 * (scripts/check-rocks.mjs) and the Babylon side just wraps buffers.
 *
 * A rock is a star-shaped radius field r(ω): its distance from the centre
 * along each unit direction ω. The mesher pushes each vertex of an icosphere
 * out along its own ray, so the surface can never self-intersect and every
 * LOD is the same rock, just coarser. r(ω) is layered:
 *   1. an ellipsoid body
 *   2. soft-min'd against fracture planes (flat faces, crisp or worn edges)
 *   3. optional strata: recessed grooves between tilted layers
 *   4. times a little fBm value noise (lumps and grain)
 *   5. hard-cut by a flat bottom, which then sits `embed` below y=0
 * An `outcrop` is 2–4 such rocks of one member type, resting together.
 *
 * Output is Babylon-native: y up, world units, Babylon front-face winding.
 */
import RNG from "../ez-tree/rng.js";

// ── Presets ─────────────────────────────────────────────────────────────────
//
// Lengths are in body units (the ellipsoid's longest axis is 1), scaled by
// `size` at the end. `[a, b]` pairs are seeded uniform ranges.

export const ROCK_PRESETS = {
  // River/field boulder: squat and rounded, a few worn faces.
  boulder: {
    size: 0.7,
    axes: { x: [0.9, 1], y: [0.55, 0.75], z: [0.7, 0.95] },
    planes: [3, 6],
    cut: [0.78, 0.93],      // plane distance as a fraction of the body radius along its normal
    softness: 0.22,         // soft-min width as a fraction of the body size (0 = hard edge)
    noise: { amp: 0.1, freq: 1.6, octaves: 3 },
    bottom: [0.45, 0.6],    // bottom cut, as a fraction of the y axis below the centre
    embed: 0.06,            // how far the flat bottom sits below ground (body units)
  },
  // Fresh broken granite: blocky, many hard fracture faces.
  granite: {
    size: 0.65,
    axes: { x: [0.85, 1], y: [0.65, 0.95], z: [0.7, 1] },
    planes: [8, 13],
    cut: [0.55, 0.82],
    softness: 0.035,
    noise: { amp: 0.025, freq: 3, octaves: 3 },
    bottom: [0.4, 0.6],
    embed: 0.06,
  },
  // Sedimentary slab: wide and flat, softened edges, horizontal layers.
  slab: {
    size: 0.75,
    axes: { x: [0.9, 1], y: [0.3, 0.45], z: [0.6, 0.9] },
    planes: [4, 6],
    cut: [0.7, 0.9],
    softness: 0.08,
    noise: { amp: 0.04, freq: 2.5, octaves: 3 },
    bottom: [0.3, 0.5],
    embed: 0.04,
    strata: {
      period: [0.11, 0.16], // layer thickness (body units)
      depth: [0.035, 0.06], // groove depth, as a fraction of the radius
      tilt: [0, 0.2],       // layer slope
    },
  },
  // A few rocks of one type resting against each other: one main rock plus
  // smaller ones round it, overlapping slightly so they read as one pile.
  outcrop: {
    kind: "outcrop",
    members: ["granite", "slab"],
    parts: [2, 4],          // rocks, including the main one
    partScale: [0.45, 0.8], // secondary rock size relative to the main
    spacing: [0.55, 0.75],  // centre distance as a fraction of the two half-widths
    embed: 0.06,
  },
};

export const ROCK_PRESET_IDS = Object.keys(ROCK_PRESETS);

/** Merged, seeded options. The preset object is kept as `options.preset`. */
export function rockOptions(preset, seed = 1) {
  const p = ROCK_PRESETS[preset] ?? ROCK_PRESETS.boulder;
  return { preset: p, seed: Math.max(1, Math.round(Number(seed) || 1)) };
}

// ── Skeleton: every random draw happens here ────────────────────────────────

/**
 * @returns {{ axes, planes: {n, d}[], k, noise, strata, bottom, lift, size }}
 *          All in body units; `lift` moves the cut bottom to y = −embed.
 *          An outcrop returns { parts: [{ sk, options, x, z, yaw, scale }] }.
 */
export function growRock(options) {
  const { preset: P, seed } = options;
  const rng = new RNG(seed);
  const range = ([a, b]) => rng.random(b, a);
  const count = ([a, b]) => Math.floor(rng.random(b + 1, a));
  if (P.kind === "outcrop") return growOutcrop(P, rng, range, count);

  // Body proportions, normalised so the longest axis is 1.
  const raw = { x: range(P.axes.x), y: range(P.axes.y), z: range(P.axes.z) };
  const m = Math.max(raw.x, raw.y, raw.z);
  const axes = { x: raw.x / m, y: raw.y / m, z: raw.z / m };

  // Fracture planes: random normals, kept off the underside (the bottom cut
  // handles that) and cutting a seeded fraction into the body.
  const planes = [];
  for (let i = 0, n = count(P.planes); i < n; i++) {
    const theta = rng.random(Math.PI * 2);
    const y = rng.random(1, -0.35);
    const s = Math.sqrt(1 - y * y);
    const nrm = { x: s * Math.cos(theta), y, z: s * Math.sin(theta) };
    planes.push({ n: nrm, d: ellipsoidRadius(axes, nrm) * range(P.cut) });
  }

  const noise = {
    ...P.noise,
    offset: { x: rng.random(100), y: rng.random(100), z: rng.random(100) },
  };

  // Flat bottom: cut below the centre, then lift so it lands at y = −embed.
  const bottom = axes.y * range(P.bottom);

  // Drawn last so presets without strata keep their RNG order.
  const strata = P.strata && {
    period: range(P.strata.period),
    depth: range(P.strata.depth),
    phase: rng.random(1),
    tilt: (() => {
      const a = rng.random(Math.PI * 2), t = range(P.strata.tilt);
      return { x: Math.cos(a) * t, z: Math.sin(a) * t };
    })(),
  };

  // Layered rock weathers flat along its bedding: cut the top on the tilt.
  if (strata) {
    const n = { x: strata.tilt.x, y: 1, z: strata.tilt.z };
    const l = Math.hypot(n.x, n.y, n.z);
    n.x /= l; n.y /= l; n.z /= l;
    planes.push({ n, d: ellipsoidRadius(axes, n) * 0.8 });
  }

  return {
    axes,
    planes,
    k: P.softness,
    noise,
    strata,
    bottom,
    lift: bottom - P.embed,
    size: P.size,
  };
}

/**
 * Main rock at the origin plus smaller ones spread round it at seeded
 * bearings, each touching the main one with a shallow overlap.
 */
function growOutcrop(P, rng, range, count) {
  const member = P.members[Math.floor(rng.random(P.members.length))];
  const n = count(P.parts);
  const parts = [];
  // Rough half-width of a member rock at scale 1 (longest axis 1 × size).
  const half = ROCK_PRESETS[member].size;
  let bearing = rng.random(Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const options = rockOptions(member, 1 + Math.floor(rng.random(1e6)));
    const scale = i === 0 ? 1 : range(P.partScale);
    const dist = i === 0 ? 0 : (half + half * scale) * range(P.spacing);
    if (i > 0) bearing += (Math.PI * 2) / (n - 1) * rng.random(1.2, 0.8);
    parts.push({
      sk: growRock(options),
      options,
      x: Math.cos(bearing) * dist,
      z: Math.sin(bearing) * dist,
      yaw: rng.random(Math.PI * 2),
      scale,
    });
  }
  return { parts };
}

// ── Radius field ────────────────────────────────────────────────────────────

/** Ellipsoid radius along unit direction w. */
function ellipsoidRadius(a, w) {
  return 1 / Math.sqrt((w.x / a.x) ** 2 + (w.y / a.y) ** 2 + (w.z / a.z) ** 2);
}

/** Polynomial soft minimum (k = blend width; k ≤ 0 is a hard min). */
function smin(a, b, k) {
  if (k <= 0 || !Number.isFinite(a) || !Number.isFinite(b)) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Integer-lattice hash → [-1, 1]. */
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Smooth 3D value noise, roughly [-1, 1]. */
function valueNoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy),
    l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy),
    sz,
  );
}

function fbm(n, p) {
  let sum = 0, amp = 1, freq = n.freq, norm = 0;
  for (let o = 0; o < n.octaves; o++) {
    sum += amp * valueNoise(p.x * freq + n.offset.x, p.y * freq + n.offset.y, p.z * freq + n.offset.z);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * The rock's radius along unit direction w, in body units, measured from the
 * body centre (before `lift`), plus the fBm value there (for cavity shading).
 * r is always > 0, so the surface is star-shaped.
 */
export function rockSample(sk, w) {
  let r = ellipsoidRadius(sk.axes, w);
  for (const { n, d } of sk.planes) {
    const c = w.x * n.x + w.y * n.y + w.z * n.z;
    if (c > 1e-6) r = smin(r, d / c, sk.k);
  }
  const st = sk.strata;
  if (st) {
    // Height above ground (tilted), then a narrow groove at each layer line.
    const h = r * (w.y + st.tilt.x * w.x + st.tilt.z * w.z) + sk.lift;
    const g = 0.5 + 0.5 * Math.cos(2 * Math.PI * (h / st.period + st.phase));
    r *= 1 - st.depth * g * g;
  }
  const noise = fbm(sk.noise, { x: w.x * r, y: w.y * r, z: w.z * r });
  r *= 1 + sk.noise.amp * noise;
  if (w.y < -1e-6) r = Math.min(r, sk.bottom / -w.y);
  return { r, noise };
}

export const rockRadius = (sk, w) => rockSample(sk, w).r;

// ── Mesher: no RNG ──────────────────────────────────────────────────────────

const _icoCache = new Map();

/** Unit icosphere with shared vertices; triangles wound outward (a→b→c CCW seen from outside). */
function icosphere(subdivisions) {
  if (_icoCache.has(subdivisions)) return _icoCache.get(subdivisions);
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; });
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdivisions; s++) {
    const mid = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      let i = mid.get(key);
      if (i === undefined) {
        const [ax, ay, az] = verts[a], [bx, by, bz] = verts[b];
        const x = ax + bx, y = ay + by, z = az + bz, l = Math.hypot(x, y, z);
        i = verts.push([x / l, y / l, z / l]) - 1;
        mid.set(key, i);
      }
      return i;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  const ico = { verts, faces };
  _icoCache.set(subdivisions, ico);
  return ico;
}

const CREASE_COS = Math.cos((45 * Math.PI) / 180);

// Baked vertex colour (multiplies the material): a plain surface is BASE, so
// dust can lighten it; rock.js scales the diffuse texture level by 1/BASE.
export const ROCK_COLOR_BASE = 0.8;
const DUST = [1, 0.94, 0.82];  // warm, dusty top faces
const GROUND_AO = 0.55;        // colour factor right at the ground line…
const GROUND_AO_HEIGHT = 0.3;  // …fading out over this height (body units)
const CAVITY_AO = 0.35;        // darkening in noise pits

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Ambient-occlusion-ish shade and dust, no RNG: dark at the ground line, in
 * the noise's pits and on undersides; dusty on upward faces.
 */
function vertexColor(yBody, embed, noise, n) {
  const ground = GROUND_AO + (1 - GROUND_AO) * smoothstep(0, GROUND_AO_HEIGHT, yBody + embed);
  const cavity = 1 - CAVITY_AO * smoothstep(0, 0.6, -noise);
  const under = 0.75 + 0.25 * smoothstep(-0.8, 0.2, n[1]);
  const shade = ground * cavity * under;
  const dust = 0.6 * smoothstep(0.5, 0.95, n[1]);
  return [0, 1, 2].map((c) => shade * (ROCK_COLOR_BASE + (DUST[c] - ROCK_COLOR_BASE) * dust));
}

/**
 * @param detail {{ subdivisions?: number }} icosphere level (4 full, 3, 2 LODs)
 * @returns {{ verts, normals, uvs, colors, indices }} flat arrays, world
 *          units; colors are RGBA
 */
export function meshRock(sk, options, detail = {}) {
  return sk.parts ? meshOutcrop(sk, detail) : meshSingle(sk, options, detail);
}

/**
 * Concatenate each part's mesh, scaled, turned about y and moved into place.
 * The smaller rocks are meshed one icosphere level coarser.
 */
function meshOutcrop(sk, detail) {
  const out = { verts: [], normals: [], uvs: [], colors: [], indices: [] };
  const sub = detail.subdivisions ?? 4;
  for (const [i, part] of sk.parts.entries()) {
    const m = meshSingle(part.sk, part.options, { ...detail, subdivisions: i === 0 ? sub : Math.max(1, sub - 1) });
    const c = Math.cos(part.yaw), s = Math.sin(part.yaw), k = part.scale;
    const base = out.verts.length / 3;
    for (let i = 0; i < m.verts.length; i += 3) {
      const x = m.verts[i], z = m.verts[i + 2], nx = m.normals[i], nz = m.normals[i + 2];
      out.verts.push((c * x - s * z) * k + part.x, m.verts[i + 1] * k, (s * x + c * z) * k + part.z);
      out.normals.push(c * nx - s * nz, m.normals[i + 1], s * nx + c * nz);
    }
    out.uvs.push(...m.uvs);
    out.colors.push(...m.colors);
    for (const i of m.indices) out.indices.push(i + base);
  }
  return out;
}

function meshSingle(sk, options, detail) {
  const ico = icosphere(detail.subdivisions ?? 4);
  const { axes, size, lift } = sk;

  // Sample directions from a pre-stretched sphere so flattened bodies still
  // get evenly spaced vertices, then push each out to the field.
  const noiseAt = [];
  const pos = ico.verts.map(([x, y, z]) => {
    let wx = x * axes.x, wy = y * axes.y, wz = z * axes.z;
    const l = Math.hypot(wx, wy, wz);
    wx /= l; wy /= l; wz /= l;
    const { r, noise } = rockSample(sk, { x: wx, y: wy, z: wz });
    noiseAt.push(noise);
    return [wx * r * size, (wy * r + lift) * size, wz * r * size];
  });
  const embed = options.preset.embed;

  // Face normals (area-weighted: unnormalised cross product).
  const faceN = ico.faces.map(([a, b, c]) => {
    const [ax, ay, az] = pos[a], [bx, by, bz] = pos[b], [cx, cy, cz] = pos[c];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  });
  const unit = (n) => { const l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; };
  const faceU = faceN.map(unit);

  const incident = pos.map(() => []);
  ico.faces.forEach((f, fi) => f.forEach((v) => incident[v].push(fi)));

  // Crease split: each face corner averages only the incident faces within
  // 45° of its own face, then corners with matching normals share a vertex.
  const verts = [], normals = [], uvs = [], colors = [], indices = [];
  const outIndex = pos.map(() => []); // per source vertex: [{n, i}]
  ico.faces.forEach((f, fi) => {
    const own = faceU[fi];
    const tri = f.map((v) => {
      let nx = 0, ny = 0, nz = 0;
      for (const g of incident[v]) {
        const u = faceU[g];
        if (u[0] * own[0] + u[1] * own[1] + u[2] * own[2] < CREASE_COS) continue;
        nx += faceN[g][0]; ny += faceN[g][1]; nz += faceN[g][2];
      }
      const n = unit([nx, ny, nz]);
      const hit = outIndex[v].find((o) => o.n[0] * n[0] + o.n[1] * n[1] + o.n[2] * n[2] > 0.9999);
      if (hit) return hit.i;
      const i = verts.length / 3;
      const [x, y, z] = pos[v];
      verts.push(x, y, z);
      normals.push(n[0], n[1], n[2]);
      // Box projection on the dominant normal axis (world units).
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      if (ay >= ax && ay >= az) uvs.push(x, z);
      else if (ax >= az) uvs.push(z, y);
      else uvs.push(x, y);
      colors.push(...vertexColor(y / size, embed, noiseAt[v], n), 1);
      outIndex[v].push({ n, i });
      return i;
    });
    // Icosphere faces are CCW from outside; Babylon's front face is the
    // opposite order (verified by check:rocks against ComputeNormals).
    indices.push(tri[0], tri[2], tri[1]);
  });

  return { verts, normals, uvs, colors, indices };
}
