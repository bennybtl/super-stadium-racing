import { StandardMaterial, Color3, Texture } from "@babylonjs/core";
import { basicColors } from "../constants.js";
import { parseColorValue } from "./mesh-color.js";

const DEFAULT_COLOR = "white";

/**
 * Resolves the Babylon material for an OBJ source-mesh, by its exact group
 * name, following the JSON schema shared by decorations (src/decorations/)
 * and obstacles (src/obstacles/):
 *
 *   1. def.meshTextureUrls[name]                      → textured material
 *      (resolved by DecorationLoader/ObstacleLoader from def.meshTextures)
 *   2. def.meshColors[name]                           → fixed-colour material
 *   3. def.meshDefaultColors[name] (baked from the model's .mtl `Kd`),
 *      unless name is listed in def.colorableMeshes    → fixed-colour material
 *   4. otherwise                                      → the shared,
 *      user-tinted colour material (see setColor)
 *
 * One instance owns the shared tint material plus per-name fixed/textured
 * material caches for a single placed/spawned prop. `tag` should be unique
 * per instance (or at least per concurrently-alive instance) so Babylon
 * material names don't collide within the scene.
 */
export class MeshMaterialResolver {
  constructor(def, scene, tag) {
    this.def = def;
    this._scene = scene;
    this._tag = tag;

    this.colorMaterial = new StandardMaterial(`matColor_${tag}`, scene);
    this.colorMaterial.specularColor = new Color3(0.15, 0.15, 0.15);
    this.colorMaterial.specularPower = 0;

    /** @type {Map<string, StandardMaterial>} group name → fixed material */
    this._fixedMaterials = new Map();
    /** @type {Map<string, StandardMaterial>} group name → textured material */
    this._texturedMaterials = new Map();
  }

  /** Tint the shared user-colour material (meshes not pinned to a fixed/textured look). */
  setColor(colorName) {
    const tint = basicColors[colorName] ?? basicColors[DEFAULT_COLOR];
    this.colorMaterial.diffuseColor = tint.diffuse;
  }

  /** Pick the material for a source mesh, by exact OBJ group name. */
  materialFor(name) {
    const tex = this.def.meshTextureUrls?.[name];
    if (tex) return this._texturedMaterial(name, tex);

    const value = this.def.meshColors?.[name];
    const fixed = value != null ? parseColorValue(value) : null;
    if (fixed) return this._fixedMaterial(name, fixed);

    if (!this.def.colorableMeshes?.includes(name)) {
      const baked = this.def.meshDefaultColors?.[name];
      const bakedFixed = baked != null ? parseColorValue(baked) : null;
      if (bakedFixed) return this._fixedMaterial(name, bakedFixed);
    }

    return this.colorMaterial;
  }

  _texturedMaterial(name, tex) {
    let mat = this._texturedMaterials.get(name);
    if (!mat) {
      mat = new StandardMaterial(`matTex_${name}_${this._tag}`, this._scene);
      const texture = new Texture(tex.url, this._scene);
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

  _fixedMaterial(name, color) {
    let mat = this._fixedMaterials.get(name);
    if (!mat) {
      mat = new StandardMaterial(`matFixed_${name}_${this._tag}`, this._scene);
      mat.diffuseColor  = color;
      mat.specularColor = new Color3(0.2, 0.2, 0.2);
      mat.specularPower = 8;
      this._fixedMaterials.set(name, mat);
    }
    return mat;
  }

  dispose() {
    this.colorMaterial?.dispose();
    for (const mat of this._fixedMaterials.values()) mat.dispose();
    this._fixedMaterials.clear();
    for (const mat of this._texturedMaterials.values()) {
      mat.diffuseTexture?.dispose();
      mat.dispose();
    }
    this._texturedMaterials.clear();
  }
}
