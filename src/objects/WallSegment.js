import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
} from "@babylonjs/core";

/**
 * WallSegment — a single static box physics body representing one piece of a wall.
 *
 * Owns the Babylon mesh, physics aggregate, and the collision metadata
 * (halfLength, halfThick, heading, friction) used by WallManager for
 * per-frame truck collision resolution.
 */
export class WallSegment {
  /**
   * @param {number} px       - world X centre
   * @param {number} pz       - world Z centre
   * @param {number} centerY  - world Y centre of the box
   * @param {number} width    - box width (along the wall face)
   * @param {number} height   - box height
   * @param {number} depth    - box depth (wall thickness)
   * @param {number} heading  - rotation around Y (radians)
   * @param {number} friction - tangential speed bleed on impact (0–1)
   * @param {number} index    - segment index (0-based) used for alternating colour
   * @param {string} name     - mesh name for debugging
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(px, pz, centerY, width, height, depth, heading, friction, index, name, scene, shadows) {
    this.halfLength = width / 2;
    this.halfThick  = depth / 2;
    this.heading    = heading;
    this.friction   = friction;
    this._index     = index;

    this.mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    this.mesh.position = new Vector3(px, centerY, pz);
    this.mesh.rotation.y = heading;

    this._applyMaterial(scene, shadows);

    this._aggregate = new PhysicsAggregate(this.mesh, PhysicsShapeType.BOX, {
      mass: 0,
      restitution: 0.2,
      friction: 0.8,
    }, scene);
  }

  get position() {
    return this.mesh.position;
  }

  dispose() {
    if (this._aggregate) this._aggregate.dispose();
    this.mesh.dispose();
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _applyMaterial(scene, shadows) {
    const mat = new StandardMaterial("wallMat", scene);
    const isRed = this._index % 2 === 0;
    mat.diffuseColor  = isRed ? new Color3(0.85, 0.08, 0.08) : new Color3(1.0, 1.0, 1.0);
    mat.specularColor = new Color3(0.2, 0.2, 0.2);
    this.mesh.material = mat;
    this.mesh.receiveShadows = true;
    shadows.addShadowCaster(this.mesh);
  }
}
