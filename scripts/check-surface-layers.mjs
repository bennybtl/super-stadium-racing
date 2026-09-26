// Surface-layer parity check: `npm run check:surface-layers`
//
// TerrainQuery answers from DriveSurfaceManager's height layers
// (src/world/surface-layers.js), which replaced the old Babylon raycasts. Until
// the raycasts are deleted, this checks the two still agree: every shipped
// track is built headlessly, with the real ground mesh, outskirts, bridge
// decks, drive boxes and seams registered in the real DriveSurfaceManager, and
// the same questions go to
//
//   raycast: new TerrainQuery(scene, { raycast: true })
//   layers:  new TerrainQuery(scene)
//
// Compared: tryHeightAtFast (height + resolved surface), and on a subset,
// castDown (height + smoothed normal) with and without a continuity hint.
//
// Query points: a jittered grid over each track (a little past the ground's
// edge), plus a denser grid over every deck and seam. At each point, from high
// above, and from just above / just below / well below every surface there, so
// the on-deck, under-deck and sunk-in (upward fallback) cases all get asked.
//
// Exits non-zero if any answer differs by more than the tolerances.

import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// ── Bundle the real modules for node ─────────────────────────────────────────
const cacheDir = join(root, 'node_modules', '.cache', 'check-surface-layers');
mkdirSync(cacheDir, { recursive: true });
const entry = join(cacheDir, 'entry.mjs');
const src = (...p) => JSON.stringify(join(root, 'src', ...p));
writeFileSync(entry, `
export { Track } from ${src('world', 'track.js')};
export { DriveSurfaceManager } from ${src('managers', 'DriveSurfaceManager.js')};
export { TerrainQuery } from ${src('managers', 'TerrainQuery.js')};
export { BridgeMeshManager } from ${src('managers', 'BridgeMeshManager.js')};
export { buildOutskirts } from ${src('objects', 'Outskirts.js')};
export { NullEngine, Scene, MeshBuilder, VertexBuffer, Logger } from '@babylonjs/core';
`);
const bundlePath = join(cacheDir, 'bundle.mjs');
const empty = Object.fromEntries(
  ['.png', '.jpg', '.jpeg', '.obj', '.mtl', '.glb', '.mp3', '.wav', '.ogg', '.svg'].map((e) => [e, 'empty']),
);
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  loader: empty,
  define: { 'import.meta.glob': '__viteGlobStub' },
  banner: { js: 'globalThis.__viteGlobStub = () => ({});' },
  outfile: bundlePath,
  absWorkingDir: root,
  logLevel: 'silent',
});
const {
  Track, DriveSurfaceManager, TerrainQuery, BridgeMeshManager, buildOutskirts,
  NullEngine, Scene, MeshBuilder, VertexBuffer, Logger,
} = await import(pathToFileURL(bundlePath).href);
Logger.LogLevels = 0;

const HEIGHT_TOLERANCE = 2e-3;  // metres; mesh positions are float32
const NORMAL_TOLERANCE = 1e-3;  // |Δ| per component of castDown's unit normal
const GRID = 40;                // track-wide query grid, per axis
const SURFACE_GRID = 14;        // per deck / seam, per axis
const EDGE_MARGIN = 8;          // query this far past the ground mesh's edge
const CAST_DOWN_EVERY = 4;      // castDown (5 raycasts each) on every Nth query
const TIE = 1e-4;               // two surfaces this close at a point are a tie

// Deterministic jitter so query points don't sit on lattice lines.
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// PhysicsAggregate needs a physics engine; nothing here simulates, so any call
// on it may do nothing.
const noopPhysics = () => new Proxy(function () {}, {
  get: (_, k) => (k === 'getPluginVersion' ? () => 2 : k === 'then' ? undefined : noopPhysics()),
  apply: () => noopPhysics(),
});

