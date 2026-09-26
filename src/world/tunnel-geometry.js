// Tunnel geometry, derived once per build and shared by everything that needs
// the tunnel's shape (the lining mesh, the editor overlay, and later the floor
// surface layer and the ground shader's bore discard), so they can't drift
// apart. Babylon-free; see TUNNELS.md.

import { expandPolyline } from "../utils/polyline-utils.js";

export const TUNNEL_DEFAULTS = Object.freeze({ width: 10, height: 6, cover: 2 });

// Lining (walls + arch) thickness, and the floor slab's depth below the floor.
export const TUNNEL_LINING_THICKNESS = 0.6;
export const TUNNEL_FLOOR_DEPTH = 0.5;
// Ground and slab at the floor: the ground shader discards ground more than
// TUNNEL_BORE_DISCARD_ABOVE over the floor inside a bore, and the slab's top
// sits TUNNEL_FLOOR_LIFT over it, covering the rest. The two overlap so that no
// band of ground is neither discarded nor covered — the ground mesh rises a
// little off the floor near the walls (triangles reaching up the cutting's
// sides), and the bore texture's floor steps by up to slope × half a texel.
// Ground exactly at the floor (the cutting in front of a portal) is kept.
export const TUNNEL_FLOOR_LIFT = 0.1;
export const TUNNEL_BORE_DISCARD_ABOVE = 0.05;

// The portal face (where the hill rises past the headwall top, see Cuttings)
// is a vertical step in the height field, but the ground mesh only has a vertex
// every metre or so, which smears the step into a steep ramp up to a cell
// diagonal wide. The headwall stands this far out in front of the face and
// reaches back into the hill, so the smear lands inside the bore.
export const TUNNEL_PORTAL_SETBACK = 2;
// How far the headwall block reaches past the face into the hill.
export const TUNNEL_HEADWALL_EMBED = 0.5;

// Distance between stations along the centreline (m).
const STATION_STEP = 1;
// Roof arch resolution: segments across the half-ellipse.
const ARCH_SEGMENTS = 14;

/**
 * Cross-section of the bore: vertical walls up to the springline, then a
 * half-ellipse to the crown. A semicircle when the tunnel is tall enough;
 * flatter otherwise, keeping at least some wall.
 */
export function tunnelProfile(width, height) {
  const halfWidth = width / 2;
  const springY = Math.max(height - halfWidth, height * 0.35);
  return { halfWidth, springY, archRise: height - springY };
}

/**
 * The bore's outline as (u, v) points — u across (+ = left of travel), v up
 * from the floor — from the left foot, up the wall, over the arch and down to
 * the right foot. `grow` pushes it outward uniformly (the lining's outer face).
 * Always the same point count, so two outlines can be stitched together.
 */
export function archContour({ halfWidth, springY, archRise }, grow = 0) {
  const a = halfWidth + grow;
  const b = archRise + grow;
  const pts = [{ u: a, v: 0 }];
  for (let i = 0; i <= ARCH_SEGMENTS; i++) {
    const t = (i / ARCH_SEGMENTS) * Math.PI;
    pts.push({ u: a * Math.cos(t), v: springY + b * Math.sin(t) });
  }
  pts.push({ u: -a, v: 0 });
  return pts;
}

/**
 * Everything derived from a tunnel feature and the terrain it runs through.
 *
 * @param {object} feature  { points:[{x,z,radius?,floorY?}], width, height, cover }
 * @param {(x: number, z: number) => number} heightAt  terrain height (analytic)
 * @returns {null | {
 *   width: number, height: number, cover: number, total: number,
 *   profile: ReturnType<typeof tunnelProfile>,
 *   stations: { x: number, z: number, s: number, floorY: number, groundY: number, nx: number, nz: number }[],
 *   portals: { in: number, out: number } | null,
 *   faces: { in: number, out: number } | null,
 *   span: { start: number, end: number },
 *   lowCover: boolean[],
 * }}
 *
 * The floor ramps linearly (by distance along the centreline) between the
 * terrain heights at the two ends, which the author places on the floors of the
 * cuttings they shaped. A control point's optional `floorY` pins the floor there
 * instead. `nx/nz` is the horizontal unit normal to the left of travel.
 *
 * Portals are the first and last stations where the terrain above the
 * centreline rises over the crown (floor + height); `null` when it never does.
 * `faces` are the exact distances along the centreline where it does (on cut
 * terrain, the portal faces), and `span` the stretch the lining covers: from
 * TUNNEL_PORTAL_SETBACK in front of one face to the same past the other, or
 * the whole centreline without portals.
 * `lowCover[i]` flags stations where the hill, having risen to `cover` above the
 * lining's outer crown, dips below it again (or, if it never gets there, the
 * whole stretch between the portals), for the editor to warn about.
 */
