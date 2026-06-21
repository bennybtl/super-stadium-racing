import { StandardMaterial, Color3, Mesh, VertexData } from "@babylonjs/core";

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

/** Build a flat, double-sided water surface mesh from an XZ contour. */
function buildWaterMesh(name, contour, y, materialAnchor, scene) {
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

/** Four corners of a (width × depth) rectangle rotated by angleRad. */
function rectContour(centerX, centerZ, width, depth, angleRad) {
  const hw = width / 2, hd = depth / 2;
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
  return [
    { x: -hw, z: -hd }, { x: hw, z: -hd }, { x: hw, z: hd }, { x: -hw, z: hd },
  ].map(({ x, z }) => ({ x: centerX + x * cos + z * sin, z: centerZ - x * sin + z * cos }));
}

function createRoundHillWater(feature, scene, baseCy) {
  const { radiusX, radiusZ, angleRad } = getHillEllipse(feature);
  const contour = ellipseContour(feature.centerX, feature.centerZ, radiusX, radiusZ, angleRad);
  const y = baseCy + getWaterLevelOffset(feature);
  return buildWaterMesh(`water_${feature.centerX}_${feature.centerZ}`, contour, y, feature, scene);
}

function createSquareHillWater(feature, scene, baseCy) {
  const depth = feature.depth ?? feature.width;
  const angleRad = -((feature.angle ?? 0) * Math.PI) / 180;
  const contour = rectContour(
    feature.centerX, feature.centerZ,
    feature.width + feature.transition * 1.2,
    depth + feature.transition * 1.2,
    angleRad
  );
  const y = baseCy + getWaterLevelOffset(feature);
  return buildWaterMesh(`water_${feature.centerX}_${feature.centerZ}`, contour, y, feature, scene);
}

function createPolyHillWater(feature, scene, baseCy, centroid) {
  const y = baseCy + getWaterLevelOffset(feature);
  return buildWaterMesh(
    `water_${centroid.x}_${centroid.z}`,
    feature.points,
    y,
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
    return createPolyHillWater(feature, scene, baseCy, centroid);
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
    ? createRoundHillWater(feature, scene, baseCy)
    : createSquareHillWater(feature, scene, baseCy);
}