function buildScene(track) {
  const scene = new Scene(new NullEngine());
  const physics = noopPhysics();
  scene.getPhysicsEngine = () => physics;
  const dsm = new DriveSurfaceManager(scene);
  scene.metadata = { driveSurfaceManager: dsm };

  // Ground: the same construction as SceneBuilder.
  const lattice = track.getGroundLattice();
  const ground = MeshBuilder.CreateGround(
    'ground', { width: lattice.width, height: lattice.depth, subdivisions: lattice.subdivisions }, scene,
  );
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] = track.getHeightAt(positions[i], positions[i + 2]);
  }
  ground.setVerticesData(VertexBuffer.PositionKind, positions);
  ground.createNormals(true);
  dsm.register(ground, { kind: 'ground', lattice });

  buildOutskirts(scene, track, dsm);
  const bridges = new BridgeMeshManager(scene, track, null, dsm);
  for (const feature of track.getFeatures()) {
    if (feature.type === 'bridgeMesh' || feature.type === 'driveBox') bridges.create(feature);
  }
  for (const mesh of scene.meshes) {
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo();
  }
  const decksAndSeams = scene.meshes.filter((m) => {
    const kind = dsm.getSurfaceByMesh(m)?.kind;
    return kind === 'deck' || kind === 'seam';
  });
  return { scene, dsm, lattice, decksAndSeams };
}

function queryPoints(lattice, decksAndSeams) {
  const pts = [];
  const halfW = lattice.width / 2 + EDGE_MARGIN;
  const halfD = lattice.depth / 2 + EDGE_MARGIN;
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      pts.push([
        -halfW + ((c + rand()) / GRID) * halfW * 2,
        -halfD + ((r + rand()) / GRID) * halfD * 2,
      ]);
    }
  }
  for (const mesh of decksAndSeams) {
    const { minimumWorld: min, maximumWorld: max } = mesh.getBoundingInfo().boundingBox;
    for (let r = 0; r < SURFACE_GRID; r++) {
      for (let c = 0; c < SURFACE_GRID; c++) {
        pts.push([
          min.x - 1 + ((c + rand()) / SURFACE_GRID) * (max.x - min.x + 2),
          min.z - 1 + ((r + rand()) / SURFACE_GRID) * (max.z - min.z + 2),
        ]);
      }
    }
  }
  return pts;
}

const heightDiff = (a, b) => (a === null || b === null ? (a === b ? 0 : Infinity) : Math.abs(a - b));
const normalDiff = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
const fmt = (v) => (v === null || v === undefined ? 'miss' : v.toFixed(3));

// ── Run ──────────────────────────────────────────────────────────────────────
const tracksDir = join(root, 'src', 'tracks');
const trackFiles = readdirSync(tracksDir).filter((f) => f.endsWith('.json')).sort();
let failedTracks = 0;
let totalQueries = 0;

