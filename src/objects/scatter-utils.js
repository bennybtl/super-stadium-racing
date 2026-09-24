/**
 * Shared helpers for the procedural feature scatters (dirt chunks, grass blades):
 * a seeded RNG, and the polyline queries used to hug walls and steer clear of
 * the racing line. Kept deterministic so a scatter is stable across rebuilds.
 */

import { TERRAIN_COLORS } from "../constants";

// ── Ground colour ────────────────────────────────────────────────────────────
// Average colour of each terrain's diffuse texture. The ground shader lerps the
// flat terrain colour toward its texture by diffuseTextureOpacity, so scatters do
// the same with the texture's mean to land on the colour the ground reads as.
const TEXTURE_MEAN = {
  packed_dirt: [0.592, 0.455, 0.314],
  loamy_dirt: [0.239, 0.18, 0.129],
  loose_dirt: [0.514, 0.365, 0.251],
  mud: [0.306, 0.247, 0.196],
  rocky: [0.396, 0.384, 0.384],
  grass: [0.2, 0.349, 0.067],
  weedy_grass: [0.439, 0.471, 0.259],
};

export function groundColor(terrain) {
  const flat = terrain?.color ?? TERRAIN_COLORS.packed_dirt;
  const tex = TEXTURE_MEAN[terrain?.name ?? "packed_dirt"];
  const k = tex ? (terrain?.diffuseTextureOpacity ?? 0.5) : 0;
  return [
    flat.r + ((tex?.[0] ?? 0) - flat.r) * k,
    flat.g + ((tex?.[1] ?? 0) - flat.g) * k,
    flat.b + ((tex?.[2] ?? 0) - flat.b) * k,
  ];
}

// ── Seeded RNG (mulberry32) ──────────────────────────────────────────────────
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str, fallback = "scatter") {
  let h = 2166136261 >>> 0;
  const s = String(str ?? fallback);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── Polyline geometry ────────────────────────────────────────────────────────
export function distToSegmentSq(px, pz, ax, az, bx, bz) {
  const dx = bx - ax,
    dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t,
    cz = az + dz * t;
  const ex = px - cx,
    ez = pz - cz;
  return ex * ex + ez * ez;
}

export function minDistToPolylines(px, pz, polylines) {
  let best = Infinity;
  for (const line of polylines) {
    for (let i = 0; i < line.length - 1; i++) {
      const d = distToSegmentSq(
        px,
        pz,
        line[i].x,
        line[i].z,
        line[i + 1].x,
        line[i + 1].z,
      );
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

export function collectWallPolylines(track) {
  const out = [];
  for (const f of track.features) {
    if (
      (f.type === "polyWall" || f.type === "polyCurb") &&
      Array.isArray(f.points) &&
      f.points.length >= 2
    ) {
      out.push(f.points);
    }
  }
  return out;
}

export function collectAiPathPolylines(track) {
  const f = track.features.find((t) => t.type === "aiPath");
  if (!f) return [];
  const out = [];
  if (Array.isArray(f.points) && f.points.length >= 2) out.push(f.points);
  if (Array.isArray(f.branches)) {
    for (const b of f.branches) {
      if (Array.isArray(b.points) && b.points.length >= 2) out.push(b.points);
    }
  }
  return out;
}
