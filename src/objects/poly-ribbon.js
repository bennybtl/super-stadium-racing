import { Mesh, VertexData, StandardMaterial, Color3 } from "@babylonjs/core";
import { TerrainQuery } from "../managers/TerrainQuery.js";

/**
 * Shared machinery for the polyline "ribbon" objects — PolyWall and PolyCurb.
 *
 * Both are the same construction: resample a corner-rounded centerline at
 * constant arc length, sample terrain height at each point, then sweep a
 * striped band along it. They differ only in their rail/height profile (a curb
 * sits on the ground; a wall has a smoothed top and a buried, raked base) and
 * in what collision they attach. That difference is the argument to
 * `buildStripedRibbon`; everything else lives here so a fix to the wrap
 * indexing or bridge sampling can't land in one shape and miss the other.
 */

/**
 * Terrain height sampler that prefers raycast sampling when a feature sits on a
 * bridge deck (where the analytic heightfield is blind to the deck) and the
 * cheaper analytic height everywhere else.
 */
export class RibbonHeightSampler {
  constructor(scene, feature) {
    this._terrainQuery = new TerrainQuery(scene);
    this._useBridgeSurface = this._featureUsesBridgeSurface(feature);
  }

  /** True when the last sample resolved onto a bridge deck. */
  get lastSampleOnBridge() {
    return (
      this._useBridgeSurface &&
      this._terrainQuery.getLastResolvedSurface?.()?.surfaceType === "bridgeMesh"
    );
  }

  sample(track, x, z) {
    if (this._useBridgeSurface) return this._terrainQuery.heightAt(x, z);
    return track.getHeightAt(x, z);
  }

  _featureUsesBridgeSurface(feature) {
    const points = feature?.points;
    if (!Array.isArray(points) || points.length === 0) return false;
    return points.some((pt) => {
      this._terrainQuery.heightAt(pt.x, pt.z);
      return (
        this._terrainQuery.getLastResolvedSurface?.()?.surfaceType ===
        "bridgeMesh"
      );
    });
  }
}

/**
 * Resample a centerline at ~constant arc length, recording terrain height (and
 * whether each sample landed on a bridge) at every point.
 *
 * Open polylines get N+1 samples including both endpoints; closed ones get N
 * and wrap. Returns parallel arrays plus the actual step and total length.
 */
export function resampleCenterline(points, closed, sampler, track, sampleStep) {
  const loop = closed ? [...points, points[0]] : points;
  const arcLen = [0];
  for (let i = 1; i < loop.length; i++) {
    arcLen.push(
      arcLen[i - 1] +
        Math.hypot(loop[i].x - loop[i - 1].x, loop[i].z - loop[i - 1].z),
    );
  }
  const total = arcLen[arcLen.length - 1];
  if (total < 1e-6) return null;

  const pointAt = (s) => {
    if (s <= 0) return { x: loop[0].x, z: loop[0].z };
    if (s >= total) {
      const l = loop[loop.length - 1];
      return { x: l.x, z: l.z };
    }
    let i = 1;
    while (i < arcLen.length && arcLen[i] < s) i++;
    const t = (s - arcLen[i - 1]) / (arcLen[i] - arcLen[i - 1]);
    return {
      x: loop[i - 1].x + t * (loop[i].x - loop[i - 1].x),
      z: loop[i - 1].z + t * (loop[i].z - loop[i - 1].z),
    };
  };

  const N = Math.max(2, Math.round(total / sampleStep));
  const count = closed ? N : N + 1;
  const xs = [], zs = [], raw = [], s = [], onBridge = [];
  for (let k = 0; k < count; k++) {
    const arc = (k * total) / N;
    const p = pointAt(arc);
    xs.push(p.x);
    zs.push(p.z);
    raw.push(sampler.sample(track, p.x, p.z));
    onBridge.push(sampler.lastSampleOnBridge);
    s.push(arc);
  }
  return { xs, zs, raw, s, onBridge, step: total / N, total, closed };
}

/**
 * Per-sample unit normal (left side) from a central-difference tangent.
 * Returns parallel `nx`/`nz` arrays.
 */
