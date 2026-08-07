import { expandPolyline, isPointInPolygon } from "../polyline-utils.js";

/**
 * Water geometry: levels, bodies, and the height field they are cut from.
 * Deliberately free of Babylon so it can be run and checked on its own; the
 * meshes are built from these results in Water.js.
 *
 * Water is not built per feature. Overlapping water features are grouped into a
 * *body* sharing one surface level, and that body's geometry is whatever region
 * sits below the level — recovered by marching squares over a sampled height
 * field rather than traced from any single feature's outline. Unions, nested
 * pools and islands then need no special handling: they are all just the sign of
 * `level - terrainHeight`.
 *
 * The height field is sampled from the *ground mesh lattice* (bilinear), not
 * from `track.getHeightAt` directly, so the waterline matches the terrain the
 * player actually sees. The ground mesh is a coarse grid (Track.getGroundLattice);
 * tracing the analytic field instead puts the shoreline where the terrain
 * would be if it were smooth, which is not where it is drawn.
 */

// ─── Ground lattice ────────────────────────────────────────────────────────

/**
 * Bilinear sampler over the ground lattice. Lattice nodes are filled in lazily
 * from `track.getHeightAt` (the same call SceneBuilder uses to displace the
 * ground vertices), so a body only pays for the nodes it actually touches and
 * bodies sharing a region share the cache.
 */
export function createTerrainSampler(track) {
  const { width, depth, subdivisions } = track.getGroundLattice();
  const n = subdivisions + 1;
  const cellX = width / subdivisions;
  const cellZ = depth / subdivisions;
  const minX = -width / 2;
  const minZ = -depth / 2;
  const nodes = new Float32Array(n * n);
  const known = new Uint8Array(n * n);

  const node = (i, j) => {
    const k = j * n + i;
    if (!known[k]) {
      nodes[k] = track.getHeightAt(minX + i * cellX, minZ + j * cellZ);
      known[k] = 1;
    }
    return nodes[k];
  };

  const sample = (x, z) => {
    const fx = Math.min(Math.max((x - minX) / cellX, 0), subdivisions);
    const fz = Math.min(Math.max((z - minZ) / cellZ, 0), subdivisions);
    const i = Math.min(Math.floor(fx), subdivisions - 1);
    const j = Math.min(Math.floor(fz), subdivisions - 1);
    const tx = fx - i;
    const tz = fz - j;
    const h0 = node(i, j) * (1 - tx) + node(i + 1, j) * tx;
    const h1 = node(i, j + 1) * (1 - tx) + node(i + 1, j + 1) * tx;
    return h0 * (1 - tz) + h1 * tz;
  };
  return sample;
}

// ─── Water features ────────────────────────────────────────────────────────

// A feature's terrain type may be a TERRAIN_TYPES object (post-load) or a raw
// name string. True only for water.
function isWaterTerrain(terrainType) {
  const name = typeof terrainType === 'string' ? terrainType : terrainType?.name;
  return name === 'water';
}

/** A feature holds water only if it is a depression painted with water. */
export function isWaterFeature(feature) {
  if (!feature || !isWaterTerrain(feature.terrainType)) return false;

  if (feature.type === 'hill') return feature.height < 0;

  if (feature.type === 'squareHill') {
    return feature.height < 0 || (
      feature.heightAtMin !== undefined && feature.heightAtMin < 0 && feature.heightAtMax < 0
    );
  }

  if (feature.type === 'polyHill') {
    return !!feature.closed && !!feature.filled
      && (feature.height ?? 0) < 0
      && Array.isArray(feature.points) && feature.points.length >= 3;
  }

  return false;
}

/** Depth of the feature at its own centre — the most water it can possibly hold. */
function getCenterDepthLimit(feature) {
  if (feature.type === 'hill' || feature.type === 'polyHill') {
    return Math.max(0, -(feature.height ?? 0));
  }

  if (feature.type === 'squareHill') {
    if (feature.heightAtMin !== undefined && feature.heightAtMax !== undefined) {
      const centerHeight = ((feature.heightAtMin ?? 0) + (feature.heightAtMax ?? 0)) * 0.5;
      return Math.max(0, -centerHeight);
    }
    return Math.max(0, -(feature.height ?? 0));
  }

  return 0;
}

