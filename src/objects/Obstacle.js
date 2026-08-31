import {
  MeshBuilder,
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
  SceneLoader,
  TransformNode,
} from "@babylonjs/core";
import { OBJFileLoader } from "@babylonjs/loaders/OBJ/objFileLoader";
import { MeshMaterialResolver } from "../utils/mesh-materials.js";
import { unitSizeOf } from "../utils/mesh-bounds.js";

OBJFileLoader.MATERIAL_LOADING_FAILS_SILENTLY = true;
OBJFileLoader.SKIP_MATERIALS = true;

const DEFAULT_OBSTACLE_TYPE = "tireStack";

/** The obstacle loader, exposed on window by main.js. */
function getObstacleLoader() {
  return typeof window !== "undefined" ? window.obstacleLoader : null;
}

/**
 * Resolve any user-facing obstacle-type string to a loaded obstacle id.
 * Definitions come from /src/obstacles/*.json (see ObstacleLoader) — adding a
 * new obstacle needs no change here, it just becomes a valid `type`.
 */
function normalizeObstacleType(type) {
  const loader = getObstacleLoader();
  const raw = String(type ?? "").trim();
  if (loader?.getObstacle(raw)) return raw;
  // Legacy/loose forms (e.g. "tire-stack", "HayBale") still resolve.
  const lower = raw.toLowerCase().replace(/[-_]/g, "");
  if (loader) {
    for (const id of loader.obstacleList) {
      if (id.toLowerCase() === lower) return id;
    }
  }
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

/** The obstacle definition (JSON config) for a type, or the default type's. */
function getObstacleSpec(type) {
  const loader = getObstacleLoader();
  const key = normalizeObstacleType(type);
  return loader?.getObstacle(key) ?? loader?.getObstacle(DEFAULT_OBSTACLE_TYPE) ?? null;
}

/**
 * Clamp a unit count for a stackable obstacle (one whose def declares
 * `stack: { min, max, default }`, e.g. the tire pile — see modelFile in
 * tireStack.json). Non-stackable obstacles always report a count of 1.
 */
function clampObstacleCount(value, spec) {
  const stack = spec?.stack;
  if (!stack) return 1;
  const fallback = stack.default ?? stack.min ?? 1;
  if (value === null || value === undefined || value === "") return fallback;
  const n = Math.round(Number(value));
  const safe = Number.isFinite(n) ? n : fallback;
  return Math.min(stack.max ?? 8, Math.max(stack.min ?? 1, safe));
}

/**
 * Default total mass for a spec at a given stack count. For a stackable
 * obstacle, `spec.mass` is the mass of ONE unit (see tireStack.json) — the
 * default weight scales with how many are piled up. Non-stackable obstacles
 * just use `spec.mass` as-is.
 */
function getDefaultMass(spec, count = 1) {
  if (!spec) return 1;
  return spec.stack ? spec.mass * Math.max(1, count) : spec.mass;
}

/**
 * Obstacle — a single rigid obstacle at a fixed world position.
 *
 * Owns one invisible BOX physics body with visual meshes parented to
 * it. The whole group tumbles together when hit by a truck.
 *
 * Visuals and materials are driven entirely by a definition loaded from
 * /src/obstacles/<id>.json (see ObstacleLoader) — same JSON-config pattern as
 * decorations (/src/decorations/, ModelDecoration). A mesh named in the def's
 * `meshColors`/`colorableMeshes`/baked-mtl keeps a fixed colour (e.g. a
 * barrel's steel hoops); every other mesh takes the instance's paint colour.
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
    color = 'yellow',
    count = null
  ) {
    this.scene = scene;
    this._loadedMeshes = [];
    this._disposed = false;
    this.obstacleType = normalizeObstacleType(obstacleType);
    this.color = normalizeObstacleColor(color);
    const spec = getObstacleSpec(this.obstacleType);
    const safeScale = Math.max(0.05, Number(scale) || 1);
    // For a stackable obstacle (spec.stack, e.g. the tire pile), halfExtents
    // and mass in the def are for ONE unit — scale them up to the pile.
    this.count = clampObstacleCount(count, spec);
    const halfExtents = spec.stack
      ? { x: spec.halfExtents.x, y: spec.halfExtents.y * this.count, z: spec.halfExtents.z }
      : spec.halfExtents;
    const safeMass = (typeof weightOverride === 'number' && weightOverride > 0)
      ? weightOverride
      : getDefaultMass(spec, this.count);
    this.radius = spec.contactRadius * safeScale;
    this.mass = safeMass;
    // World-space half-extents and yaw of the physics body — used by
    // ObstacleManager's oriented truck-overlap test.
    this.halfExtents = {
      x: halfExtents.x * safeScale,
      y: halfExtents.y * safeScale,
      z: halfExtents.z * safeScale,
    };
    this.angle = angle;

    const centerY = groundY + (halfExtents.y * safeScale);

    // Invisible physics body used by all obstacle visuals.
    this.body = MeshBuilder.CreateBox(`tireStack_${x}_${z}`, {
      width:  halfExtents.x * 2 * safeScale,
      height: halfExtents.y * 2 * safeScale,
      depth:  halfExtents.z * 2 * safeScale,
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
    // Meshes not pinned by the def (meshColors/colorableMeshes/baked-mtl)
    // share this instance's paint colour.
    this._matRes = new MeshMaterialResolver(spec, scene, `obstacle_${x}_${z}`);
    this._matRes.setColor(this.color);

    // Pivot node: child of body, holds rotation correction so it tumbles with physics
    this._pivot = new TransformNode(`tireStackPivot_${x}_${z}`, scene);
    this._pivot.parent     = this.body;
    this._pivot.position.y = (-halfExtents.y + (spec.offsetY ?? 0)) * safeScale;
    this._pivot.rotation.x = (spec.rotationX ?? 0) * Math.PI / 180; // config is in degrees
    this._pivot.scaling.setAll((spec.baseScale ?? 1) * safeScale);

    // Load once, clone per instance
    Obstacle._getSourceMeshes(scene, this.obstacleType)
      .then(sourceMeshes => {
        // If the obstacle was disposed while the OBJ was still loading (e.g. the
        // editor disposes the runtime ObstacleManager right after buildScene),
        // its _pivot is gone. Cloning onto a disposed parent leaves an orphan
        // mesh stranded at the world origin — bail instead.
        if (this._disposed) return;
        // A stackable obstacle clones the unit `count` times, stacked along Y
        // using the model's own bounding-box height as the repeat pitch (same
        // technique as the decorations' scaffold arch) — unit 0 sits with its
        // base at the pivot's local origin, each further unit directly above it.
        const repeats = spec.stack ? this.count : 1;
        const unit = spec.stack ? unitSizeOf(sourceMeshes) : null;
        for (let i = 0; i < repeats; i++) {
          const yOffset = unit ? i * unit.y - unit.minY : 0;
          for (const src of sourceMeshes) {
            const m = src.clone(`tireStackMesh_${x}_${z}_${i}`, this._pivot);
            m.position.y = yOffset;
            m.isVisible  = true;
            m.material   = this._matRes.materialFor(src.name);
            m.isPickable = false;
            shadows.addShadowCaster(m);
            m.receiveShadows = true;
            this._loadedMeshes.push(m);
          }
        }
      })
      .catch(err => console.warn(`[Obstacle] Failed to load obstacle '${this.obstacleType}':`, err));
  }

  get position() {
    return this.body.position;
  }

  dispose() {
    this._disposed = true;
    this.aggregate.dispose();
    for (const m of this._loadedMeshes) m.dispose();
    this._matRes?.dispose();
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
      const url = spec.modelUrl;
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

export { normalizeObstacleType, getObstacleSpec, clampObstacleCount, getDefaultMass };
