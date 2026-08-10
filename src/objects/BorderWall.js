import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Texture,
  PhysicsAggregate,
  PhysicsShapeType,
} from "@babylonjs/core";

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
  color: "#808080",
};

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
    color: typeof raw.color === "string" ? raw.color : DEFAULT_BORDER_WALL.color,
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
    mesh.material?.dispose(true, true);
    mesh.dispose();
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

  const create = (name, x, z, width, depth) => {
    const wall = MeshBuilder.CreateBox(
      name,
      { width, height: settings.height + WALL_SKIRT, depth },
      scene
    );
    // Base pinned at -WALL_SKIRT, top at `height` above the track: adjusting the
    // height only moves the top.
    wall.position = new Vector3(x, settings.height / 2 - WALL_SKIRT / 2, z);
    wall.metadata = {
      ...(wall.metadata ?? {}),
      truckCollider: true,
      truckColliderFriction: 0.9,
    };

    const mat = new StandardMaterial(name + "Mat", scene);
    mat.diffuseColor = Color3.FromHexString(settings.color);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    mat.bumpTexture = new Texture(new URL("../assets/normals/8648-normal.jpg", import.meta.url).href, scene);
    mat.bumpTexture.level = 0.7;
    mat.invertNormalMapY = true;
    wall.material = mat;

    new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0 }, scene);

    // Also add to wallManager so they show up on the track editor grid and can be optionally hidden
    let heading, halfLength, halfThick;
    if (width > depth) {
      heading = 0;
      halfLength = width / 2;
      halfThick = depth / 2;
    } else {
      heading = Math.PI / 2;
      halfLength = depth / 2;
      halfThick = width / 2;
    }

    wallManager?._walls.push({
      segments: [{
        position: { x, z },
        heading,
        halfLength,
        halfThick,
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