export function deriveTunnel(feature, heightAt) {
  const tp = tunnelPath(feature);
  if (!tp) return null;
  const width = feature.width ?? TUNNEL_DEFAULTS.width;
  const height = feature.height ?? TUNNEL_DEFAULTS.height;
  const cover = feature.cover ?? TUNNEL_DEFAULTS.cover;
  const { path, total } = tp;
  const end = path[path.length - 1];
  const endY = [heightAt(path[0].x, path[0].z), heightAt(end.x, end.z)];

  const n = Math.max(2, Math.round(total / STATION_STEP));
  const stations = [];
  for (let k = 0; k <= n; k++) {
    const s = (k * total) / n;
    const { x, z } = _pointAt(tp, s);
    stations.push({ x, z, s, floorY: tunnelFloorAt(tp, s, endY), groundY: heightAt(x, z), nx: 0, nz: 0 });
  }
  for (let k = 0; k <= n; k++) {
    const a = stations[Math.max(0, k - 1)];
    const b = stations[Math.min(n, k + 1)];
    const tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    stations[k].nx = -tz / len;
    stations[k].nz = tx / len;
  }

  let portalIn = -1, portalOut = -1;
  for (let k = 0; k <= n; k++) {
    if (stations[k].groundY > stations[k].floorY + height) {
      if (portalIn < 0) portalIn = k;
      portalOut = k;
    }
  }
  const portals = portalIn < 0 ? null : { in: portalIn, out: portalOut };

  // The faces between stations: where the ground first crosses the crown.
  const aboveCrown = (sAt) => {
    const { x, z } = _pointAt(tp, sAt);
    return heightAt(x, z) > tunnelFloorAt(tp, sAt, endY) + height;
  };
  const crossing = (below, above) => {
    for (let i = 0; i < 24; i++) {
      const mid = (below + above) / 2;
      if (aboveCrown(mid)) above = mid; else below = mid;
    }
    return above;
  };
  const faces = !portals ? null : {
    in: portalIn === 0 ? 0 : crossing(stations[portalIn - 1].s, stations[portalIn].s),
    out: portalOut === n ? total : crossing(stations[portalOut + 1].s, stations[portalOut].s),
  };
  const span = faces && faces.out > faces.in
    ? { start: Math.max(0, faces.in - TUNNEL_PORTAL_SETBACK), end: Math.min(total, faces.out + TUNNEL_PORTAL_SETBACK) }
    : { start: 0, end: total };

  // Low cover: the hill dipping back after rising to full cover. The ramps up
  // from each portal never have it (at the portal itself the hill only just
  // clears the crown), so they don't count; a hill that never reaches full
  // cover at all is flagged from portal to portal.
  const lowCover = stations.map(() => false);
  if (portals) {
    const covered = (k) => stations[k].groundY - stations[k].floorY >= height + TUNNEL_LINING_THICKNESS + cover;
    let from = portals.in, to = portals.out;
    while (from <= portals.out && !covered(from)) from++;
    while (to >= portals.in && !covered(to)) to--;
    if (from > to) { from = portals.in; to = portals.out; }
    for (let k = from; k <= to; k++) lowCover[k] = !covered(k);
  }

  return { width, height, cover, total, profile: tunnelProfile(width, height), stations, portals, faces, span, lowCover };
}

/**
 * Station frames from `s0` to `s1` along a derived tunnel: interpolated ones
 * at both ends and the stations in between. Each is { x, z, s, floorY, nx, nz }.
 */
export function stationsBetween({ stations }, s0, s1) {
  const at = (sAt) => {
    let k = 1;
    while (k < stations.length - 1 && stations[k].s < sAt) k++;
    const a = stations[k - 1], b = stations[k];
    const t = b.s > a.s ? Math.min(1, Math.max(0, (sAt - a.s) / (b.s - a.s))) : 0;
    const nx = a.nx + t * (b.nx - a.nx), nz = a.nz + t * (b.nz - a.nz);
    const len = Math.hypot(nx, nz) || 1;
    return {
      x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z), s: sAt,
      floorY: a.floorY + t * (b.floorY - a.floorY), nx: nx / len, nz: nz / len,
    };
  };
  const out = [at(s0)];
  for (const st of stations) if (st.s > s0 + 1e-6 && st.s < s1 - 1e-6) out.push(st);
  out.push(at(s1));
  return out;
}