/** How full the basin is authored to be, never more than it can hold. */
function getWaterLevelOffset(feature) {
  const desired = typeof feature.waterLevelOffset === 'number'
    ? feature.waterLevelOffset
    : (feature.type === 'squareHill' ? 1 : 2);
  return Math.min(desired, getCenterDepthLimit(feature));
}

// ─── Footprints ────────────────────────────────────────────────────────────
// A feature's footprint is the region where it alters terrain height. It bounds
// where its water may spread (so a pool cannot flood an unrelated dip that
// happens to sit below the same level), decides which features count as sitting
// inside a pool, and groups overlapping water into bodies.

/**
 * Is (x, z) within `dist` of any edge of the closed polyline?
 *
 * Deliberately not "what is the minimum distance" — the answer is only ever
 * compared against a threshold, so this compares squared distances (no hypot),
 * rejects each edge by its bounding box first, and returns on the first edge in
 * range instead of scanning the rest. Rasterisation calls this once per grid
 * node per polyHill footprint, tens of thousands of times per rebuild, where
 * measuring the true minimum was the single most expensive thing water did.
 */
function withinPolylineDistance(x, z, pts, dist) {
  const dist2 = dist * dist;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];

    if (x < (p1.x < p2.x ? p1.x : p2.x) - dist) continue;
    if (x > (p1.x > p2.x ? p1.x : p2.x) + dist) continue;
    if (z < (p1.z < p2.z ? p1.z : p2.z) - dist) continue;
    if (z > (p1.z > p2.z ? p1.z : p2.z) + dist) continue;

    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-8) continue;
    const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (z - p1.z) * dz) / len2));
    const ex = x - (p1.x + t * dx);
    const ez = z - (p1.z + t * dz);
    if (ex * ex + ez * ez < dist2) return true;
  }
  return false;
}

/** Sample an ellipse into a contour, using track.js's rotation convention. */
function ellipseContour(centerX, centerZ, radiusX, radiusZ, angleRad, segments = 48) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const lx = Math.cos(t) * radiusX;
    const lz = Math.sin(t) * radiusZ;
    pts.push({ x: centerX + lx * cos - lz * sin, z: centerZ + lx * sin + lz * cos });
  }
  return pts;
}

/** Perimeter of a rotated rectangle, subdivided so overlap tests stay dense. */
function rectContour(centerX, centerZ, width, depth, angleRad) {
  const hw = width / 2;
  const hd = depth / 2;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const corners = [
    { x: -hw, z: -hd }, { x: hw, z: -hd }, { x: hw, z: hd }, { x: -hw, z: hd },
  ];
  const SEG_LEN = 2;
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const segs = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / SEG_LEN));
    for (let s = 0; s < segs; s++) {
      const t = s / segs;
      const lx = a.x + (b.x - a.x) * t;
      const lz = a.z + (b.z - a.z) * t;
      pts.push({ x: centerX + lx * cos - lz * sin, z: centerZ + lx * sin + lz * cos });
    }
  }
  return pts;
}

function boundsOf(pts, pad = 0) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

/**
 * Build a feature's footprint: a containment test matching the region where
 * `track.getHeightAt` lets the feature contribute, plus its outline and bounds
 * for overlap tests.
 */
function buildFootprint(feature) {
  const { outline, bounds, contains } = buildFootprintShape(feature);
  // Every caller tests points spread over the whole body's raster, so most
  // queries are nowhere near this feature. Four comparisons reject those before
  // the real test runs — which for a polyHill is a scan over every rim edge.
  return {
    outline,
    bounds,
    contains: (x, z) => (
      x >= bounds.minX && x <= bounds.maxX &&
      z >= bounds.minZ && z <= bounds.maxZ &&
      contains(x, z)
    ),
  };
}

