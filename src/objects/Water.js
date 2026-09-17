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
  isMudFeature,
  foamWidths,
  foamTiling,
  FOAM_NOMINAL_WIDTH,
} from "./water-field.js";
import { attachWaterSurfacePlugin, attachWaterFoamPlugin } from "../shaders/water-shader.js";

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
// so opacity follows 1 - e^(-depth/absorb) rather than sitting flat: the
// shallows go clear and the terrain stops banding through the deep.
//
// Mud pools reuse every line of this pipeline — same absorption curve, same
// foam ribbon — just against a murkier, more opaque palette: silty water reads
// as opaque within centimetres rather than the half-metre or so real water
// takes, and its foam is dirt-brown rather than white froth.
const LIQUID_STYLES = {
  water: {
    absorb: 1.2,
    alphaShallow: 0.10,
    alphaDeep: 0.55,
    tintShallow: [0.30, 0.58, 0.88],
    tintDeep: [0.05, 0.20, 0.68],
    emissive: [0.02, 0.08, 0.22],
    specular: [0.8, 0.9, 1.0],
    specularPower: 34,
    foamEmissive: [0.9, 0.95, 1.0],
  },
  mud: {
    absorb: 0.35,
    alphaShallow: 0.75,
    alphaDeep: 0.96,
    tintShallow: [0.20, 0.13, 0.07],
    tintDeep: [0.07, 0.045, 0.025],
    emissive: [0.025, 0.015, 0.008],
    specular: [0.35, 0.28, 0.18],
    specularPower: 10,
    // Left unchanged at the user's request — the shore foam should read
    // lighter than the darker, more opaque body above.
    foamEmissive: [0.55, 0.42, 0.27],
  },
};

