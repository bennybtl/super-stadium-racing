import { Matrix, MeshBuilder, PhysicsAggregate, PhysicsShapeType, Vector3 } from "@babylonjs/core";
import { BridgeMesh } from "./BridgeMesh.js";
import { TRUCK_HALF_HEIGHT } from "../constants.js";

// Extra depth below the lowest terrain corner so a solid-base box never shows
// a gap between its sides and the ground.
const SOLID_BASE_MARGIN = 0.5;

function _rotateVector(x, z, rotationDeg = 0) {
  const rad = rotationDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: x * cos - z * sin,
    z: x * sin + z * cos,
  };
}

function _resolveHeights(feature) {
  const sloped = feature.heightAtMin !== undefined;
  const hLo = sloped ? (feature.heightAtMin ?? 0) : (feature.height ?? 2);
  const hHi = sloped ? (feature.heightAtMax ?? hLo) : (feature.height ?? 2);
  return { hLo, hHi };
}

/**
 * Derive a 2×2 bridgeMesh-shaped feature from a driveBox feature. The driveBox
 * stores terrain-relative heights (squareHill feel); the derived grid carries
 * the absolute world-Y heights BridgeMesh expects.
 *
 * Heights resolve against a plane fitted through the terrain at the four
 * footprint corners, not a single center sample, so a box sitting on a slope
 * tilts with the ground instead of staying level (which buried its uphill edge
 * and floated the downhill one). Averaging the corners is the least-squares fit
 * for four points on a rectangle, so local bumps don't drag the whole box. The
 * surface stays planar — a wedge's own rise is added on top of the terrain tilt.
 */
export function deriveDriveBoxGrid(feature, track) {
  const {
    centerX, centerZ,
    width, depth,
    rotation = 0,
    solidBase = true,
    thickness = 0.4,
    layerId = 0,
  } = feature;

  const { hLo, hHi } = _resolveHeights(feature);
  const halfW = width / 2;
  const halfD = depth / 2;

  // Corner order matches the row-major 2×2 grid _gridPoints builds:
  // r0c0 (−X,−Z), r0c1 (+X,−Z), r1c0 (−X,+Z), r1c1 (+X,+Z).
  const localCorners = [[-halfW, -halfD], [halfW, -halfD], [-halfW, halfD], [halfW, halfD]];
  const centerTerrainY = track?.getHeightAt?.(centerX, centerZ) ?? 0;
  const cornerTerrainY = localCorners.map(([lx, lz]) => {
    const rotated = _rotateVector(lx, lz, rotation);
    return track?.getHeightAt?.(centerX + rotated.x, centerZ + rotated.z) ?? centerTerrainY;
  });

  const baseY = (cornerTerrainY[0] + cornerTerrainY[1] + cornerTerrainY[2] + cornerTerrainY[3]) / 4;
  const terrainGradX = width > 0
    ? ((cornerTerrainY[1] + cornerTerrainY[3]) - (cornerTerrainY[0] + cornerTerrainY[2])) / (2 * width)
    : 0;
  const terrainGradZ = depth > 0
    ? ((cornerTerrainY[2] + cornerTerrainY[3]) - (cornerTerrainY[0] + cornerTerrainY[1])) / (2 * depth)
    : 0;

  const heights = localCorners.map(([lx, lz]) =>
    baseY + terrainGradX * lx + terrainGradZ * lz + (lx < 0 ? hLo : hHi)
  );

  let resolvedThickness = Math.max(0.1, thickness);
  if (solidBase) {
    // Deep enough that the flat bottom clears the terrain at every corner, so
    // the sides visually extend into the ground. Now that the top tracks the
    // terrain plane this stays close to the box's own height instead of growing
    // with the slope.
    let maxDrop = 0;
    for (let i = 0; i < heights.length; i++) {
      maxDrop = Math.max(maxDrop, heights[i] - cornerTerrainY[i]);
    }
    resolvedThickness = Math.max(0.1, maxDrop + SOLID_BASE_MARGIN);
  }

  return {
    type: 'bridgeMesh',
    centerX, centerZ,
    width, depth,
    cols: 2, rows: 2,
    heights,
    rotation,
    thickness: resolvedThickness,
    layerId,
    color: feature.color,
    sideColor: feature.sideColor,
  };
}

