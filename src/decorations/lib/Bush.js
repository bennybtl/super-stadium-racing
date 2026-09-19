import { MeshBuilder, Matrix, VertexBuffer } from "@babylonjs/core";
import { makeRng, hashSeed } from "../../objects/scatter-utils.js";

/**
 * ProceduralBush — deterministic low-poly bush geometry.
 *
 * A single icosahedron, not several blobs fused together. Mesh.MergeMeshes is
 * a plain concatenation, not a boolean union — nesting one closed blob inside
 * another still leaves both surfaces in the buffer, so wherever they cross
 * you see the seam, reading as separate globs stuck together rather than one
 * clump. Instead, all the variety comes from deforming ONE mesh's own shared
 * vertices: a per-axis jitter for a lumpy silhouette, plus a handful of
 * asymmetric "bump" swells pushed out from random directions, before
 * convertToFlatShadedMesh bakes the low-poly facets in. Given the same
 * options it always produces the same bush.
 */

export const BUSH_DEFAULTS = {
  radius: 0.9, // overall size
  seed: 1,
};

const BLOB_POLY = 3; // icosahedron — 12 verts, 20 faces; round base for foliage
const BUMPS_MIN = 2;
const BUMPS_MAX = 4;

/** Scale each shared vertex by an independent per-axis factor for a lumpy blob. */
function axisJitter(mesh, rand) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i]     *= 0.75 + rand() * 0.5;
    pos[i + 1] *= 0.7  + rand() * 0.6;
    pos[i + 2] *= 0.75 + rand() * 0.5;
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
}

/**
 * Push vertices outward from a few random directions, so the foliage bulges
 * lopsided instead of reading as one uniformly-dented sphere. Cheap stand-in
 * for real 3D noise: each "bump" is a direction + strength; a vertex whose
 * own direction from center aligns with it gets pushed out more.
 */
function bumpDeform(mesh, rand) {
  const bumps = [];
  const n = BUMPS_MIN + Math.floor(rand() * (BUMPS_MAX - BUMPS_MIN + 1));
  for (let b = 0; b < n; b++) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(rand() * 2 - 1);
    bumps.push({
      x: Math.sin(phi) * Math.cos(theta),
      y: Math.cos(phi),
      z: Math.sin(phi) * Math.sin(theta),
      strength: 0.15 + rand() * 0.25,
    });
  }

  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len, ny = y / len, nz = z / len;
    let push = 1;
    for (const b of bumps) {
      const d = Math.max(0, nx * b.x + ny * b.y + nz * b.z);
      push += b.strength * d * d * d;
    }
    push = Math.min(push, 1.5);
    pos[i] = x * push;
    pos[i + 1] = y * push;
    pos[i + 2] = z * push;
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
}

export class ProceduralBush {
  /**
   * @returns {{ foliage: Mesh|null, height: number }}
   *          Master is parented to nothing and left at the origin. Caller owns
   *          disposal (see bush.js refcount).
   */
  static buildMasters(scene, options = {}) {
    const o = { ...BUSH_DEFAULTS, ...options };
    const rand = makeRng(hashSeed(String(o.seed)));

    const m = MeshBuilder.CreatePolyhedron(`bushFoliage_${o.seed}`, {
      type: BLOB_POLY, size: o.radius, flat: false,
    }, scene);

    axisJitter(m, rand);
    bumpDeform(m, rand);
    m.bakeTransformIntoVertices(Matrix.RotationY(rand() * Math.PI * 2));

    // Settle it onto the ground: lift so the lowest point sits right at y=0.
    const pos = m.getVerticesData(VertexBuffer.PositionKind);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < pos.length; i += 3) {
      minY = Math.min(minY, pos[i]);
      maxY = Math.max(maxY, pos[i]);
    }
    const lift = -minY;
    m.bakeTransformIntoVertices(Matrix.Translation(0, lift, 0));

    m.convertToFlatShadedMesh();
    m.isVisible = false; // instances still render; this only hides the source
    m.isPickable = false;
    m.freezeWorldMatrix();

    return { foliage: m, height: maxY + lift };
  }
}
