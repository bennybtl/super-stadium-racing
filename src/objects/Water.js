import { StandardMaterial, Color3, Mesh, VertexData, Texture } from "@babylonjs/core";
import {
  createTerrainSampler,
  groupIntoBodies,
  rasterizeBody,
  buildSurfaceGeometry,
  traceShorelines,
  decimateLoop,
  foamSide,
  isWaterFeature,
  foamWidths,
  foamTiling,
  FOAM_NOMINAL_WIDTH,
} from "./water-field.js";

/**
 * Water meshes: the Babylon half of the water build. All of the geometry
 * decisions — levels, grouping, the field and its shorelines — live in
 * water-field.js, which stays free of Babylon so it can be exercised directly.
 */

// ─── Meshes ────────────────────────────────────────────────────────────────

const _foamTextureModules = import.meta.glob('../assets/textures/water-swirl.texture.png', {
  eager: true, query: '?url', import: 'default',
});
const FOAM_TEXTURE_URL = Object.values(_foamTextureModules)[0];

// A tiny vertical bias so the foam sits just above the water plane without
// z-fighting. Band width is not a constant — see foamWidths in water-field.js.
const FOAM_Y_BIAS = 0.05;
// World size of one repeat of the swirl mask. The mask is mapped isotropically —
// `v` across the band uses the same world-units-per-UV as `u` along it — so the
// swirls stay round instead of smearing along a band whose width varies.
const FOAM_TEXTURE_TILE = 15;
// Dither: per-vertex the band width shrinks by up to this fraction and the
// shoreline opacity drops by up to FOAM_ALPHA_DITHER, breaking up the uniform
// gradient into a frothier edge.
const FOAM_WIDTH_DITHER = 0.7;
const FOAM_ALPHA_DITHER = 0.35;

// Surface shading. Real water hides its bottom by absorbing light over distance,
// so opacity follows 1 - e^(-depth/WATER_ABSORB) rather than sitting flat: the
// shallows go clear and the terrain stops banding through the deep.
const WATER_ABSORB = 1.2;
const WATER_ALPHA_SHALLOW = 0.10;
const WATER_ALPHA_DEEP = 0.55;
const WATER_TINT_SHALLOW = [0.30, 0.58, 0.88];
const WATER_TINT_DEEP = [0.05, 0.20, 0.68];

