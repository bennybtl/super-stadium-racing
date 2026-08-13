import { expandPolyline, isPointInPolygon } from "./polyline-utils.js";

/**
 * Where a feature reaches: the parameters that set its extent, and the exact
 * region over which it alters terrain height.
 *
 * Two things need this and have to agree — `Track.getHeightAt`, which sums the
 * contributions, and the water builder, which has to know precisely where a
 * feature changes the ground so a pool cannot spread past it. They compute
 * different answers from the same shape (a height, versus a yes/no), so the
 * arithmetic is necessarily written twice; keeping the *parameters* here means
 * the two can't disagree about radii, transition bands, or the rotation
 * convention, which is where a silent drift would actually come from.
 *
 * Babylon-free on purpose, so both consumers stay runnable outside a browser.
 */

/**
 * The height profile every feature uses to meet the terrain.
 *
 * `u` runs 0 (full feature height) → 1 (terrain), and the curve is smoothstep,
 * `2u³ − 3u² + 1`, whose slope is zero at BOTH ends. That second half is the
 * point: the quarter-cosine this replaced left a slope of −(π/2)·height at u=1,
 * so every hill met flat ground in a crease ring. It was invisible while the
 * ground mesh sampled every ~2.8 units and averaged it away, and became obvious
 * the moment the lattice got fine enough to resolve it.
 *
 * `shape` warps u before the curve, moving WHERE the steep part of the drop
 * sits rather than smoothing globally (for that, widen the band itself):
 *   shape < 1  falls away early, long gentle toe — steeper up near the top
 *   shape = 1  plain smoothstep
 *   shape > 1  height holds, then falls late and steeply — mesa-like (sharper)
 *
 * The floor is 0.8, not 0.5. The slope at u=0 only vanishes for shape > 0.5, and
 * approaches zero so slowly below 0.8 that the top of the band creases harder
 * than the toe we set out to fix: measured |f'| near u=0 is 2.0–2.6 at shape
 * 0.5–0.6 versus 1.571 for the quarter-cosine's toe. At 0.8 it stays under 1.0
 * across the range a real lattice samples, so both ends beat the old curve.
 *
 * @param {number} u      0..1, normalized distance across the falloff band
 * @param {number} shape  EDGE_SHAPE_MIN..MAX profile warp; 1 is neutral
 * @returns {number} height multiplier, 1 at u=0 → 0 at u=1
 */
export function edgeFalloff(u, shape = 1) {
  if (!(u > 0)) return 1;
  if (u >= 1) return 0;
  const s = clampEdgeShape(shape);
  const v = s === 1 ? u : Math.pow(u, s);
  return 1 + v * v * (2 * v - 3);
}

export const EDGE_SHAPE_MIN = 0.8;
export const EDGE_SHAPE_MAX = 4;

/**
 * Default shape — deliberately not 1.
 *
 * Smoothstep is thinner through the middle of the band than the quarter-cosine
 * it replaced (0.500 vs 0.707 at the midpoint), so defaulting to 1 would quietly
 * shrink every hill on every existing track — most visibly as water pools, whose
 * wetted area is where the bowl is deeper than the level: a 20-radius, 6-deep
 * pool lost about a third of its radius. 1.75 is the least-squares match to the
 * old curve (max deviation 0.085 rather than 0.207) with the toe slope still
 * ~0.02 instead of 1.571, so tracks keep their shape and lose the crease.
 */
export const EDGE_SHAPE_DEFAULT = 1.75;

/** Clamp a `shape` to the range where both ends of the profile stay clean. */
export function clampEdgeShape(val) {
  const s = Number(val);
  if (!Number.isFinite(s)) return 1;
  return Math.min(EDGE_SHAPE_MAX, Math.max(EDGE_SHAPE_MIN, s));
}

/** The `shape` knob for any feature that has a falloff band. */
export function getEdgeShape(feature) {
  return clampEdgeShape(feature?.edgeShape ?? EDGE_SHAPE_DEFAULT);
}

/** Ellipse radii and rotation of a hill, with radii clamped away from zero. */
export function getHillEllipseParams(feature) {
  return {
    radiusX: Math.max(0.001, feature.radiusX ?? 10),
    radiusZ: Math.max(0.001, feature.radiusZ ?? 10),
    angleRad: ((feature.angle ?? 0) * Math.PI) / 180,
    // Fraction of the radius that stays flat before the falloff starts, so a
    // hill can be a mesa rather than only a dome. A fraction rather than a
    // world-space band (squareHill's `transition`) because the band would be a
    // different width along X than along Z on any non-circular ellipse; in the
    // ellipse's own normalized radius it is exact in every direction.
    flatTop: Math.min(0.95, Math.max(0, feature.flatTop ?? 0)),
  };
}

