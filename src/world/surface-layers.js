/**
 * Drivable surface layers: Babylon-free height queries that give the same
 * answer as the drive-surface raycasts (TerrainQuery → DriveSurfaceManager),
 * without meshes, picking or octrees.
 *
 * A layer answers "how high is this surface at (x, z)?" by pushing its height
 * (or heights, where its triangles overlap) onto an array, and nothing where it
 * doesn't reach. SurfaceLayers stacks them and picks one per query with the
 * same down-then-up rule the raycasts use, so a truck on a deck gets the deck
 * and a truck under it gets the ground.
 *
 * Nothing in the game uses this yet: `npm run check:surface-layers` compares it
 * against the real raycasts on every shipped track (phase 2a of the surface
 * plan). Switching TerrainQuery over comes after that agrees.
 */

// ─── Layers ─────────────────────────────────────────────────────────────────

/**
 * The ground mesh, sampled in closed form. Same lattice as SceneBuilder's
 * CreateGround (Track.getGroundLattice) and the same diagonal per cell, so this
 * matches the drawn triangles exactly, not the smooth analytic field between
 * vertices. Nodes are filled lazily from `heightAt` (the call SceneBuilder uses
 * to displace the vertices). Nothing outside the lattice.
 */
export function createGroundLayer({ width, depth, subdivisions }, heightAt) {
  const n = subdivisions + 1;
  const nodes = new Float64Array(n * n);
  const known = new Uint8Array(n * n);
  const halfW = width / 2;
  const halfD = depth / 2;

  // i runs along +X, j along +Z. Positions use CreateGround's own arithmetic so
  // node heights match the mesh vertices bit for bit.
  const node = (i, j) => {
    const k = j * n + i;
    if (!known[k]) {
      nodes[k] = heightAt((i * width) / subdivisions - halfW, (j * depth) / subdivisions - halfD);
      known[k] = 1;
    }
    return nodes[k];
  };

  return {
    heightsAt(x, z, out) {
      if (x < -halfW || x > halfW || z < -halfD || z > halfD) return;
      const fx = ((x + halfW) / width) * subdivisions;
      const fz = ((z + halfD) / depth) * subdivisions;
      const i = Math.min(Math.floor(fx), subdivisions - 1);
      const j = Math.min(Math.floor(fz), subdivisions - 1);
      const tx = fx - i;
      const tz = fz - j;
      // CreateGround splits every cell along the (i, j+1)–(i+1, j) diagonal.
      if (tx + tz <= 1) {
        const h00 = node(i, j);
        out.push(h00 + (node(i + 1, j) - h00) * tx + (node(i, j + 1) - h00) * tz);
      } else {
        const h11 = node(i + 1, j + 1);
        out.push(h11 + (node(i, j + 1) - h11) * (1 - tx) + (node(i + 1, j) - h11) * (1 - tz));
      }
    },
  };
}

// Target triangles per grid cell for the triangle-layer index.
const TRI_INDEX_TARGET = 4;

// How far past a triangle's edges (in barycentric units) a point still counts
// as on it, extrapolating the triangle's plane. Matches Babylon's
// Ray.intersectsTriangle epsilon, which is what the drive-surface raycasts
// answer with: a ~1 cm skirt around a 10 m deck triangle, clipped to the mesh's
// bounding box (see heightAt). Kept for exact parity
// while both systems exist; 0 is the clean value once the raycasts are gone.
const EDGE_TOLERANCE = 1e-3;

/**
 * Any triangle mesh (world-space `positions`, `indices`), sampled from above:
 * the height of every triangle over (x, z). Triangles with no XZ extent
 * (vertical faces) are skipped.
 *
 * Built from the same vertex arrays as the mesh, so deck smoothing, per-point
 * offsets and the drive-mesh overlap all come for free.
 */
