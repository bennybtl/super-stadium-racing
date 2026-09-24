import {
  Mesh,
  VertexData,
  Matrix,
  Vector3,
  Quaternion,
  StandardMaterial,
  Color3,
} from "@babylonjs/core";
import {
  ROCK_COLOR_BASE,
  rockOptions,
  growRock,
  meshRock,
} from "../decorations/lib/rock/RockGen.js";
import {
  makeRng,
  hashSeed,
  minDistToPolylines,
  collectWallPolylines,
  collectAiPathPolylines,
  groundColor,
} from "./scatter-utils.js";

/**
 * Procedural "dirt chunk" scatter.
 *
 * Builds a handful of small RockGen rocks (low icosphere level, with RockGen's
 * baked ground-line AO) and scatters them as thin instances in clumps: drifts
 * piled against walls, where loose dirt accumulates, and a few sparse clumps
 * on open ground, keeping a clearance around the AI drive path. Each chunk is
 * tinted to the terrain it sits on. Generation is deterministic (seeded from
 * the track id) so it's stable across rebuilds.
 *
 * Chunks are not saved features: they're regenerated at scene build time.
 */

const DEFAULTS = {
  baseSize: 0.4, // base chunk radius (world units), before per-instance scale
  maxChunks: 5200, // hard cap for safety/perf

  driveClearance: 7, // keep this far from the AI path (and its branches)
  boundsPadding: 4, // stay this far inside the track edge

  // Dirt chunks look wrong on these surfaces, so skip any region whose
  // terrain type is one of these (matched by terrain type name).
  excludeTerrain: ["grass", "asphalt"],

  // Wall drifts: clumps piled against the wall base, patchy along its length.
  wallMinOffset: 0.2, // chunks stay at least this far off the wall line
  wallFalloff: 0.4, // mean extra distance of a clump from the wall (exponential)
  wallBand: 4.0, // distance at which chunks reach their smallest size
  wallStep: 1.2, // try a clump every ~this many units along each side of a wall
  driftLength: 7, // along-wall length of a drift / gap (noise period)
  clumpSize: [4, 14], // chunks per wall clump (scaled by local drift density)
  clumpSpread: 0.55, // clump radius (gaussian sigma), stretched along the wall

  // Open-ground clumps.
  areaDensity: 0.0025, // clump centres per square unit
  areaClumpSize: [1, 5],
  areaSpread: 0.6,

  // Per-clump tone: each pile is this much lighter or darker than the ground
  // (random sign, magnitude in range), so it reads against the dirt it sits on.
  clumpTone: [0.08, 0.16],
};

// RockGen shapes used as chunk variants (each one thin-instanced draw call).
// Icosphere level 1 (80 tris) keeps a few thousand instances cheap.
const CHUNK_VARIANTS = [
  ["granite", 3],
  ["granite", 11],
  ["granite", 27],
  ["boulder", 5],
  ["boulder", 19],
  ["slab", 8],
];
const CHUNK_DETAIL = { subdivisions: 1 };

// ── Base chunk mesh ──────────────────────────────────────────────────────────
function makeChunkMesh(name, scene, preset, seed, size, material) {
  const options = rockOptions(preset, seed);
  const buf = meshRock(growRock(options), options, CHUNK_DETAIL);
  const k = size / options.preset.size; // RockGen body → chunk radius
  const vd = new VertexData();
  vd.positions = buf.verts.map((v) => v * k);
  vd.normals = buf.normals;
  vd.colors = buf.colors;
  vd.indices = buf.indices;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  mesh.alwaysSelectAsActiveMesh = true; // thin instances span the whole track
  return mesh;
}