/**
 * Extents and falloff band of a squareHill.
 *
 * `width`/`depth` are the feature's FOOTPRINT — the falloff is inset, running
 * from the flat top out to the rect edge, so changing `transition` reshapes the
 * edge without resizing the hill. (It used to be added outside the rect, which
 * made the smoothing slider grow the whole feature by 2·transition per axis;
 * schema v3 migrates old tracks by folding that skirt into width/depth.)
 *
 * `band` is the transition clamped to what fits: a band wider than the half
 * extent would leave the profile still above zero at the rect edge, i.e. a cliff
 * exactly where this is meant to produce a soft join.
 *
 *   halfWidth/halfDepth      half the footprint
 *   innerHalfWidth/Depth     the flat top, footprint minus the band
 *   band                     falloff width actually used
 */
export function getSquareHillParams(feature) {
  const halfWidth = feature.width / 2;
  const halfDepth = (feature.depth ?? feature.width) / 2;
  const transition = feature.transition ?? 4;
  const band = Math.max(0, Math.min(transition, halfWidth, halfDepth));
  return {
    halfWidth,
    halfDepth,
    transition,
    band,
    innerHalfWidth: halfWidth - band,
    innerHalfDepth: halfDepth - band,
    angleRad: ((feature.angle ?? 0) * Math.PI) / 180,
  };
}

/** How far a polyHill's falloff reaches outside its polygon. */
export function getPolyHillHalfWidth(feature) {
  return (feature.width ?? feature.slope ?? 5) / 2;
}

/**
 * Rotate a world point into a feature's local frame. Shared by hill and
 * squareHill — one rotation convention, so a sign error can't apply to the
 * height math and the footprint differently.
 */
export function toFeatureLocal(feature, x, z) {
  return rotateToLocal(
    x - feature.centerX,
    z - feature.centerZ,
    ((feature.angle ?? 0) * Math.PI) / 180,
  );
}

/**
 * The rotation kernel itself, for the features that name their angle something
 * other than `angle` (terrainRegion uses `rotation`). Takes a center-relative
 * offset so every caller shares one sign convention.
 */
export function rotateToLocal(wx, wz, angleRad) {
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  return {
    lx: wx * cosA + wz * sinA,
    lz: -wx * sinA + wz * cosA,
  };
}

// ─── Footprints ────────────────────────────────────────────────────────────

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
 * A feature's footprint: `contains(x, z)` is true exactly where the feature
 * alters terrain height, plus an `outline` and `bounds` for overlap tests.
 * Returns null for feature types whose extent this doesn't model — callers must
 * treat that as "reach unknown" rather than "reaches nothing".
 *
 * The water builder uses this to bound where a pool may spread (so it cannot
 * flood an unrelated dip that happens to sit below the same level), to decide
 * which features count as sitting inside a pool, and to group overlapping water
 * into bodies.
 */
export function featureFootprint(feature) {
  const shape = footprintShape(feature);
  if (!shape) return null;
  const { outline, bounds, contains } = shape;
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

function footprintShape(feature) {
  // meshGrid and the non-height feature types are deliberately absent: their
  // reach isn't modelled here, and guessing would be worse than saying so.
  if (feature?.type !== 'hill' && feature?.type !== 'squareHill' && feature?.type !== 'polyHill') {
    return null;
  }

  if (feature.type === 'hill') {
    const { radiusX, radiusZ, angleRad } = getHillEllipseParams(feature);
    const outline = ellipseContour(feature.centerX, feature.centerZ, radiusX, radiusZ, angleRad);
    return {
      outline,
      bounds: boundsOf(outline),
      contains: (x, z) => {
        const { lx, lz } = toFeatureLocal(feature, x, z);
        return (lx * lx) / (radiusX * radiusX) + (lz * lz) / (radiusZ * radiusZ) < 1;
      },
    };
  }

  if (feature.type === 'squareHill') {
    const { halfWidth: hw, halfDepth: hd, band, innerHalfWidth, innerHalfDepth, angleRad } =
      getSquareHillParams(feature);
    // The falloff band is inset, so the outline is exactly the rect.
    const outline = rectContour(
      feature.centerX, feature.centerZ,
      hw * 2, hd * 2,
      angleRad
    );
    return {
      outline,
      bounds: boundsOf(outline),
      // Mirrors the height test in Track.getHeightAt — including the corners,
      // where the band runs out diagonally before it reaches the rect corner and
      // the hill contributes nothing. The outline is the bounding rect; this is
      // the real support.
      contains: (x, z) => {
        const { lx, lz } = toFeatureLocal(feature, x, z);
        if (band <= 0) return Math.abs(lx) < hw && Math.abs(lz) < hd;
        const edgeDx = Math.max(0, Math.abs(lx) - innerHalfWidth);
        const edgeDz = Math.max(0, Math.abs(lz) - innerHalfDepth);
        return edgeDx * edgeDx + edgeDz * edgeDz < band * band;
      },
    };
  }

  // polyHill: filled, closed loops only (guaranteed by isWaterFeature).
  const rim = expandPolyline(feature.points, true);
  const halfWidth = getPolyHillHalfWidth(feature);
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

