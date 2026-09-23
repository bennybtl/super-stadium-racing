import { Mesh, VertexData, Texture } from "@babylonjs/core";
import { treeOptions, growSkeleton, meshSkeleton } from "./EzTree.js";

/**
 * Babylon side of the ez-tree port: preset lookup + master-mesh building.
 * EzTree.js stays engine-free; this turns its plain arrays into hidden,
 * instanceable masters for instanced-decoration.js.
 */

const presetModules = import.meta.glob("./presets/*.json", { eager: true, import: "default" });

/** { oak_medium: {...}, pine_small: {...}, … } keyed by file name. */
export const EZ_TREE_PRESETS = Object.fromEntries(
  Object.entries(presetModules).map(([path, json]) => [path.match(/([^/]+)\.json$/)[1], json]),
);

const LABEL = (id) => id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const EZ_TREE_PRESET_OPTIONS = Object.keys(EZ_TREE_PRESETS)
  .sort()
  .map((id) => ({ value: id, label: LABEL(id) }));

/**
 * One mesh from ez-tree buffers, scaled to world units. ez-tree is right-handed
 * (Three); mirroring z converts it, and the mirror alone also turns Three's CCW
 * front faces into Babylon's CW ones — so indices are kept as-is (checked:
 * VertexData.ComputeNormals agrees with the supplied normals 100%; swapping
 * winding makes it 0%). `vScale` scales uv.v. ez-tree sets bark
 * texture.repeat.y = 1/textureScale.y instead, but here the bark texture is
 * shared by presets with different scales, so the scale is baked into the UVs.
 */
function masterFromBuffers(name, buf, scale, scene, vScale = 1) {
  if (!buf.indices.length) return null;
  const positions = new Float32Array(buf.verts.length);
  const normals = new Float32Array(buf.normals.length);
  for (let i = 0; i < buf.verts.length; i += 3) {
    positions[i] = buf.verts[i] * scale;
    positions[i + 1] = buf.verts[i + 1] * scale;
    positions[i + 2] = -buf.verts[i + 2] * scale;
    normals[i] = buf.normals[i];
    normals[i + 1] = buf.normals[i + 1];
    normals[i + 2] = -buf.normals[i + 2];
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = vScale === 1 ? buf.uvs : buf.uvs.map((v, i) => (i & 1 ? v * vScale : v));
  vd.indices = buf.indices;

  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.isVisible = false; // instance source only
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  return mesh;
}

/** Resolved ez-tree options for a preset id + seed. */
export function ezTreeOptions({ preset, seed }) {
  return treeOptions({ ...(EZ_TREE_PRESETS[preset] ?? {}), seed });
}

/**
 * Lower-detail levels, as screen coverage: the fraction of the screen the
 * tree's bounding sphere covers (Babylon `useLODScreenCoverage`). That makes
 * the switch independent of tree scale and camera zoom. The detail specs are
 * ez-tree's own defaultLODLevels (~40% and ~20% of full triangles). A 16-unit
 * tree ~40 units from the race camera covers ~14%. Tune by eye.
 */
const LOD_LEVELS = [
  { coverage: 0.05, detail: { sectionStride: 3, segmentFactor: 0.75, leafStride: 2, leafScale: 1.25 } },
  { coverage: 0.015, detail: { sectionStride: 6, segmentFactor: 0.4, leafStride: 2, leafScale: 1.3, billboard: "single" } },
];

/**
 * Build the masters for one tree variant, each with its LOD chain. Groups:
 *   trunk  — the level-0 branch only (collider target: its bounds are trunk-sized)
 *   branch — every other branch
 *   leaf   — leaf quads
 * Instances follow their master's LOD per instance (Babylon picks the level
 * from the instance's own bounding sphere), in the shadow pass as well.
 * @param {{bark, leaf}} materials  assigned to every level
 * @returns {{ trunk, branch, leaf, height }}
 */
export function buildEzTreeMasters(scene, options, scale, name, materials) {
  const skeleton = growSkeleton(options);
  const [trunkBranch, ...rest] = skeleton.branches;
  const trunkSkeleton = { branches: [trunkBranch], leaves: [] };
  const restSkeleton = { branches: rest, leaves: skeleton.leaves };
  const barkV = 1 / options.bark.textureScale.y;

  const buildLevel = (detail, suffix) => {
    const trunkBuf = meshSkeleton(trunkSkeleton, options, detail).branches;
    const { branches, leaves } = meshSkeleton(restSkeleton, options, detail);
    const level = {
      trunk: masterFromBuffers(`${name}_trunk${suffix}`, trunkBuf, scale, scene, barkV),
      branch: masterFromBuffers(`${name}_branch${suffix}`, branches, scale, scene, barkV),
      leaf: masterFromBuffers(`${name}_leaf${suffix}`, leaves, scale, scene),
      bufs: [trunkBuf, branches, leaves],
    };
    if (level.trunk) level.trunk.material = materials.bark;
    if (level.branch) level.branch.material = materials.bark;
    if (level.leaf) level.leaf.material = materials.leaf;
    return level;
  };

  const full = buildLevel({}, "");
  let maxY = 0;
  for (const b of full.bufs) {
    for (let i = 1; i < b.verts.length; i += 3) if (b.verts[i] > maxY) maxY = b.verts[i];
  }

  for (const master of [full.trunk, full.branch, full.leaf]) {
    if (master) master.useLODScreenCoverage = true;
  }
  LOD_LEVELS.forEach(({ coverage, detail }, i) => {
    const lod = buildLevel(detail, `_lod${i + 1}`);
    for (const group of ["trunk", "branch", "leaf"]) {
      const master = full[group], mesh = lod[group];
      if (!master || !mesh) { mesh?.dispose(); continue; }
      master.addLODLevel(coverage, mesh);
      // Mesh.dispose() doesn't take its LOD meshes with it.
      master.onDisposeObservable.addOnce(() => mesh.dispose());
    }
  });

  return { trunk: full.trunk, branch: full.branch, leaf: full.leaf, height: maxY * scale };
}

// Textures (src/assets/trees, see LICENSE.md there): leaf sprig cutouts per
// leaves.type and the bark colour map per bark.type. One Texture per URL per
// scene, shared by every variant; the scene disposes them.
const textureUrls = import.meta.glob("../../../assets/trees/*.{png,jpg}", { eager: true, import: "default" });
const urlFor = (file) => Object.entries(textureUrls).find(([p]) => p.endsWith(`/${file}`))?.[1] ?? null;
const _textures = new WeakMap(); // scene → Map(url → Texture)

function sharedTexture(scene, url) {
  let byUrl = _textures.get(scene);
  if (!byUrl) _textures.set(scene, (byUrl = new Map()));
  let tex = byUrl.get(url);
  if (!tex || tex.isDisposed?.()) {
    tex = new Texture(url, scene);
    byUrl.set(url, tex);
  }
  return tex;
}

/** Leaf sprig texture (alpha cutout) for options.leaves.type, or null. */
export function leafTexture(scene, options) {
  const url = urlFor(`leaf_${options.leaves.type}.png`);
  if (!url) return null;
  const tex = sharedTexture(scene, url);
  tex.hasAlpha = true;
  return tex;
}

/** Bark colour texture for options.bark.type ('Bark001' → bark_001.jpg), or null. */
export function barkTexture(scene, options) {
  const url = urlFor(`bark_${options.bark.type.replace(/^Bark/, "")}.jpg`);
  return url ? sharedTexture(scene, url) : null;
}
