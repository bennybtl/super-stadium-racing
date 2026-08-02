import { MeshBuilder, PhysicsAggregate, PhysicsShapeType, Vector3 } from "@babylonjs/core";
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
 * the absolute world-Y heights BridgeMesh expects, resolved against the terrain
 * under the feature center at build time.
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
  const terrainY = track?.getHeightAt?.(centerX, centerZ) ?? 0;
  const yLo = terrainY + hLo;
  const yHi = terrainY + hHi;

  let resolvedThickness = Math.max(0.1, thickness);
  if (solidBase) {
    // Deep enough that the flat bottom ends up below the lowest terrain corner,
    // so the sides visually extend into the ground.
    const halfW = width / 2;
    const halfD = depth / 2;
    let maxDrop = 0;
    for (const [lx, lz] of [[-halfW, -halfD], [halfW, -halfD], [-halfW, halfD], [halfW, halfD]]) {
      const rotated = _rotateVector(lx, lz, rotation);
      const cornerTerrainY = track?.getHeightAt?.(centerX + rotated.x, centerZ + rotated.z) ?? terrainY;
      const topY = lx < 0 ? yLo : yHi;
      maxDrop = Math.max(maxDrop, topY - cornerTerrainY);
    }
    resolvedThickness = Math.max(0.1, maxDrop + SOLID_BASE_MARGIN);
  }

  return {
    type: 'bridgeMesh',
    centerX, centerZ,
    width, depth,
    cols: 2, rows: 2,
    // Row-major 2×2; X varies by column, so column 0 = −X edge, column 1 = +X.
    heights: [yLo, yHi, yLo, yHi],
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
 *     height:      number,   // flat mode: top height above terrain at center
 *     heightAtMin: number,   // wedge mode (presence switches, like squareHill)
 *     heightAtMax: number,   //   heights above terrain at the −X / +X edges
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
    const yLo = heights[0];
    const yHi = heights[1];

    const colliderHeight = thickness - TRUCK_HALF_HEIGHT;
    if (colliderHeight <= 0.05) return;

    const rise = yHi - yLo;
    const slopeAngle = Math.atan2(rise, width);
    const slopeLength = Math.hypot(width, rise);

    const box = MeshBuilder.CreateBox(
      `drive_box_collider_${centerX}_${centerZ}`,
      { width: slopeLength, height: colliderHeight, depth },
      scene
    );
    box.isVisible = false;
    box.isPickable = false;
    // Babylon's rotation.y is the opposite sign of the _rotateVector convention.
    box.rotation.set(0, -rotation * Math.PI / 180, slopeAngle);

    // Place the box so its top-center sits at the slope midpoint, lowered by the
    // inset. The local top-center offset (0, H/2, 0) under roll φ becomes
    // (−(H/2)sinφ, (H/2)cosφ, 0).
    const halfH = colliderHeight / 2;
    const topOffsetLocalX = -halfH * Math.sin(slopeAngle);
    const topOffsetY = halfH * Math.cos(slopeAngle);
    const rotatedOffset = _rotateVector(topOffsetLocalX, 0, rotation);
    box.position = new Vector3(
      centerX - rotatedOffset.x,
      (yLo + yHi) / 2 - TRUCK_HALF_HEIGHT - topOffsetY,
      centerZ - rotatedOffset.z
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
