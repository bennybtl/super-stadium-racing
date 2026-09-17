import {
  Mesh,
  MeshBuilder,
  VertexData,
  StandardMaterial,
  Texture,
  DynamicTexture,
  Color3,
  Vector3,
} from "@babylonjs/core";
import { TerrainQuery } from "../managers/TerrainQuery.js";
import { lerp } from "../utils/math-utils.js";
import chainlinkTextureUrl from "../assets/textures/chainlink.texture.png?url";

// Scuff marks (see paintWallScuffTexture): baked as an actual canvas texture —
// blurred, irregular dark blotches — rather than coloured geometry, since a
// rubbed/torn look needs real soft edges that vertex-shaded quads can't give
// at the ribbon's mesh resolution.
const SCUFF_COLOR = [0.10, 0.09, 0.09];
// Texture is one shared canvas per wall, split into two vertical halves — the
// bottom half [0, 0.5) holds the "inner (right)" face's marks, the top half
// [0.5, 1] the "outer (left)" face's — so one diffuseTexture covers both.
const SCUFF_TEX_HEIGHT = 256;
const SCUFF_TEX_PX_PER_UNIT = 24; // texel density along the wall's arc length
const SCUFF_TEX_MAX_WIDTH = 4096;
// Where within its half a face's blotches may land (fraction of that half),
// keeping clear of the seam between halves and the wall's buried base/top edge.
const SCUFF_BAND_MIN = 0.12;
const SCUFF_BAND_MAX = 0.85;
const SCUFF_BLUR_PX = 4;
const SCUFF_MAX_BLOBS_PER_SAMPLE = 5;

