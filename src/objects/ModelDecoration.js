import {
  StandardMaterial,
  Color3,
  Texture,
  TransformNode,
  SceneLoader,
} from "@babylonjs/core";
import { OBJFileLoader } from "@babylonjs/loaders/OBJ/objFileLoader";
import { basicColors } from "../constants.js";

OBJFileLoader.MATERIAL_LOADING_FAILS_SILENTLY = true;
OBJFileLoader.SKIP_MATERIALS = true;

const DEFAULT_COLOR = "white";

/** Parse a mesh colour value: [r,g,b] (0..1) or a "#rrggbb"/"rrggbb" hex string. */
function parseMeshColor(value) {
  if (Array.isArray(value) && value.length === 3) {
    return new Color3(value[0], value[1], value[2]);
  }
  if (typeof value === "string") {
    const hex = value.trim().replace(/^#/, "");
    if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
      const n = parseInt(hex, 16);
      return new Color3(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
    }
  }
  return null;
}

/**
 * ModelDecoration — a static OBJ prop placed on the terrain, driven entirely by
 * a definition loaded from /decorations/<id>.json (see DecorationLoader).
 *
 * Editor-managed like Flag / BannerString (no physics). Only position, heading,
 * scale and colour are meaningful. The heading rotates the container; scale
 * multiplies the base model scale. Colour works like vehicles: meshes named in
 * the def's `meshColors` map (keyed by exact OBJ group name) keep that fixed
 * colour; every other mesh takes the user-chosen colour. A mesh named in
 * `meshTextures` is textured instead of coloured (requires UVs on the model).
 *
 * This generalises the former bespoke Tent object; tent is now just one
 * decoration definition among any number you drop into /decorations/.
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

    // Meshes not named in `meshColors` share this user-tinted material; each
    // named mesh gets its own fixed material keyed by the group name.
    this._colorMaterial = new StandardMaterial(`decoColorMat_${tag}`, scene);
    this._colorMaterial.specularColor = new Color3(0.15, 0.15, 0.15);
    this._colorMaterial.specularPower = 0;
    this._applyColorToMaterial(this.color);

    /** @type {Map<string, StandardMaterial>} group name → fixed material */
    this._fixedMaterials = new Map();
    /** @type {Map<string, StandardMaterial>} group name → textured material */
    this._texturedMaterials = new Map();

    // Load the model once (cached per scene per def), then clone into this instance.
    ModelDecoration._getSourceMeshes(scene, def)
      .then(sourceMeshes => {
        if (this.container.isDisposed()) return;
        for (const src of sourceMeshes) {
          // Decide from the SOURCE group name before cloning renames the mesh.
          const material = this._materialForMesh(src.name, scene, tag);
          const m = src.clone(`decoMesh_${tag}`, this._pivot);
          m.isVisible  = true;
          m.isPickable = true; // editor selects decorations by clicking their mesh
          m.material   = material;
          if (this._shadows) {
            this._shadows.addShadowCaster(m);
            m.receiveShadows = true;
          }
          this._meshes.push(m);
        }
      })
      .catch(err => console.warn(`[ModelDecoration] Failed to load '${def.id}':`, err));
  }

  /**
   * Pick the material for a source mesh, by exact OBJ group name:
   *   1. a `meshTextures` entry → textured material (needs UVs on the model),
   *   2. else a `meshColors` entry → fixed-colour material,
   *   3. else the shared user-colour material.
   */
  _materialForMesh(name, scene, tag) {
    const tex = this.def.meshTextureUrls?.[name];
    if (tex) return this._texturedMaterial(name, tex, scene, tag);

    const value = this.def.meshColors?.[name];
    const fixed = value != null ? parseMeshColor(value) : null;
    if (fixed) return this._fixedMaterial(name, fixed, scene, tag);

    return this._colorMaterial;
  }

  _texturedMaterial(name, tex, scene, tag) {
    let mat = this._texturedMaterials.get(name);
    if (!mat) {
      mat = new StandardMaterial(`decoTexMat_${name}_${tag}`, scene);
      const texture = new Texture(tex.url, scene);
      // Tile/pan the texture across the mesh's UVs (repeat wrap so scale > 1 tiles).
      texture.wrapU = Texture.WRAP_ADDRESSMODE;
      texture.wrapV = Texture.WRAP_ADDRESSMODE;
      texture.uScale  = tex.uScale ?? 1;
      texture.vScale  = tex.vScale ?? 1;
      texture.uOffset = tex.uOffset ?? 0;
      texture.vOffset = tex.vOffset ?? 0;
      mat.diffuseTexture = texture;
      // Opaque texture: render in the normal pass. Double-sided so faces show
      // regardless of winding (no dependency on consistent normals).
      mat.backFaceCulling = false;
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
      mat.specularPower = 0;
      this._texturedMaterials.set(name, mat);
    }
    return mat;
  }

  _fixedMaterial(name, color, scene, tag) {
    let mat = this._fixedMaterials.get(name);
    if (!mat) {
      mat = new StandardMaterial(`decoFixedMat_${name}_${tag}`, scene);
      mat.diffuseColor  = color;
      mat.specularColor = new Color3(0.2, 0.2, 0.2);
      mat.specularPower = 8;
      this._fixedMaterials.set(name, mat);
    }
    return mat;
  }

  _applyColorToMaterial(colorName) {
    const tint = basicColors[colorName] ?? basicColors[DEFAULT_COLOR];
    this._colorMaterial.diffuseColor = tint.diffuse;
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
    this._applyColorToMaterial(color);
  }

  dispose() {
    for (const m of this._meshes) m.dispose();
    this._meshes = [];
    this._colorMaterial?.dispose();
    for (const mat of this._fixedMaterials.values()) mat.dispose();
    this._fixedMaterials.clear();
    for (const mat of this._texturedMaterials.values()) {
      mat.diffuseTexture?.dispose();
      mat.dispose();
    }
    this._texturedMaterials.clear();
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

  /** Call this when unloading a scene so the next scene gets a fresh load. */
  static clearCache() {
    ModelDecoration._sourcePromises?.clear();
    ModelDecoration._sourcePromises = null;
  }
}
