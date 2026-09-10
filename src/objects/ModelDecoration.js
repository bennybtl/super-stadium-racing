import {
  TransformNode,
  SceneLoader,
} from "@babylonjs/core";
import { OBJFileLoader } from "@babylonjs/loaders/OBJ/objFileLoader";
import { MeshMaterialResolver } from "../utils/mesh-materials.js";

OBJFileLoader.MATERIAL_LOADING_FAILS_SILENTLY = true;
OBJFileLoader.SKIP_MATERIALS = true;

const DEFAULT_COLOR = "white";

/**
 * Whether a decoration instance should act as a truck collider: the feature's
 * own toggle, else the def's default, else off.
 */
export function colliderEnabledFor(feature, def) {
  return !!(feature.collider ?? def?.featureDefaults?.collider ?? false);
}

/**
 * Flip `truckCollider` metadata on the meshes a def nominated via
 * `colliderMeshes`. StaticBodyCollisionManager picks these up by scanning the
 * scene, using each mesh's own bounds — so marking just the trunk of a tree
 * gives a trunk-sized collider and leaves the canopy pass-through.
 */
export function applyColliderMetadata(meshes, enabled, def) {
  for (const m of meshes) {
    m.metadata = {
      ...(m.metadata ?? {}),
      truckCollider: enabled,
      truckColliderFriction: def?.colliderFriction ?? 0.9,
    };
  }
}

/**
 * ModelDecoration — a static OBJ prop placed on the terrain, driven entirely by
 * a definition loaded from /src/decorations/<id>.json (see DecorationLoader).
 *
 * Editor-managed like Flag / BannerString (no physics). Only position, heading,
 * scale and colour are meaningful. The heading rotates the container; scale
 * multiplies the base model scale. Colour works like vehicles: meshes named in
 * the def's `meshColors` map (keyed by exact OBJ group name) keep that fixed
 * colour; every other mesh takes the user-chosen colour. A mesh named in
 * `meshTextures` is textured instead of coloured (requires UVs on the model).
 *
 * This generalises the former bespoke Tent object; tent is now just one
 * decoration definition among any number you drop into /src/decorations/.
 */
export class ModelDecoration {
  /**
   * @param {object} feature  track feature { x, z, heading?, scale?, color?, model? }
   * @param {object} def       decoration definition from DecorationLoader
   * @param {number} groundY   terrain height at (x, z)
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator|null} shadows
   */
  constructor(feature, def, groundY, scene, shadows) {
    this.feature = feature;
    this.def     = def;
    this._scene  = scene;
    this._shadows = (def.castsShadows === false) ? null : (shadows ?? null);
    this._meshes = [];
    this.color   = feature.color ?? def.defaultColor ?? DEFAULT_COLOR;

    const id = def.id;
    const tag = `${id}_${feature.x.toFixed(1)}_${feature.z.toFixed(1)}`;

    // Container holds world placement: position + heading + overall user scale.
    // A negative axis scale mirrors the model; Babylon flips face winding for the
    // resulting negative-determinant transform, so it still renders correctly.
    this.container = new TransformNode(`deco_${tag}`, scene);
    this.container.position.copyFromFloats(feature.x, groundY, feature.z);
    this.container.rotation.y = feature.heading ?? 0;
    this._applyScaling();

    // Pivot corrects the model's authored orientation and applies the base
    // scale/offset, independent of the user-facing heading/scale.
    this._pivot = new TransformNode(`decoPivot_${tag}`, scene);
    this._pivot.parent = this.container;
    this._pivot.rotation.x = (def.rotationX ?? 0) * Math.PI / 180; // config is in degrees
    this._pivot.position.y = def.offsetY ?? 0;
    this._pivot.scaling.setAll(def.baseScale ?? 1);

    // Meshes not pinned by meshColors/meshTextures/baked-mtl share this
    // user-tinted material; each pinned mesh gets its own fixed material.
    this._matRes = new MeshMaterialResolver(def, scene, `deco_${tag}`);
    this._matRes.setColor(this.color);

    /** Clones of the meshes named in def.colliderMeshes. */
    this._colliderMeshes = [];

    // Load the model once (cached per scene per def), then clone into this instance.
    // `ready` resolves once the clones exist, so an attached decal can wait for
    // its target meshes before projecting.
    this.ready = ModelDecoration._getSourceMeshes(scene, def)
      .then(sourceMeshes => {
        if (this.container.isDisposed()) return;
        for (const src of sourceMeshes) {
          // Decide from the SOURCE group name before cloning renames the mesh.
          const material = this._matRes.materialFor(src.name);
          const isCollider = !!def.colliderMeshes?.includes(src.name);
          const m = src.clone(`decoMesh_${tag}`, this._pivot);
          m.isVisible  = true;
          m.isPickable = true; // editor selects decorations by clicking their mesh
          m.material   = material;
          // Static OBJ geometry — a decal can be stuck to it (see DecalManager).
          m.metadata = { ...(m.metadata ?? {}), decalTarget: true };
          if (this._shadows) {
            this._shadows.addShadowCaster(m);
            m.receiveShadows = true;
          }
          if (isCollider) this._colliderMeshes.push(m);
          this._meshes.push(m);
        }
        this._applyCollider();
      })
      .catch(err => console.warn(`[ModelDecoration] Failed to load '${def.id}':`, err));
  }

