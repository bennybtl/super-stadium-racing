import {
  MeshBuilder,
  StandardMaterial,
  MultiMaterial,
  SubMesh,
  Color3,
  Vector3,
  Texture,
  PhysicsAggregate,
  PhysicsShapeType,
} from "@babylonjs/core";
import concreteSideUrl from "../assets/textures/concrete_2.texture.png?url";
import concreteTopUrl from "../assets/textures/concrete_3.texture.png?url";

/**
 * BorderWall - the four grey boxes that seal the track perimeter.
 *
 * These are not track features: they're derived from the track's size plus the
 * per-track `borderWall` settings (on/off, thickness, height, colour), so they
 * live here rather than in WallManager (which owns feature-spawned poly walls).
 * SceneBuilder calls this once at build time; the editor calls it again when a
 * setting changes so the change is visible without a full scene rebuild.
 */

export const DEFAULT_BORDER_WALL = {
  enabled: true,
  thickness: 2,
  // Height ABOVE the track surface. 12 matches what the original fixed wall
  // showed: a 24-tall box centred on y = 0, half of it buried.
  height: 12,
};

// World metres per concrete-texture repeat, on both the side and top faces.
const TEXTURE_TILE_METERS = 6;
// Local path to the shared normal map, kept alongside the concrete diffuse.
const WALL_NORMAL_URL = new URL("../assets/normals/8648-normal.jpg", import.meta.url).href;

// Gap between the editable track area and the wall's inner face. Matches
// GROUND_BORDER in track.js so the wall sits at the edge of the ground mesh.
const WALL_INSET = 10;

// How far the wall continues below y = 0. It stands just outside the ground
// mesh, so there is no terrain under it to meet — this skirt is what hides the
// void beneath. Anchoring the base here rather than centring the box on y = 0 is
// what keeps a short wall sitting on the track instead of floating above it.
const WALL_SKIRT = 3;

const WALL_NAMES = ["borderNorth", "borderSouth", "borderEast", "borderWest"];

/** Merge a track's stored settings over the defaults, clamping the numbers. */
export function resolveBorderWall(track) {
  const raw = track?.borderWall ?? {};
  return {
    enabled: raw.enabled !== false,
    thickness: clamp(raw.thickness, 0.5, 20, DEFAULT_BORDER_WALL.thickness),
    height: clamp(raw.height, 1, 40, DEFAULT_BORDER_WALL.height),
  };
}