/**
 * The tunnel's centreline as a path: the corner-rounded polyline with its
 * cumulative arc lengths, and the floor heights its control points pin (at
 * their nearest distance along it). Terrain-independent, so callers can cache
 * it on the feature's points. Null without two distinct points.
 */
export function tunnelPath(feature) {
  const points = feature?.points;
  if (!Array.isArray(points) || points.length < 2) return null;
  const path = expandPolyline(points, false);
  const arc = [0];
  for (let i = 1; i < path.length; i++) {
    arc.push(arc[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  }
  const total = arc[arc.length - 1];
  if (!(total > 1e-3)) return null;
  const pinned = [];
  for (let i = 1; i < points.length - 1; i++) {
    if (Number.isFinite(points[i].floorY)) pinned.push({ s: _nearestArc(path, arc, points[i]), y: points[i].floorY });
  }
  pinned.sort((p, q) => p.s - q.s);
  const first = points[0].floorY, last = points[points.length - 1].floorY;
  return {
    path, arc, total, pinned,
    pinnedEnds: [Number.isFinite(first) ? first : null, Number.isFinite(last) ? last : null],
  };
}

/**
 * Floor height at distance `s` along the path: a linear ramp through the
 * ends (their pinned floorY, else `endY` — the terrain there) and any pinned
 * interior points.
 */
export function tunnelFloorAt(tp, s, endY) {
  const y0 = tp.pinnedEnds[0] ?? endY[0];
  const y1 = tp.pinnedEnds[1] ?? endY[1];
  let prevS = 0, prevY = y0;
  for (const k of tp.pinned) {
    if (s <= k.s) return _lerpAt(prevS, prevY, k.s, k.y, s);
    prevS = k.s; prevY = k.y;
  }
  return _lerpAt(prevS, prevY, tp.total, y1, s);
}

function _lerpAt(s0, y0, s1, y1, s) {
  const span = s1 - s0;
  const t = span > 0 ? Math.min(1, Math.max(0, (s - s0) / span)) : 0;
  return y0 + t * (y1 - y0);
}

function _pointAt({ path, arc }, s) {
  let i = 1;
  while (i < arc.length - 1 && arc[i] < s) i++;
  const span = arc[i] - arc[i - 1];
  const t = span > 0 ? Math.min(1, Math.max(0, (s - arc[i - 1]) / span)) : 0;
  return {
    x: path[i - 1].x + t * (path[i].x - path[i - 1].x),
    z: path[i - 1].z + t * (path[i].z - path[i - 1].z),
  };
}

// ─── Cuttings ────────────────────────────────────────────────────────────────
// The terrain is a sum of additive features, which can't carve a level floor
// into a slope, so the tunnel cuts its own approaches: along the drawn
// centreline, ground lower than the portal headwall's top is capped to a
// trench — level at the floor across the bore, sides rising at
// TUNNEL_CUT_SIDE_SLOPE. Ground already above the headwall top is left alone,
// which keeps the hill over the tunnel and makes the portal face where the hill
// rises past it (exactly where the headwall stands). Capping only ever lowers
// the ground, and at the drawn ends the floor meets the terrain, so each
// cutting blends back into it.

/** How far the portal headwall (and so the cut's reach) rises above the crown. */
export const TUNNEL_CUT_CLEARANCE = TUNNEL_LINING_THICKNESS + 1.2;
/** Rise per metre of the cuttings' side walls. */
export const TUNNEL_CUT_SIDE_SLOPE = 1.5;

/** Half width of the cut at the headwall top (beyond it nothing is lowered). */
export function tunnelCutReach(feature) {
  const width = feature.width ?? TUNNEL_DEFAULTS.width;
  const height = feature.height ?? TUNNEL_DEFAULTS.height;
  return width / 2 + (height + TUNNEL_CUT_CLEARANCE) / TUNNEL_CUT_SIDE_SLOPE;
}

/**
 * Terrain height `h` at (x, z) after the tunnel's cut. `endY()` returns the
 * uncut terrain heights at the path's two ends (only called when the point is
 * within reach, since it costs two terrain samples).
 */
export function cutTunnelHeight(tp, feature, x, z, h, endY) {
  const reach = tunnelCutReach(feature);
  // Nearest point on the path; the two ends are cut square.
  const { path, arc } = tp;
  let best = Infinity, bestS = 0, beyondEnd = false;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1].x, az = path[i - 1].z;
    const dx = path[i].x - ax, dz = path[i].z - az;
    const len2 = dx * dx + dz * dz;
    const raw = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    const t = Math.min(1, Math.max(0, raw));
    const d2 = (ax + t * dx - x) ** 2 + (az + t * dz - z) ** 2;
    if (d2 < best) {
      best = d2;
      bestS = arc[i - 1] + t * (arc[i] - arc[i - 1]);
      beyondEnd = (i === 1 && raw < 0) || (i === path.length - 1 && raw > 1);
    }
  }
  if (beyondEnd || best > reach * reach) return h;
  const floorY = tunnelFloorAt(tp, bestS, endY());
  const height = feature.height ?? TUNNEL_DEFAULTS.height;
  if (h >= floorY + height + TUNNEL_CUT_CLEARANCE) return h;
  const halfWidth = (feature.width ?? TUNNEL_DEFAULTS.width) / 2;
  return Math.min(h, floorY + Math.max(0, Math.sqrt(best) - halfWidth) * TUNNEL_CUT_SIDE_SLOPE);
}

