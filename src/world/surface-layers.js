/**
 * Drivable surface layers: Babylon-free height queries for every drive
 * surface, without picking or octrees. (They replaced Babylon raycasts, and
 * matched them on every shipped track before the switch.)
 *
 * A layer answers "how high is this surface at (x, z)?" by pushing its height
 * (or heights, where its triangles overlap) onto an array, and nothing where it
 * doesn't reach; `normalAt` gives the interpolated vertex normal there.
 * SurfaceLayers stacks them and picks one per query with a down-then-up rule,
 * so a truck on a deck gets the deck and a truck under it gets the ground.
 *
 * DriveSurfaceManager builds a layer for every surface it registers, and
 * TerrainQuery answers from these.
 */

// Interpolated, normalized vertex normal → `out` (any {x, y, z}), as Babylon's
// PickingInfo.getNormal(true, true) computes it for a hit.
function _blendNormal(normals, a, b, c, wa, wb, wc, out) {
  const x = normals[a] * wa + normals[b] * wb + normals[c] * wc;
  const y = normals[a + 1] * wa + normals[b + 1] * wb + normals[c + 1] * wc;
  const z = normals[a + 2] * wa + normals[b + 2] * wb + normals[c + 2] * wc;
  const len = Math.hypot(x, y, z) || 1;
  out.x = x / len; out.y = y / len; out.z = z / len;
  return out;
}

// ─── Layers ─────────────────────────────────────────────────────────────────

/**
 * The ground mesh, sampled in closed form: SceneBuilder's CreateGround lattice
 * (Track.getGroundLattice) read straight from the mesh's position and normal
 * buffers, with the same diagonal per cell, so it matches the drawn triangles
 * exactly. Nothing outside the lattice.
 */
export function createGroundLayer({ width, depth, subdivisions }, positions, normals) {
  const n = subdivisions + 1;
  const halfW = width / 2;
  const halfD = depth / 2;
  // Buffer offset of lattice node (i along +X, j along +Z). CreateGround's row 0
  // is the +Z edge.
  const at = (i, j) => ((subdivisions - j) * n + i) * 3;

  // The cell and triangle under (x, z): three node offsets and their weights.
  const locate = (x, z) => {
    if (x < -halfW || x > halfW || z < -halfD || z > halfD) return null;
    const fx = ((x + halfW) / width) * subdivisions;
    const fz = ((z + halfD) / depth) * subdivisions;
    const i = Math.min(Math.floor(fx), subdivisions - 1);
    const j = Math.min(Math.floor(fz), subdivisions - 1);
    const tx = fx - i;
    const tz = fz - j;
    // CreateGround splits every cell along the (i, j+1)–(i+1, j) diagonal.
    return tx + tz <= 1
      ? [at(i, j), at(i + 1, j), at(i, j + 1), 1 - tx - tz, tx, tz]
      : [at(i + 1, j + 1), at(i, j + 1), at(i + 1, j), tx + tz - 1, 1 - tx, 1 - tz];
  };

  return {
    heightsAt(x, z, out) {
      const t = locate(x, z);
      if (t) out.push(positions[t[0] + 1] * t[3] + positions[t[1] + 1] * t[4] + positions[t[2] + 1] * t[5]);
    },
    normalAt(x, z, _y, out) {
      const t = locate(x, z);
      return t ? _blendNormal(normals, t[0], t[1], t[2], t[3], t[4], t[5], out) : null;
    },
  };
}

// Target triangles per grid cell for the triangle-layer index.
const TRI_INDEX_TARGET = 4;

// Barycentric slack so a point exactly on a shared edge isn't lost to rounding.
const EDGE_EPSILON = 1e-9;

/**
 * Any triangle mesh (world-space `positions`, `indices`, `normals`), sampled
 * from above: the height of every triangle over (x, z). Triangles with no XZ
 * extent (vertical faces) are skipped.
 *
 * Built from the same vertex arrays as the mesh, so deck smoothing, per-point
 * offsets and the drive-mesh overlap all come for free.
 */