function clamp(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Dispose any existing border walls (meshes take their physics body with them). */
export function disposeBorderWalls(scene) {
  for (const name of WALL_NAMES) {
    const mesh = scene.getMeshByName(name);
    if (!mesh) continue;
    const mat = mesh.material;
    mesh.dispose();
    // MultiMaterial.dispose() leaves its sub-materials (and their textures)
    // behind, so free those explicitly.
    for (const sub of mat?.subMaterials ?? []) sub?.dispose(true, true);
    mat?.dispose(true, true);
  }
}

/**
 * (Re)build the four perimeter walls from the track's settings. Existing walls
 * are disposed first, so this doubles as the editor's in-place refresh.
 *
 * `wallManager` is optional: SceneBuilder passes it so the walls also register
 * as AI wall descriptors; the editor refresh omits it.
 */
export function buildBorderWalls(scene, track, wallManager = null) {
  disposeBorderWalls(scene);

  const settings = resolveBorderWall(track);
  if (!settings.enabled) return settings;

  const trackWidth = track?.width ?? 160;
  const trackDepth = track?.depth ?? 160;
  const t = settings.thickness;
  // Inner faces sit at the ground-mesh edge; the north/south spans run long
  // enough to close the corners against the east/west walls.
  const paddingX = trackWidth / 2 + WALL_INSET;
  const paddingZ = trackDepth / 2 + WALL_INSET;
  const spanX = trackWidth + WALL_INSET * 2 + t * 2;
  const spanZ = trackDepth + WALL_INSET * 2;

  const wallHeight = settings.height + WALL_SKIRT;

  const create = (name, x, z, width, depth) => {
    // Build every wall long-axis along local X and rotate the vertical
    // (east/west) ones 90°, so all four share one box UV layout — tiling the
    // side texture the same way regardless of orientation. (Building them
    // axis-aligned instead maps U to Y on the ±X faces and streaks the
    // texture.)
    const vertical = depth > width;
    const longSpan = vertical ? depth : width;
    const shortSpan = vertical ? width : depth;

    const wall = MeshBuilder.CreateBox(
      name,
      { width: longSpan, height: wallHeight, depth: shortSpan },
      scene
    );
    // Base pinned at -WALL_SKIRT, top at `height` above the track: adjusting the
    // height only moves the top.
    wall.position = new Vector3(x, settings.height / 2 - WALL_SKIRT / 2, z);
    if (vertical) wall.rotation.y = Math.PI / 2;
    wall.metadata = {
      ...(wall.metadata ?? {}),
      truckCollider: true,
      truckColliderFriction: 0.9,
      decalTarget: true, // wall decals project onto these
    };

    // Concrete: `concrete_2` on the four sides, `concrete_3` on the top, tiled
    // to a fixed world scale so long and short walls read the same. Faces of a
    // Babylon box run [front, back, right, left] then top then bottom, six
    // indices each — so the sides are indices 0..23, the top 24..29.
    const makeConcrete = (suffix, diffuseUrl, uScale, vScale) => {
      const m = new StandardMaterial(name + suffix, scene);
      m.specularColor = new Color3(0.08, 0.08, 0.08);
      const diffuse = new Texture(diffuseUrl, scene);
      diffuse.uScale = uScale;
      diffuse.vScale = vScale;
      m.diffuseTexture = diffuse;
      const bump = new Texture(WALL_NORMAL_URL, scene);
      bump.uScale = uScale;
      bump.vScale = vScale;
      bump.level = 0.7;
      m.bumpTexture = bump;
      m.invertNormalMapY = true;
      return m;
    };
    // Side faces (box ±Z): U runs the long axis, V runs the height.
    const sideMat = makeConcrete(
      "SideMat",
      concreteSideUrl,
      longSpan / TEXTURE_TILE_METERS,
      wallHeight / TEXTURE_TILE_METERS,
    );
    // Top face (box +Y): Babylon maps U → box depth (the thickness) and
    // V → box width (the long axis) — the reverse of the side faces.
    const topMat = makeConcrete(
      "TopMat",
      concreteTopUrl,
      shortSpan / TEXTURE_TILE_METERS,
      longSpan / TEXTURE_TILE_METERS,
    );

    const vertexCount = wall.getTotalVertices();
    wall.subMeshes = [];
    new SubMesh(0, 0, vertexCount, 0, 24, wall);  // 4 sides
    new SubMesh(1, 0, vertexCount, 24, 6, wall);  // top (+Y)
    new SubMesh(2, 0, vertexCount, 30, 6, wall);  // bottom (buried)

    const mat = new MultiMaterial(name + "Mat", scene);
    mat.subMaterials = [sideMat, topMat, sideMat];
    wall.material = mat;

    new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0 }, scene);

    // Also add to wallManager so they show up on the track editor grid and can be optionally hidden
    wallManager?._walls.push({
      segments: [{
        position: { x, z },
        heading: vertical ? Math.PI / 2 : 0,
        halfLength: longSpan / 2,
        halfThick: shortSpan / 2,
        friction: 0.1,
      }],
      dispose() {},   // no Babylon meshes — required by WallManager.dispose()
    });
  };

  create("borderNorth", 0,  paddingZ + t / 2, spanX, t);
  create("borderSouth", 0, -paddingZ - t / 2, spanX, t);
  create("borderEast",  paddingX + t / 2,  0, t, spanZ);
  create("borderWest", -paddingX - t / 2,  0, t, spanZ);

  return settings;
}
