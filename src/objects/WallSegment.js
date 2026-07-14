import {
  Mesh,
  MeshBuilder,
  VertexData,
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
} from "@babylonjs/core";

/**
 * WallSegment — a single static box physics body (invisible collider).
 */
export class WallSegment {
  constructor(
    px, pz, centerY,
    width, height, depth,
    heading, friction,
    index, style, name,
    scene, shadows,
    yShiftA = 0, yShiftB = 0,
    collidable = true,
    collisionHeight = null,
  ) {
    this.halfLength = width / 2;
    this.halfThick  = depth / 2;
    this.heading    = heading;
    this.friction   = friction;

    const sheared = Math.abs(yShiftA) > 0.001 || Math.abs(yShiftB) > 0.001;
    const physicalHeight = collisionHeight != null ? Number(collisionHeight) : Number(height);
    const mesh = sheared
      ? this._createShearedBox(name, width, physicalHeight, depth, yShiftA, yShiftB, scene)
      : MeshBuilder.CreateBox(name, { width, height: physicalHeight, depth }, scene);

    mesh.position = new Vector3(px, centerY + (physicalHeight - height) / 2, pz);
    mesh.rotation.y = heading;
    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.metadata = {
      ...(mesh.metadata ?? {}),
      truckCollider: collidable,
      truckColliderFriction: Math.max(0, Math.min(1, 1 - friction)),
    };

    this.mesh = mesh;
    this._aggregate = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, {
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

  _createShearedBox(name, width, height, depth, yShiftA, yShiftB, scene) {
    const hw = width / 2, hh = height / 2, hd = depth / 2;
    const a = yShiftA, b = yShiftB;

    const positions = [
      -hw, a - hh, -hd,   -hw, a + hh, -hd,   +hw, b + hh, -hd,   +hw, b - hh, -hd,
      +hw, b - hh, +hd,   +hw, b + hh, +hd,   -hw, a + hh, +hd,   -hw, a - hh, +hd,
      -hw, a + hh, -hd,   -hw, a + hh, +hd,   +hw, b + hh, +hd,   +hw, b + hh, -hd,
      -hw, a - hh, +hd,   -hw, a - hh, -hd,   +hw, b - hh, -hd,   +hw, b - hh, +hd,
      -hw, a - hh, +hd,   -hw, a + hh, +hd,   -hw, a + hh, -hd,   -hw, a - hh, -hd,
      +hw, b - hh, -hd,   +hw, b + hh, -hd,   +hw, b + hh, +hd,   +hw, b - hh, +hd,
    ];

    const indices = [
      0,1,2,   0,2,3,
      4,5,6,   4,6,7,
      8,9,10,  8,10,11,
      12,13,14,12,14,15,
      16,17,18,16,18,19,
      20,21,22,20,22,23,
    ];

    const normals = [
      0,0,-1,  0,0,-1,  0,0,-1,  0,0,-1,
      0,0,1,   0,0,1,   0,0,1,   0,0,1,
      0,1,0,   0,1,0,   0,1,0,   0,1,0,
      0,-1,0,  0,-1,0,  0,-1,0,  0,-1,0,
      -1,0,0,  -1,0,0,  -1,0,0,  -1,0,0,
      1,0,0,   1,0,0,   1,0,0,   1,0,0,
    ];

    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices   = indices;
    vd.normals   = normals;
    vd.applyToMesh(mesh);
    return mesh;
  }
}
