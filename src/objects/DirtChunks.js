import {
  MeshBuilder, Matrix, Vector3, Quaternion, StandardMaterial, Color3, VertexBuffer,
} from "@babylonjs/core";

/**
 * Procedural "dirt chunk" scatter.
 *
 * Builds a few jittered low-poly polyhedra and scatters them as thin instances
 * (one draw call each) across the track — densely along wall lines and sparsely
 * in open areas, while keeping a clearance around the AI drive path. Generation
 * is deterministic (seeded from the track id) so it's stable across rebuilds.
 *
 * Chunks are not saved features: they're regenerated at scene build time.
 */

const DEFAULTS = {
  variants: 3,           // distinct base shapes (each thin-instanced)
  baseSize: 0.55,        // base chunk radius (world units), before per-instance scale
  maxChunks: 2400,       // hard cap for safety/perf

  driveClearance: 7,     // keep this far from the AI path (and its branches)
  boundsPadding: 4,      // stay this far inside the track edge

  // Wall-hugging scatter
  wallBand: 5.0,         // dirt sits within this distance of a wall
  wallMinOffset: 0.4,    // ...but at least this far off it
  wallStep: 4.8,         // sample a cluster every ~this many units along a wall
  wallPerStep: 8,        // candidate chunks per wall sample (denser near walls)

  // General open-ground scatter
  areaDensity: 0.012,    // candidate points per square unit
  areaAccept: 0.5,       // fraction of open-ground candidates kept
};

// ── Seeded RNG (mulberry32) ──────────────────────────────────────────────────
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str ?? "dirt");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── Geometry helpers ─────────────────────────────────────────────────────────
function distToSegmentSq(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t, cz = az + dz * t;
  const ex = px - cx, ez = pz - cz;
  return ex * ex + ez * ez;
}

