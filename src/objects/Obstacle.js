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
import { basicColors } from "../constants.js";
import tireStackUrl from "../assets/models/tire-stack.obj?url";
import barrelUrl from "../assets/models/barrel.obj?url";
import hayBaleUrl from "../assets/models/hay-bale.obj?url";
import softWallUrl from "../assets/models/soft-wall.obj?url";

OBJFileLoader.MATERIAL_LOADING_FAILS_SILENTLY = true;
OBJFileLoader.SKIP_MATERIALS = true;

const DEFAULT_OBSTACLE_TYPE = "tireStack";

const OBSTACLE_SPECS = {
  tireStack: {
    url: tireStackUrl,
    halfExtents: { x: 0.62, y: 0.56, z: 0.62 },
    mass: 40,
    contactRadius: 0.62,
    linearDamping: 0.6,
    angularDamping: 0.4,
    modelRotationX: -Math.PI / 2,
    modelScale: 0.1,
    modelOffsetY: 0,
    diffuseColor: basicColors.white.diffuse,
    specularColor: new Color3(0.3, 0.3, 0.3),
    specularPower: 10,
  },
  barrel: {
    url: barrelUrl,
    halfExtents: { x: 0.45, y: 0.55, z: 0.45 },
    mass: 20,
    contactRadius: 0.5,
    linearDamping: 0.55,
    angularDamping: 0.35,
    modelRotationX: -Math.PI / 2,
    modelScale: 0.1,
    modelOffsetY: 0,
    diffuseColor: basicColors.white.diffuse,
    specularColor: new Color3(0.3, 0.3, 0.3),
    specularPower: 10,
  },
  hayBale: {
    url: hayBaleUrl,
    halfExtents: { x: 0.8, y: 0.45, z: 0.55 },
    mass: 30,
    contactRadius: 0.8,
    linearDamping: 0.7,
    angularDamping: 0.5,
    modelRotationX: -Math.PI / 2,
    modelScale: 0.1,
    modelOffsetY: 0,
    diffuseColor: basicColors.white.diffuse,
    emissiveColor: basicColors.white.emissive,
    specularColor: new Color3(0.3, 0.3, 0.3),
    specularPower: 10,
  },
  softWall: {
    url: softWallUrl,
    halfExtents: { x: 1.1, y: 0.85, z: 3.2 },
    mass: 80,
    contactRadius: 3.2,
    linearDamping: 0.6,
    angularDamping: 0.4,
    modelRotationX: -Math.PI / 2,
    modelScale: 0.1,
    modelOffsetY: 0,
    diffuseColor: basicColors.white.diffuse,
    specularColor: new Color3(0.3, 0.3, 0.3),
    specularPower: 10,
  },
};

function normalizeObstacleType(type) {
  const raw = String(type ?? "").trim().toLowerCase();
  if (raw === "barrel") return "barrel";
  if (raw === "haybale" || raw === "hay-bale" || raw === "hay_bale") return "hayBale";
  if (raw === "tirestack" || raw === "tire_stack" || raw === "tire-stack") return "tireStack";
  if (raw === "softwall" || raw === "soft_wall" || raw === "soft-wall") return "softWall";
  return DEFAULT_OBSTACLE_TYPE;
}

function normalizeObstacleColor(color) {
  const raw = String(color ?? "").trim().toLowerCase();
  if (raw === "white") return "white";
  if (raw === "red") return "red";
  if (raw === "blue") return "blue";
  if (raw === "black") return "black";
  return "yellow";
}

function getObstacleSpec(type) {
  const key = normalizeObstacleType(type);
  return OBSTACLE_SPECS[key] ?? OBSTACLE_SPECS[DEFAULT_OBSTACLE_TYPE];
}

/**
 * Obstacle — a single rigid obstacle at a fixed world position.
 *
 * Owns one invisible BOX physics body with visual meshes parented to
 * it. The whole group tumbles together when hit by a truck.
 */
