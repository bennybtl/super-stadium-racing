// Tunnel geometry, derived once per build and shared by everything that needs
// the tunnel's shape (the lining mesh, the editor overlay, and later the floor
// surface layer and the ground shader's bore discard), so they can't drift
// apart. Babylon-free; see TUNNELS.md.

import { expandPolyline } from "../utils/polyline-utils.js";

export const TUNNEL_DEFAULTS = Object.freeze({ width: 10, height: 6, cover: 2 });

// Lining (walls + arch) thickness, and the floor slab's depth below the floor.
export const TUNNEL_LINING_THICKNESS = 0.6;
export const TUNNEL_FLOOR_DEPTH = 0.5;

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
 * `lowCover[i]` flags stations where the hill, having risen to `cover` above the
 * lining's outer crown, dips below it again (or, if it never gets there, the
 * whole stretch between the portals), for the editor to warn about.
 */
export function deriveTunnel(feature, heightAt) {
  const points = feature?.points;
  if (!Array.isArray(points) || points.length < 2) return null;
  const width = feature.width ?? TUNNEL_DEFAULTS.width;
  const height = feature.height ?? TUNNEL_DEFAULTS.height;
  const cover = feature.cover ?? TUNNEL_DEFAULTS.cover;

  const path = expandPolyline(points, false);
  const arc = [0];
  for (let i = 1; i < path.length; i++) {
    arc.push(arc[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  }
  const total = arc[arc.length - 1];
  if (!(total > 1e-3)) return null;

  const pointAt = (s) => {
    let i = 1;
    while (i < arc.length - 1 && arc[i] < s) i++;
    const span = arc[i] - arc[i - 1];
    const t = span > 0 ? Math.min(1, Math.max(0, (s - arc[i - 1]) / span)) : 0;
    return {
      x: path[i - 1].x + t * (path[i].x - path[i - 1].x),
      z: path[i - 1].z + t * (path[i].z - path[i - 1].z),
    };
  };

  // Floor keys: both ends, plus any control point that pins its own floorY
  // (placed at its nearest distance along the rounded centreline).
  const first = points[0];
  const last = points[points.length - 1];
  const keys = [
    { s: 0, y: Number.isFinite(first.floorY) ? first.floorY : heightAt(path[0].x, path[0].z) },
  ];
  for (let i = 1; i < points.length - 1; i++) {
    if (Number.isFinite(points[i].floorY)) keys.push({ s: _nearestArc(path, arc, points[i]), y: points[i].floorY });
  }
  const end = path[path.length - 1];
  keys.push({ s: total, y: Number.isFinite(last.floorY) ? last.floorY : heightAt(end.x, end.z) });
  keys.sort((p, q) => p.s - q.s);
  const floorAt = (s) => {
    let k = 1;
    while (k < keys.length - 1 && keys[k].s < s) k++;
    const span = keys[k].s - keys[k - 1].s;
    const t = span > 0 ? Math.min(1, Math.max(0, (s - keys[k - 1].s) / span)) : 0;
    return keys[k - 1].y + t * (keys[k].y - keys[k - 1].y);
  };

  const n = Math.max(2, Math.round(total / STATION_STEP));
  const stations = [];
  for (let k = 0; k <= n; k++) {
    const s = (k * total) / n;
    const { x, z } = pointAt(s);
    stations.push({ x, z, s, floorY: floorAt(s), groundY: heightAt(x, z), nx: 0, nz: 0 });
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

  return { width, height, cover, total, profile: tunnelProfile(width, height), stations, portals, lowCover };
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
