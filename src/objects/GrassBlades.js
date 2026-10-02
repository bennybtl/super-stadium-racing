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
  makeRng,
  hashSeed,
  minDistToPolylines,
  collectWallPolylines,
  collectAiPathPolylines,
  groundColor,
} from "./scatter-utils.js";
import { growTuft, meshTuft } from "../decorations/lib/grass/GrassGen.js";

/**
 * Procedural "grass blade" scatter — the grass-terrain counterpart to
 * DirtChunks.
 *
 * Generates a few grass tufts (GrassGen: fans of curved, tapered blades with a
 * baked root→tip gradient) and scatters them as thin instances (one draw call
 * per variant): dense along wall lines, sparse across open
 * ground, always keeping a clearance around the AI drive path — and ONLY over
 * regions whose terrain type is grass. Deterministic (seeded from the track id)
 * so it's stable across rebuilds.
 *
 * Blades are not saved features: they're regenerated at scene build time.
 */

// Distinct tuft shapes, each one thin-instanced draw call.
const TUFT_SEEDS = [3, 7, 12, 21, 34, 55];

const DEFAULTS = {
  baseScale: 1.1, // tuft height in world units before per-instance variance
  maxBlades: 6000, // hard cap for safety/perf
  sink: 0.05, // push the tuft root this far below the ground (m)
  tiltMax: 0.13, // max random lean off vertical (rad)

  driveClearance: 6, // keep this far from the AI path (and its branches)
  boundsPadding: 4, // stay this far inside the track edge

  // Only scatter where the terrain type is one of these (matched by name).
  includeTerrain: ["grass"],

  // Wall-hugging scatter — grass grows tall and thick against wall bases.
  wallBand: 4.5, // grass sits within this distance of a wall
  wallMinOffset: 0.25, // ...but at least this far off it
  wallStep: 2.2, // sample a cluster every ~this many units along a wall
  wallPerStep: 9, // candidate blades per wall sample
  wallParallelBand: 1.1, // jitter along the wall tangent

  // General open-ground scatter
  areaDensity: 0.02, // candidate points per square unit
  areaAccept: 0.4, // fraction of open-ground candidates kept
};

/** True when any grass terrain is in play — a cheap gate so all-dirt tracks
 *  skip the candidate loop entirely. */
function trackHasGrass(track, names) {
  const set = new Set(names);
  if (set.has(track.defaultTerrainType?.name)) return true;
  return !!track.features?.some((f) => set.has(f?.terrainType?.name));
}

