import {
  Mesh,
  MeshBuilder,
  VertexData,
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
  constructor(px, pz, centerY, width, height, depth, heading, friction, index, name, scene, shadows, yShiftA = 0, yShiftB = 0) {
    this.halfLength = width / 2;
    this.halfThick  = depth / 2;
    this.heading    = heading;
    this.friction   = friction;
    this._index     = index;

    this._sheared = Math.abs(yShiftA) > 0.001 || Math.abs(yShiftB) > 0.001;
    this.mesh = this._sheared
      ? this._createParallelogramMesh(name, width, height, depth, yShiftA, yShiftB, scene)
      : MeshBuilder.CreateBox(name, { width, height, depth }, scene);
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

  /**
   * Build a sheared box (parallelogram cross-section) so wall segments blend
   * smoothly on sloped terrain instead of producing a stair-step look.
   * yShiftA / yShiftB are vertical offsets at the −X / +X ends of the segment.
   */
  _createParallelogramMesh(name, width, height, depth, yShiftA, yShiftB, scene) {
    const hw = width / 2, hh = height / 2, hd = depth / 2;
    const a = yShiftA, b = yShiftB;

    // 24 vertices (4 per face) so each face gets its own flat-shaded normal
    const positions = [
      // Front face (−Z)
      -hw, a - hh, -hd,   -hw, a + hh, -hd,   +hw, b + hh, -hd,   +hw, b - hh, -hd,
      // Back face (+Z)
      +hw, b - hh, +hd,   +hw, b + hh, +hd,   -hw, a + hh, +hd,   -hw, a - hh, +hd,
      // Top face
      -hw, a + hh, -hd,   -hw, a + hh, +hd,   +hw, b + hh, +hd,   +hw, b + hh, -hd,
      // Bottom face
      -hw, a - hh, +hd,   -hw, a - hh, -hd,   +hw, b - hh, -hd,   +hw, b - hh, +hd,
      // Left face (−X)
      -hw, a - hh, +hd,   -hw, a + hh, +hd,   -hw, a + hh, -hd,   -hw, a - hh, -hd,
      // Right face (+X)
      +hw, b - hh, -hd,   +hw, b + hh, -hd,   +hw, b + hh, +hd,   +hw, b - hh, +hd,
    ];

    const indices = [
      0,1,2,   0,2,3,      // front
      4,5,6,   4,6,7,      // back
      8,9,10,  8,10,11,    // top
      12,13,14,12,14,15,   // bottom
      16,17,18,16,18,19,   // left
      20,21,22,20,22,23,   // right
    ];

    // Manually specify outward-facing normals so lighting is correct in
    // Babylon's left-handed coordinate system (ComputeNormals can flip some
    // face normals inward when vertices are sheared).
    const normals = [
      // Front (−Z)
      0,0,-1,  0,0,-1,  0,0,-1,  0,0,-1,
      // Back (+Z)
      0,0,1,   0,0,1,   0,0,1,   0,0,1,
      // Top — approximate as straight up (tilt is negligible per segment)
      0,1,0,   0,1,0,   0,1,0,   0,1,0,
      // Bottom
      0,-1,0,  0,-1,0,  0,-1,0,  0,-1,0,
      // Left (−X)
      -1,0,0,  -1,0,0,  -1,0,0,  -1,0,0,
      // Right (+X)
      1,0,0,   1,0,0,   1,0,0,   1,0,0,
    ];

    const uvs = [];
    for (let f = 0; f < 6; f++) uvs.push(0, 0, 0, 1, 1, 1, 1, 0);

    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices   = indices;
    vd.normals   = normals;
    vd.uvs       = uvs;
    vd.applyToMesh(mesh);
    return mesh;
  }

  _applyMaterial(scene, shadows) {
    const mat = new StandardMaterial("wallMat", scene);
    const isRed = this._index % 2 === 0;
    mat.diffuseColor  = isRed ? new Color3(0.85, 0.08, 0.08) : new Color3(1.0, 1.0, 1.0);
    mat.specularColor = new Color3(0.2, 0.2, 0.2);
    if (this._sheared) mat.backFaceCulling = false;
    this.mesh.material = mat;
    this.mesh.receiveShadows = true;
    shadows.addShadowCaster(this.mesh);
  }
}
