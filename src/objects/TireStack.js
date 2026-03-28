import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
} from "@babylonjs/core";

const TIRE_OUTER_RADIUS = 0.42; // outer radius of the torus
const TIRE_TUBE_RADIUS  = 0.14; // thickness of the torus tube
const TIRE_HEIGHT       = TIRE_TUBE_RADIUS * 2; // how tall one tire sits
const TIRES_PER_STACK   = 4;
const STACK_MASS        = 40;   // total mass of the whole rigid stack

/**
 * TireStack — a single rigid stack of tires at a fixed world position.
 *
 * Owns one invisible BOX physics body with torus visual meshes parented to
 * it. The whole group tumbles together when hit by a truck.
 */
export class TireStack {
  /**
   * @param {number} x
   * @param {number} z
   * @param {number} groundY  - terrain height at (x, z)
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(x, z, groundY, scene, shadows) {
    this.scene = scene;

    const stackHeight  = TIRES_PER_STACK * TIRE_HEIGHT * 2;
    const stackCentreY = groundY + stackHeight / 2;

    // Invisible physics body — a box that tightly wraps all tires
    this.body = MeshBuilder.CreateBox(`tireStack_${x}_${z}`, {
      width:  TIRE_OUTER_RADIUS * 2,
      height: stackHeight,
      depth:  TIRE_OUTER_RADIUS * 2,
    }, scene);
    this.body.position   = new Vector3(x, stackCentreY, z);
    this.body.isVisible  = false;
    this.body.isPickable = false;

    this.aggregate = new PhysicsAggregate(this.body, PhysicsShapeType.BOX, {
      mass:        STACK_MASS,
      restitution: 0.2,
      friction:    0.8,
    }, scene);

    // Linear damping: 0 = slides forever, 1 = stops almost instantly.
    // Angular damping: controls how quickly it stops spinning/tumbling.
    this.aggregate.body.setLinearDamping(0.6);
    this.aggregate.body.setAngularDamping(0.4);

    // Visual torus meshes parented to the body — they move with it for free
    this.tires = [];
    for (let i = 0; i < TIRES_PER_STACK; i++) {
      const tire = MeshBuilder.CreateTorus(`tire_${x}_${z}_${i}`, {
        diameter:     TIRE_OUTER_RADIUS * 2,
        thickness:    TIRE_TUBE_RADIUS * 2,
        tessellation: 16,
      }, scene);

      const localY = -stackHeight / 2 + TIRE_TUBE_RADIUS + i * TIRE_HEIGHT;
      tire.position   = new Vector3(0, localY, 0);
      tire.rotation.y = Math.PI / 2; // lay flat
      tire.parent     = this.body;

      this._applyTireMaterial(tire);
      shadows.addShadowCaster(tire);
      tire.receiveShadows = true;
      this.tires.push(tire);
    }
  }

  get position() {
    return this.body.position;
  }

  dispose() {
    this.aggregate.dispose();
    for (const tire of this.tires) tire.dispose();
    this.body.dispose();
    this.tires = [];
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _applyTireMaterial(mesh) {
    const mat = new StandardMaterial("tireMat", this.scene);
    mat.diffuseColor  = new Color3(0.08, 0.08, 0.08);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    mesh.material = mat;
  }
}

export { TIRE_OUTER_RADIUS, STACK_MASS };