/** Build one unit-height tuft mesh, root at y=0, ready to be thin-instanced. */
function buildTuftMesh(scene, seed, name, material) {
  const buf = meshTuft(growTuft(seed));
  const vd = new VertexData();
  vd.positions = buf.verts;
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

/**
 * Scatter procedural grass blades onto the track. Resolves to the base meshes
 * so the caller can dispose them, or null when nothing was generated.
 *
 * @param {import('@babylonjs/core').Scene} scene
 * @param {import('../world/track.js').Track} track
 * @param {object} [options]
 */
export async function scatterGrassBlades(scene, track, options = {}) {
  const cfg = { ...DEFAULTS, ...options };

  if (!trackHasGrass(track, cfg.includeTerrain)) return null;

  // A drive path keeps grass off the racing line; if the track has none (a bare
  // test track), scatter anyway — grass on grass is harmless.
  const aiPath = collectAiPathPolylines(track);
  const wallLines = collectWallPolylines(track);
  const halfW = (track.width ?? 160) / 2 - cfg.boundsPadding;
  const halfD = (track.depth ?? 160) / 2 - cfg.boundsPadding;

  const rng = makeRng(hashSeed(track.id, "grass") ^ 0x7a5b3c1d);
  const included = new Set(cfg.includeTerrain);
  const placements = [];

  // wallDistNorm: 0 = against the wall, 1 = open ground / far edge of the band.
  const tryPlace = (x, z, wallDistNorm = 1.0) => {
    if (placements.length >= cfg.maxBlades) return;
    if (Math.abs(x) > halfW || Math.abs(z) > halfD) return;
    if (aiPath.length && minDistToPolylines(x, z, aiPath) < cfg.driveClearance) return;

    const terrain = track.getTerrainTypeAt(x, z);
    if (!included.has(terrain?.name)) return;

    placements.push({
      x,
      z,
      y: track.getHeightAt(x, z),
      wallDistNorm,
      color: groundColor(terrain),
    });
  };

  // 1) Dense scatter hugging the walls.
  for (const line of wallLines) {
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

      const steps = Math.max(1, Math.floor(len / cfg.wallStep));

      for (let s = 0; s < steps; s++) {
        const t = (s + rng()) / steps;
        const cx = a.x + dx * t,
          cz = a.z + dz * t;

        for (let k = 0; k < cfg.wallPerStep; k++) {
          const side = rng() < 0.5 ? 1 : -1;
          const offPerp = cfg.wallMinOffset + rng() * rng() * cfg.wallBand;
          const paraSide = rng() < 0.5 ? 1 : -1;
          const offPara = rng() * cfg.wallParallelBand;

          const finalX = cx + perpX * offPerp * side + ux * offPara * paraSide;
          const finalZ = cz + perpZ * offPerp * side + uz * offPara * paraSide;

          const wallDistNorm = Math.min(
            1.0,
            offPerp / (cfg.wallMinOffset + cfg.wallBand),
          );

          tryPlace(finalX, finalZ, wallDistNorm);
        }
      }
    }
  }

  // 2) Sparse scatter across open ground outside the drive path.
  const nArea = Math.floor(2 * halfW * (2 * halfD) * cfg.areaDensity);
  for (let i = 0; i < nArea; i++) {
    if (rng() >= cfg.areaAccept) continue;
    tryPlace((rng() * 2 - 1) * halfW, (rng() * 2 - 1) * halfD, 1.0);
  }

  if (placements.length === 0) return null;

  // Shared material — diffuse white so vertex gradient × per-instance tint give
  // the colour. No emissive: it lifted the tufts off the ground they grow from.
  const mat = new StandardMaterial("grassBladeMat", scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.04, 0.06, 0.03);
  mat.backFaceCulling = false; // grass planes read from both sides

  const baseMeshes = TUFT_SEEDS.map((seed, v) =>
    buildTuftMesh(scene, seed, `grassBlade_${v}`, mat),
  );

  const variants = baseMeshes.length;
  const buckets = Array.from({ length: variants }, () => []);
  const colorBuckets = Array.from({ length: variants }, () => []);

  const _scale = new Vector3();
  const _pos = new Vector3();
  const _rot = new Quaternion();

  for (const p of placements) {
    const v = (rng() * variants) | 0;

    // Taller and lusher against walls (wallDistNorm 0), shorter in the open.
    const tall = 1.25 + rng() * 0.5;
    const short = 0.6 + rng() * 0.3;
    const sc = cfg.baseScale * (tall + (short - tall) * p.wallDistNorm);
    const widthJitter = 0.85 + rng() * 0.3;
    _scale.set(sc * widthJitter, sc, sc * widthJitter);

    Quaternion.FromEulerAnglesToRef(
      (rng() - 0.5) * 2 * cfg.tiltMax,
      rng() * Math.PI * 2,
      (rng() - 0.5) * 2 * cfg.tiltMax,
      _rot,
    );
    _pos.set(p.x, p.y - cfg.sink, p.z);

    const arr = new Float32Array(16);
    Matrix.Compose(_scale, _rot, _pos).copyToArray(arr);
    buckets[v].push(arr);

    // Per-instance colour: grass tint with random shade + a little dry-out.
    const shade = 0.8 + rng() * 0.4;
    const dry = rng() < 0.15 ? 0.35 * rng() : 0; // toward tan
    const [gr, gg, gb] = p.color;
    const r = gr * shade + dry * 0.35;
    const g = gg * shade + dry * 0.22;
    const bch = gb * shade;
    colorBuckets[v].push(r, g, bch, 1.0);
  }

  for (let v = 0; v < variants; v++) {
    const list = buckets[v];
    if (list.length === 0) {
      baseMeshes[v].dispose();
      baseMeshes[v] = null;
      continue;
    }
    const data = new Float32Array(list.length * 16);
    list.forEach((arr, i) => data.set(arr, i * 16));
    baseMeshes[v].thinInstanceSetBuffer("matrix", data, 16, true);
    baseMeshes[v].thinInstanceSetBuffer(
      "color",
      new Float32Array(colorBuckets[v]),
      4,
      false,
    );
  }

  return baseMeshes.filter(Boolean);
}
