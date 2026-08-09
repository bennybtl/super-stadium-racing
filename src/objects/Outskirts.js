import {
  MeshBuilder,
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
} from "@babylonjs/core";
import { resolveBorderWall } from "./BorderWall.js";

/**
 * Outskirts — the flat plain that carries the border terrain off toward the
 * horizon on tracks with no perimeter wall.
 *
 * With the wall on, the ground mesh simply ends a few metres past the editable
 * area and the wall hides the edge. With it off that edge is in plain view, so
 * this ring of four slabs continues the surface outward: flat at y = 0 (where
 * the ground mesh's outer strip already sits — see the jitter note in
 * Track.getHeightAt), drivable, and cheap (4 boxes, no terrain bake).
 *
 * The slabs render with the SAME terrain material as the ground, which is what
 * makes the join invisible: the terrain shader reads its type/colour from the
 * grid texture by world position and clamps outside the play area, so the plain
 * resolves to exactly the border terrain the ground's outer edge already shows,
 * and the detail texture is tiled in world space on both. An earlier version
 * built a lookalike StandardMaterial here and the seam was plainly visible —
 * same texture, different lighting path.
 *
 * A ring rather than one big plane: the play area dips below y = 0 in valleys
 * and water, and a slab spanning the middle would poke up through it.
 */

// How far past the ground mesh the plain extends, in metres. Far enough to read
// as "terrain to the horizon" from the chase camera without the outer edge
// drifting past the point lights' range into unlit black.
export const OUTSKIRTS_EXTENT = 600;

// Slab thickness; only the top face is ever seen.
const SLAB_THICKNESS = 6;

const OUTSKIRTS_NAMES = ["outskirtsNorth", "outskirtsSouth", "outskirtsEast", "outskirtsWest"];

/** Scene name SceneBuilder gives the plain's material, so a later in-place
 *  rebuild (which has no textures to build one from) can find it again. */
export const OUTSKIRTS_MATERIAL_NAME = "outskirtsMat";

/** Dispose the outskirt slabs. The material is shared across rebuilds and kept. */
export function disposeOutskirts(scene) {
  for (const name of OUTSKIRTS_NAMES) {
    scene.getMeshByName(name)?.dispose();
  }
}

/**
 * (Re)build the outskirt plain. Existing slabs are disposed first, so this
 * doubles as the editor's in-place refresh. No-op (beyond the dispose) when the
 * track has its perimeter wall on — the wall is the edge in that case.
 *
 * `material` is the terrain material to render with; SceneBuilder passes one
 * built from the same textures as the ground. The editor's in-place refresh
 * omits it and the material already in the scene is reused.
 */
export function buildOutskirts(scene, track, driveSurfaceManager = null, material = null) {
  disposeOutskirts(scene);
  if (resolveBorderWall(track).enabled) return;

  const slabMaterial = material ?? scene.getMaterialByName(OUTSKIRTS_MATERIAL_NAME);

  const { width: groundWidth, depth: groundDepth } = track.getGroundLattice();
  const halfW = groundWidth / 2;
  const halfD = groundDepth / 2;
  const ext = OUTSKIRTS_EXTENT;

  const create = (name, x, z, width, depth) => {
    const slab = MeshBuilder.CreateBox(
      name,
      { width, height: SLAB_THICKNESS, depth },
      scene
    );
    // Top face flush with the ground mesh's flat outer strip.
    slab.position = new Vector3(x, -SLAB_THICKNESS / 2, z);
    if (slabMaterial) slab.material = slabMaterial;

    // Nothing out here casts a shadow, and the slabs are large enough that
    // receiving would sample the shadow map across the whole plain for nothing.
    slab.receiveShadows = false;

    new PhysicsAggregate(slab, PhysicsShapeType.BOX, { mass: 0 }, scene);
    // Registering makes the plain a real drive surface: TerrainQuery's raycasts
    // resolve height on it, so trucks drive out here instead of falling through.
    driveSurfaceManager?.register(slab, {
      surfaceType: "ground",
      level: 0,
      tags: { surfaceKind: "ground-outskirts" },
    });
  };

  const spanX = groundWidth + ext * 2;
  create("outskirtsNorth", 0,  halfD + ext / 2, spanX, ext);
  create("outskirtsSouth", 0, -halfD - ext / 2, spanX, ext);
  create("outskirtsEast",  halfW + ext / 2, 0, ext, groundDepth);
  create("outskirtsWest", -halfW - ext / 2, 0, ext, groundDepth);
}
