import { MeshBuilder, Matrix, VertexBuffer } from "@babylonjs/core";
import { makeRng, hashSeed } from "../../objects/scatter-utils.js";

/**
 * ProceduralRock — deterministic low-poly rock geometry.
 *
 * A single polyhedron, not several fused together. Mesh.MergeMeshes is a
 * plain concatenation, not a boolean union — nesting one closed solid inside
 * another still leaves both surfaces in the buffer, so wherever they cross
 * you see the seam, reading as stacked objects rather than one rock. Instead,
 * all the variety comes from deforming ONE mesh's own shared vertices:
 *   - a random base solid (ROCK_POLY_TYPES, 6-24 shared vertices)
 *   - an angular per-axis jitter
 *   - a handful of asymmetric "bump" swells pushed out from random directions
 * before convertToFlatShadedMesh bakes the low-poly facets in. Given the same
 * options it always produces the same rock.
 */

export const ROCK_DEFAULTS = {
  radius: 0.6, // overall size
  seed: 1,
};

// Babylon polyhedron `type` values, spanning a range of shared-vertex counts
// so rocks vary from simple facets to denser, more detailed chunks.
const ROCK_POLY_TYPES = [
  1,  // Octahedron                        6 verts,  8 faces
  6,  // Pentagonal Prism                 10 verts,  7 faces
  12, // Elongated Square Dipyramid (J15) 10 verts, 12 faces
  3,  // Icosahedron                      12 verts, 20 faces
  7,  // Hexagonal Prism                  12 verts,  8 faces
  13, // Elongated Pentagonal Dipyramid (J16) 12 verts, 15 faces
  2,  // Dodecahedron                     20 verts, 12 faces
  4,  // Rhombicuboctahedron              24 verts, 26 faces
];

const BUMPS_MIN = 2;
const BUMPS_MAX = 4;

/** Scale each shared vertex independently per axis for an angular chunk. */
function axisJitter(mesh, rand) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i]     *= 0.65 + rand() * 0.7;
    pos[i + 1] *= 0.55 + rand() * 0.75;
    pos[i + 2] *= 0.65 + rand() * 0.7;
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
}

/**
 * Push vertices outward from a few random directions, so the silhouette
 * swells asymmetrically instead of the axis jitter's uniform egg/box shape.
 * Cheap stand-in for real 3D noise: each "bump" is a direction + strength; a
 * vertex whose own direction from center aligns with it gets pushed out more.
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
      strength: 0.2 + rand() * 0.3,
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
    push = Math.min(push, 1.7);
    pos[i] = x * push;
    pos[i + 1] = y * push;
    pos[i + 2] = z * push;
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
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

    const type = ROCK_POLY_TYPES[Math.floor(rand() * ROCK_POLY_TYPES.length)];
    const m = MeshBuilder.CreatePolyhedron(`rockBody_${o.seed}`, {
      type, size: o.radius, flat: false,
    }, scene);

    axisJitter(m, rand);
    bumpDeform(m, rand);

    const tumble = Matrix.RotationY(rand() * Math.PI * 2)
      .multiply(Matrix.RotationX((rand() - 0.5) * Math.PI * 0.6))
      .multiply(Matrix.RotationZ((rand() - 0.5) * Math.PI * 0.6));
    m.bakeTransformIntoVertices(tumble);

    // Settle it onto the ground: lift so the lowest point sits a little below
    // y=0, like a real rock partly embedded rather than floating on top.
    const pos = m.getVerticesData(VertexBuffer.PositionKind);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < pos.length; i += 3) {
      minY = Math.min(minY, pos[i]);
      maxY = Math.max(maxY, pos[i]);
    }
    const embed = o.radius * (0.1 + rand() * 0.1);
    const lift = -minY - embed;
    m.bakeTransformIntoVertices(Matrix.Translation(0, lift, 0));

    m.convertToFlatShadedMesh();
    m.isVisible = false; // instances still render; this only hides the source
    m.isPickable = false;
    m.freezeWorldMatrix();

    return { rock: m, height: maxY + lift };
  }
}