export function centerlineNormals(xs, zs, closed) {
  const n = xs.length;
  const nx = new Array(n), nz = new Array(n);
  for (let i = 0; i < n; i++) {
    const ip = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const iN = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    let tx = xs[iN] - xs[ip], tz = zs[iN] - zs[ip];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    nx[i] = -tz;
    nz[i] = tx; // rotate tangent +90° in XZ
  }
  return { nx, nz };
}

/**
 * Sweep a striped band along a centerline and return the finished mesh.
 *
 * Rails are supplied by the caller so each shape controls its own profile:
 * `lx/lz` and `rx/rz` are the top rails, `lbx/lbz` and `rbx/rbz` the bottom
 * rails (equal to the top rails when the shape has no splay), with `topY`/`botY`
 * the vertical extents at each sample.
 */
export function buildStripedRibbon({
  name,
  scene,
  shadows,
  xs,
  s,
  step,
  closed,
  nx,
  nz,
  lx, lz, rx, rz,
  lbx, lbz, rbx, rbz,
  topY,
  botY,
  stripes,
  stripeLen,
}) {
  const n = xs.length;
  const positions = [], indices = [], normals = [], colors = [];
  const pushQuad = (p0, p1, p2, p3, nrm, col) => {
    const base = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    for (let k = 0; k < 4; k++) {
      normals.push(...nrm);
      colors.push(col[0], col[1], col[2], 1);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const bandCount = closed ? n : n - 1;
  for (let i = 0; i < bandCount; i++) {
    const j = (i + 1) % n;
    // stripe colour from the band's mid arc-length
    const sMid = closed && i === n - 1 ? s[i] + step * 0.5 : (s[i] + s[j]) / 2;
    const col = stripes[Math.floor(sMid / stripeLen) % stripes.length];

    // averaged outward normal for the side faces of this band
    let anx = nx[i] + nx[j], anz = nz[i] + nz[j];
    const al = Math.hypot(anx, anz) || 1;
    anx /= al;
    anz /= al;

    const Li_b = [lbx[i], botY[i], lbz[i]], Li_t = [lx[i], topY[i], lz[i]];
    const Lj_b = [lbx[j], botY[j], lbz[j]], Lj_t = [lx[j], topY[j], lz[j]];
    const Ri_b = [rbx[i], botY[i], rbz[i]], Ri_t = [rx[i], topY[i], rz[i]];
    const Rj_b = [rbx[j], botY[j], rbz[j]], Rj_t = [rx[j], topY[j], rz[j]];

    // Outer (left) face — faces +n
    pushQuad(Li_b, Li_t, Lj_t, Lj_b, [anx, 0, anz], col);
    // Inner (right) face — faces −n
    pushQuad(Ri_b, Rj_b, Rj_t, Ri_t, [-anx, 0, -anz], col);
    // Top face
    pushQuad(Li_t, Ri_t, Rj_t, Lj_t, [0, 1, 0], col);
  }

  // End caps for an open polyline. Winding is cosmetic — backFaceCulling is off.
  if (!closed) {
    const capCol = stripes[0];
    pushQuad(
      [lbx[0], botY[0], lbz[0]],
      [lx[0], topY[0], lz[0]],
      [rx[0], topY[0], rz[0]],
      [rbx[0], botY[0], rbz[0]],
      [-nz[0], 0, nx[0]],
      capCol,
    );
    const e = n - 1;
    pushQuad(
      [lbx[e], botY[e], lbz[e]],
      [lx[e], topY[e], lz[e]],
      [rx[e], topY[e], rz[e]],
      [rbx[e], botY[e], rbz[e]],
      [nz[e], 0, -nx[e]],
      capCol,
    );
  }

  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.colors = colors;
  vd.applyToMesh(mesh);

  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.diffuseColor = new Color3(1, 1, 1); // let vertex colours drive the surface
  mat.specularColor = new Color3(0.2, 0.2, 0.2);
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.useVertexColors = true;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  shadows?.addShadowCaster(mesh);

  return mesh;
}
