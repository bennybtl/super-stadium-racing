import { MeshBuilder, Mesh, Matrix, Vector3 } from "@babylonjs/core";
import { makeRng, hashSeed } from "../../objects/scatter-utils.js";

/**
 * ProceduralCactus — deterministic low-poly saguaro.
 *
 * Like ProceduralTree this is NOT a scene object: `buildMasters()` returns
 * merged, hidden meshes (`trunk`, `arms`) ready to be hardware-instanced. A
 * ribbed column with a domed top, plus 0–4 arms (seeded) that stub out from the
 * trunk, elbow, and rise vertically with a rounded tip — the classic saguaro
 * silhouette. Low cylinder tessellation gives the rib facets once it's
 * flat-shaded after the merge.
 *
 * Every part bakes its accumulated transform into its vertices (no TransformNode
 * hierarchy) so Mesh.MergeMeshes just concatenates. Same seed → identical
 * geometry, every load.
 */

export const CACTUS_DEFAULTS = {
  trunkHeight: 3.2,
  trunkRadius: 0.42,
  ribs: 8,   // cross-section facets → reads as ribs at low poly
  seed: 1,
};

const MAX_ARMS = 4;

/** Tapered column built along +Y with its pivot at the base, baked into `frame`. */
function column(name, baseR, topR, height, frame, ribs, scene) {
  const m = MeshBuilder.CreateCylinder(name, {
    height, diameterTop: topR * 2, diameterBottom: baseR * 2, tessellation: ribs,
  }, scene);
  m.bakeTransformIntoVertices(Matrix.Translation(0, height / 2, 0).multiply(frame));
  return m;
}

/** Low-poly top hemisphere of radius `r`, sitting on the XZ plane of `frame`. */
function dome(name, r, frame, ribs, scene) {
  const m = MeshBuilder.CreateSphere(name, {
    diameter: r * 2, segments: Math.max(8, ribs), slice: 0.5,
  }, scene);
  m.bakeTransformIntoVertices(frame);
  return m;
}

const ARM_STEPS = 6;    // short columns per arm — more = smoother bend
const ARM_OVERLAP = 1.12; // each column runs past its step to close the bend joints

export class ProceduralCactus {
  /**
   * @returns {{ trunk: Mesh|null, arms: Mesh|null, height: number }}
   */
  static buildMasters(scene, options = {}) {
    const o = { ...CACTUS_DEFAULTS, ...options };
    const rand = makeRng(hashSeed(String(o.seed)));

    // ── Per-cactus character (all seeded) ────────────────────────────────────
    const trunkH = o.trunkHeight * (0.6 + rand() * 0.95);   // 0.6 .. 1.55 ×
    const trunkR = o.trunkRadius * (0.8 + rand() * 0.5);
    const lean = rand() * 0.09;
    const leanDir = rand() * Math.PI * 2;
    const rootFrame = Matrix.RotationZ(lean).multiply(Matrix.RotationY(leanDir));

    const trunkParts = [];
    const armParts = [];
    let idx = 0;
    let height = trunkH + trunkR;

    // ── Trunk: ribbed column + domed top ────────────────────────────────────
    const topR = trunkR * 0.86;
    trunkParts.push(column("trunk", trunkR, topR, trunkH, rootFrame, o.ribs, scene));
    trunkParts.push(dome("trunkCap", topR, Matrix.Translation(0, trunkH, 0).multiply(rootFrame), o.ribs, scene));

    // ── Arms ────────────────────────────────────────────────────────────────
    // Each arm is a walk of short overlapping columns: it leaves the trunk
    // near-horizontal and curves up to vertical over the first ~half, then
    // rises straight to a domed tip. The overlap fills the bends, so there's no
    // ball at the joint.
    const arms = Math.round(rand() * MAX_ARMS); // 0 .. 4
    for (let i = 0; i < arms; i++) {
      const armR = trunkR * (0.5 + rand() * 0.16);
      const attachY = trunkH * (0.3 + 0.42 * ((i + rand() * 0.6) / Math.max(1, arms)));
      const spin = i * (Math.PI * 2 / Math.max(1, arms)) + rand() * 0.9;
      const armLen = trunkR * 1.2 + trunkH * (0.35 + rand() * 0.5);
      const startBend = 1.1 + rand() * 0.25;                  // radians off vertical at the base
      const bendSteps = Math.ceil(ARM_STEPS * 0.6);
      const segLen = armLen / ARM_STEPS;

      // Frame at the trunk surface, tilted out, spun around the trunk axis.
      let f = Matrix.RotationZ(-startBend)
        .multiply(Matrix.Translation(trunkR * 0.5, attachY, 0))
        .multiply(Matrix.RotationY(spin))
        .multiply(rootFrame);

      let segTop = f;
      for (let k = 0; k < ARM_STEPS; k++) {
        const r0 = armR * (1 - 0.1 * (k / ARM_STEPS));
        const r1 = armR * (1 - 0.1 * ((k + 1) / ARM_STEPS));
        armParts.push(column(`aSeg${idx}_${k}`, r0, r1, segLen * ARM_OVERLAP, f, o.ribs, scene));
        segTop = Matrix.Translation(0, segLen * ARM_OVERLAP, 0).multiply(f); // this column's visual top
        f = Matrix.Translation(0, segLen, 0).multiply(f);
        if (k < bendSteps) f = Matrix.RotationZ(startBend / bendSteps).multiply(f);
      }

      // Dome caps the last column's actual top, not the (shorter) step point.
      const tip = segTop.getTranslation();
      armParts.push(dome(`aTip${idx}`, armR * 0.92, segTop, o.ribs, scene));
      height = Math.max(height, tip.y + armR);
      idx++;
    }

    const merge = (name, parts) => {
      if (!parts.length) return null;
      const m = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
      if (!m) return null;
      m.name = name;
      m.convertToFlatShadedMesh();
      m.isVisible = false;   // instances still render; this only hides the source
      m.isPickable = false;
      m.freezeWorldMatrix();
      return m;
    };

    return {
      trunk: merge(`cactusTrunk_${o.seed}`, trunkParts),
      arms: merge(`cactusArms_${o.seed}`, armParts),
      height,
    };
  }
}