function minDistToPolylines(px, pz, polylines) {
  let best = Infinity;
  for (const line of polylines) {
    for (let i = 0; i < line.length - 1; i++) {
      const d = distToSegmentSq(px, pz, line[i].x, line[i].z, line[i + 1].x, line[i + 1].z);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

function collectWallPolylines(track) {
  const out = [];
  for (const f of track.features) {
    if ((f.type === "polyWall" || f.type === "polyCurb")
      && Array.isArray(f.points) && f.points.length >= 2) {
      out.push(f.points);
    }
  }
  return out;
}

function collectAiPathPolylines(track) {
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

// Babylon built-in polyhedron types (0..14) used as chunk base shapes.
const CHUNK_POLY_TYPES = [2, 3, 5, 8];
const CHUNK_FLATTEN = 0.7; // squash on Y so chunks sit like rocks (baked into geometry)

// ── Base chunk mesh ──────────────────────────────────────────────────────────
function makeChunkMesh(name, scene, rng, size, polyType, material) {
  // flat:false → SHARED vertices. CreatePolyhedron defaults to flat:true, which
  // duplicates each corner per face; jittering those independently splits the
  // faces apart (broken geometry). With shared vertices each corner is jittered
  // exactly once and the mesh stays watertight, then convertToFlatShadedMesh
  // re-facets it for the low-poly rock look.
  const mesh = MeshBuilder.CreatePolyhedron(name, { type: polyType, size, flat: false }, scene);
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    const j = 0.72 + rng() * 0.56; // 0.72 .. 1.28, radial → stays star-shaped
    pos[i] *= j;
    pos[i + 1] *= j * CHUNK_FLATTEN; // squash on Y so chunks sit like rocks
    pos[i + 2] *= j;
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
  mesh.convertToFlatShadedMesh();
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  mesh.alwaysSelectAsActiveMesh = true; // thin instances span the whole track
  return mesh;
}

/**
 * Scatter procedural dirt chunks onto the track. Returns the base meshes so the
 * caller can dispose them, or null when nothing was generated.
 *
 * @param {import('@babylonjs/core').Scene} scene
 * @param {import('../track.js').Track} track
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

  const placements = [];
  const tryPlace = (x, z) => {
    if (placements.length >= cfg.maxChunks) return;
    if (Math.abs(x) > halfW || Math.abs(z) > halfD) return;
    if (minDistToPolylines(x, z, aiPath) < cfg.driveClearance) return; // keep racing line clear
    placements.push({ x, z, y: track.getHeightAt(x, z) });
  };

  // 1) Dense scatter hugging the walls.
  for (const line of wallLines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const ux = dx / len, uz = dz / len;
      const perpX = -uz, perpZ = ux;
      const steps = Math.max(1, Math.floor(len / cfg.wallStep));
      for (let s = 0; s < steps; s++) {
        const t = (s + rng()) / steps;
        const cx = a.x + dx * t, cz = a.z + dz * t;
        for (let k = 0; k < cfg.wallPerStep; k++) {
          const side = rng() < 0.5 ? 1 : -1;
          // rng² biases the offset toward the wall, so density is highest right
          // against it and tapers across the band.
          const off = cfg.wallMinOffset + rng() * rng() * cfg.wallBand;
          tryPlace(cx + perpX * off * side, cz + perpZ * off * side);
        }
      }
    }
  }

  // 2) Sparse scatter across open ground outside the drive path.
  const nArea = Math.floor((2 * halfW) * (2 * halfD) * cfg.areaDensity);
  for (let i = 0; i < nArea; i++) {
    if (rng() >= cfg.areaAccept) continue;
    tryPlace((rng() * 2 - 1) * halfW, (rng() * 2 - 1) * halfD);
  }

  if (placements.length === 0) return null;

  // Build the base meshes (one per variant) and bucket placements into them.
  const baseMeshes = [];
  const buckets = [];
  for (let v = 0; v < cfg.variants; v++) {
    const mat = new StandardMaterial(`dirtChunkMat_${v}`, scene);
    const shade = 0.32 + v * 0.05;
    mat.diffuseColor = new Color3(shade, shade * 0.74, shade * 0.5);
    mat.emissiveColor = new Color3(shade * 0.18, shade * 0.13, shade * 0.09); // lift the shadowed faces off black
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    const polyType = CHUNK_POLY_TYPES[v % CHUNK_POLY_TYPES.length];
    baseMeshes.push(makeChunkMesh(`dirtChunk_${v}`, scene, rng, cfg.baseSize, polyType, mat));
    buckets.push([]);
  }

  // Per-instance transform: random yaw + slight tumble, UNIFORM scale (preserves
  // the baked normals), and a small sink so chunks look half-buried.
  const _scale = new Vector3();
  const _pos = new Vector3();
  const _rot = new Quaternion();
  for (const p of placements) {
    const v = (rng() * cfg.variants) | 0;
    const sc = 0.5 + rng() * 0.95; // uniform size 0.5 .. 1.45 (uniform → normals preserved)
    _scale.set(sc, sc, sc);
    Quaternion.FromEulerAnglesToRef(
      (rng() - 0.5) * 0.5, rng() * Math.PI * 2, (rng() - 0.5) * 0.5, _rot,
    );
    _pos.set(p.x, p.y - cfg.baseSize * CHUNK_FLATTEN * sc * 0.4, p.z);
    const m = Matrix.Compose(_scale, _rot, _pos);
    const arr = new Float32Array(16);
    m.copyToArray(arr);
    buckets[v].push(arr);
  }

  for (let v = 0; v < cfg.variants; v++) {
    const list = buckets[v];
    if (list.length === 0) { baseMeshes[v].dispose(); baseMeshes[v] = null; continue; }
    const data = new Float32Array(list.length * 16);
    list.forEach((arr, i) => data.set(arr, i * 16));
    baseMeshes[v].thinInstanceSetBuffer("matrix", data, 16, true);
  }

  return baseMeshes.filter(Boolean);
}