/** Cheap deterministic hash → [0,1), so the same (sample, blob) always paints the same way. */
function _hash01(n) {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}

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
  total = 1, // only meaningful for UV generation; unused shapes (e.g. PolyCurb) can omit it
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
  const positions = [], indices = [], normals = [], colors = [], uvs = [];
  const pushQuad = (p0, p1, p2, p3, nrm, col, uv0, uv1, uv2, uv3) => {
    const base = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    normals.push(...nrm, ...nrm, ...nrm, ...nrm);
    colors.push(
      col[0], col[1], col[2], 1,
      col[0], col[1], col[2], 1,
      col[0], col[1], col[2], 1,
      col[0], col[1], col[2], 1,
    );
    uvs.push(...uv0, ...uv1, ...uv2, ...uv3);
    // Wound so the front face is the side the quad's `nrm` points to (verts are
    // listed CCW around that normal). backFaceCulling then shows the outward
    // surfaces and hides the buried interior.
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  // U is a wall-length-relative arc-length fraction; V splits the texture into
  // two halves so one shared scuff texture (see paintWallScuffTexture) can
  // hold both side faces — clean rows (0 and the seam at 0.5) are used
  // wherever a quad isn't one of the two scuffable faces.
  const CLEAN = [0, 0];
  const rightV = [0, 0.5], leftV = [0.5, 1];

  const bandCount = closed ? n : n - 1;
  for (let i = 0; i < bandCount; i++) {
    const j = (i + 1) % n;
    // stripe colour from the band's mid arc-length
    const sMid = closed && i === n - 1 ? s[i] + step * 0.5 : (s[i] + s[j]) / 2;
    const col = stripes[Math.floor(sMid / stripeLen) % stripes.length];
    const uI = s[i] / total, uJ = s[j] / total;

    // averaged outward normal for the side faces of this band
    let anx = nx[i] + nx[j], anz = nz[i] + nz[j];
    const al = Math.hypot(anx, anz) || 1;
    anx /= al;
    anz /= al;

    const Li_b = [lbx[i], botY[i], lbz[i]], Li_t = [lx[i], topY[i], lz[i]];
    const Lj_b = [lbx[j], botY[j], lbz[j]], Lj_t = [lx[j], topY[j], lz[j]];
    const Ri_b = [rbx[i], botY[i], rbz[i]], Ri_t = [rx[i], topY[i], rz[i]];
    const Rj_b = [rbx[j], botY[j], rbz[j]], Rj_t = [rx[j], topY[j], rz[j]];

    // A closed box cross-section (top / inner / bottom / outer), every face wound
    // outward and consistently so the ribbon is a genuine single-sided solid —
    // it then casts one clean shadow silhouette at any light angle (the old open
    // double-sided shell dropped a second, offset shadow from its top edge).
    pushQuad(Li_t, Lj_t, Rj_t, Ri_t, [0, 1, 0], col, CLEAN, CLEAN, CLEAN, CLEAN); // top
    pushQuad(Ri_t, Rj_t, Rj_b, Ri_b, [-anx, 0, -anz], col,
      [uI, rightV[1]], [uJ, rightV[1]], [uJ, rightV[0]], [uI, rightV[0]]); // inner (right)
    pushQuad(Ri_b, Rj_b, Lj_b, Li_b, [0, -1, 0], col, CLEAN, CLEAN, CLEAN, CLEAN); // bottom (buried)
    pushQuad(Li_b, Lj_b, Lj_t, Li_t, [anx, 0, anz], col,
      [uI, leftV[0]], [uJ, leftV[0]], [uJ, leftV[1]], [uI, leftV[1]]); // outer (left)
  }

  // End caps for an open polyline — wound outward (away from the ribbon body) so
  // the closed solid stays single-sided all the way to its tips.
  if (!closed) {
    const capCol = stripes[0];
    // Start cap faces −tangent.
    pushQuad(
      [lbx[0], botY[0], lbz[0]],
      [lx[0], topY[0], lz[0]],
      [rx[0], topY[0], rz[0]],
      [rbx[0], botY[0], rbz[0]],
      [-nz[0], 0, nx[0]],
      capCol,
      CLEAN, CLEAN, CLEAN, CLEAN,
    );
    // End cap faces +tangent — reversed winding vs the start cap.
    const e = n - 1;
    pushQuad(
      [rbx[e], botY[e], rbz[e]],
      [rx[e], topY[e], rz[e]],
      [lx[e], topY[e], lz[e]],
      [lbx[e], botY[e], lbz[e]],
      [nz[e], 0, -nx[e]],
      capCol,
      CLEAN, CLEAN, CLEAN, CLEAN,
    );
  }

  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.colors = colors;
  vd.uvs = uvs;
  vd.applyToMesh(mesh);

  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.diffuseColor = new Color3(1, 1, 1); // let vertex colours drive the surface
  mat.specularColor = new Color3(0.2, 0.2, 0.2);
  // The ribbon is now a closed, outward-wound solid — cull back faces so it
  // casts one clean shadow (a double-sided caster drops a second, offset one).
  mat.backFaceCulling = true;
  mesh.material = mat;
  mesh.useVertexColors = true;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  shadows?.addShadowCaster(mesh);

  return mesh;
}

function _scuffTexWidth(total) {
  return Math.min(SCUFF_TEX_MAX_WIDTH, Math.max(64, Math.round(total * SCUFF_TEX_PX_PER_UNIT)));
}

/** A blank (all-white) scuff canvas sized for this wall's length. */
function _createBlankScuffTexture(scene, name, total) {
  const texWidth = _scuffTexWidth(total);
  const tex = new DynamicTexture(`${name}Scuff`, { width: texWidth, height: SCUFF_TEX_HEIGHT }, scene, false);
  const ctx = tex.getContext();
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, texWidth, SCUFF_TEX_HEIGHT);
  tex.update(false);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