export function createTriangleLayer(positions, indices) {
  const tris = [];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue;
    const tri = {
      ax, ay, az, by, cy, cx, cz, bx, bz, det,
      minX: Math.min(ax, bx, cx), maxX: Math.max(ax, bx, cx),
      minZ: Math.min(az, bz, cz), maxZ: Math.max(az, bz, cz),
    };
    tris.push(tri);
    minX = Math.min(minX, tri.minX); maxX = Math.max(maxX, tri.maxX);
    minZ = Math.min(minZ, tri.minZ); maxZ = Math.max(maxZ, tri.maxZ);
  }
  if (tris.length === 0) return { heightsAt() {} };

  // Uniform grid over the XZ bounds; each cell lists the triangles whose XZ box
  // overlaps it.
  const cellsPerSide = Math.max(1, Math.ceil(Math.sqrt(tris.length / TRI_INDEX_TARGET)));
  const cellW = Math.max((maxX - minX) / cellsPerSide, 1e-9);
  const cellD = Math.max((maxZ - minZ) / cellsPerSide, 1e-9);
  const cells = Array.from({ length: cellsPerSide * cellsPerSide }, () => []);
  // EDGE_TOLERANCE in world units for the largest triangle: every box test is
  // widened by this so a point on a skirt still reaches its triangle.
  let skirt = 0;
  for (const tri of tris) {
    skirt = Math.max(skirt, (tri.maxX - tri.minX + tri.maxZ - tri.minZ) * EDGE_TOLERANCE);
  }
  const cellOf = (v, min, size) => Math.min(cellsPerSide - 1, Math.max(0, Math.floor((v - min) / size)));
  for (const tri of tris) {
    const c0 = cellOf(tri.minX - skirt, minX, cellW), c1 = cellOf(tri.maxX + skirt, minX, cellW);
    const r0 = cellOf(tri.minZ - skirt, minZ, cellD), r1 = cellOf(tri.maxZ + skirt, minZ, cellD);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) cells[r * cellsPerSide + c].push(tri);
    }
  }

  return {
    heightsAt(x, z, out) {
      // Exact bounds, no skirt: Babylon tests the mesh's bounding box before
      // any triangle, so the skirt never reaches past the mesh's own extent.
      if (x < minX || x > maxX || z < minZ || z > maxZ) return;
      for (const tri of cells[cellOf(z, minZ, cellD) * cellsPerSide + cellOf(x, minX, cellW)]) {
        if (x < tri.minX - skirt || x > tri.maxX + skirt || z < tri.minZ - skirt || z > tri.maxZ + skirt) continue;
        // Barycentric weights of (x, z) in the triangle's XZ projection.
        const wa = ((tri.bz - tri.cz) * (x - tri.cx) + (tri.cx - tri.bx) * (z - tri.cz)) / tri.det;
        const wb = ((tri.cz - tri.az) * (x - tri.cx) + (tri.ax - tri.cx) * (z - tri.cz)) / tri.det;
        const wc = 1 - wa - wb;
        if (wa < -EDGE_TOLERANCE || wb < -EDGE_TOLERANCE || wc < -EDGE_TOLERANCE) continue;
        out.push(wa * tri.ay + wb * tri.by + wc * tri.cy);
      }
    },
  };
}

// ─── The stack ──────────────────────────────────────────────────────────────

// Mirrors the options TerrainQuery passes to DriveSurfaceManager.queryDriveSurfaceAt.
const PENETRATION_THRESHOLD = 1.5;
const MAX_UPWARD_RISE = 1.0;
const UP_ORIGIN_DROP = 0.05;
const UP_MAX_DISTANCE_NO_DOWN = 50;
const DOWN_EXTRA_DISTANCE = 200;

/**
 * Every drivable layer, and the rule for picking one at a point.
 */
export class SurfaceLayers {
  constructor() {
    this._entries = [];
  }

  /**
   * @param {{ heightsAt(x: number, z: number, out: number[]): void }} layer
   * @param {{ kind?: 'ground'|'deck'|'seam', level?: number }} [info]
   * @returns {object} the entry, for `remove`
   */
  add(layer, { kind = 'ground', level = 0 } = {}) {
    const entry = { layer, kind, level };
    this._entries.push(entry);
    return entry;
  }

  remove(entry) {
    const i = this._entries.indexOf(entry);
    if (i !== -1) this._entries.splice(i, 1);
  }

  /** Every surface height at (x, z): `[{ y, kind, level }]`, unordered. */
  hitsAt(x, z) {
    const hits = [];
    const ys = [];
    for (const { layer, kind, level } of this._entries) {
      ys.length = 0;
      layer.heightsAt(x, z, ys);
      for (const y of ys) hits.push({ y, kind, level });
    }
    return hits;
  }

  /**
   * The surface under a point at height `fromY`, chosen the way
   * `DriveSurfaceManager.queryDriveSurfaceAt` chooses it:
   *
   *  1. down: the highest surface at or below `fromY`;
   *  2. if that's more than 1.5 below (the truck has sunk into something),
   *     or there is none, look up from just under `fromY` and take the nearest
   *     surface above, but only if it's no more than 1.0 above `fromY`, so a
   *     truck under a bridge never snaps onto the deck;
   *  3. otherwise the down hit.
   *
   * @returns {{ y: number, kind: string, level: number } | null}
   */
  sample(x, z, fromY) {
    const hits = this.hitsAt(x, z);
    let down = null;
    for (const h of hits) {
      if (h.y <= fromY && h.y >= -DOWN_EXTRA_DISTANCE && (down === null || h.y > down.y)) down = h;
    }
    if (down && fromY - down.y <= PENETRATION_THRESHOLD) return down;

    const upOrigin = fromY - UP_ORIGIN_DROP;
    const upMax = down ? fromY - down.y + 1 : UP_MAX_DISTANCE_NO_DOWN;
    let up = null;
    for (const h of hits) {
      if (h.y >= upOrigin && h.y - upOrigin <= upMax && (up === null || h.y < up.y)) up = h;
    }
    if (up && up.y - fromY <= MAX_UPWARD_RISE) return up;
    return down;
  }
}