function buildFootprintShape(feature) {
  if (feature.type === 'hill') {
    const radiusX = Math.max(0.001, feature.radiusX ?? 10);
    const radiusZ = Math.max(0.001, feature.radiusZ ?? 10);
    const angleRad = ((feature.angle ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const outline = ellipseContour(feature.centerX, feature.centerZ, radiusX, radiusZ, angleRad);
    return {
      outline,
      bounds: boundsOf(outline),
      contains: (x, z) => {
        const wx = x - feature.centerX;
        const wz = z - feature.centerZ;
        const lx = wx * cos + wz * sin;
        const lz = -wx * sin + wz * cos;
        return (lx * lx) / (radiusX * radiusX) + (lz * lz) / (radiusZ * radiusZ) < 1;
      },
    };
  }

  if (feature.type === 'squareHill') {
    const hw = feature.width / 2;
    const hd = (feature.depth ?? feature.width) / 2;
    const transition = feature.transition ?? 4;
    const angleRad = ((feature.angle ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const outline = rectContour(
      feature.centerX, feature.centerZ,
      feature.width + transition * 2, (feature.depth ?? feature.width) + transition * 2,
      angleRad
    );
    return {
      outline,
      bounds: boundsOf(outline),
      contains: (x, z) => {
        const wx = x - feature.centerX;
        const wz = z - feature.centerZ;
        const lx = wx * cos + wz * sin;
        const lz = -wx * sin + wz * cos;
        const edgeDx = Math.max(0, Math.abs(lx) - hw);
        const edgeDz = Math.max(0, Math.abs(lz) - hd);
        return edgeDx * edgeDx + edgeDz * edgeDz < transition * transition;
      },
    };
  }

  // polyHill: filled, closed loops only (guaranteed by isWaterFeature).
  const rim = expandPolyline(feature.points, true);
  const halfWidth = (feature.width ?? feature.slope ?? 5) / 2;
  const centroid = rim.reduce(
    (acc, p) => ({ x: acc.x + p.x / rim.length, z: acc.z + p.z / rim.length }),
    { x: 0, z: 0 }
  );
  const normals = outwardNormals(rim, centroid);
  return {
    outline: rim.map((p, i) => ({ x: p.x + normals[i].x * halfWidth, z: p.z + normals[i].z * halfWidth })),
    bounds: boundsOf(rim, halfWidth),
    contains: (x, z) => isPointInPolygon(x, z, rim) || withinPolylineDistance(x, z, rim, halfWidth),
  };
}

/** Outward unit normal of edge a→b, disambiguated by pushing away from `centroid`. */
function edgeNormalOutward(a, b, centroid) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let nx = dz, nz = -dx;
  const len = Math.hypot(nx, nz) || 1;
  nx /= len; nz /= len;
  const mx = (a.x + b.x) / 2 - centroid.x;
  const mz = (a.z + b.z) / 2 - centroid.z;
  if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
  return { x: nx, z: nz };
}

/** Per-vertex outward unit normals (corner bisectors) for a closed XZ contour. */
function outwardNormals(contour, centroid) {
  const n = contour.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const n1 = edgeNormalOutward(contour[(i - 1 + n) % n], contour[i], centroid);
    const n2 = edgeNormalOutward(contour[i], contour[(i + 1) % n], centroid);
    let nx = n1.x + n2.x, nz = n1.z + n2.z;
    const len = Math.hypot(nx, nz);
    out[i] = len < 1e-6 ? { x: 0, z: 0 } : { x: nx / len, z: nz / len };
  }
  return out;
}

// ─── Levels and bodies ─────────────────────────────────────────────────────

/** Where a feature sits: its centre, or the centroid of its control points. */
function featureCenter(feature) {
  if (typeof feature.centerX === 'number' && typeof feature.centerZ === 'number') {
    return { x: feature.centerX, z: feature.centerZ };
  }
  const pts = feature.points ?? [];
  if (pts.length === 0) return { x: 0, z: 0 };
  return pts.reduce(
    (acc, p) => ({ x: acc.x + p.x / pts.length, z: acc.z + p.z / pts.length }),
    { x: 0, z: 0 }
  );
}

/** A point inside the feature — where its depth is measured from. */
function featureInteriorPoint(feature, footprint) {
  const centroid = featureCenter(feature);
  if (footprint.contains(centroid.x, centroid.z)) return centroid;

  // Concave loops can put their centroid outside themselves; fall back to a scan.
  const { minX, maxX, minZ, maxZ } = footprint.bounds;
  const STEPS = 12;
  for (let j = 1; j < STEPS; j++) {
    for (let i = 1; i < STEPS; i++) {
      const x = minX + ((maxX - minX) * i) / STEPS;
      const z = minZ + ((maxZ - minZ) * j) / STEPS;
      if (footprint.contains(x, z)) return { x, z };
    }
  }
  return centroid;
}

/**
 * One feature's water level: the ambient ground under the pool, dropped by
 * however much of the basin's depth is left unfilled.
 *
 * "Ambient" means the terrain sum with this feature — and anything sitting
 * wholly inside it — removed. That exclusion is the whole point: heights are
 * additive, so a hill dropped into the hole raises the composite floor at the
 * centre and used to carry the water surface up with it. Reading the ambient
 * directly, and not from a ring of rim samples, keeps the level right when the
 * surrounding ground is curved: the rim of a bowl dug into a dome sits well
 * above the ground at its centre, and filling to the rim would leave the water
 * standing above the terrain.
 *
 * Containment is tested on the whole outline rather than the centre, because a
 * pool dug into a *concentric* hill would otherwise exclude the very hill it
 * sits on and lose all of its elevation.
 */
function featureWaterLevel(track, feature, footprint) {
  const p = featureInteriorPoint(feature, footprint);
  const ambient = track.getHeightAt(p.x, p.z, (other) => {
    if (other === feature) return true;
    if (other.type !== 'hill' && other.type !== 'squareHill' && other.type !== 'polyHill') return false;
    return buildFootprint(other).outline.every((q) => footprint.contains(q.x, q.z));
  });
  return ambient - (getCenterDepthLimit(feature) - getWaterLevelOffset(feature));
}

function boundsOverlap(a, b) {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minZ <= b.maxZ && b.minZ <= a.maxZ;
}

/**
 * Do two footprints share any area? Bounds reject first, then a two-way outline
 * point test. Two thin bars crossing in a perfect X would slip through (neither
 * outline has a point inside the other) — no shape the editor makes hits that in
 * practice, and the cost of a full segment-intersection pass is not worth it.
 */
function footprintsOverlap(a, b) {
  if (!boundsOverlap(a.bounds, b.bounds)) return false;
  for (const p of a.outline) if (b.contains(p.x, p.z)) return true;
  for (const p of b.outline) if (a.contains(p.x, p.z)) return true;
  return false;
}

/**
 * Group water features into bodies of overlapping footprints (connected
 * components), each with one shared level.
 *
 * The level is the highest of the members' own levels. That single rule covers
 * both failure modes of per-feature water: a pool nested inside another computes
 * its level off the outer pool's floor, so it always loses and stops drawing a
 * second surface below the first; and two partially overlapping pools converge
 * on one plane instead of intersecting at different heights. `waterLevelOffset`
 * keeps its meaning per feature — how full that basin is — and the fullest
 * member wins for the group.
 */
export function groupIntoBodies(track, features) {
  const parts = features.map((feature) => {
    const footprint = buildFootprint(feature);
    return { feature, footprint, level: featureWaterLevel(track, feature, footprint) };
  });

  const bodyOf = parts.map((_, i) => i);
  const find = (i) => (bodyOf[i] === i ? i : (bodyOf[i] = find(bodyOf[i])));
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (find(i) === find(j)) continue;
      if (footprintsOverlap(parts[i].footprint, parts[j].footprint)) bodyOf[find(i)] = find(j);
    }
  }

  const groups = new Map();
  parts.forEach((part, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(part);
  });

  return [...groups.values()].map((members) => ({
    members: members.map((m) => m.feature),
    footprints: members.map((m) => m.footprint),
    level: Math.max(...members.map((m) => m.level)),
    bounds: members.reduce((acc, m) => ({
      minX: Math.min(acc.minX, m.footprint.bounds.minX),
      maxX: Math.max(acc.maxX, m.footprint.bounds.maxX),
      minZ: Math.min(acc.minZ, m.footprint.bounds.minZ),
      maxZ: Math.max(acc.maxZ, m.footprint.bounds.maxZ),
    }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }),
  }));
}