export class Obstacle {
  /**
   * @param {number} x
   * @param {number} z
   * @param {number} groundY  - terrain height at (x, z)
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(
    x,
    z,
    groundY,
    scene,
    shadows,
    obstacleType = DEFAULT_OBSTACLE_TYPE,
    angle = 0,
    scale = 1,
    weightOverride = null,
    color = 'yellow'
  ) {
    this.scene = scene;
    this._loadedMeshes = [];
    this.obstacleType = normalizeObstacleType(obstacleType);
    this.color = normalizeObstacleColor(color);
    const spec = getObstacleSpec(this.obstacleType);
    const safeScale = Math.max(0.05, Number(scale) || 1);
    const safeMass = (typeof weightOverride === 'number' && weightOverride > 0)
      ? weightOverride
      : spec.mass;
    this.radius = spec.contactRadius * safeScale;
    this.mass = safeMass;

    const centerY = groundY + (spec.halfExtents.y * safeScale);

    // Invisible physics body used by all obstacle visuals.
    this.body = MeshBuilder.CreateBox(`tireStack_${x}_${z}`, {
      width:  spec.halfExtents.x * 2 * safeScale,
      height: spec.halfExtents.y * 2 * safeScale,
      depth:  spec.halfExtents.z * 2 * safeScale,
    }, scene);
    this.body.position   = new Vector3(x, centerY, z);
    this.body.rotation.y = angle;
    this.body.isVisible  = false;
    this.body.isPickable = false;

    this.aggregate = new PhysicsAggregate(this.body, PhysicsShapeType.BOX, {
      mass:        safeMass,
      restitution: 0.2,
      friction:    0.8,
    }, scene);

    // Linear damping: 0 = slides forever, 1 = stops almost instantly.
    // Angular damping: controls how quickly it stops spinning/tumbling.
    this.aggregate.body.setLinearDamping(spec.linearDamping);
    this.aggregate.body.setAngularDamping(spec.angularDamping);

    // OBJ visual model parented to the physics body so it tumbles with it.
    const tint = basicColors[this.color] ?? basicColors.yellow;
    this._paintMat = new StandardMaterial(`obstacleMat_${x}_${z}`, scene);
    this._paintMat.diffuseColor  = tint.diffuse;
    this._paintMat.emissiveColor = new Color3(0.0, 0.0, 0.0);
    this._paintMat.specularColor = new Color3(0.2, 0.2, 0.2);
    this._paintMat.specularPower = 0;

    // Pivot node: child of body, holds rotation correction so it tumbles with physics
    this._pivot = new TransformNode(`tireStackPivot_${x}_${z}`, scene);
    this._pivot.parent     = this.body;
    this._pivot.position.y = (-spec.halfExtents.y + (spec.modelOffsetY ?? 0)) * safeScale;
    this._pivot.rotation.x = spec.modelRotationX ?? 0;
    this._pivot.scaling.setAll((spec.modelScale ?? 1) * safeScale);

    // Load once, clone per instance
    Obstacle._getSourceMeshes(scene, this.obstacleType)
      .then(sourceMeshes => {
        for (const src of sourceMeshes) {
          const m = src.clone(`tireStackMesh_${x}_${z}`, this._pivot);
          m.isVisible  = true;
          m.material   = this._paintMat;
          m.isPickable = false;
          shadows.addShadowCaster(m);
          m.receiveShadows = true;
          this._loadedMeshes.push(m);
        }
      })
      .catch(err => console.warn(`[Obstacle] Failed to load obstacle '${this.obstacleType}':`, err));
  }

  get position() {
    return this.body.position;
  }

  dispose() {
    this.aggregate.dispose();
    for (const m of this._loadedMeshes) m.dispose();
    this._paintMat?.dispose();
    this._pivot?.dispose();
    this.body.dispose();
    this._loadedMeshes = [];
  }

  // ─── Static shared loader ─────────────────────────────────────────────────

  /** Loads the OBJ once and caches hidden source meshes for cloning. */
  static _getSourceMeshes(scene, obstacleType = DEFAULT_OBSTACLE_TYPE) {
    const key = normalizeObstacleType(obstacleType);
    const spec = getObstacleSpec(key);
    if (!Obstacle._sourcePromises) {
      Obstacle._sourcePromises = new Map();
    }
    const cached = Obstacle._sourcePromises.get(key);
    const cachedSceneDisposed = !!cached?.scene && (
      (typeof cached.scene.isDisposed === 'function' && cached.scene.isDisposed())
      || cached.scene.isDisposed === true
    );
    const shouldReload = !cached
      || cached.scene !== scene
      || cachedSceneDisposed;
    if (shouldReload) {
      const url = spec.url;
      const lastSlash = url.lastIndexOf('/');
      const rootUrl   = url.substring(0, lastSlash + 1);
      const fileName  = url.substring(lastSlash + 1);
      const promise = SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene)
        .then(result => {
          for (const m of result.meshes) {
            m.isVisible  = false;
            m.isPickable = false;
          }
          return result.meshes;
        });
      Obstacle._sourcePromises.set(key, { scene, promise });
    }
    return Obstacle._sourcePromises.get(key).promise;
  }

  /** Call this when unloading a scene so the next scene gets a fresh load. */
  static clearCache() {
    Obstacle._sourcePromises?.clear();
    Obstacle._sourcePromises = null;
  }

}

export { normalizeObstacleType, getObstacleSpec };
