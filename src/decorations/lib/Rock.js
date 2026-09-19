import { MeshBuilder, Mesh, Matrix, VertexBuffer } from "@babylonjs/core";
import { makeRng, hashSeed } from "../../objects/scatter-utils.js";

/**
 * ProceduralRock — deterministic low-poly rock geometry.
 *
 * A cluster of 1–3 jittered boulders. Unlike Bush.js's radial (blob-shaped)
 * jitter, each vertex here is scaled independently per axis, which tears the
 * shared octahedron into flat, angular facets once convertToFlatShadedMesh
 * runs — reads as chipped stone rather than a round pebble. Given the same
 * options it always produces the same rock.
 */

export const ROCK_DEFAULTS = {
  radius: 0.6, // main boulder radius
  seed: 1,
};

const ROCK_POLY = 1; // octahedron — fewer, bigger facets than the bush's icosahedron
const MIN_ROCKS = 1;
const MAX_ROCKS = 3;

/** Scale each shared vertex independently per axis for an angular chunk. */
function jitter(mesh, rand) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i]     *= 0.7 + rand() * 0.6;
    pos[i + 1] *= 0.6 + rand() * 0.7;
    pos[i + 2] *= 0.7 + rand() * 0.6;
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
}

function chunk(name, x, y, z, r, rand, scene) {
  const m = MeshBuilder.CreatePolyhedron(name, {
    type: ROCK_POLY, size: r, flat: false,
  }, scene);
  jitter(m, rand);
  m.bakeTransformIntoVertices(Matrix.RotationY(rand() * Math.PI * 2).multiply(Matrix.Translation(x, y, z)));
  return m;
}

export class ProceduralRock {
  /**
   * @returns {{ rock: Mesh|null, height: number }}
   *          Master is parented to nothing and left at the origin. Caller owns
   *          disposal (see rock.js refcount).
   */
  static buildMasters(scene, options = {}) {
    const o = { ...ROCK_DEFAULTS, ...options };
    const rand = makeRng(hashSeed(String(o.seed)));

    const parts = [];
    const rocks = MIN_ROCKS + Math.floor(rand() * (MAX_ROCKS - MIN_ROCKS + 1));
    let height = 0;

    for (let i = 0; i < rocks; i++) {
      // First rock sits centered and largest; any extras scatter beside it,
      // smaller, so the cluster reads as one outcrop, not a random pile.
      const r = o.radius * (i === 0 ? (0.85 + rand() * 0.3) : (0.35 + rand() * 0.35));
      const ang = rand() * Math.PI * 2;
      const dist = i === 0 ? 0 : o.radius * (0.5 + rand() * 0.4);
      const cx = Math.cos(ang) * dist;
      const cz = Math.sin(ang) * dist;
      const cy = r * (0.5 + rand() * 0.15); // partly embedded in the ground

      parts.push(chunk(`r${i}`, cx, cy, cz, r, rand, scene));
      height = Math.max(height, cy + r);
    }

    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!merged) return { rock: null, height: 0 };
    merged.name = `rockBody_${o.seed}`;
    merged.convertToFlatShadedMesh();
    merged.isVisible = false; // instances still render; this only hides the source
    merged.isPickable = false;
    merged.freezeWorldMatrix();

    return { rock: merged, height };
  }
}