// ─── Field rasterisation + marching squares ────────────────────────────────

// Target spacing for the water grid, and the cell budget per axis that overrides
// it on large bodies. Finer than the ground lattice is worthwhile: the sampled
// field is smooth between lattice nodes, so smaller cells buy a smoother
// shoreline, but the foam band has to stay comfortably wider than a cell or the
// ribbon starts to wobble against the grid.
const WATER_CELL_TARGET = 0.5;
const WATER_MAX_CELLS = 220;
// Field value standing in for "outside every footprint" — deep enough to read as
// dry land no matter the terrain.
const DRY = -1e3;
// How much depth range one merged run of submerged cells may span (world units).
// Runs interpolate depth between their two ends, so this caps the shading error
// the merge introduces.
const DEPTH_RUN_TOLERANCE = 0.25;

/**
 * Sample `level - terrainHeight` over the body's bounds, masked to its
 * footprints. Positive is submerged.
 */
export function rasterizeBody(body, sample) {
  const pad = WATER_CELL_TARGET * 2;
  const minX = body.bounds.minX - pad;
  const minZ = body.bounds.minZ - pad;
  const spanX = (body.bounds.maxX + pad) - minX;
  const spanZ = (body.bounds.maxZ + pad) - minZ;
  const cell = Math.max(WATER_CELL_TARGET, spanX / WATER_MAX_CELLS, spanZ / WATER_MAX_CELLS);
  const nx = Math.max(2, Math.ceil(spanX / cell));
  const nz = Math.max(2, Math.ceil(spanZ / cell));

  const field = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) {
    const z = minZ + j * cell;
    for (let i = 0; i <= nx; i++) {
      const x = minX + i * cell;
      let inside = false;
      for (const fp of body.footprints) {
        if (fp.contains(x, z)) { inside = true; break; }
      }
      field[j * (nx + 1) + i] = inside ? body.level - sample(x, z) : DRY;
    }
  }

  return {
    minX, minZ, cell, nx, nz, field,
    at: (i, j) => field[j * (nx + 1) + i],
    x: (i) => minX + i * cell,
    z: (j) => minZ + j * cell,
  };
}

