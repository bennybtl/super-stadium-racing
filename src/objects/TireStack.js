import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
  SceneLoader,
  TransformNode,
} from "@babylonjs/core";
import { OBJFileLoader } from "@babylonjs/loaders/OBJ/objFileLoader";
import tireStackUrl from "../assets/tire-stack.obj?url";

OBJFileLoader.MATERIAL_LOADING_FAILS_SILENTLY = true;
OBJFileLoader.SKIP_MATERIALS = true;

const TIRE_OUTER_RADIUS = 0.62; // outer radius of the torus
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
    this._loadedMeshes = [];

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

    // OBJ visual model parented to the physics body so it tumbles with it
    this._tireMat = new StandardMaterial(`tireStackMat_${x}_${z}`, scene);
    this._tireMat.diffuseColor  = new Color3(0.8, 0.5, 0.1);
    this._tireMat.specularColor = new Color3(0.3, 0.2, 0.05);
    this._tireMat.specularPower = 32;

    // Pivot node: child of body, holds rotation correction so it tumbles with physics
    this._pivot = new TransformNode(`tireStackPivot_${x}_${z}`, scene);
    this._pivot.parent     = this.body;
    this._pivot.position.y = -stackHeight / 2;
    this._pivot.rotation.x = -Math.PI / 2;

    // Load once, clone per instance
    TireStack._getSourceMeshes(scene)
      .then(sourceMeshes => {
        for (const src of sourceMeshes) {
          const m = src.clone(`tireStackMesh_${x}_${z}`, this._pivot);
          m.isVisible  = true;
          m.material   = this._tireMat;
          m.isPickable = false;
          shadows.addShadowCaster(m);
          m.receiveShadows = true;
          this._loadedMeshes.push(m);
        }
      })
      .catch(err => console.warn('[TireStack] Failed to load tire-stack.obj:', err));
  }

  get position() {
    return this.body.position;
  }

  dispose() {
    this.aggregate.dispose();
    for (const m of this._loadedMeshes) m.dispose();
    this._tireMat?.dispose();
    this._pivot?.dispose();
    this.body.dispose();
    this._loadedMeshes = [];
  }

  // ─── Static shared loader ─────────────────────────────────────────────────

  /** Loads the OBJ once and caches hidden source meshes for cloning. */
  static _getSourceMeshes(scene) {
    if (!TireStack._sourcePromise) {
      const lastSlash = tireStackUrl.lastIndexOf('/');
      const rootUrl   = tireStackUrl.substring(0, lastSlash + 1);
      const fileName  = tireStackUrl.substring(lastSlash + 1);
      TireStack._sourcePromise = SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene)
        .then(result => {
          for (const m of result.meshes) {
            m.isVisible  = false;
            m.isPickable = false;
          }
          return result.meshes;
        });
    }
    return TireStack._sourcePromise;
  }

  /** Call this when unloading a scene so the next scene gets a fresh load. */
  static clearCache() {
    TireStack._sourcePromise = null;
  }

}

export { TIRE_OUTER_RADIUS, STACK_MASS };
