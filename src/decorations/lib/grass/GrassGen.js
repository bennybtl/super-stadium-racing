/**
 * Procedural grass-tuft generator, built like the rock / cactus ones: draw
 * every random choice into a small skeleton, then mesh it with no RNG.
 * Engine-free — plain math and arrays — so the Babylon side just wraps buffers.
 *
 * A tuft is a fan of tapered blades rooted in a small disc. Each blade leans
 * outward from the centre and bends further as it rises (the lean angle grows
 * with the square of the distance along the blade), so outer blades arc over
 * and inner ones stand up. Blades are single ribbons in N segments ending in a
 * point; the material is double-sided.
 *
 * Output is Babylon-native: y up, unit height (the tallest blade reaches ~1),
 * root at y=0, centred on x/z.
 */
import RNG from "../ez-tree/rng.js";

export const GRASS_DEFAULTS = {
  blades: [7, 14], // blades per tuft
  rootRadius: 0.12, // blade roots spread over a disc this wide
  height: [0.5, 1.0], // blade length; centre blades draw toward the top of the range
  width: [0.035, 0.06], // blade half-width at the root
  lean: [0.08, 0.45], // angle off vertical at the root (rad), more for outer blades
  bend: [0.3, 1.1], // extra lean gained by the tip (rad)
  segments: 4, // ribbon segments per blade (the last one tapers to a point)
  dry: 0.1, // chance a blade is dried to straw
};

// Baked colour multipliers (they multiply the per-instance terrain tint):
// shaded at the root, lighter and a little sun-bleached at the tip. ROOT..TIP
// averages ~1 so a tuft reads as the ground's colour overall.
const ROOT_COLOR = [0.45, 0.45, 0.45];
const TIP_COLOR = [1.3, 1.22, 0.95];
const DRY_COLOR = [2.2, 1.35, 1.2]; // × green tint → straw

// ── Skeleton: every random draw happens here ────────────────────────────────

/** @returns {{ blades: { x, z, yaw, len, w, lean, bend, twist, shade, dry }[] }} */
export function growTuft(seed = 1, options = {}) {
  const P = { ...GRASS_DEFAULTS, ...options };
  const rng = new RNG(Math.max(1, Math.round(seed)));
  const range = ([a, b]) => rng.random(b, a);
  const n = Math.floor(rng.random(P.blades[1] + 1, P.blades[0]));

  const blades = [];
  for (let i = 0; i < n; i++) {
    // sqrt → uniform over the disc; golden-angle start keeps roots spread out.
    const r = P.rootRadius * Math.sqrt(rng.random());
    const a = i * 2.39996 + rng.random(0.6, -0.6);
    const out = r / P.rootRadius; // 0 at the centre, 1 at the rim
    blades.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      // Lean outward (away from the tuft centre), with some scatter.
      yaw: a + rng.random(0.5, -0.5),
      len: P.height[0] + (P.height[1] - P.height[0]) * (1 - 0.6 * out) * rng.random(1, 0.6),
      w: range(P.width),
      lean: P.lean[0] + (P.lean[1] - P.lean[0]) * (0.4 * rng.random() + 0.6 * out),
      bend: range(P.bend),
      twist: rng.random(0.5, -0.5), // blade-plane twist root→tip (rad)
      shade: rng.random(1.1, 0.85),
      dry: rng.random() < P.dry,
    });
  }
  return { blades, segments: P.segments };
}

// ── Mesher: no RNG ──────────────────────────────────────────────────────────

/**
 * @returns {{ verts, normals, colors, indices }} flat arrays; colors are RGBA.
 * Normals all point straight up so each tuft lights like the ground it grows
 * from (thin double-sided blades otherwise go dark on their back faces).
 */
export function meshTuft(sk) {
  const verts = [], normals = [], colors = [], indices = [];
  const S = sk.segments;

  let top = 0;
  const bladePts = sk.blades.map((b) => {
    // Integrate the bent centreline: lean(s) = lean + bend·s².
    const pts = [[b.x, 0, b.z]];
    const step = b.len / S;
    const dx = Math.cos(b.yaw), dz = Math.sin(b.yaw);
    let [x, y, z] = pts[0];
    for (let k = 1; k <= S; k++) {
      const s = (k - 0.5) / S;
      const ang = b.lean + b.bend * s * s;
      x += dx * Math.sin(ang) * step;
      z += dz * Math.sin(ang) * step;
      y += Math.cos(ang) * step;
      pts.push([x, y, z]);
      top = Math.max(top, y);
    }
    return pts;
  });

  sk.blades.forEach((b, bi) => {
    const pts = bladePts[bi];
    const base = verts.length / 3;
    const tint = b.dry ? DRY_COLOR : [1, 1, 1];
    const color = (y) => {
      const t = top > 0 ? Math.min(1, Math.max(0, y / top)) ** 0.8 : 1;
      return [0, 1, 2].map((c) => (ROOT_COLOR[c] + (TIP_COLOR[c] - ROOT_COLOR[c]) * t) * tint[c] * b.shade);
    };

    for (let k = 0; k <= S; k++) {
      const [x, y, z] = pts[k];
      const s = k / S;
      if (k === S) {
        // Tip: a single point.
        verts.push(x, y, z);
        normals.push(0, 1, 0);
        colors.push(...color(y), 1);
        continue;
      }
      // Width runs across the lean direction, twisting as the blade rises.
      const yaw = b.yaw + Math.PI / 2 + b.twist * s;
      const w = b.w * (1 - s ** 1.5);
      const wx = Math.cos(yaw) * w, wz = Math.sin(yaw) * w;
      verts.push(x - wx, y, z - wz, x + wx, y, z + wz);
      normals.push(0, 1, 0, 0, 1, 0);
      const c = color(y);
      colors.push(...c, 1, ...c, 1);
    }

    for (let k = 0; k < S - 1; k++) {
      const a = base + k * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const last = base + (S - 1) * 2;
    indices.push(last, last + 2, last + 1);
  });

  // Normalise to unit height so callers scale in world units.
  if (top > 0) for (let i = 0; i < verts.length; i++) verts[i] /= top;
  return { verts, normals, colors, indices };
}