/**
 * DriveBox — a parametric drivable box or wedge (ramps, boxes, thin flat
 * bridges). Internally composes a BridgeMesh built from a derived 2×2 grid,
 * inheriting its material, drive-surface registration, topology nodes, and
 * terrain seams — plus an invisible side collider (see _buildCollider) on boxes
 * tall enough to need one, so trucks bump off the faces instead of being lifted
 * onto the top by the floor raycast.
 *
 * Feature format:
 *   {
 *     type:        'driveBox',
 *     centerX:     number,
 *     centerZ:     number,
 *     width:       number,   // local X extent (slope runs along X in wedge mode)
 *     depth:       number,   // local Z extent
 *     rotation:    number,   // yaw in degrees (bridgeMesh convention)
 *     height:      number,   // flat mode: clearance above the terrain plane
 *     heightAtMin: number,   // wedge mode (presence switches, like squareHill)
 *     heightAtMax: number,   //   clearance above terrain at the −X / +X edges
 *     solidBase:   boolean,  // true (default): base extends to terrain
 *     thickness:   number,   // slab thickness when solidBase is false
 *     layerId:     number,   // surface layer id (default 0)
 *     color:       string,   // top face: hex for flat diffuse, else terrain look
 *     sideColor:   string,   // sides + bottom; absent = same material as the top
 *   }
 */
export class DriveBox {
  constructor(feature, track, scene, shadows = null, driveSurfaceManager = null, terrainBlendConfig = null) {
    this.feature = feature;
    this._scene = scene;

    const derived = deriveDriveBoxGrid(feature, track);
    this._bridge = new BridgeMesh(derived, track, scene, shadows, driveSurfaceManager, terrainBlendConfig);
    this._buildCollider(feature, derived, scene);
  }

  get _bridgeMeshKey() {
    return this._bridge._bridgeMeshKey;
  }

  updateTerrainSeamSurfaces(sides) {
    this._bridge.updateTerrainSeamSurfaces(sides);
  }

  /**
   * One oriented box collider for the sides, rolled about its local Z for a
   * wedge (roll applies before yaw in Babylon's YawPitchRoll order) so it hugs
   * the ramp instead of walling off its bounding box.
   *
   * Its top is inset TRUCK_HALF_HEIGHT below the drive surface, because
   * StaticBodyCollisionManager inflates every collider by the truck's extents
   * (Minkowski sum) before resolving. That inflation puts the effective wall top
   * back at the drive surface exactly, which is what we want: a truck whose body
   * sits at or above the top surface never collides, so arriving from a ramp or
   * an adjoining box passes straight on, while anything genuinely below the top
   * is blocked by the side faces.
   *
   * A slab thinner than TRUCK_HALF_HEIGHT gets no collider at all — there is no
   * part of it a truck can be beside without also being under it. Those behave
   * like a plain bridge deck: drive under freely, drive on top via the raycast.
   */
  _buildCollider(feature, derived, scene) {
    const { centerX, centerZ, width, depth, rotation = 0 } = feature;
    const { heights, thickness } = derived;
    const [h00, h01, h10, h11] = heights;

    const colliderHeight = thickness - TRUCK_HALF_HEIGHT;
    if (colliderHeight <= 0.05) return;

    // Read the finished top surface rather than the wedge rise alone, so the
    // collider follows the terrain tilt baked into `heights` too.
    const gradX = width > 0 ? ((h01 + h11) - (h00 + h10)) / (2 * width) : 0;
    const gradZ = depth > 0 ? ((h10 + h11) - (h00 + h01)) / (2 * depth) : 0;
    const centroidY = (h00 + h01 + h10 + h11) / 4;

    // Babylon's rotation.y is the opposite sign of the _rotateVector convention.
    // Roll (about local Z) tilts the surface along local X; pitch (about local X)
    // tilts it along local Z — exact for either alone, a close approximation for
    // the combination, which the TRUCK_HALF_HEIGHT inset absorbs.
    const yaw = -rotation * Math.PI / 180;
    const roll = Math.atan(gradX);
    const pitch = -Math.atan(gradZ);

    const box = MeshBuilder.CreateBox(
      `drive_box_collider_${centerX}_${centerZ}`,
      {
        width: width * Math.hypot(1, gradX),
        height: colliderHeight,
        depth: depth * Math.hypot(1, gradZ),
      },
      scene
    );
    box.isVisible = false;
    box.isPickable = false;
    box.rotation.set(pitch, yaw, roll);

    // Sit the box's top-center at the surface centroid, lowered by the inset.
    const topOffset = Vector3.TransformNormal(
      new Vector3(0, colliderHeight / 2, 0),
      Matrix.RotationYawPitchRoll(yaw, pitch, roll)
    );
    box.position = new Vector3(
      centerX - topOffset.x,
      centroidY - TRUCK_HALF_HEIGHT - topOffset.y,
      centerZ - topOffset.z
    );

    box.metadata = { truckCollider: true };

    this._colliderMesh = box;
    this._colliderAggregate = new PhysicsAggregate(box, PhysicsShapeType.BOX, { mass: 0 }, scene);
  }

  dispose() {
    this._colliderAggregate?.dispose?.();
    this._colliderAggregate = null;
    this._colliderMesh?.dispose();
    this._colliderMesh = null;
    this._bridge.dispose();
    this._bridge = null;
  }
}