/** Distance along the path of its nearest point to `p`. */
function _nearestArc(path, arc, p) {
  let best = Infinity, bestS = 0;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1].x, az = path[i - 1].z;
    const dx = path[i].x - ax, dz = path[i].z - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.z - az) * dz) / len2)) : 0;
    const d2 = (ax + t * dx - p.x) ** 2 + (az + t * dz - p.z) ** 2;
    if (d2 < best) { best = d2; bestS = arc[i - 1] + t * (arc[i] - arc[i - 1]); }
  }
  return bestS;
}


// ─── Bore raster ─────────────────────────────────────────────────────────────
// The open volume inside the tunnels, as a grid over their bounding box: what
// the ground shader discards (terrain between the floor and the roof, which is
// only ever the terrain across the mouths) and what keeps steep-slope blockers
// out of the bore. Texel = [floorY, ceilingY, inside (0/1), distance from the
// centreline]. The shader only discards ground clearly above the floor: the cut
// ground at the floor is kept, under the (lifted) slab inside the tunnel and as
// the cutting's floor in front of it.

export const BORE_TEXELS_PER_METRE = 4;
// Past the inner wall: the lining itself hides terrain there, so reaching into
// it only makes sure no sliver of ground survives against the wall.
const BORE_SIDE_MARGIN = TUNNEL_LINING_THICKNESS / 2;
// Past each end of the lining, so texel rounding can't leave a sliver.
const BORE_END_EXTENSION = 0.25;
const BORE_MAX_SIZE = 2048;

/** Roof height above the floor at distance `d` from the centreline. */
function _ceilingAbove({ halfWidth, springY, archRise }, d) {
  const q = Math.min(1, d / halfWidth);
  return springY + archRise * Math.sqrt(1 - q * q);
}

/**
 * Rasterize the bores of derived tunnels (deriveTunnel results).
 * @returns {null | { minX: number, minZ: number, sizeX: number, sizeZ: number,
 *   width: number, height: number, data: Float32Array }}
 *   `data` is RGBA per texel, row-major from (minX, minZ), with an empty
 *   one-texel border so clamped lookups outside the box read "not inside".
 */