/** Deterministic 0..1 hash noise from a world position (per-vertex foam dither). */
function _foamNoise(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Per-vertex colour + alpha for the surface, from how deep the water is there. */
function depthShading(depths) {
  const colors = [];
  for (const d of depths) {
    const t = 1 - Math.exp(-Math.max(0, d) / WATER_ABSORB);
    colors.push(
      WATER_TINT_SHALLOW[0] + (WATER_TINT_DEEP[0] - WATER_TINT_SHALLOW[0]) * t,
      WATER_TINT_SHALLOW[1] + (WATER_TINT_DEEP[1] - WATER_TINT_SHALLOW[1]) * t,
      WATER_TINT_SHALLOW[2] + (WATER_TINT_DEEP[2] - WATER_TINT_SHALLOW[2]) * t,
      WATER_ALPHA_SHALLOW + (WATER_ALPHA_DEEP - WATER_ALPHA_SHALLOW) * t,
    );
  }
  return colors;
}

// Depth shading and the foam mask both live in the vertex stream and the
// texture, so every body's surface — and every foam ribbon — wants the exact
// same material. One of each per scene, built on first use and owned by the
// scene, instead of a fresh pair per body on every editor rebuild.
const _waterMaterials = new WeakMap();
const _foamMaterials = new WeakMap();

function getWaterMaterial(scene) {
  const cached = _waterMaterials.get(scene);
  if (cached) return cached;

  const mat = new StandardMaterial('waterSurfaceMat', scene);
  // Colour and opacity both come from the vertex stream, so the material stays
  // neutral and lets it through unchanged.
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.emissiveColor = new Color3(0.02, 0.08, 0.22);
  mat.specularColor = new Color3(0.8, 0.9, 1.0);
  mat.specularPower = 34;
  mat.backFaceCulling = false;
  _waterMaterials.set(scene, mat);
  return mat;
}

function getFoamMaterial(scene) {
  const cached = _foamMaterials.get(scene);
  if (cached) return cached;

  const mat = new StandardMaterial('waterFoamMat', scene);
  mat.disableLighting = true;            // flat stylised foam, lighting-independent
  mat.emissiveColor = new Color3(0.9, 0.95, 1.0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;

  // The swirl mask multiplies into the band's own gradient: the alpha channel
  // carries the froth, the vertex alpha carries shore-to-open-water falloff.
  if (FOAM_TEXTURE_URL) {
    const tex = new Texture(FOAM_TEXTURE_URL, scene);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    mat.opacityTexture = tex;
  }

  _foamMaterials.set(scene, mat);
  return mat;
}

/**
 * Build a foam ribbon along a shoreline: a band of quads from the waterline
 * toward open water, white-opaque at the edge fading to transparent, with inner
 * vertices offset along each vertex's edge bisector so the band stays continuous
 * at corners. `sgn` picks which side of the loop the band lies on, `widths` how
 * far in the band reaches at each vertex.
 */
function createWaterFoamRibbon(name, contour, y, sgn, widths, scene) {
  const n = contour.length;
  if (n < 3) return null;

  const edgeIn = new Array(n);
  for (let i = 0; i < n; i++) {
    const p1 = contour[i];
    const p2 = contour[(i + 1) % n];
    let dx = p2.x - p1.x, dz = p2.z - p1.z;
    const len = Math.hypot(dx, dz) || 1e-6;
    dx /= len; dz /= len;
    edgeIn[i] = { x: sgn * -dz, z: sgn * dx };
  }

  const inner = new Array(n);
  const noise = new Array(n);
  const bandWidth = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = edgeIn[(i - 1 + n) % n];
    const b = edgeIn[i];
    let bx = a.x + b.x, bz = a.z + b.z;
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-6) { bx = b.x; bz = b.z; } else { bx /= bl; bz /= bl; }
    const ns = _foamNoise(contour[i].x, contour[i].z);
    noise[i] = ns;
    const w = widths[i] * (1 - FOAM_WIDTH_DITHER * ns); // wavy inner edge
    bandWidth[i] = w;
    inner[i] = { x: contour[i].x + bx * w, z: contour[i].z + bz * w };
  }

  // Mask UVs: `u` runs the shoreline by arc length, `v` across the band at the
  // same world-to-UV scale so the swirls stay square as the band widens.
  const { edgeLen, uvScale } = foamTiling(contour, FOAM_TEXTURE_TILE);

  const fy = y + FOAM_Y_BIAS;
  const positions = [];
  const colors = [];
  const normals = [];
  const uvs = [];
  let travelled = 0;
  for (let i = 0; i < n; i++) {
    positions.push(contour[i].x, fy, contour[i].z); // outer (shoreline)
    positions.push(inner[i].x, fy, inner[i].z);     // inner (open water)
    const shoreAlpha = 1 - FOAM_ALPHA_DITHER * noise[i];
    colors.push(1, 1, 1, shoreAlpha); // ~opaque white at the shore
    colors.push(1, 1, 1, 0);          // transparent toward open water
    normals.push(0, 1, 0, 0, 1, 0);
    const u = travelled * uvScale;
    uvs.push(u, 0, u, bandWidth[i] * uvScale);
    travelled += edgeLen[i];
  }
  const indices = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(2 * i, 2 * j, 2 * j + 1, 2 * i, 2 * j + 1, 2 * i + 1);
  }

  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.colors = colors;
  vd.uvs = uvs;
  vd.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.useVertexColors = true;
  mesh.hasVertexAlpha = true;
  mesh.material = getFoamMaterial(scene);
  return mesh;
}

/**
 * Build every water body on the track: one surface mesh plus one foam ribbon per
 * shoreline. Meshes are named with the `water_` prefix, which is how the editor
 * finds and disposes them.
 *
 * @param {import('../track.js').Track} currentTrack
 * @param {BABYLON.Scene} scene
 */
export function buildWaterBodies(currentTrack, scene) {
  const features = (currentTrack.features ?? []).filter(isWaterFeature);
  if (features.length === 0) return;

  const sample = createTerrainSampler(currentTrack);
  const bodies = groupIntoBodies(currentTrack, features);

  bodies.forEach((body, index) => {
    const grid = rasterizeBody(body, sample);
    const { positions, indices, depths } = buildSurfaceGeometry(grid, body.level);
    if (indices.length === 0) return; // level sits below the basin floor

    const name = `water_body${index}`;
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    // The surface is a flat horizontal plane, so the normals are known — deriving
    // them from winding would only risk a uniformly flipped (unlit) surface.
    vd.normals = Array.from({ length: positions.length }, (_, i) => (i % 3 === 1 ? 1 : 0));
    vd.colors = depthShading(depths);
    vd.applyToMesh(mesh);
    mesh.isPickable = false;
    mesh.useVertexColors = true;
    mesh.hasVertexAlpha = true;
    mesh.material = getWaterMaterial(scene);

    traceShorelines(grid).forEach((raw, loopIndex) => {
      const loop = decimateLoop(raw, Math.max(grid.cell, FOAM_NOMINAL_WIDTH * 0.55));
      if (loop.length < 4) return;
      const sgn = foamSide(loop, grid);
      const widths = foamWidths(loop, grid, sgn);
      createWaterFoamRibbon(`${name}_foam${loopIndex}`, loop, body.level, sgn, widths, scene);
    });
  });
}