/** One irregular scuff blotch cluster at canvas x=`cx`, confined to [vMin,vMax] (fraction of texture height). */
function _paintScuffBlob(ctx, cx, vMin, vMax, intensity, seed, texHeight) {
  const blobCount = 1 + Math.round(intensity * (SCUFF_MAX_BLOBS_PER_SAMPLE - 1));
  for (let b = 0; b < blobCount; b++) {
    const r1 = _hash01(seed + b * 78.233);
    const r2 = _hash01(seed + b * 11.13 + 51);
    const r3 = _hash01(seed + b * 3.71 + 173);
    const cy = lerp(vMin, vMax, r1) * texHeight;
    const rx = lerp(6, 22, r2) * (0.5 + intensity * 0.5);
    ctx.globalAlpha = intensity * lerp(0.35, 0.9, r3);
    ctx.beginPath();
    ctx.ellipse(cx + (r2 - 0.5) * 14, cy, rx, rx * 0.4, (r3 - 0.5) * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** This side's blob band, as [vMin,vMax] fractions of the whole texture height (see buildStripedRibbon's UVs). */
function _scuffSideBand(side) {
  return side >= 0
    ? [0.5 + SCUFF_BAND_MIN * 0.5, 0.5 + SCUFF_BAND_MAX * 0.5] // left face
    : [SCUFF_BAND_MIN * 0.5, SCUFF_BAND_MAX * 0.5];             // right face
}

/**
 * Bake the wall's scuff-mark texture: one canvas, split into two vertical
 * halves — [0, 0.5) for the "inner (right)" face, [0.5, 1] for "outer (left)"
 * (see buildStripedRibbon's UVs) — each painted with soft, irregular dark
 * blotches wherever that side's per-sample intensity (from PolyWall's AI-path
 * slide-projection, see `scuffLeft`/`scuffRight`) is nonzero. A canvas blur
 * pass gives the torn, feathered edges vertex colours can't reproduce at the
 * ribbon's mesh resolution. Returns null when nothing on the wall is scuffed,
 * so the caller can skip touching the material at all.
 */
export function paintWallScuffTexture(scene, name, { total, s, scuffLeft, scuffRight }) {
  const n = s.length;
  const hasAny = (arr) => Array.isArray(arr) && arr.some((v) => v > 0);
  if (!hasAny(scuffLeft) && !hasAny(scuffRight)) return null;

  const tex = _createBlankScuffTexture(scene, name, total);
  const ctx = tex.getContext();
  const texWidth = tex.getSize().width;
  const rgb = SCUFF_COLOR.map((c) => Math.round(c * 255));
  ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  ctx.filter = `blur(${SCUFF_BLUR_PX}px)`;

  // `seedBase` keeps the two faces' pseudo-random blob placement distinct.
  const paintSide = (arr, side, seedBase) => {
    if (!arr) return;
    const [vMin, vMax] = _scuffSideBand(side);
    for (let i = 0; i < n; i++) {
      const intensity = arr[i];
      if (intensity <= 0) continue;
      const cx = (s[i] / total) * texWidth;
      _paintScuffBlob(ctx, cx, vMin, vMax, intensity, seedBase + i * 12.9898, SCUFF_TEX_HEIGHT);
    }
  };
  paintSide(scuffRight, -1, 0);
  paintSide(scuffLeft, 1, 1000);

  ctx.filter = "none";
  ctx.globalAlpha = 1;
  tex.update(false);
  return tex;
}

/**
 * Lazily-created blank scuff texture for a wall that had no deterministic
 * baseline scuff (paintWallScuffTexture returned null) but is now taking its
 * first live hit.
 */
export function createBlankWallScuffTexture(scene, name, total) {
  return _createBlankScuffTexture(scene, name, total);
}

/**
 * Paint one batch of live scuff hits directly onto an existing wall scuff
 * texture — additive, no clearing — then upload once for the whole batch.
 * `hits`: [{ s (arc length), side, intensity, seed }].
 */
export function addWallScuffHits(tex, { total, hits }) {
  if (!tex || !hits?.length) return;
  const ctx = tex.getContext();
  const { width: texWidth, height: texHeight } = tex.getSize();
  const rgb = SCUFF_COLOR.map((c) => Math.round(c * 255));
  ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  ctx.filter = `blur(${SCUFF_BLUR_PX}px)`;
  for (const { s: sPos, side, intensity, seed } of hits) {
    const cx = (sPos / total) * texWidth;
    const [vMin, vMax] = _scuffSideBand(side);
    _paintScuffBlob(ctx, cx, vMin, vMax, intensity, seed, texHeight);
  }
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  tex.update(false);
}

// ── Chain-link fence ────────────────────────────────────────────────────────
// A rail + posts + alpha-cut chain-link strip standing on top of a sampled
// polyline. Shared by PolyWall (fence above a wall) and BleachersStand (safety
// rail around a grandstand). The caller supplies the sampled centerline
// (xs/zs/s/nx/nz + a per-sample base height `smooth`) and the vertical span
// bottom→top the fabric fills; everything is built in whatever frame those
// coordinates are in, so a caller working in a local frame can parent the
// returned meshes into place.
const FENCE_POST_SPACING = 4;      // world units between posts down a straight run
const FENCE_POST_CORNER_ANGLE = 10; // turn (deg) at a sample that counts as a bend
const FENCE_TUBE_RADIUS = 0.07;    // rail and post radius (world units)
const FENCE_TUBE_SIDES = 6;        // tube tessellation — hexagons read as round here
const FENCE_MIN_HEIGHT = 0.3;      // below this there is nothing worth drawing
const FENCE_POST_EMBED = 0.15;     // how far posts sink into the surface below
const FENCE_COLOR = new Color3(0.60, 0.62, 0.65);
const FENCE_MESH_TILE = 2;         // world units per chain-link texture repeat

/**
 * Metal tubing standing on a sampled polyline: a rail following the profile,
 * carried by posts at regular intervals, backed by a chain-link strip spanning
 * `bottom`→`top` above each sample's `smooth` height. Straight runs skip every
 * other post; bends get one per sample. Open paths always get an end post.
 *
 * Purely visual — the caller owns whatever collision stops a body here.
 *
 * @returns {Mesh[]} `[tubing, fabric]` (or just `[tubing]` when the span is a
 *   sliver), empty when there is no gap worth drawing.
 */
export function buildChainlinkFence({
  xs, zs, s, step, total, nx, nz, smooth, closed, scene, bottom, top,
}) {
  const fenceHeight = top - bottom;
  if (fenceHeight < FENCE_MIN_HEIGHT) return [];

  const n = xs.length;
  const parts = [];

  // Top rail — centred a radius below `top` so the tube's crown, not its axis,
  // lands on that height.
  const railY = (i) => smooth[i] + top - FENCE_TUBE_RADIUS;
  const path = [];
  for (let i = 0; i < n; i++) path.push(new Vector3(xs[i], railY(i), zs[i]));
  if (closed) path.push(path[0].clone());
  parts.push(MeshBuilder.CreateTube("fenceRail", {
    path,
    radius: FENCE_TUBE_RADIUS,
    tessellation: FENCE_TUBE_SIDES,
    cap: closed ? Mesh.NO_CAP : Mesh.CAP_ALL,
  }, scene));

  const postAt = (i) => {
    const baseY = smooth[i] + bottom - FENCE_POST_EMBED;
    const height = smooth[i] + top - baseY;
    const post = MeshBuilder.CreateCylinder("fencePost", {
      height,
      diameter: FENCE_TUBE_RADIUS * 2,
      tessellation: FENCE_TUBE_SIDES,
    }, scene);
    post.position.set(xs[i], baseY + height / 2, zs[i]);
    parts.push(post);
  };

  // Turn between the segments meeting at sample `i`, in radians.
  const turnAt = (i) => {
    const prev = closed ? (i - 1 + n) % n : i - 1;
    const next = closed ? (i + 1) % n : i + 1;
    if (prev < 0 || next >= n) return 0; // open ends have only one segment
    const ax = xs[i] - xs[prev], az = zs[i] - zs[prev];
    const bx = xs[next] - xs[i], bz = zs[next] - zs[i];
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 1e-6 || lb < 1e-6) return 0;
    const cos = (ax * bx + az * bz) / (la * lb);
    return Math.acos(Math.min(1, Math.max(-1, cos)));
  };

  const cornerAngle = (FENCE_POST_CORNER_ANGLE * Math.PI) / 180;
  let lastPost = -1;
  let lastPostS = -Infinity;
  for (let i = 0; i < n; i++) {
    // Straight enough to skip every other sample; a bend gets one per sample.
    const spacing = turnAt(i) < cornerAngle
      ? FENCE_POST_SPACING * 2
      : FENCE_POST_SPACING;
    // Samples are quantised to `step`, so allow the nearest one rather than
    // overshooting a whole sample past every target distance.
    if (s[i] - lastPostS < spacing - step * 0.5) continue;
    postAt(i);
    lastPost = i;
    lastPostS = s[i];
  }
  // Open paths always get an end post, so the rail never trails off unsupported.
  if (!closed && lastPost !== n - 1) postAt(n - 1);

  const tubing = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!tubing) return [];
  tubing.name = "fenceTubing";

  const mat = new StandardMaterial("fenceMat", scene);
  mat.diffuseColor = FENCE_COLOR;
  mat.specularColor = new Color3(0.35, 0.35, 0.35);
  mat.specularPower = 48;
  tubing.material = mat;
  tubing.isPickable = false;
  tubing.receiveShadows = true;

  const fabric = _buildChainlinkFabric({
    xs, zs, s, total, nx, nz, smooth, closed, scene,
    bottom,
    top: top - FENCE_TUBE_RADIUS, // hangs from the rail's axis
  });

  return fabric ? [tubing, fabric] : [tubing];
}