/**
 * Bilinear read of the rasterised field: water depth at an arbitrary point,
 * negative on dry land. Used to measure how fast the bottom drops away from a
 * shoreline.
 */
function fieldAt(grid, x, z) {
  const fx = Math.min(Math.max((x - grid.minX) / grid.cell, 0), grid.nx);
  const fz = Math.min(Math.max((z - grid.minZ) / grid.cell, 0), grid.nz);
  const i = Math.min(Math.floor(fx), grid.nx - 1);
  const j = Math.min(Math.floor(fz), grid.nz - 1);
  const tx = fx - i;
  const tz = fz - j;
  const d0 = grid.at(i, j) * (1 - tx) + grid.at(i + 1, j) * tx;
  const d1 = grid.at(i, j + 1) * (1 - tx) + grid.at(i + 1, j + 1) * tx;
  return d0 * (1 - tz) + d1 * tz;
}

/** Where along a→b the field crosses zero. */
function crossing(ax, az, va, bx, bz, vb) {
  const t = va / (va - vb);
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t };
}

/** Does the waterline pass through this cell — some corners wet, some dry? */
function isBoundaryCell(grid, i, j) {
  const wet = grid.at(i, j) > 0;
  return wet !== (grid.at(i + 1, j) > 0)
    || wet !== (grid.at(i + 1, j + 1) > 0)
    || wet !== (grid.at(i, j + 1) > 0);
}

