import { StandardMaterial, Color3, Mesh, VertexData } from "@babylonjs/core";
import { expandPolyline } from "../polyline-utils.js";

function getHillEllipse(feature) {
  return {
    radiusX: feature.radiusX ?? 10,
    radiusZ: feature.radiusZ ?? 10,
    angleRad: -((feature.angle ?? 0) * Math.PI) / 180,
  };
}

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

function getPolyHillCentroid(feature) {
  const pts = feature.points ?? [];
  if (pts.length === 0) return { x: feature.centerX ?? 0, z: feature.centerZ ?? 0 };
  let sx = 0;
  let sz = 0;
  for (const p of pts) { sx += p.x; sz += p.z; }
  return { x: sx / pts.length, z: sz / pts.length };
}

function getWaterLevelOffset(feature) {
  const desired = typeof feature.waterLevelOffset === 'number'
    ? feature.waterLevelOffset
    : (feature.type === 'squareHill' ? 1 : 2);
  return Math.min(desired, getCenterDepthLimit(feature));
}

function applyWaterMaterial(mesh, feature, scene) {
  const waterMat = new StandardMaterial(`waterMat_${feature.centerX}_${feature.centerZ}`, scene);
  waterMat.diffuseColor = new Color3(0.08, 0.28, 0.82);
  waterMat.emissiveColor = new Color3(0.02, 0.08, 0.22);
  waterMat.specularColor = new Color3(0.8, 0.9, 1.0);
  waterMat.specularPower = 34;
  waterMat.alpha = 0.4;
  waterMat.backFaceCulling = false;
  mesh.material = waterMat;
}

// ─── Polygon triangulation (ear clipping) ──────────────────────────────────
// Earcut isn't bundled, so we triangulate flat XZ polygons ourselves. Handles
// arbitrary simple polygons including concave ones (the FlipCode "snip" method).

function _polygonSignedArea(pts) {
  let a = 0;
  for (let p = pts.length - 1, q = 0; q < pts.length; p = q++) {
    a += pts[p].x * pts[q].z - pts[q].x * pts[p].z;
  }
  return a * 0.5;
}

function _pointInTriangle(ax, az, bx, bz, cx, cz, px, pz) {
  // Barycentric sign test (consistent winding required).
  const ux = cx - bx, uz = cz - bz;
  const vx = ax - cx, vz = az - cz;
  const wx = bx - ax, wz = bz - az;
  const apx = px - ax, apz = pz - az;
  const bpx = px - bx, bpz = pz - bz;
  const cpx = px - cx, cpz = pz - cz;
  const aCROSSbp = ux * bpz - uz * bpx;
  const cCROSSap = wx * apz - wz * apx;
  const bCROSScp = vx * cpz - vz * cpx;
  return aCROSSbp >= 0 && bCROSScp >= 0 && cCROSSap >= 0;
}

/**
 * Ear-clip a simple polygon of {x,z} points into triangle index triples
 * (indices into the input array). Concave-safe; returns [] on failure.
 */