/**
 * The chain-link fabric itself: a quad strip on the centerline spanning
 * `bottom`→`top`, textured with an alpha-cut chain-link tile.
 *
 * Alpha *testing* rather than blending — the mesh is mostly holes, and a cutout
 * keeps it writing depth so overlapping runs (and the tubing in front) sort
 * correctly without a transparency pass. UVs run off arc length, so the weave
 * keeps a constant world scale around corners and the diamonds stay square
 * whatever the height.
 */
function _buildChainlinkFabric({
  xs, zs, s, total, nx, nz, smooth, closed, scene, bottom, top,
}) {
  const n = xs.length;
  const height = top - bottom;
  if (n < 2 || height <= 0) return null;

  // Closed loops repeat the first sample so the seam band has somewhere to
  // interpolate its U to, rather than wrapping back to zero.
  const count = closed ? n + 1 : n;
  const positions = [], normals = [], uvs = [], indices = [];
  // A closed loop stretches the tile just enough to fit a whole number of
  // repeats around the perimeter, so the weave meets itself at the seam instead
  // of being cut mid-diamond.
  const tile = closed
    ? total / Math.max(1, Math.round(total / FENCE_MESH_TILE))
    : FENCE_MESH_TILE;
  const vTop = height / tile;

  for (let k = 0; k < count; k++) {
    const i = k % n;
    const u = (k < n ? s[i] : total) / tile;
    positions.push(xs[i], smooth[i] + bottom, zs[i]);
    positions.push(xs[i], smooth[i] + top, zs[i]);
    normals.push(nx[i], 0, nz[i], nx[i], 0, nz[i]);
    uvs.push(u, 0, u, vTop);
  }

  for (let k = 0; k < count - 1; k++) {
    const b = k * 2;
    indices.push(b, b + 1, b + 3, b, b + 3, b + 2);
  }

  const mesh = new Mesh("fenceMesh", scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.applyToMesh(mesh);

  const texture = new Texture(chainlinkTextureUrl, scene);
  texture.hasAlpha = true;
  texture.anisotropicFilteringLevel = 4;

  const mat = new StandardMaterial("fenceMeshMat", scene);
  mat.diffuseTexture = texture;
  mat.diffuseColor = FENCE_COLOR;
  mat.specularColor = new Color3(0.25, 0.25, 0.25);
  mat.specularPower = 48;
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true; // the strip is seen from both sides
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  return mesh;
}