export function createTriangleLayer(positions, indices, normals = null) {
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
      a, b, c, ax, ay, az, by, cy, cx, cz, bx, bz, det,
      minX: Math.min(ax, bx, cx), maxX: Math.max(ax, bx, cx),
      minZ: Math.min(az, bz, cz), maxZ: Math.max(az, bz, cz),
    };
    tris.push(tri);
    minX = Math.min(minX, tri.minX); maxX = Math.max(maxX, tri.maxX);
    minZ = Math.min(minZ, tri.minZ); maxZ = Math.max(maxZ, tri.maxZ);
  }
  if (tris.length === 0) return { heightsAt() {}, normalAt: () => null };

  // Uniform grid over the XZ bounds; each cell lists the triangles whose XZ box
  // overlaps it.
  const cellsPerSide = Math.max(1, Math.ceil(Math.sqrt(tris.length / TRI_INDEX_TARGET)));
  const cellW = Math.max((maxX - minX) / cellsPerSide, 1e-9);
  const cellD = Math.max((maxZ - minZ) / cellsPerSide, 1e-9);
  const cells = Array.from({ length: cellsPerSide * cellsPerSide }, () => []);
  const cellOf = (v, min, size) => Math.min(cellsPerSide - 1, Math.max(0, Math.floor((v - min) / size)));
  for (const tri of tris) {
    const c0 = cellOf(tri.minX, minX, cellW), c1 = cellOf(tri.maxX, minX, cellW);
    const r0 = cellOf(tri.minZ, minZ, cellD), r1 = cellOf(tri.maxZ, minZ, cellD);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) cells[r * cellsPerSide + c].push(tri);
    }
  }

  // Calls visit(tri, wa, wb, wc, y) for every triangle over (x, z); stops
  // early when visit returns true.
  const forEachHit = (x, z, visit) => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return;
    for (const tri of cells[cellOf(z, minZ, cellD) * cellsPerSide + cellOf(x, minX, cellW)]) {
      if (x < tri.minX || x > tri.maxX || z < tri.minZ || z > tri.maxZ) continue;
      // Barycentric weights of (x, z) in the triangle's XZ projection.
      const wa = ((tri.bz - tri.cz) * (x - tri.cx) + (tri.cx - tri.bx) * (z - tri.cz)) / tri.det;
      const wb = ((tri.cz - tri.az) * (x - tri.cx) + (tri.ax - tri.cx) * (z - tri.cz)) / tri.det;
      const wc = 1 - wa - wb;
      if (wa < -EDGE_EPSILON || wb < -EDGE_EPSILON || wc < -EDGE_EPSILON) continue;
      if (visit(tri, wa, wb, wc, wa * tri.ay + wb * tri.by + wc * tri.cy)) return;
    }
  };

  return {
    heightsAt(x, z, out) {
      forEachHit(x, z, (_tri, _wa, _wb, _wc, y) => { out.push(y); });
    },
    // Normal of the triangle whose height at (x, z) is `y` (one heightsAt hit).
    normalAt(x, z, y, out) {
      let result = null;
      forEachHit(x, z, (tri, wa, wb, wc, ty) => {
        if (Math.abs(ty - y) > 1e-9) return false;
        result = normals
          ? _blendNormal(normals, tri.a, tri.b, tri.c, wa, wb, wc, out)
          : null;
        return true;
      });
      return result;
    },
  };
}

// ─── The stack ──────────────────────────────────────────────────────────────

// The surface-pick rule's distances (see SurfaceLayers.sample).
const PENETRATION_THRESHOLD = 1.5;
const MAX_UPWARD_RISE = 1.0;
const UP_ORIGIN_DROP = 0.05;
const UP_MAX_DISTANCE_NO_DOWN = 50;
const DOWN_EXTRA_DISTANCE = 200;

/**
 * Every drivable layer, and the rule for picking one at a point. Each layer is
 * added with a `surface` (DriveSurfaceManager's record, `{ surfaceId, kind,
 * level, ... }`), which every hit carries back.
 */
export class SurfaceLayers {
  constructor() {
    this._entries = [];
    /**
     * Optional `(x, z) => { min, max } | null`: a vertical band where the
     * ground (kind 'ground') isn't there — the inside of a tunnel bore, which
     * the ground shader also discards. Other surfaces are unaffected.
     */
    this.groundVoidAt = null;
  }