/**
 * Walk the eight slots around a cell (corner, edge, corner, …) emitting each
 * submerged corner and each zero crossing in order. The result is the submerged
 * part of the cell as a polygon, and its crossings in the order the foam
 * segments need them. Saddle cells (opposite corners submerged) come out joined
 * through the middle, which keeps surface and foam consistent with each other.
 */
function cellSlots(grid, i, j) {
  const cx = [grid.x(i), grid.x(i + 1), grid.x(i + 1), grid.x(i)];
  const cz = [grid.z(j), grid.z(j), grid.z(j + 1), grid.z(j + 1)];
  const v = [grid.at(i, j), grid.at(i + 1, j), grid.at(i + 1, j + 1), grid.at(i, j + 1)];

  // Polygon points carry `d`, the water depth there: the field value at a
  // submerged corner, and zero at a crossing — that *is* the waterline.
  const poly = [];
  const cuts = [];
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    if (v[k] > 0) poly.push({ x: cx[k], z: cz[k], d: v[k] });
    if ((v[k] > 0) !== (v[k2] > 0)) {
      const p = crossing(cx[k], cz[k], v[k], cx[k2], cz[k2], v[k2]);
      poly.push({ ...p, d: 0 });
      cuts.push(p);
    }
  }
  return { poly, cuts };
}

/**
 * Surface triangles for a body: one merged quad per run of fully submerged cells
 * (so a large pool is a handful of triangles rather than two per cell) plus the
 * marching-squares polygon for each boundary cell.
 *
 * `depths` runs parallel to the vertices — how deep the water is at each one,
 * read straight off the field, zero along the shoreline. Shading uses it to fade
 * the surface out in the shallows instead of laying one flat alpha over
 * everything.
 */
export function buildSurfaceGeometry(grid, y) {
  const positions = [];
  const indices = [];
  const depths = [];
  const pushTri = (a, b, c) => {
    const base = positions.length / 3;
    positions.push(a.x, y, a.z, b.x, y, b.z, c.x, y, c.z);
    depths.push(a.d, b.d, c.d);
    indices.push(base, base + 1, base + 2);
  };
  // A run of full cells spans lattice nodes, so its corner depths are field
  // values; the two shared corners are sampled once per end of the run.
  const pushQuad = (i0, i1, j) => {
    const x0 = grid.x(i0), x1 = grid.x(i1), z0 = grid.z(j), z1 = grid.z(j + 1);
    const a = { x: x0, z: z0, d: grid.at(i0, j) };
    const b = { x: x1, z: z0, d: grid.at(i1, j) };
    const c = { x: x1, z: z1, d: grid.at(i1, j + 1) };
    const e = { x: x0, z: z1, d: grid.at(i0, j + 1) };
    pushTri(a, b, c);
    pushTri(a, c, e);
  };

  const isFull = (i, j) => grid.at(i, j) > 0 && grid.at(i + 1, j) > 0
    && grid.at(i + 1, j + 1) > 0 && grid.at(i, j + 1) > 0;

  for (let j = 0; j < grid.nz; j++) {
    let runStart = -1;
    let runMin = 0;
    let runMax = 0;
    const flush = (end) => {
      if (runStart >= 0) pushQuad(runStart, end, j);
      runStart = -1;
    };

    for (let i = 0; i < grid.nx; i++) {
      if (isFull(i, j)) {
        const corners = [grid.at(i, j), grid.at(i + 1, j), grid.at(i + 1, j + 1), grid.at(i, j + 1)];
        const lo = Math.min(...corners);
        const hi = Math.max(...corners);
        // A run only carries depth at its two ends, so it may not span more
        // depth range than shading can stand to interpolate across.
        if (runStart >= 0 && Math.max(runMax, hi) - Math.min(runMin, lo) > DEPTH_RUN_TOLERANCE) flush(i);
        if (runStart < 0) { runStart = i; runMin = lo; runMax = hi; }
        else { runMin = Math.min(runMin, lo); runMax = Math.max(runMax, hi); }
        continue;
      }
      flush(i);
      if (!isBoundaryCell(grid, i, j)) continue;
      const { poly } = cellSlots(grid, i, j);
      for (let k = 1; k + 1 < poly.length; k++) pushTri(poly[0], poly[k], poly[k + 1]);
    }
    flush(grid.nx);
  }

  return { positions, indices, depths };
}

