import { MeshBuilder, Mesh, Matrix, Vector3, VertexBuffer } from "@babylonjs/core";
import { makeRng, hashSeed } from "../../objects/scatter-utils.js";

/**
 * ProceduralTree — deterministic low-poly tree geometry.
 *
 * This is NOT a scene object. `buildMasters()` returns three merged meshes
 * (trunk / branches / foliage), each a single draw call, hidden and ready to be
 * hardware-instanced with `createInstance()`. tree.js caches one set of masters
 * per variant, so a forest of identical trees costs three draw calls total, not
 * three per tree.
 *
 * Structure: a trunk, then 1–4 primary branches (seeded) splaying from its top,
 * each optionally forking into twigs, and each ending in ONE distinct foliage
 * blob sized to cover that branch's tip cloud. So a 3-branch tree reads as three
 * separate leaf masses on three limbs, not a random pile of overlapping spheres.
 *
 * Every part bakes its accumulated transform straight into its vertices (no
 * TransformNode hierarchy) so Mesh.MergeMeshes just concatenates, then the whole
 * tree is flat-shaded once for crisp isometric facets. Given the same options it
 * always produces the same tree — required for tracks that reload identically.
 */

export const TREE_DEFAULTS = {
  trunkHeight: 3.0,
  trunkRadius: 0.4,
  radialSegments: 6, // trunk/branch cylinder sides — keep low-poly
  maxDepth: 3,       // trunk(1) → primary branch(2) → twig(3) → tip
  seed: 1,
};

const TAPER = 0.62;        // each tier's radius vs its parent
const MIN_PRIMARIES = 1;
const MAX_PRIMARIES = 4;

// Foliage blobs are CreatePolyhedron (not CreateIcoSphere — that one duplicates
// every corner per face no matter what `flat` says, so jittering it tears the
// facets apart). CreatePolyhedron with flat:false gives genuinely SHARED
// vertices; jitter each once, merge, then convertToFlatShadedMesh puts the hard
// low-poly facets back. Same trap DirtChunks hit.
const FOLIAGE_POLY = 3; // Babylon polyhedron type 3 = icosahedron (20 faces)

/** Radially scale each shared vertex by a random factor for a lumpy blob. */
function jitter(mesh, rand) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    const j = 0.72 + rand() * 0.56; // 0.72 .. 1.28, radial → stays blob-shaped
    pos[i]     *= j;
    pos[i + 1] *= j;
    pos[i + 2] *= j;
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
}

/**
 * One jittered foliage polyhedron centred at (x,y,z). `sx/sy/sz` are the
 * per-axis radii, so a canopy can be squat and wide or tall and narrow. Only
 * spun about Y (plus a tiny wobble) so a flat blob stays flat.
 */
function foliageBlob(name, x, y, z, sx, sy, sz, rand, scene) {
  const m = MeshBuilder.CreatePolyhedron(name, {
    type: FOLIAGE_POLY, sizeX: sx, sizeY: sy, sizeZ: sz, flat: false,
  }, scene);
  jitter(m, rand);
  m.bakeTransformIntoVertices(
    Matrix.RotationY(rand() * Math.PI * 2)
      .multiply(Matrix.RotationX((rand() - 0.5) * 0.3))
      .multiply(Matrix.Translation(x, y, z)),
  );
  return m;
}

/** Tapered cylinder with its pivot moved to the base, then baked into `frame`. */
function branchSegment(name, baseR, topR, height, frame, segments, scene) {
  const seg = MeshBuilder.CreateCylinder(name, {
    height, diameterTop: topR * 2, diameterBottom: baseR * 2, tessellation: segments,
  }, scene);
  seg.bakeTransformIntoVertices(Matrix.Translation(0, height / 2, 0).multiply(frame));
  return seg;
}

/** Merge one group's parts into a single hidden, instanceable master mesh. */
function mergeMaster(name, parts, scene) {
  if (!parts.length) return null;
  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!merged) return null;
  merged.name = name;
  merged.convertToFlatShadedMesh();
  merged.isVisible = false;      // instances still render; this only hides the source
  merged.isPickable = false;
  merged.freezeWorldMatrix();
  return merged;
}