// Seeded 1D value noise in [0, 1] (smooth, two octaves) for patchy drifts.
function makeNoise1D(rng, size = 256) {
  const lattice = Array.from({ length: size }, rng);
  const at = (x) => {
    const i = Math.floor(x), f = x - i;
    const a = lattice[((i % size) + size) % size];
    const b = lattice[(((i + 1) % size) + size) % size];
    return a + (b - a) * f * f * (3 - 2 * f);
  };
  return (x) => (at(x) * 2 + at(x * 2.3 + 17)) / 3;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Scatter procedural dirt chunks onto the track. Returns the base meshes so the
 * caller can dispose them, or null when nothing was generated.
 *
 * @param {import('@babylonjs/core').Scene} scene
 * @param {import('../world/track.js').Track} track
 * @param {object} [options]
 */
export function scatterDirtChunks(scene, track, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const aiPath = collectAiPathPolylines(track);

  // No drive path → no notion of "outside the path"; skip rather than litter it.
  if (aiPath.length === 0) return null;

  const wallLines = collectWallPolylines(track);
  const halfW = (track.width ?? 160) / 2 - cfg.boundsPadding;
  const halfD = (track.depth ?? 160) / 2 - cfg.boundsPadding;

  const rng = makeRng(hashSeed(track.id) ^ 0x1f2e3d4c);
  const gauss = () => (rng() + rng() + rng() - 1.5) * 1.41; // ~N(0, 1)
  const drift = makeNoise1D(rng);
  const clumpTone = () => {
    const [lo, hi] = cfg.clumpTone;
    return (rng() < 0.5 ? -1 : 1) * (lo + (hi - lo) * rng());
  };
  const excluded = new Set(cfg.excludeTerrain);
  const placements = [];

  // `near` is 1 right at a wall, 0 at wallBand and beyond; `core` is 1 at a
  // clump's centre, 0 at its edge. Both push chunk size up.
  const tryPlace = (x, z, near, core, tone) => {
    if (placements.length >= cfg.maxChunks) return;
    if (Math.abs(x) > halfW || Math.abs(z) > halfD) return;
    if (minDistToPolylines(x, z, aiPath) < cfg.driveClearance) return; // keep racing line clear

    // Don't scatter dirt over grass/asphalt regions (null = default dirt ground).
    const terrain = track.getTerrainTypeAt(x, z);
    if (excluded.has(terrain?.name)) return;

    placements.push({ x, z, y: track.getHeightAt(x, z), near, core, tone, color: groundColor(terrain) });
  };

  // 1) Drifts against the walls. Walk each side of each wall by arc length; a
  // noise field along the wall decides where dirt has piled up and where it's
  // bare, so drifts come in patches rather than an even band.
  let lineSeed = 0;
  for (const line of wallLines) {
    let arc = (lineSeed += 97.3);
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i],
        b = line[i + 1];
      const dx = b.x - a.x,
        dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;

      const ux = dx / len,
        uz = dz / len;
      const perpX = -uz,
        perpZ = ux;

      for (let s = rng() * cfg.wallStep; s < len; s += cfg.wallStep) {
        for (const side of [1, -1]) {
          const u = (arc + s) / cfg.driftLength + (side > 0 ? 0 : 131.7);
          const density = smoothstep(0.35, 0.8, drift(u));
          if (rng() >= density) continue;

          const cx = a.x + ux * s,
            cz = a.z + uz * s;
          const centrePerp = cfg.wallMinOffset - Math.log(1 - rng()) * cfg.wallFalloff;
          const [nMin, nMax] = cfg.clumpSize;
          const n = Math.round(nMin + (nMax - nMin) * density * (0.5 + 0.5 * rng()));
          const sigma = cfg.clumpSpread * (0.7 + 0.6 * rng());
          const tone = clumpTone();

          for (let k = 0; k < n; k++) {
            const gp = gauss(),
              gq = gauss();
            const para = gp * sigma * 1.8;
            let perp = centrePerp + gq * sigma * 0.6;
            // Reflect off the wall face rather than poke through it.
            if (perp < cfg.wallMinOffset) perp = 2 * cfg.wallMinOffset - perp;
            const x = cx + ux * para + perpX * perp * side;
            const z = cz + uz * para + perpZ * perp * side;
            const near = 1 - Math.min(1, perp / cfg.wallBand);
            const core = Math.max(0, 1 - Math.hypot(gp, gq) / 2.5);
            tryPlace(x, z, near, core, tone);
          }
        }
      }
      arc += len;
    }
  }

  // 2) Sparse clumps across open ground outside the drive path.
  const nArea = Math.floor(2 * halfW * (2 * halfD) * cfg.areaDensity);
  for (let i = 0; i < nArea; i++) {
    const cx = (rng() * 2 - 1) * halfW,
      cz = (rng() * 2 - 1) * halfD;
    const [nMin, nMax] = cfg.areaClumpSize;
    const n = nMin + Math.floor(rng() * (nMax - nMin + 1));
    const tone = clumpTone();
    for (let k = 0; k < n; k++) {
      const gp = gauss(),
        gq = gauss();
      const core = Math.max(0, 1 - Math.hypot(gp, gq) / 2.5);
      tryPlace(cx + gp * cfg.areaSpread, cz + gq * cfg.areaSpread, 0, core, tone);
    }
  }

  if (placements.length === 0) return null;

  // One shared material: white diffuse so vertex AO × per-instance tint give
  // the colour. No emissive — it lifted the chunks off the ground they sit on.
  const mat = new StandardMaterial("dirtChunkMat_0", scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.03, 0.03, 0.03);

  const baseMeshes = CHUNK_VARIANTS.map(([preset, seed], v) =>
    makeChunkMesh(`dirtChunk_${v}`, scene, preset, seed, cfg.baseSize, mat),
  );
  const buckets = baseMeshes.map(() => []);
  const colorBuckets = baseMeshes.map(() => []);

  const _scale = new Vector3();
  const _pos = new Vector3();
  const _rot = new Quaternion();

  for (const p of placements) {
    const v = (rng() * baseMeshes.length) | 0;

    // Heavy-tailed size: mostly small grit, the odd bigger lump — bigger near
    // walls and at clump centres, where the pile is deepest.
    const sc =
      (0.3 + 0.9 * rng() ** 2.2) * (0.6 + 0.4 * p.near) * (0.75 + 0.45 * p.core);
    _scale.set(sc * (0.85 + 0.3 * rng()), sc * (0.7 + 0.5 * rng()), sc * (0.85 + 0.3 * rng()));
    Quaternion.FromEulerAnglesToRef(
      (rng() - 0.5) * 0.35,
      rng() * Math.PI * 2,
      (rng() - 0.5) * 0.35,
      _rot,
    );
    // Settle into the ground a little (RockGen's flat bottom already sits
    // just below y=0); smaller pieces sink proportionally deeper.
    _pos.set(p.x, p.y - cfg.baseSize * sc * (0.05 + 0.2 * rng()), p.z);

    const arr = new Float32Array(16);
    Matrix.Compose(_scale, _rot, _pos).copyToArray(arr);
    buckets[v].push(arr);

    // Terrain colour, un-doing RockGen's vertex-colour base so a plain face
    // matches the ground; small shade/warmth jitter so pieces read separately.
    const shade = ((0.9 + 0.2 * rng()) * (1 + p.tone)) / ROCK_COLOR_BASE;
    const warm = (rng() - 0.5) * 0.06;
    const [r, g, b] = p.color;
    colorBuckets[v].push(r * shade * (1 + warm), g * shade, b * shade * (1 - warm), 1.0);
  }

  const kept = [];
  baseMeshes.forEach((mesh, v) => {
    const list = buckets[v];
    if (list.length === 0) {
      mesh.dispose();
      return;
    }
    const data = new Float32Array(list.length * 16);
    list.forEach((arr, i) => data.set(arr, i * 16));
    mesh.thinInstanceSetBuffer("matrix", data, 16, true);
    mesh.thinInstanceSetBuffer("color", new Float32Array(colorBuckets[v]), 4, true);
    kept.push(mesh);
  });

  return kept;
}