  /**
   * @param {{ heightsAt(x, z, out: number[]): void, normalAt(x, z, y, out): object|null }} layer
   * @param {{ surfaceId?: number, kind?: string, level?: number }} surface
   * @returns {object} the entry, for `remove`
   */
  add(layer, surface) {
    const entry = { layer, surface };
    this._entries.push(entry);
    return entry;
  }

  remove(entry) {
    const i = this._entries.indexOf(entry);
    if (i !== -1) this._entries.splice(i, 1);
  }

  /** Every surface height at (x, z): `[{ y, surface, layer }]`, unordered. */
  hitsAt(x, z) {
    const hits = [];
    const ys = [];
    const voidBand = this.groundVoidAt?.(x, z) ?? null;
    for (const { layer, surface } of this._entries) {
      ys.length = 0;
      layer.heightsAt(x, z, ys);
      for (const y of ys) {
        if (voidBand && surface.kind === "ground" && y > voidBand.min && y < voidBand.max) continue;
        hits.push({ y, surface, layer });
      }
    }
    return hits;
  }

  /**
   * The surface under a point at height `fromY`:
   *
   *  1. down: the highest surface at or below `fromY`;
   *  2. if that's more than 1.5 below (the truck has sunk into something),
   *     or there is none, look up from just under `fromY` and take the nearest
   *     surface above, but only if it's no more than 1.0 above `fromY`, so a
   *     truck under a bridge never snaps onto the deck;
   *  3. otherwise the down hit.
   *
   * `prefer` is TerrainPhysics' continuity hint: in each direction, a hit on
   * surface `surfaceId` beats the nearest hit when it's within
   * `maxDistanceDelta` of it, so a truck doesn't flip between two nearly
   * level surfaces.
   *
   * @param {{ surfaceId: number, maxDistanceDelta?: number } | null} [prefer]
   * @returns {{ y: number, surface: object, layer: object } | null}
   */
  sample(x, z, fromY, prefer = null) {
    const hits = this.hitsAt(x, z);
    const down = this._pick(hits, h => h.y <= fromY && h.y >= -DOWN_EXTRA_DISTANCE, h => fromY - h.y, prefer);
    if (down && fromY - down.y <= PENETRATION_THRESHOLD) return down;

    const upOrigin = fromY - UP_ORIGIN_DROP;
    const upMax = down ? fromY - down.y + 1 : UP_MAX_DISTANCE_NO_DOWN;
    const up = this._pick(hits, h => h.y >= upOrigin && h.y - upOrigin <= upMax, h => h.y - upOrigin, prefer);
    if (up && up.y - fromY <= MAX_UPWARD_RISE) return up;
    return down;
  }

  /**
   * Highest hit on `level` at or below `fromY`, within `maxDistance` (a
   * level-locked downward probe, as TerrainQuery's normal sampling uses).
   * @returns {number|null}
   */
  downOnLevel(x, z, fromY, level, maxDistance) {
    let best = null;
    for (const h of this.hitsAt(x, z)) {
      if (h.surface.level !== level || h.y > fromY || fromY - h.y > maxDistance) continue;
      if (best === null || h.y > best) best = h.y;
    }
    return best;
  }

  /** Interpolated vertex normal of a `sample` hit → `out`, or null. */
  normalAt(hit, x, z, out) {
    return hit.layer.normalAt(x, z, hit.y, out);
  }

  // The nearest hit passing `accept` (by `distance`), or the preferred
  // surface's nearest hit when it's within maxDistanceDelta of that. An exact
  // tie (a seam's foot lying on the ground) goes to the first-added surface,
  // i.e. the ground.
  _pick(hits, accept, distance, prefer) {
    let nearest = null;
    let preferred = null;
    for (const h of hits) {
      if (!accept(h)) continue;
      const d = distance(h);
      if (nearest === null || d < distance(nearest)) nearest = h;
      if (prefer && h.surface.surfaceId === prefer.surfaceId && (preferred === null || d < distance(preferred))) {
        preferred = h;
      }
    }
    if (preferred && distance(preferred) - distance(nearest) <= (prefer.maxDistanceDelta ?? 0.75)) return preferred;
    return nearest;
  }
}
