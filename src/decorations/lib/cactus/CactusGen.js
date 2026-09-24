/**
 * Procedural cactus generator (CACTUS.md), built on the ez-tree ideas: grow a
 * skeleton of sections with all the RNG, then mesh each stem as one continuous
 * tube with no RNG. Engine-free — plain {x,y,z} math and arrays — so it runs
 * headless (scripts/check-cactus.mjs) and the Babylon side just wraps buffers.
 *
 * Two growth modes:
 *   columnar — a trunk plus arms that elbow up to vertical (saguaro, organ
 *              pipe, barrel = a short fat trunk with no arms)
 *   pads     — a tree of flat oval paddles, each sprouting from the rim of
 *              its parent (prickly pear)
 * Every stem carries its own cross-section `shape` (ribbed or flat oval), so
 * one mesher serves both.
 *
 * Output is Babylon-native: y up, world units, Babylon front-face winding.
 */
import RNG from "../ez-tree/rng.js";

// ── Vector helpers (plain {x,y,z}) ──────────────────────────────────────────

const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const scale = (a, s) => v3(a.x * s, a.y * s, a.z * s);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => scale(a, 1 / (len(a) || 1));
const lerp = (a, b, t) => a + (b - a) * t;
const UP = v3(0, 1, 0);

/** Rodrigues: rotate v about unit axis k by angle. */
function rotate(v, k, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/** Rotate v by the minimal rotation taking unit a onto unit b (parallel transport). */
function transport(v, a, b) {
  const axis = cross(a, b);
  const s = len(axis);
  if (s < 1e-9) return v;
  return rotate(v, scale(axis, 1 / s), Math.atan2(s, dot(a, b)));
}

/** Any unit vector perpendicular to unit t. */
function perpendicular(t) {
  const ref = Math.abs(t.y) < 0.9 ? UP : v3(1, 0, 0);
  return norm(cross(ref, t));
}

// ── Presets ─────────────────────────────────────────────────────────────────
//
// Lengths are world units. `[a, b]` pairs are seeded uniform ranges.

const COLUMNAR_MESH = {
  step: 0.22,           // ring spacing along a stem (world units)
  segmentsPerRib: 4,    // ring vertices per rib
  domeRings: 5,         // rings closing each tip
  baseSink: 0.25,       // trunk starts this far below ground
};

export const CACTUS_PRESETS = {
  saguaro: {
    kind: "columnar",
    stem: {
      length: [4.5, 8],       // trunk height
      radius: [0.4, 0.55],
      taper: 0.12,            // radius loss base → top (fraction)
      bulge: 0,               // mid-height swell (fraction), barrel shape
      domeScale: 1,           // tip dome height × radius (<1 flattens it)
      lean: 0.06,             // max radians off vertical
      gnarl: 0.015,           // random turn per unit length (radians)
      ribs: 14,
      ribDepth: 0.12,         // valley depth as a fraction of radius
      ribSharpness: 0.6,      // <1 → narrow ridges, broad rounded valleys
      ribTwist: 0.04,         // radians of twist per unit length
    },
    arms: {
      count: [0, 4],          // inclusive integer range
      attach: [0.3, 0.72],    // along the trunk, fraction of its length
      radius: [0.55, 0.75],   // × trunk radius
      elevation: [0.05, 0.3], // initial angle above horizontal (radians)
      run: [0.25, 0.9],       // straight run past the trunk surface before bending (world units)
      bendRadius: [1.6, 3.2], // elbow radius × arm radius
      rise: [0.25, 0.55],     // vertical rise after the elbow, × trunk length
      gnarl: 0.02,
    },
    mesh: COLUMNAR_MESH,
  },

  // Many stems from the base: a central column plus basal arms that leave
  // steeply, splay a little and rise to staggered heights.
  organ_pipe: {
    kind: "columnar",
    stem: {
      length: [3, 5],
      radius: [0.3, 0.4],
      taper: 0.08,
      bulge: 0,
      domeScale: 1,
      lean: 0.08,
      gnarl: 0.02,
      ribs: 12,
      ribDepth: 0.14,
      ribSharpness: 0.6,
      ribTwist: 0.02,
    },
    arms: {
      count: [4, 9],
      attach: [0.02, 0.14],
      radius: [0.85, 1.0],
      elevation: [0.75, 1.2],
      run: [0, 0.15],
      bendRadius: [4, 9],
      rise: [0.35, 0.95],
      gnarl: 0.02,
    },
    // Many stems: coarser rings keep it near a saguaro's triangle budget.
    mesh: { ...COLUMNAR_MESH, step: 0.3, segmentsPerRib: 3 },
  },

  // Squat, fat and deeply ribbed, with a flattened crown and spiralled ribs.
  barrel: {
    kind: "columnar",
    stem: {
      length: [0.7, 1.5],
      radius: [0.45, 0.75],
      taper: 0,
      bulge: 0.14,
      domeScale: 0.5,
      lean: 0.12,
      gnarl: 0.01,
      ribs: 22,
      ribDepth: 0.2,
      ribSharpness: 0.5,
      ribTwist: 0.25,
    },
    arms: { count: [0, 0] },
    mesh: { ...COLUMNAR_MESH, step: 0.12, domeRings: 6, baseSink: 0.15 },
  },

  // Flat oval paddles, each sprouting from the upper rim of its parent.
  prickly_pear: {
    kind: "pads",
    pads: {
      count: [4, 11],         // total pads
      roots: [1, 2],          // pads growing from the ground
      length: [0.8, 1.15],    // root pad length; children shrink from there
      width: 0.68,            // full width × length
      thickness: 0.16,        // thickness × width
      shrink: [0.72, 0.95],   // child length × parent length
      maxChildren: 3,
      attach: [0.55, 0.92],   // where on the parent's rim, along its length
      spread: [0.25, 0.85],   // child angle off the parent's axis (radians)
      twist: [-0.7, 0.7],     // child plane rotation about its own axis (radians)
      rootTilt: [0, 0.35],    // root pad lean off vertical (radians)
      minUp: 0.15,            // children never point below this t.y
    },
    mesh: {
      rings: 12,              // rings per pad
      segments: 16,           // ring vertices per pad
      baseSink: 0.1,
    },
  },
};

export const CACTUS_PRESET_IDS = Object.keys(CACTUS_PRESETS);

/** Preset + seed → options (the preset object is shared, never mutated). */
export function cactusOptions(preset, seed) {
  return { preset: CACTUS_PRESETS[preset] ?? CACTUS_PRESETS.saguaro, seed: Number(seed) || 1 };
}

// ── Skeleton (all RNG) ──────────────────────────────────────────────────────

/**
 * Grow one stem as a list of sections. `turn(t, s)` returns the tangent for
 * the next step (bends, gnarl); growth stops when `done(p, t, s)` or at
 * maxLength. `radiusAt(s)` sets each ring's radius. Optional tip dome:
 * `domeRings` rings on a quarter circle (height × `domeScale`).
 * Section: { p, t, n, r, s, dome }.
 */
function growStem({ origin, dir, n0, radiusAt, step, maxLength, turn, done, domeRings = 0, domeScale = 1 }) {
  const sections = [];
  let p = origin, t = norm(dir), n = n0 ?? perpendicular(t), s = 0;
  for (;;) {
    sections.push({ p, t, n, r: radiusAt(s), s, dome: false });
    if (s >= maxLength || done?.(p, t, s)) break;
    const t2 = norm(turn(t, s));
    n = norm(transport(n, t, t2));
    t = t2;
    p = add(p, scale(t, step));
    s += step;
  }
  const last = sections[sections.length - 1];
  for (let k = 1; k <= domeRings; k++) {
    const a = (k / domeRings) * (Math.PI / 2);
    const h = last.r * Math.sin(a) * domeScale;
    sections.push({ p: add(last.p, scale(last.t, h)), t: last.t, n: last.n, r: last.r * Math.cos(a), s: last.s + h, dome: true });
  }
  return sections;
}

function makeRange(rng) {
  return ([a, b]) => lerp(a, b, rng.random());
}

function growColumnar(options, rng) {
  const { stem, arms, mesh } = options.preset;
  const range = makeRange(rng);
  const shape = { kind: "ribbed", ...stem };
  const gnarlTurn = (t, amount, stepLen) => {
    const k = perpendicular(t);
    return rotate(t, rotate(k, t, rng.random() * Math.PI * 2), rng.random(amount, -amount) * stepLen);
  };

  // Trunk: near-vertical with a seeded lean and a little wander.
  const H = range(stem.length);
  const R = range(stem.radius);
  const leanDir = rng.random() * Math.PI * 2;
  const lean = rng.random() * stem.lean;
  const trunkDir = v3(Math.sin(lean) * Math.cos(leanDir), Math.cos(lean), Math.sin(lean) * Math.sin(leanDir));
  const trunkLen = H + mesh.baseSink;
  const trunk = {
    shape,
    sections: growStem({
      origin: v3(0, -mesh.baseSink, 0),
      dir: trunkDir,
      radiusAt: (s) => {
        const u = Math.min(1, s / trunkLen);
        return R * (1 - stem.taper * u) * (1 + (stem.bulge ?? 0) * Math.sin(Math.PI * u));
      },
      step: mesh.step,
      maxLength: trunkLen,
      turn: (t) => gnarlTurn(t, stem.gnarl, mesh.step),
      domeRings: mesh.domeRings,
      domeScale: stem.domeScale ?? 1,
    }),
  };

  // Arms: spread around the trunk, staggered up it.
  const [cMin, cMax] = arms.count;
  const count = cMin + Math.floor(rng.random() * (cMax - cMin + 1));
  const spin0 = rng.random() * Math.PI * 2;
  const body = trunk.sections.filter((sec) => !sec.dome);
  const armStems = [];
  for (let i = 0; i < count; i++) {
    const at = lerp(arms.attach[0], arms.attach[1], (i + rng.random()) / count);
    const host = body[Math.min(body.length - 1, Math.round(at * (body.length - 1)))];
    const azimuth = spin0 + (i / count) * Math.PI * 2 + rng.random(0.5, -0.5) * (Math.PI / count);
    const out = norm(v3(Math.cos(azimuth), 0, Math.sin(azimuth)));
    const elevation = range(arms.elevation);
    const dir = add(scale(out, Math.cos(elevation)), scale(UP, Math.sin(elevation)));

    const armR = R * range(arms.radius);
    const run = host.r + range(arms.run);           // straight until clear of the trunk
    const curvature = 1 / (armR * range(arms.bendRadius));
    const topY = host.p.y + H * range(arms.rise);
    const taperLen = run + H;                       // taper reference (kept from phase 1 so saguaros don't re-roll)
    const maxLength = run + H * 2;                  // safety cap; `done` normally ends it

    armStems.push({
      shape,
      sections: growStem({
        origin: add(host.p, scale(out, host.r * 0.25)), // starts inside the trunk
        dir,
        radiusAt: (s) => armR * (1 - 0.08 * Math.min(1, s / taperLen)),
        step: mesh.step,
        maxLength,
        turn: (t, s) => {
          let t2 = gnarlTurn(t, arms.gnarl, mesh.step);
          if (s >= run) {
            // Growth force: turn toward +Y at most `curvature` rad per unit.
            const axis = cross(t2, UP);
            const sinA = len(axis);
            if (sinA > 1e-6) {
              const full = Math.atan2(sinA, dot(t2, UP));
              t2 = rotate(t2, scale(axis, 1 / sinA), Math.min(full, curvature * mesh.step));
            }
          }
          return t2;
        },
        done: (p, t, s) => s > run && t.y > 0.97 && p.y >= topY,
        domeRings: mesh.domeRings,
        domeScale: stem.domeScale ?? 1,
      }),
    });
  }

  return { trunk, arms: armStems };
}

/** Pad half-width profile along its length: 0 at both ends, widest past the middle. */
function padProfile(u) {
  const w = Math.pow(Math.min(1, Math.max(0, u)), 0.75);
  return Math.sqrt(Math.max(0, 1 - (2 * w - 1) ** 2));
}

function growPads(options, rng) {
  const { pads, mesh } = options.preset;
  const range = makeRange(rng);
  const shape = { kind: "pad", thickness: pads.thickness };

  const total = pads.count[0] + Math.floor(rng.random() * (pads.count[1] - pads.count[0] + 1));
  const rootCount = Math.min(total, pads.roots[0] + Math.floor(rng.random() * (pads.roots[1] - pads.roots[0] + 1)));

  const makePad = (origin, dir, n0, L) => {
    const half = (L * pads.width) / 2;
    const step = L / mesh.rings;
    return {
      shape,
      length: L,
      children: 0,
      sections: growStem({
        origin, dir, n0,
        radiusAt: (s) => half * padProfile(s / L),
        step,
        maxLength: L - step * 1e-6,
        turn: (t) => t,
      }),
    };
  };

  const all = [];
  const queue = [];
  const spin0 = rng.random() * Math.PI * 2;
  for (let i = 0; i < rootCount; i++) {
    const az = spin0 + (i / rootCount) * Math.PI * 2 + rng.random(0.4, -0.4);
    const tilt = range(pads.rootTilt);
    const out = v3(Math.cos(az), 0, Math.sin(az));
    const dir = norm(add(scale(UP, Math.cos(tilt)), scale(out, Math.sin(tilt))));
    // Wide axis horizontal, roughly perpendicular to the lean.
    const n0 = norm(transport(v3(-Math.sin(az), 0, Math.cos(az)), UP, dir));
    const offset = scale(out, i === 0 ? 0 : 0.15);
    const pad = makePad(add(v3(0, -mesh.baseSink, 0), offset), dir, n0, range(pads.length));
    all.push(pad);
    queue.push(pad);
  }

  // Breadth-first: each pad sprouts children on its upper rim until the total is reached.
  while (all.length < total && queue.length) {
    const parent = queue.shift();
    const want = 1 + Math.floor(rng.random() * pads.maxChildren);
    for (let c = 0; c < want && all.length < total; c++) {
      const u = range(pads.attach);
      const sec = parent.sections[Math.min(parent.sections.length - 1, Math.round(u * (parent.sections.length - 1)))];
      const side = rng.random() < 0.5 ? -1 : 1;
      const b = cross(sec.t, sec.n);
      // Just inside the rim, so the child's narrow base is buried in the parent.
      const origin = add(sec.p, scale(sec.n, side * sec.r * 0.7));
      const spread = range(pads.spread);
      let dir = norm(add(scale(sec.t, Math.cos(spread)), scale(sec.n, side * Math.sin(spread))));
      dir = norm(add(dir, scale(b, rng.random(0.25, -0.25))));
      if (dir.y < pads.minUp) dir = norm(add(dir, v3(0, pads.minUp - dir.y + 0.05, 0)));
      // Keep the child roughly in the parent's plane, then twist it about its own axis.
      const n0 = rotate(norm(transport(sec.n, sec.t, dir)), dir, range(pads.twist));
      const child = makePad(origin, dir, n0, parent.length * range(pads.shrink));
      parent.children++;
      all.push(child);
      queue.push(child);
    }
  }

  const [trunk, ...arms] = all;
  return { trunk, arms };
}

/**
 * @returns {{ trunk: Stem, arms: Stem[] }} with Stem = { shape, sections }
 */
export function growCactus(options) {
  const rng = new RNG(options.seed);
  return options.preset.kind === "pads" ? growPads(options, rng) : growColumnar(options, rng);
}

// ── Meshing (no RNG) ────────────────────────────────────────────────────────

/** Scalloped rib profile: 1 on a ridge, 1 − depth in a valley. */
function ribProfile(theta, shape) {
  const f = (1 - Math.cos(shape.ribs * theta)) / 2;
  return 1 - shape.ribDepth * Math.pow(f, shape.ribSharpness);
}

/** Unit cross-section point (x along n, y along b) at angle theta. */
function sectionPoint(shape, theta, twist) {
  if (shape.kind === "pad") return [Math.cos(theta), shape.thickness * Math.sin(theta)];
  const rho = ribProfile(theta + twist, shape);
  return [rho * Math.cos(theta), rho * Math.sin(theta)];
}

function meshStem(buf, { shape, sections }, detail, preset) {
  const stride = Math.max(1, Math.floor(detail.sectionStride ?? 1));
  const factor = detail.segmentFactor ?? 1;
  const N = shape.kind === "pad"
    ? Math.max(8, Math.round(preset.mesh.segments * factor))
    : shape.ribs * Math.max(1, Math.round(preset.mesh.segmentsPerRib * factor));

  // Body rings by stride (always keep the first and last body ring), dome rings always.
  const body = sections.filter((sec) => !sec.dome);
  const rings = [];
  for (let i = 0; i < body.length; i += stride) rings.push(body[i]);
  if ((body.length - 1) % stride !== 0) rings.push(body[body.length - 1]);
  for (const sec of sections) if (sec.dome) rings.push(sec);

  const base = buf.verts.length / 3;
  const eps = 1e-3;
  for (let i = 0; i < rings.length; i++) {
    const { p, t, n, r, s } = rings[i];
    const b = cross(t, n);
    const prev = rings[Math.max(0, i - 1)], next = rings[Math.min(rings.length - 1, i + 1)];
    const ds = next.s - prev.s;
    const dr = ds > 1e-9 ? (next.r - prev.r) / ds : 0; // dr/ds
    const twist = shape.kind === "pad" ? 0 : shape.ribTwist * s;

    for (let j = 0; j <= N; j++) {
      // The grid turns with the twist, so each ridge stays on its own vertex
      // column. A fixed grid lets sharp ridges slide between vertices ring
      // to ring, which reads as a sawtooth fringe.
      const theta = (j / N) * Math.PI * 2 - twist;
      const [x, y] = sectionPoint(shape, theta, twist);
      const S = add(scale(n, x), scale(b, y));
      buf.verts.push(p.x + S.x * r, p.y + S.y * r, p.z + S.z * r);

      // Surface P(s,θ) = p + r·S(θ): ∂P/∂s ≈ t + r'·S, ∂P/∂θ = r·S'. The
      // normal ∝ S' × (t + r'·S) — r cancels, so it stays valid where the
      // ring closes to a point (tips, pad ends). Ribbed twist only adds an S'
      // term to ∂P/∂s, which drops out of the cross product.
      const [x1, y1] = sectionPoint(shape, theta + eps, twist);
      const [x0, y0] = sectionPoint(shape, theta - eps, twist);
      const Sd = add(scale(n, (x1 - x0) / (2 * eps)), scale(b, (y1 - y0) / (2 * eps)));
      const normal = norm(cross(Sd, add(t, scale(S, dr))));
      buf.normals.push(normal.x, normal.y, normal.z);
      buf.uvs.push(j / N, s);
    }
  }

  const W = N + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const a = base + i * W + j, bb = a + 1, c = a + W, d = c + 1;
      buf.indices.push(a, c, bb, bb, c, d);
    }
  }
}

/**
 * Mesh a skeleton at the given detail ({ sectionStride, segmentFactor }).
 * @returns {{ trunk: Buffers, arms: Buffers }} with Buffers = {verts, normals, uvs, indices}
 */
export function meshCactus(skeleton, options, detail = {}) {
  const empty = () => ({ verts: [], normals: [], uvs: [], indices: [] });
  const trunk = empty(), arms = empty();
  meshStem(trunk, skeleton.trunk, detail, options.preset);
  for (const arm of skeleton.arms) meshStem(arms, arm, detail, options.preset);
  return { trunk, arms };
}