function triangulatePolygon(contour) {
  const n = contour.length;
  if (n < 3) return [];

  // Work on an index list, forced counter-clockwise.
  const V = new Array(n);
  if (_polygonSignedArea(contour) > 0) {
    for (let i = 0; i < n; i++) V[i] = i;
  } else {
    for (let i = 0; i < n; i++) V[i] = (n - 1) - i;
  }

  const result = [];
  let nv = n;
  let count = 2 * nv; // guard against a degenerate polygon looping forever
  for (let v = nv - 1; nv > 2; ) {
    if (count-- <= 0) return result; // bad polygon — return what we have

    let u = v; if (nv <= u) u = 0;
    v = u + 1; if (nv <= v) v = 0;
    let w = v + 1; if (nv <= w) w = 0;

    const ax = contour[V[u]].x, az = contour[V[u]].z;
    const bx = contour[V[v]].x, bz = contour[V[v]].z;
    const cx = contour[V[w]].x, cz = contour[V[w]].z;

    // Convex corner? (CCW polygon → positive cross product)
    if (((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) >= 1e-10) {
      let isEar = true;
      for (let p = 0; p < nv; p++) {
        if (p === u || p === v || p === w) continue;
        if (_pointInTriangle(ax, az, bx, bz, cx, cz, contour[V[p]].x, contour[V[p]].z)) {
          isEar = false;
          break;
        }
      }
      if (isEar) {
        result.push(V[u], V[v], V[w]);
        for (let s = v, t = v + 1; t < nv; s++, t++) V[s] = V[t]; // clip ear
        nv--;
        count = 2 * nv;
      }
    }
  }
  return result;
}

// How far the foam band reaches in from the shoreline (world units), and a tiny
// vertical bias so it sits just above the water plane without z-fighting.
const FOAM_WIDTH = 1.6;
const FOAM_Y_BIAS = 0.05;
// Dither: per-vertex the band width shrinks by up to this fraction and the
// shoreline opacity drops by up to FOAM_ALPHA_DITHER, breaking up the uniform
// gradient into a frothier edge.
const FOAM_WIDTH_DITHER = 0.6;
const FOAM_ALPHA_DITHER = 0.35;

/** Deterministic 0..1 hash noise from a world position (per-vertex foam dither). */
function _foamNoise(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Build a foam ribbon hugging the inside of a water contour: a band of quads
 * from the shoreline inward, white-opaque at the edge fading to transparent at
 * the inner edge via per-vertex alpha. Inner vertices are offset along each
 * vertex's edge bisector so the band is continuous (no gaps at corners) and
 * concave-safe.
 */
function createWaterFoamRibbon(name, contour, y, scene) {
  const n = contour.length;
  if (n < 3) return null;

  // Inward direction depends on the contour winding.
  const sgn = _polygonSignedArea(contour) > 0 ? 1 : -1;

  // Per-edge inward normals.
  const edgeIn = new Array(n);
  for (let i = 0; i < n; i++) {
    const p1 = contour[i], p2 = contour[(i + 1) % n];
    let dx = p2.x - p1.x, dz = p2.z - p1.z;
    const len = Math.hypot(dx, dz) || 1e-6;
    dx /= len; dz /= len;
    edgeIn[i] = { x: sgn * -dz, z: sgn * dx };
  }

  // Inner ring: offset each vertex inward along the bisector of its two edges so
  // adjacent foam quads share the inner vertex (continuous band). The offset and
  // shoreline alpha are dithered per vertex so the band isn't a uniform ring.
  const inner = new Array(n);
  const noise = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = edgeIn[(i - 1 + n) % n], b = edgeIn[i];
    let bx = a.x + b.x, bz = a.z + b.z;
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-6) { bx = b.x; bz = b.z; } else { bx /= bl; bz /= bl; }
    const ns = _foamNoise(contour[i].x, contour[i].z);
    noise[i] = ns;
    const w = FOAM_WIDTH * (1 - FOAM_WIDTH_DITHER * ns); // wavy inner edge
    inner[i] = { x: contour[i].x + bx * w, z: contour[i].z + bz * w };
  }

  const fy = y + FOAM_Y_BIAS;
  const positions = [];
  const colors = [];
  const normals = [];
  for (let i = 0; i < n; i++) {
    positions.push(contour[i].x, fy, contour[i].z); // outer (shoreline)
    positions.push(inner[i].x, fy, inner[i].z);     // inner (open water)
    const shoreAlpha = 1 - FOAM_ALPHA_DITHER * noise[i]; // broken-up shoreline
    colors.push(1, 1, 1, shoreAlpha); // ~opaque white at the shore
    colors.push(1, 1, 1, 0);          // transparent toward open water
    normals.push(0, 1, 0, 0, 1, 0);
  }
  const indices = [];
  for (let i = 0; i < n; i++) {
    const o0 = 2 * i, in0 = 2 * i + 1;
    const j = (i + 1) % n;
    const o1 = 2 * j, in1 = 2 * j + 1;
    indices.push(o0, o1, in1, o0, in1, in0);
  }

  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.colors = colors;
  vd.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.useVertexColors = true;
  mesh.hasVertexAlpha = true;

  const foamMat = new StandardMaterial(`${name}Mat`, scene);
  foamMat.disableLighting = true;            // flat stylised foam, lighting-independent
  foamMat.emissiveColor = new Color3(0.9, 0.95, 1.0);
  foamMat.diffuseColor = new Color3(0.6, 0.6, 1);
  foamMat.specularColor = new Color3(0, 0, 0);
  foamMat.backFaceCulling = false;
  mesh.material = foamMat;
  return mesh;
}