export class ProceduralTree {
  /**
   * @returns {{ trunk: Mesh|null, branch: Mesh|null, leaf: Mesh|null, height: number }}
   *          Masters are parented to nothing and left at the origin. Caller owns
   *          disposal (see tree.js refcount).
   */
  static buildMasters(scene, options = {}) {
    const o = { ...TREE_DEFAULTS, ...options };
    const rand = makeRng(hashSeed(String(o.seed)));

    const trunkParts = [];
    const branchParts = [];
    const leafParts = [];
    let idx = 0;

    // Grow one branch subtree from `frame`, collecting its terminal tips.
    const growBranch = (frame, depth, radius, height, tips) => {
      const nextRadius = radius * TAPER;
      branchParts.push(branchSegment(`b${idx++}`, radius, nextRadius, height, frame, o.radialSegments, scene));

      const tipFrame = Matrix.Translation(0, height, 0).multiply(frame);
      if (depth >= o.maxDepth) {
        tips.push(tipFrame.getTranslation());
        return;
      }
      const twigs = rand() < 0.35 ? 1 : 2;
      for (let i = 0; i < twigs; i++) {
        const spread = 0.25 + rand() * 0.4;
        const spin = i * (Math.PI * 2 / twigs) + rand() * 0.7;
        const childFrame = Matrix.RotationZ(spread)
          .multiply(Matrix.RotationY(spin))
          .multiply(tipFrame);
        growBranch(childFrame, depth + 1, nextRadius, height * (0.55 + rand() * 0.2), tips);
      }
    };

    // ── Per-tree character (all seeded) ──────────────────────────────────────
    // A handful of random dials so no two seeds share a silhouette: overall
    // height, a slight lean, how far the primaries splay (columnar → umbrella),
    // and how squat vs tall the canopy blobs are.
    const trunkH   = o.trunkHeight * (0.7 + rand() * 0.9);   // 0.7 .. 1.6 ×
    const trunkR   = o.trunkRadius * (0.85 + rand() * 0.4);
    const lean     = rand() * 0.13;                          // radians off vertical
    const leanDir  = rand() * Math.PI * 2;
    const umbrella = 0.15 + rand() * 0.8;                    // primary splay
    const canopyFlat = 0.7 + rand() * 0.65;                  // <1 wide/squat, >1 tall

    const rootFrame = Matrix.RotationZ(lean).multiply(Matrix.RotationY(leanDir));

    // ── Trunk ────────────────────────────────────────────────────────────────
    const trunkNextR = trunkR * TAPER;
    trunkParts.push(branchSegment("trunk", trunkR, trunkNextR, trunkH, rootFrame, o.radialSegments, scene));

    // ── 1–4 primary branches, one distinct foliage blob each ──────────────────
    const primaries = MIN_PRIMARIES + Math.floor(rand() * (MAX_PRIMARIES - MIN_PRIMARIES + 1));
    let height = trunkH;

    for (let i = 0; i < primaries; i++) {
      // Attach staggered up the top half of the trunk → blobs sit at different
      // levels instead of all bursting from one point.
      const attachY = trunkH * (0.55 + 0.45 * ((i + rand() * 0.6) / primaries));
      // A lone primary stands nearly straight; multiples splay by `umbrella`.
      const spread = primaries === 1 ? rand() * 0.2 : umbrella * (0.55 + rand() * 0.7);
      const spin = i * (Math.PI * 2 / primaries) + rand() * 0.6;
      const primaryFrame = Matrix.RotationZ(spread)
        .multiply(Matrix.RotationY(spin))
        .multiply(Matrix.Translation(0, attachY, 0))
        .multiply(rootFrame);
      const primaryHeight = trunkH * (0.35 + rand() * 0.55);

      const tips = [];
      growBranch(primaryFrame, 2, trunkNextR, primaryHeight, tips);

      // One blob covering this branch's tip cloud.
      const c = new Vector3(0, 0, 0);
      for (const t of tips) c.addInPlace(t);
      c.scaleInPlace(1 / tips.length);
      let r = 0;
      for (const t of tips) r = Math.max(r, Vector3.Distance(t, c));
      const base = Math.max(r * 1.15 + trunkR * 3, trunkH * 0.5);
      const sx = base * (0.9 + rand() * 0.35);
      const sz = base * (0.9 + rand() * 0.35);
      const sy = base * canopyFlat * (0.85 + rand() * 0.3);

      leafParts.push(foliageBlob(`k${idx++}`, c.x, c.y, c.z, sx, sy, sz, rand, scene));
      height = Math.max(height, c.y + sy);
    }

    return {
      trunk: mergeMaster(`treeTrunk_${o.seed}`, trunkParts, scene),
      branch: mergeMaster(`treeBranch_${o.seed}`, branchParts, scene),
      leaf: mergeMaster(`treeLeaf_${o.seed}`, leafParts, scene),
      height,
    };
  }
}