  // ─── Decal attachment (see DecalManager) ────────────────────────────────────

  /** Node a stuck-on decal parents to / stores its position relative to. */
  get decalAnchor() { return this.container; }

  /** Meshes a stuck-on decal may project onto. */
  get decalMeshes() { return this._meshes; }

  _applyCollider() {
    applyColliderMetadata(this._colliderMeshes, colliderEnabledFor(this.feature, this.def), this.def);
  }

  /** Editor toggle: make the def's nominated meshes solid to trucks. */
  setCollider(on) {
    this.feature.collider = !!on;
    this._applyCollider();
  }

  // ─── Editor helpers ─────────────────────────────────────────────────────────

  containsMesh(mesh) {
    return this._meshes.includes(mesh);
  }

  get position() {
    return this.container.position.clone();
  }

  moveTo(x, z, groundY) {
    this.feature.x = x;
    this.feature.z = z;
    this.container.position.copyFromFloats(x, groundY, z);
  }

  setHeading(radians) {
    this.feature.heading = radians;
    this.container.rotation.y = radians;
  }

  setScale(newScale) {
    this.feature.scale = Math.max(0.1, Number(newScale) || 1);
    this._applyScaling();
  }

  setMirrorX(on) {
    this.feature.mirrorX = !!on;
    this._applyScaling();
  }

  setMirrorZ(on) {
    this.feature.mirrorZ = !!on;
    this._applyScaling();
  }

  /** Apply scale + mirror flags to the container's per-axis scaling. */
  _applyScaling() {
    const s = Math.max(0.1, Number(this.feature.scale) || 1);
    this.container.scaling.set(
      this.feature.mirrorX ? -s : s,
      s,
      this.feature.mirrorZ ? -s : s,
    );
  }

  setColor(color) {
    this.color = color;
    this.feature.color = color;
    this._matRes.setColor(color);
  }

  dispose() {
    for (const m of this._meshes) m.dispose();
    this._meshes = [];
    this._matRes.dispose();
    this._pivot?.dispose();
    this.container.dispose();
  }

  // ─── Static shared loader ─────────────────────────────────────────────────

  /**
   * Loads a decoration OBJ once per scene per def and caches hidden source
   * meshes for cloning. Keyed by def id so different decorations don't collide.
   */
  static _getSourceMeshes(scene, def) {
    if (!ModelDecoration._sourcePromises) {
      ModelDecoration._sourcePromises = new Map();
    }
    const key = def.id;
    const cached = ModelDecoration._sourcePromises.get(key);
    const cachedSceneDisposed = !!cached?.scene && (
      (typeof cached.scene.isDisposed === 'function' && cached.scene.isDisposed())
      || cached.scene.isDisposed === true
    );
    if (!cached || cached.scene !== scene || cachedSceneDisposed) {
      const url = def.modelUrl;
      if (!url) {
        // No resolved OBJ (missing/renamed modelFile, or a def that should have
        // had a controller). Fail soft with an empty mesh set rather than
        // crashing the whole scene build.
        console.error(`[ModelDecoration] "${def.id}" has no modelUrl (modelFile: ${def.modelFile ?? 'none'}); skipping`);
        const empty = Promise.resolve([]);
        ModelDecoration._sourcePromises.set(key, { scene, promise: empty });
        return empty;
      }
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
      ModelDecoration._sourcePromises.set(key, { scene, promise });
    }
    return ModelDecoration._sourcePromises.get(key).promise;
  }

  /**
   * Public entry point for decoration controllers that build their own geometry
   * from a def's OBJ (e.g. a unit repeated into a larger structure). Resolves to
   * hidden source meshes to clone; the load is cached per scene per def.
   */
  static loadSourceMeshes(scene, def) {
    return ModelDecoration._getSourceMeshes(scene, def);
  }

  /** Call this when unloading a scene so the next scene gets a fresh load. */
  static clearCache() {
    ModelDecoration._sourcePromises?.clear();
    ModelDecoration._sourcePromises = null;
  }
}
