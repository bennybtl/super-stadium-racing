// Surface-layer parity check: `npm run check:surface-layers`
//
// SurfaceLayers (src/world/surface-layers.js) is meant to replace the
// drive-surface raycasts with plain height queries. Before anything switches
// over, this builds every shipped track headlessly, with the real ground mesh,
// outskirts, bridge decks, drive boxes and seams registered in the real
// DriveSurfaceManager, and asks both systems the same questions:
//
//   raycast: TerrainQuery.tryHeightAt (what TerrainPhysics and respawn use)
//   layers:  SurfaceLayers.sample, built from the track lattice (ground) and
//            the registered meshes' vertex data (outskirts, decks, seams)
//
// Query points: a jittered grid over each track (a little past the ground's
// edge), plus a denser grid over every deck and seam. At each point, from high
// above, and from just above / just below / well below every surface there, so
// the on-deck, under-deck and sunk-in (upward fallback) cases all get asked.
//
// Exits non-zero if any answer differs by more than TOLERANCE.

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
export { SurfaceLayers, createGroundLayer, createTriangleLayer } from ${src('world', 'surface-layers.js')};
export { NullEngine, Scene, MeshBuilder, VertexBuffer, Vector3, Logger } from '@babylonjs/core';
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
  SurfaceLayers, createGroundLayer, createTriangleLayer,
  NullEngine, Scene, MeshBuilder, VertexBuffer, Vector3, Logger,
} = await import(pathToFileURL(bundlePath).href);
Logger.LogLevels = 0;

const TOLERANCE = 2e-3;   // metres; mesh positions are float32
const GRID = 48;          // track-wide query grid, per axis
const SURFACE_GRID = 16;  // per deck / seam, per axis
const EDGE_MARGIN = 8;    // query this far past the ground mesh's edge

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
  const { width, depth, subdivisions } = track.getGroundLattice();
  const ground = MeshBuilder.CreateGround('ground', { width, height: depth, subdivisions }, scene);
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] = track.getHeightAt(positions[i], positions[i + 2]);
  }
  ground.setVerticesData(VertexBuffer.PositionKind, positions);
  dsm.register(ground, { kind: 'ground' });

  buildOutskirts(scene, track, dsm);
  const bridges = new BridgeMeshManager(scene, track, null, dsm);
  for (const feature of track.getFeatures()) {
    if (feature.type === 'bridgeMesh' || feature.type === 'driveBox') bridges.create(feature);
  }
  for (const mesh of scene.meshes) {
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo();
  }
  return { scene, dsm, ground, lattice: { width, depth, subdivisions } };
}

// The layer stack: ground from the track lattice, everything else from the
// registered meshes' own (world-space) vertex data.
function buildLayers(track, { scene, dsm, ground, lattice }) {
  const layers = new SurfaceLayers();
  layers.add(createGroundLayer(lattice, (x, z) => track.getHeightAt(x, z)), { kind: 'ground' });
  const others = [];
  for (const mesh of scene.meshes) {
    const record = dsm.getSurfaceByMesh(mesh);
    if (!record || mesh === ground) continue;
    const local = mesh.getVerticesData(VertexBuffer.PositionKind);
    const world = new Float64Array(local.length);
    const m = mesh.getWorldMatrix();
    const v = new Vector3();
    for (let i = 0; i < local.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(local[i], local[i + 1], local[i + 2], m, v);
      world[i] = v.x; world[i + 1] = v.y; world[i + 2] = v.z;
    }
    // Ground-kind hits must face up (DriveSurfaceManager's upwardY normal
    // filter, on interpolated vertex normals), which drops the outskirt slabs'
    // bottom faces. Decks and seams are filtered on |normal.y| instead.
    let indices = mesh.getIndices();
    if (record.kind === 'ground') {
      const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
      indices = Array.from(indices).filter((_, k, all) => {
        const t = k - (k % 3);
        return [all[t], all[t + 1], all[t + 2]].every((vi) => normals[vi * 3 + 1] >= 0);
      });
    }
    layers.add(createTriangleLayer(world, indices), { kind: record.kind, level: record.level });
    if (record.kind !== 'ground') others.push(mesh);
  }
  return { layers, decksAndSeams: others };
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

// ── Run ──────────────────────────────────────────────────────────────────────
const tracksDir = join(root, 'src', 'tracks');
const trackFiles = readdirSync(tracksDir).filter((f) => f.endsWith('.json')).sort();
let failedTracks = 0;
let totalQueries = 0;

for (const file of trackFiles) {
  const track = Track.fromJSON(readFileSync(join(tracksDir, file), 'utf8'));
  const built = buildScene(track);
  const { layers, decksAndSeams } = buildLayers(track, built);
  const tq = new TerrainQuery(built.scene);

  let queries = 0;
  let maxDy = 0;
  const mismatches = [];
  for (const [x, z] of queryPoints(built.lattice, decksAndSeams)) {
    const fromYs = [500];
    for (const { y } of layers.hitsAt(x, z)) fromYs.push(y + 0.1, y - 0.5, y - 2);
    for (const fromY of fromYs) {
      queries++;
      // castDown's first query is exactly tryHeightAtFast; only its steep-face
      // retry (a miss) needs the full call.
      const rayY = tq.tryHeightAtFast(x, z, fromY) ?? tq.tryHeightAt(x, z, fromY);
      const hit = layers.sample(x, z, fromY);
      const layerY = hit?.y ?? null;
      const dy = rayY === null || layerY === null ? (rayY === layerY ? 0 : Infinity) : Math.abs(rayY - layerY);
      if (dy > TOLERANCE) {
        mismatches.push({ x, z, fromY, rayY, layerY, kind: hit?.kind });
      } else {
        maxDy = Math.max(maxDy, dy);
      }
    }
  }
  totalQueries += queries;

  const name = file.replace(/\.json$/, '');
  const surfaces = decksAndSeams.length ? `, ${decksAndSeams.length} decks/seams` : '';
  if (mismatches.length === 0) {
    console.log(`ok    ${name} (${queries} queries${surfaces}, max |dy| ${maxDy.toExponential(1)})`);
  } else {
    failedTracks++;
    console.log(`FAIL  ${name}: ${mismatches.length}/${queries} queries differ${surfaces}`);
    for (const m of mismatches.slice(0, 5)) {
      const f = (v) => (v === null ? 'miss' : v.toFixed(3));
      console.log(`      (${m.x.toFixed(2)}, ${m.z.toFixed(2)}) from ${m.fromY.toFixed(2)}: ray ${f(m.rayY)}, layers ${f(m.layerY)}${m.kind ? ` [${m.kind}]` : ''}`);
    }
  }
  built.scene.getEngine().dispose();
}

console.log(failedTracks
  ? `\n${failedTracks} track(s) differ`
  : `\nsurface layers match the raycasts on all ${trackFiles.length} tracks (${totalQueries} queries)`);
process.exit(failedTracks ? 1 : 0);