/** Deterministic 0..1 hash noise from a world position (per-vertex foam dither). */
function _foamNoise(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Per-vertex colour + alpha for the surface, from how deep the liquid is there. */
function depthShading(depths, kind) {
  const style = LIQUID_STYLES[kind];
  const colors = [];
  for (const d of depths) {
    const t = 1 - Math.exp(-Math.max(0, d) / style.absorb);
    colors.push(
      style.tintShallow[0] + (style.tintDeep[0] - style.tintShallow[0]) * t,
      style.tintShallow[1] + (style.tintDeep[1] - style.tintShallow[1]) * t,
      style.tintShallow[2] + (style.tintDeep[2] - style.tintShallow[2]) * t,
      style.alphaShallow + (style.alphaDeep - style.alphaShallow) * t,
    );
  }
  return colors;
}

// Depth shading and the foam mask both live in the vertex stream and the
// texture, so every body of a given kind wants the exact same material. One
// pair per kind per scene, built on first use and owned by the scene, instead
// of a fresh pair per body on every editor rebuild.
const _waterMaterials = new WeakMap();
const _foamMaterials = new WeakMap();

function getWaterMaterial(scene, kind) {
  let byKind = _waterMaterials.get(scene);
  if (!byKind) { byKind = {}; _waterMaterials.set(scene, byKind); }
  if (byKind[kind]) return byKind[kind];

  const style = LIQUID_STYLES[kind];
  const mat = new StandardMaterial(`${kind}SurfaceMat`, scene);
  // Colour and opacity both come from the vertex stream, so the material stays
  // neutral and lets it through unchanged.
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.emissiveColor = new Color3(...style.emissive);
  mat.specularColor = new Color3(...style.specular);
  mat.specularPower = style.specularPower;
  mat.backFaceCulling = false;
  // Surface animation (see WATER_REACTIVE.md). Attaches once per scene with the
  // material, so every body of this kind shares one compiled effect.
  attachWaterSurfacePlugin(mat);
  byKind[kind] = mat;
  return mat;
}

const _foamTextures = new WeakMap();

/**
 * The shoreline swirl mask, one per scene. Exported because the wake ribbon
 * (WakeRibbon.js) wants the same froth so the two read as one material.
 * Callers must not mutate its offsets — it is shared; clone it if you need your
 * own scroll.
 *
 * @param {BABYLON.Scene} scene
 * @returns {import('@babylonjs/core').Texture|null}
 */
export function getSharedFoamTexture(scene) {
  if (!FOAM_TEXTURE_URL) return null;
  const cached = _foamTextures.get(scene);
  if (cached) return cached;

  const tex = new Texture(FOAM_TEXTURE_URL, scene);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  _foamTextures.set(scene, tex);
  return tex;
}

function getFoamMaterial(scene, kind) {
  let byKind = _foamMaterials.get(scene);
  if (!byKind) { byKind = {}; _foamMaterials.set(scene, byKind); }
  if (byKind[kind]) return byKind[kind];

  const style = LIQUID_STYLES[kind];
  const mat = new StandardMaterial(`${kind}FoamMat`, scene);
  mat.disableLighting = true;            // flat stylised foam, lighting-independent
  // Foam colour comes purely from emissive: the vertex stream only carries
  // alpha (see createWaterFoamRibbon), so a lit diffuseColor would tint every
  // kind toward white regardless of foamEmissive — that's invisible on the
  // near-white water foam but would wash out mud's brown right back to pale.
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(...style.foamEmissive);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;

  // The swirl mask multiplies into the band's own gradient: the alpha channel
  // carries the froth, the vertex alpha carries shore-to-open-water falloff.
  // Shared across kinds — only the emissive tint above changes the froth's
  // colour, so mud and water can reuse the same mask texture.
  const foam = getSharedFoamTexture(scene);
  if (foam) mat.opacityTexture = foam;

  // Organic breakup + wake lapping (WATER_REACTIVE.md Phase 3). Attaches once
  // per scene with the material, so every shoreline ribbon of this kind shares
  // one effect.
  attachWaterFoamPlugin(mat);

  byKind[kind] = mat;
  return mat;
}

/**
 * Build a foam ribbon along a shoreline: a band of quads from the waterline
 * toward open water, white-opaque at the edge fading to transparent, with inner
 * vertices offset along each vertex's edge bisector so the band stays continuous
 * at corners. `sgn` picks which side of the loop the band lies on, `widths` how
 * far in the band reaches at each vertex.
 */
function createWaterFoamRibbon(name, contour, y, sgn, widths, scene, kind) {
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
  mesh.material = getFoamMaterial(scene, kind);
  return mesh;
}

/**
 * Build every water and mud body on the track: one surface mesh plus one foam
 * ribbon per shoreline. Mud pools run through the exact same geometry as water
 * — grouped and rasterised separately so a mud puddle never merges into a
 * neighbouring water body's shared level — with only the material differing
 * (see LIQUID_STYLES). Meshes are named with the `water_` prefix, which is how
 * the editor finds and disposes them.
 *
 * @param {import('../world/track.js').Track} currentTrack
 * @param {BABYLON.Scene} scene
 */
export function buildWaterBodies(currentTrack, scene) {
  const allFeatures = currentTrack.features ?? [];
  const kindedBodies = [
    ...groupIntoBodies(currentTrack, allFeatures.filter(isWaterFeature)).map((body) => ({ body, kind: 'water' })),
    ...groupIntoBodies(currentTrack, allFeatures.filter(isMudFeature)).map((body) => ({ body, kind: 'mud' })),
  ];
  if (kindedBodies.length === 0) return;

  const sample = createTerrainSampler(currentTrack);

  kindedBodies.forEach(({ body, kind }, index) => {
    const grid = rasterizeBody(body, sample);
    const { positions, indices, depths } = buildSurfaceGeometry(grid, body.level);
    if (indices.length === 0) return; // level sits below the basin floor

    const name = `water_${kind}_body${index}`;
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    // The surface is a flat horizontal plane, so the normals are known — deriving
    // them from winding would only risk a uniformly flipped (unlit) surface.
    vd.normals = Array.from({ length: positions.length }, (_, i) => (i % 3 === 1 ? 1 : 0));
    vd.colors = depthShading(depths, kind);
    vd.applyToMesh(mesh);
    mesh.isPickable = false;
    mesh.useVertexColors = true;
    mesh.hasVertexAlpha = true;
    mesh.material = getWaterMaterial(scene, kind);

    traceShorelines(grid).forEach((raw, loopIndex) => {
      const loop = decimateLoop(raw, Math.max(grid.cell, FOAM_NOMINAL_WIDTH * 0.55));
      if (loop.length < 4) return;
      const sgn = foamSide(loop, grid);
      const widths = foamWidths(loop, grid, sgn);
      createWaterFoamRibbon(`${name}_foam${loopIndex}`, loop, body.level, sgn, widths, scene, kind);
    });
  });
}