export function rasterizeBores(tunnels, texelsPerMetre = BORE_TEXELS_PER_METRE) {
  const bores = [];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const t of tunnels) {
    if (!t) continue;
    const pts = stationsBetween(t, t.span.start, t.span.end).map((st) => ({ x: st.x, z: st.z, floorY: st.floorY }));
    if (pts.length < 2) continue;
    const extend = (from, towards) => {
      const dx = from.x - towards.x, dz = from.z - towards.z;
      const len = Math.hypot(dx, dz) || 1;
      return { x: from.x + (dx / len) * BORE_END_EXTENSION, z: from.z + (dz / len) * BORE_END_EXTENSION, floorY: from.floorY };
    };
    pts.unshift(extend(pts[0], pts[1]));
    pts.push(extend(pts[pts.length - 1], pts[pts.length - 2]));
    const reach = t.profile.halfWidth + BORE_SIDE_MARGIN;
    for (const p of pts) {
      minX = Math.min(minX, p.x - reach); maxX = Math.max(maxX, p.x + reach);
      minZ = Math.min(minZ, p.z - reach); maxZ = Math.max(maxZ, p.z + reach);
    }
    bores.push({ pts, reach, profile: t.profile });
  }
  if (!bores.length) return null;

  let tpm = texelsPerMetre;
  const inner = () => [Math.ceil((maxX - minX) * tpm), Math.ceil((maxZ - minZ) * tpm)];
  while (Math.max(...inner()) + 2 > BORE_MAX_SIZE) tpm /= 2;
  const [iw, ih] = inner();
  const width = iw + 2, height = ih + 2;
  // One empty texel of border on every side.
  const originX = minX - 1 / tpm, originZ = minZ - 1 / tpm;
  const sizeX = width / tpm, sizeZ = height / tpm;
  const data = new Float32Array(width * height * 4);

  const texelRange = (x0, x1, z0, z1) => [
    Math.max(1, Math.floor((x0 - originX) * tpm)), Math.min(width - 2, Math.ceil((x1 - originX) * tpm)),
    Math.max(1, Math.floor((z0 - originZ) * tpm)), Math.min(height - 2, Math.ceil((z1 - originZ) * tpm)),
  ];
  const write = (r, c, d, floorY, profile) => {
    const o = (r * width + c) * 4;
    if (data[o + 2] > 0 && data[o + 3] <= d) return; // a nearer segment is already there
    data[o] = floorY;
    data[o + 1] = floorY + _ceilingAbove(profile, d);
    data[o + 2] = 1;
    data[o + 3] = d;
  };
  // Projection of (x, z) onto segment i (pts[i-1] → pts[i]): t along it, 0..1 on it.
  const along = (pts, i, x, z) => {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    return ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1);
  };

  for (const { pts, reach, profile } of bores) {
    // Each segment's strip, cut square at both ends…
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const [c0, c1, r0, r1] = texelRange(Math.min(a.x, b.x) - reach, Math.max(a.x, b.x) + reach, Math.min(a.z, b.z) - reach, Math.max(a.z, b.z) + reach);
      for (let r = r0; r <= r1; r++) {
        const z = originZ + (r + 0.5) / tpm;
        for (let c = c0; c <= c1; c++) {
          const x = originX + (c + 0.5) / tpm;
          const t = along(pts, i, x, z);
          if (t < 0 || t > 1) continue;
          const d = Math.hypot(x - (a.x + t * (b.x - a.x)), z - (a.z + t * (b.z - a.z)));
          if (d <= reach) write(r, c, d, a.floorY + t * (b.floorY - a.floorY), profile);
        }
      }
    }
    // …plus, at each interior joint, the wedge on the outside of the bend that
    // lies past the end of one strip and before the start of the next.
    for (let i = 1; i < pts.length - 1; i++) {
      const j = pts[i];
      const [c0, c1, r0, r1] = texelRange(j.x - reach, j.x + reach, j.z - reach, j.z + reach);
      for (let r = r0; r <= r1; r++) {
        const z = originZ + (r + 0.5) / tpm;
        for (let c = c0; c <= c1; c++) {
          const x = originX + (c + 0.5) / tpm;
          const d = Math.hypot(x - j.x, z - j.z);
          if (d <= reach && along(pts, i, x, z) > 1 && along(pts, i + 1, x, z) < 0) write(r, c, d, j.floorY, profile);
        }
      }
    }
  }
  return { minX: originX, minZ: originZ, sizeX, sizeZ, width, height, data };
}

/** The bore at (x, z) — `{ floorY, ceilingY }` — or null outside every tunnel. */
export function sampleBore(raster, x, z) {
  if (!raster) return null;
  const c = Math.floor(((x - raster.minX) / raster.sizeX) * raster.width);
  const r = Math.floor(((z - raster.minZ) / raster.sizeZ) * raster.height);
  if (c < 0 || r < 0 || c >= raster.width || r >= raster.height) return null;
  const o = (r * raster.width + c) * 4;
  return raster.data[o + 2] > 0 ? { floorY: raster.data[o], ceilingY: raster.data[o + 1] } : null;
}