/**
 * Move each contour point inward to the actual waterline — the distance from
 * `center` along its ray where the terrain rises to meet the water surface
 * (`waterY`). Clamped to the original extent so it only ever pulls inward: this
 * keeps the foam on the *visible* pool when shallow water sits in a deep bowl
 * (otherwise the foam is buried in the sloped walls), without growing past the
 * footprint for flat-floored holes. Assumes terrain rises monotonically from the
 * (deepest) centre outward, which holds for these depressions.
 */
function clipContourToWaterline(contour, center, waterY, heightAt) {
  return contour.map((p) => {
    const dx = p.x - center.x, dz = p.z - center.z;
    const rayLen = Math.hypot(dx, dz);
    if (rayLen < 1e-6) return { x: p.x, z: p.z };
    const ux = dx / rayLen, uz = dz / rayLen;

    // No crossing out to the rim → water reaches the edge; keep full extent.
    if (heightAt(p.x, p.z) < waterY) return { x: p.x, z: p.z };

    // Binary-search the first distance where terrain meets the water surface.
    let lo = 0, hi = rayLen;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) * 0.5;
      if (heightAt(center.x + ux * mid, center.z + uz * mid) >= waterY) hi = mid;
      else lo = mid;
    }
    const d = (lo + hi) * 0.5;
    return { x: center.x + ux * d, z: center.z + uz * d };
  });
}

/** Build a flat, double-sided water surface mesh (+ foam edge) from an XZ contour. */
function buildWaterMesh(name, contour, y, center, heightAt, materialAnchor, scene) {
  const indices = triangulatePolygon(contour);
  if (indices.length === 0) return null;

  const positions = [];
  for (const p of contour) positions.push(p.x, y, p.z);
  const normals = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.applyToMesh(mesh);
  mesh.isPickable = false;
  applyWaterMaterial(mesh, materialAnchor, scene);

  // Foam follows the actual waterline (clamped to the footprint), not the full
  // rim, so it isn't buried when shallow water sits in a deep hole. Named with
  // the same `water_` prefix so the editor's rebuild disposes it with the surface.
  const foamContour = (center && heightAt)
    ? clipContourToWaterline(contour, center, y, heightAt)
    : contour;
  createWaterFoamRibbon(`${name}_foam`, foamContour, y, scene);
  return mesh;
}

/** Sample an ellipse (radiusX × radiusZ, rotated by angleRad) into a contour. */
function ellipseContour(centerX, centerZ, radiusX, radiusZ, angleRad, segments = 48) {
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const lx = Math.cos(t) * radiusX;
    const lz = Math.sin(t) * radiusZ;
    // Rotate about Y (Babylon rotation.y convention) and offset to centre.
    pts.push({ x: centerX + lx * cos + lz * sin, z: centerZ - lx * sin + lz * cos });
  }
  return pts;
}

/**
 * Perimeter of a (width × depth) rectangle rotated by angleRad, with each edge
 * subdivided so the waterline clip can trace the bulge along the edges (4 corner
 * points alone leave the foam cutting inside the waterline at the edge midpoints).
 */
function rectContour(centerX, centerZ, width, depth, angleRad) {
  const hw = width / 2, hd = depth / 2;
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
  const corners = [
    { x: -hw, z: -hd }, { x: hw, z: -hd }, { x: hw, z: hd }, { x: -hw, z: hd },
  ];
  const SEG_LEN = 2; // one point at least every ~2 world units along the edge
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    const segs = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / SEG_LEN));
    for (let s = 0; s < segs; s++) {
      const t = s / segs; // include the start, drop the end (next edge's start)
      const lx = a.x + (b.x - a.x) * t;
      const lz = a.z + (b.z - a.z) * t;
      pts.push({ x: centerX + lx * cos + lz * sin, z: centerZ - lx * sin + lz * cos });
    }
  }
  return pts;
}

