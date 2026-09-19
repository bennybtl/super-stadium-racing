import { MeshBuilder, Mesh, Matrix, VertexBuffer } from "@babylonjs/core";
import { makeRng, hashSeed } from "../../objects/scatter-utils.js";

/**
 * ProceduralBush — deterministic low-poly bush geometry.
 *
 * A cluster of jittered foliage blobs overlapping near ground level, so it
 * reads as one dense clump rather than a pile of spheres. Same shared-vertex
 * jitter trick as ProceduralTree's canopy: CreatePolyhedron with flat:false
 * gives real shared vertices to jitter, then convertToFlatShadedMesh puts the
 * low-poly facets back after the merge. Given the same options it always
 * produces the same bush.
 */

export const BUSH_DEFAULTS = {
  radius: 0.9, // overall footprint radius
  seed: 1,
};

const BLOB_POLY = 3; // icosahedron — round blobs, unlike Rock.js's angular chunks
const MIN_BLOBS = 3;
const MAX_BLOBS = 6;

/** Radially scale each shared vertex by a random factor for a lumpy blob. */
function jitter(mesh, rand) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    const j = 0.75 + rand() * 0.5; // 0.75 .. 1.25, radial → stays blob-shaped
    pos[i] *= j;
    pos[i + 1] *= j;
    pos[i + 2] *= j;
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
}

function blob(name, x, y, z, sx, sy, sz, rand, scene) {
  const m = MeshBuilder.CreatePolyhedron(name, {
    type: BLOB_POLY, sizeX: sx, sizeY: sy, sizeZ: sz, flat: false,
  }, scene);
  jitter(m, rand);
  m.bakeTransformIntoVertices(Matrix.RotationY(rand() * Math.PI * 2).multiply(Matrix.Translation(x, y, z)));
  return m;
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

    const parts = [];
    const blobs = MIN_BLOBS + Math.floor(rand() * (MAX_BLOBS - MIN_BLOBS + 1));
    let height = 0;

    for (let i = 0; i < blobs; i++) {
      // Scatter blob centers around the footprint so they overlap into one
      // clump instead of lining up in a ring.
      const ang = rand() * Math.PI * 2;
      const dist = rand() * o.radius * 0.5;
      const r = o.radius * (0.45 + rand() * 0.45);
      const cx = Math.cos(ang) * dist;
      const cz = Math.sin(ang) * dist;
      const cy = r * (0.65 + rand() * 0.35);

      parts.push(blob(
        `bl${i}`, cx, cy, cz,
        r * (0.9 + rand() * 0.3), r * (0.8 + rand() * 0.35), r * (0.9 + rand() * 0.3),
        rand, scene,
      ));
      height = Math.max(height, cy + r);
    }

    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!merged) return { foliage: null, height: 0 };
    merged.name = `bushFoliage_${o.seed}`;
    merged.convertToFlatShadedMesh();
    merged.isVisible = false; // instances still render; this only hides the source
    merged.isPickable = false;
    merged.freezeWorldMatrix();

    return { foliage: merged, height };
  }
}