// Foam band geometry. The band has no single width: it covers the shallow shelf,
// so it runs wide over a gently shelving beach and tightens against a steep wall.
// FOAM_NOMINAL_WIDTH is only the spacing hint used when thinning a shoreline.
const FOAM_SHELF_DEPTH = 0.55;   // foam covers water shallower than this
const FOAM_MIN_WIDTH = 0.7;
const FOAM_MAX_WIDTH = 3.2;
const FOAM_SLOPE_PROBE = 1.2;    // how far in to measure the drop-off
export const FOAM_NOMINAL_WIDTH = 1.6;

/**
 * How far the foam reaches in at each point of a shoreline: the distance over
 * which the bottom drops to FOAM_SHELF_DEPTH, measured by probing the field
 * inward. A steep wall reaches that depth immediately and gets a tight rim; a
 * gently shelving beach carries the band a long way out.
 */
export function foamWidths(loop, grid, sgn) {
  return loop.map((p, i) => {
    const q = loop[(i + 1) % loop.length];
    let dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return FOAM_NOMINAL_WIDTH;
    dx /= len; dz /= len;
    const inX = sgn * -dz;
    const inZ = sgn * dx;
    const depth = fieldAt(grid, p.x + inX * FOAM_SLOPE_PROBE, p.z + inZ * FOAM_SLOPE_PROBE);
    // Probe fell dry: a strip of water thinner than the probe. Keep the band
    // tight rather than letting it overshoot to the far shore.
    if (depth <= 0) return FOAM_MIN_WIDTH;
    const width = (FOAM_SHELF_DEPTH / depth) * FOAM_SLOPE_PROBE;
    return Math.min(FOAM_MAX_WIDTH, Math.max(FOAM_MIN_WIDTH, width));
  });
}

/**
 * Mask tiling for a shoreline: per-edge lengths, the perimeter, and the UV scale
 * to map world distance onto texture repeats.
 *
 * The repeat count is rounded to a whole number, which is the whole point — a
 * fractional count would leave the pattern mid-stride where the loop closes and
 * draw a seam straight across the foam.
 */
export function foamTiling(loop, tileWorldSize) {
  const edgeLen = loop.map((p, i) => {
    const q = loop[(i + 1) % loop.length];
    return Math.hypot(q.x - p.x, q.z - p.z);
  });
  const perimeter = edgeLen.reduce((a, b) => a + b, 0);
  const tiles = Math.max(1, Math.round(perimeter / tileWorldSize));
  return { edgeLen, perimeter, tiles, uvScale: perimeter > 0 ? tiles / perimeter : 0 };
}

// ─── Shoreline loops ───────────────────────────────────────────────────────

const LOOP_KEY_SCALE = 1e4;
const loopKey = (p) => `${Math.round(p.x * LOOP_KEY_SCALE)},${Math.round(p.z * LOOP_KEY_SCALE)}`;

/**
 * Collect every zero-crossing segment, then link them end to end into closed
 * shorelines. Adjacent cells interpolate their shared edge from the same two
 * field values, so endpoints match exactly and can be keyed directly.
 *
 * Each loop is one shoreline: the rim of the body, or an island inside it — the
 * linker neither knows nor cares which.
 */