for (const file of trackFiles) {
  const track = Track.fromJSON(readFileSync(join(tracksDir, file), 'utf8'));
  const built = buildScene(track);
  const ray = new TerrainQuery(built.scene, { raycast: true });
  const lay = new TerrainQuery(built.scene);

  let queries = 0;
  let ties = 0;
  let maxDy = 0;
  let maxDn = 0;
  const mismatches = [];
  const miss = (what, x, z, fromY, a, b) => mismatches.push(`${what} at (${x.toFixed(2)}, ${z.toFixed(2)}) from ${fromY.toFixed(2)}: ray ${a}, layers ${b}`);

  for (const [x, z] of queryPoints(built.lattice, built.decksAndSeams)) {
    const hits = built.dsm.layers.hitsAt(x, z);
    const fromYs = [500];
    for (const { y } of hits) fromYs.push(y + 0.1, y - 0.5, y - 2);
    // A continuity hint naming a surface that isn't always the nearest one.
    const other = hits.length > 1 ? hits[hits.length - 1].surface.surfaceId : null;
    const lock = other === null ? null : { transitionLock: { mode: 'prefer', maxDistanceDelta: 0.08, surfaceId: other } };

    for (const fromY of fromYs) {
      queries++;
      const ry = ray.tryHeightAtFast(x, z, fromY);
      const rs = ray.getLastResolvedSurface();
      const ly = lay.tryHeightAtFast(x, z, fromY);
      const ls = lay.getLastResolvedSurface();
      const dy = heightDiff(ry, ly);
      // castDown's steep-face retry: the fast raycast misses faces steeper than
      // its normal filter; only a full castDown can tell a real disagreement.
      if (dy > HEIGHT_TOLERANCE && !(ry === null && ray.tryHeightAt(x, z, fromY) !== null)) {
        miss('fast height', x, z, fromY, fmt(ry), fmt(ly));
      } else if (dy <= HEIGHT_TOLERANCE && ry !== null && rs?.surfaceId !== ls?.surfaceId
        && !hits.some((h) => h.surface.surfaceId === rs?.surfaceId && Math.abs(h.y - ly) <= HEIGHT_TOLERANCE)) {
        // A different surface is only a disagreement when the raycast's surface
        // isn't also right there: where a seam's foot lies on the ground the two
        // coincide, and which one a tie resolves to is float noise.
        miss('fast surface', x, z, fromY, rs?.kind, ls?.kind);
      } else if (dy <= HEIGHT_TOLERANCE) {
        maxDy = Math.max(maxDy, dy);
      }

      if (queries % CAST_DOWN_EVERY !== 0) continue;
      // Where two surfaces coincide (a seam's foot on the ground), the raycast
      // picked one by float noise in its hit distances, and the picked surface
      // steers castDown's normal probes; heights still have to agree, normals
      // can't be expected to.
      const tied = ly !== null && hits.filter((h) => Math.abs(h.y - ly) <= TIE).length > 1;
      if (tied) ties++;
      for (const opts of lock ? [{}, lock] : [{}]) {
        const rc = ray.castDown(x, z, fromY, opts);
        const lc = lay.castDown(x, z, fromY, opts);
        const cdy = heightDiff(rc?.y ?? null, lc?.y ?? null);
        const label = opts.transitionLock ? 'castDown (lock)' : 'castDown';
        if (cdy > HEIGHT_TOLERANCE) {
          miss(`${label} height`, x, z, fromY, fmt(rc?.y), fmt(lc?.y));
        } else if (rc && lc && !tied) {
          const dn = normalDiff(rc.normal, lc.normal);
          if (dn > NORMAL_TOLERANCE) {
            miss(`${label} normal`, x, z, fromY, `(${rc.normal.x.toFixed(3)}, ${rc.normal.y.toFixed(3)}, ${rc.normal.z.toFixed(3)})`, `(${lc.normal.x.toFixed(3)}, ${lc.normal.y.toFixed(3)}, ${lc.normal.z.toFixed(3)})`);
          } else {
            maxDn = Math.max(maxDn, dn);
          }
        }
      }
    }
  }
  totalQueries += queries;

  const name = file.replace(/\.json$/, '');
  const surfaces = built.decksAndSeams.length ? `, ${built.decksAndSeams.length} decks/seams` : '';
  if (mismatches.length === 0) {
    const tieNote = ties ? `, ${ties} ties` : '';
    console.log(`ok    ${name} (${queries} queries${surfaces}${tieNote}, max |dy| ${maxDy.toExponential(1)}, max |dn| ${maxDn.toExponential(1)})`);
  } else {
    failedTracks++;
    console.log(`FAIL  ${name}: ${mismatches.length} of ${queries} queries differ${surfaces}`);
    for (const m of mismatches.slice(0, 6)) console.log(`      ${m}`);
  }
  built.scene.getEngine().dispose();
}

console.log(failedTracks
  ? `\n${failedTracks} track(s) differ`
  : `\nlayers match the raycasts on all ${trackFiles.length} tracks (${totalQueries} queries)`);
process.exit(failedTracks ? 1 : 0);