function createRoundHillWater(feature, scene, baseCy, currentTrack) {
  const { radiusX, radiusZ, angleRad } = getHillEllipse(feature);
  const contour = ellipseContour(feature.centerX, feature.centerZ, radiusX, radiusZ, angleRad);
  const y = baseCy + getWaterLevelOffset(feature);
  const center = { x: feature.centerX, z: feature.centerZ };
  const heightAt = (x, z) => currentTrack.getHeightAt(x, z);
  return buildWaterMesh(`water_${feature.centerX}_${feature.centerZ}`, contour, y, center, heightAt, feature, scene);
}

function createSquareHillWater(feature, scene, baseCy, currentTrack) {
  const depth = feature.depth ?? feature.width;
  const angleRad = -((feature.angle ?? 0) * Math.PI) / 180;
  const contour = rectContour(
    feature.centerX, feature.centerZ,
    feature.width + feature.transition * 1.2,
    depth + feature.transition * 1.2,
    angleRad
  );
  const y = baseCy + getWaterLevelOffset(feature);
  const center = { x: feature.centerX, z: feature.centerZ };
  const heightAt = (x, z) => currentTrack.getHeightAt(x, z);
  return buildWaterMesh(`water_${feature.centerX}_${feature.centerZ}`, contour, y, center, heightAt, feature, scene);
}

function createPolyHillWater(feature, scene, baseCy, centroid, currentTrack) {
  const y = baseCy + getWaterLevelOffset(feature);
  const heightAt = (x, z) => currentTrack.getHeightAt(x, z);
  // Use the same corner-rounded contour the terrain uses (per-point `radius`),
  // so the water/foam follow the rounded corners instead of hard points.
  const contour = expandPolyline(feature.points, feature.closed ?? true);
  return buildWaterMesh(
    `water_${centroid.x}_${centroid.z}`,
    contour,
    y,
    centroid,
    heightAt,
    { centerX: centroid.x, centerZ: centroid.z },
    scene
  );
}

/**
 * Create the hill visuals for hill, squareHill, and polyHill features.
 * Water is only added when the hill is negative (a depression) and the terrain
 * type is water. PolyHills additionally must be a closed, filled loop.
 *
 * @param {object} feature
 * @param {import('../track.js').Track} currentTrack
 * @param {BABYLON.Scene} scene
 * @returns {BABYLON.Mesh|null}
 */
export function createHill(feature, currentTrack, scene) {
  if (feature.type === 'polyHill') {
    if (!feature.closed || !feature.filled) return null;
    if (!((feature.height ?? 0) < 0)) return null;
    if (!Array.isArray(feature.points) || feature.points.length < 3) return null;

    const centroid = getPolyHillCentroid(feature);
    const terrainType = currentTrack.getTerrainTypeAt(centroid.x, centroid.z);
    if (!(terrainType === 'water' || terrainType?.name === 'water')) return null;

    const baseCy = currentTrack.getHeightAt(centroid.x, centroid.z);
    return createPolyHillWater(feature, scene, baseCy, centroid, currentTrack);
  }

  if (feature.type !== 'hill' && feature.type !== 'squareHill') return null;

  const isNegativeHill = feature.type === 'hill' && feature.height < 0;
  const isNegativeSquareHill = feature.type === 'squareHill' && (
    feature.height < 0 ||
    (feature.heightAtMin !== undefined && feature.heightAtMin < 0 && feature.heightAtMax < 0)
  );
  if (!isNegativeHill && !isNegativeSquareHill) return null;

  const terrainType = currentTrack.getTerrainTypeAt(feature.centerX, feature.centerZ);
  if (!(terrainType === 'water' || terrainType?.name === 'water')) return null;

  const baseCy = currentTrack.getHeightAt(feature.centerX, feature.centerZ);
  return feature.type === 'hill'
    ? createRoundHillWater(feature, scene, baseCy, currentTrack)
    : createSquareHillWater(feature, scene, baseCy, currentTrack);
}