export function traceShorelines(grid) {
  const segments = [];
  for (let j = 0; j < grid.nz; j++) {
    for (let i = 0; i < grid.nx; i++) {
      // Only cells straddling the waterline have crossings, and that is a few
      // percent of them. Four field reads sort a cell out; cellSlots allocates.
      if (!isBoundaryCell(grid, i, j)) continue;
      const { cuts } = cellSlots(grid, i, j);
      if (cuts.length === 2) segments.push([cuts[0], cuts[1]]);
      else if (cuts.length === 4) { segments.push([cuts[0], cuts[1]]); segments.push([cuts[2], cuts[3]]); }
    }
  }

  const byPoint = new Map();
  segments.forEach((seg, index) => {
    for (const end of [0, 1]) {
      const key = loopKey(seg[end]);
      if (!byPoint.has(key)) byPoint.set(key, []);
      byPoint.get(key).push({ index, end });
    }
  });

  const used = new Array(segments.length).fill(false);
  const loops = [];
  for (let s = 0; s < segments.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    const loop = [segments[s][0], segments[s][1]];
    // Walk from the open end, hopping to whichever unused segment shares it.
    for (;;) {
      const tail = loop[loop.length - 1];
      const next = (byPoint.get(loopKey(tail)) ?? []).find((c) => !used[c.index]);
      if (!next) break;
      used[next.index] = true;
      loop.push(segments[next.index][1 - next.end]);
    }
    // Drop the duplicated closing point, then discard specks.
    if (loop.length > 2 && loopKey(loop[0]) === loopKey(loop[loop.length - 1])) loop.pop();
    if (loop.length >= 6) loops.push(loop);
  }
  return loops;
}

/**
 * Thin a shoreline to roughly even spacing. Marching squares emits a vertex per
 * cell edge; the foam's per-vertex dither reads as noise at that density, and
 * the ribbon does not need it.
 */
export function decimateLoop(loop, minSpacing) {
  const out = [loop[0]];
  for (let i = 1; i < loop.length; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(loop[i].x - last.x, loop[i].z - last.z) >= minSpacing) out.push(loop[i]);
  }
  // Guard the seam: drop the last point if it landed on top of the first.
  if (out.length > 3) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(last.x - first.x, last.z - first.z) < minSpacing * 0.5) out.pop();
  }
  return out;
}

function signedArea(pts) {
  let a = 0;
  for (let p = pts.length - 1, q = 0; q < pts.length; p = q++) {
    a += pts[p].x * pts[q].z - pts[q].x * pts[p].z;
  }
  return a * 0.5;
}

/**
 * Which way the foam band faces: +1 or -1, to be applied to each edge normal.
 *
 * Probing the field beats reasoning about winding — it comes out right for island
 * loops (water outside) as well as rim loops (water inside), without the linker
 * or the caller having to track orientation. The winding only supplies a
 * direction to probe along; the field decides whether that direction was the wet
 * one, and the answer flips the sign if it wasn't.
 */
export function foamSide(loop, grid) {
  const windingSide = signedArea(loop) > 0 ? 1 : -1;
  const step = Math.max(1, Math.floor(loop.length / 8));
  let votes = 0;
  let total = 0;
  for (let i = 0; i < loop.length; i += step) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    let dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    dx /= len; dz /= len;
    const px = (a.x + b.x) / 2 + windingSide * -dz * grid.cell;
    const pz = (a.z + b.z) / 2 + windingSide * dx * grid.cell;
    const fi = Math.round((px - grid.minX) / grid.cell);
    const fj = Math.round((pz - grid.minZ) / grid.cell);
    if (fi < 0 || fj < 0 || fi > grid.nx || fj > grid.nz) continue;
    total++;
    if (grid.at(fi, fj) > 0) votes++;
  }

  const probedIntoWater = total === 0 || votes * 2 >= total;
  return probedIntoWater ? windingSide : -windingSide;
}

