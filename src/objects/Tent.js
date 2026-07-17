import {
  StandardMaterial,
  Color3,
  TransformNode,
  SceneLoader,
} from "@babylonjs/core";
import { OBJFileLoader } from "@babylonjs/loaders/OBJ/objFileLoader";
import { basicColors } from "../constants.js";
import tentUrl from "../assets/models/tent.obj?url";

OBJFileLoader.MATERIAL_LOADING_FAILS_SILENTLY = true;
OBJFileLoader.SKIP_MATERIALS = true;

// The tent .obj is authored Z-up (height runs along +Z), so rotate it upright.
const MODEL_ROTATION_X = -Math.PI / 2;
// The model is ~5m wide as authored, which is already a reasonable tent size.
const MODEL_SCALE = 1;

const DEFAULT_COLOR = "white";

/**
 * Tent — a static decoration model placed on the terrain.
 *
 * Editor-managed like Flag / BannerString (no physics). Only position, heading,
 * scale and color are meaningful. The heading rotates the container; scale
 * multiplies the base model scale; color tints the whole model with one material.
 */
export class Tent {
  constructor(feature, groundY, scene, shadows) {
    this.feature  = feature;
    this._scene   = scene;
    this._shadows = shadows ?? null;
    this._meshes  = [];
    this.color    = feature.color ?? DEFAULT_COLOR;

    // Container holds world placement: position + heading + overall scale.
    this.container = new TransformNode(
      `tent_${feature.x.toFixed(1)}_${feature.z.toFixed(1)}`,
      scene
    );
    this.container.position.copyFromFloats(feature.x, groundY, feature.z);
    this.container.rotation.y = feature.heading ?? 0;
    this.container.scaling.setAll(Math.max(0.1, Number(feature.scale) || 1));

    // Pivot corrects the model's Z-up orientation and applies the base scale,
    // independent of the user-facing heading/scale on the container.
    this._pivot = new TransformNode(
      `tentPivot_${feature.x.toFixed(1)}_${feature.z.toFixed(1)}`,
      scene
    );
    this._pivot.parent = this.container;
    this._pivot.rotation.x = MODEL_ROTATION_X;
    this._pivot.scaling.setAll(MODEL_SCALE);

    // The cover material carries the user-chosen color; the legs keep a fixed
    // neutral metal look. The OBJ splits into a "tent-cover" mesh plus "leg1".."leg4".
    this._coverMaterial = new StandardMaterial(
      `tentCoverMat_${feature.x.toFixed(1)}_${feature.z.toFixed(1)}`,
      scene
    );
    const tint = basicColors[this.color] ?? basicColors[DEFAULT_COLOR];
    this._coverMaterial.diffuseColor  = tint.diffuse;
    this._coverMaterial.specularColor = new Color3(0.15, 0.15, 0.15);
    this._coverMaterial.specularPower = 0;

    this._legMaterial = new StandardMaterial(
      `tentLegMat_${feature.x.toFixed(1)}_${feature.z.toFixed(1)}`,
      scene
    );
    this._legMaterial.diffuseColor  = new Color3(0.55, 0.55, 0.58);
    this._legMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
    this._legMaterial.specularPower = 32;

    // Load the model once (cached per scene), then clone into this instance.
    Tent._getSourceMeshes(scene)
      .then(sourceMeshes => {
        if (this.container.isDisposed()) return;
        for (const src of sourceMeshes) {
          // Decide from the SOURCE group name ("tent-cover" / "leg1".."leg4")
          // before cloning renames the mesh.
          const isLeg = /leg/i.test(src.name);
          const m = src.clone(`tentMesh_${isLeg ? 'leg' : 'cover'}_${feature.x.toFixed(1)}_${feature.z.toFixed(1)}`, this._pivot);
          m.isVisible  = true;
          m.isPickable = true; // editor selects tents by clicking their mesh
          // Only the cover takes the chosen color; legs stay neutral metal.
          m.material   = isLeg ? this._legMaterial : this._coverMaterial;
          if (this._shadows) {
            this._shadows.addShadowCaster(m);
            m.receiveShadows = true;
          }
          this._meshes.push(m);
        }
      })
      .catch(err => console.warn('[Tent] Failed to load tent model:', err));
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
    const s = Math.max(0.1, Number(newScale) || 1);
    this.feature.scale = s;
    this.container.scaling.setAll(s);
  }

  setColor(color) {
    this.color = color;
    this.feature.color = color;
    const tint = basicColors[color] ?? basicColors[DEFAULT_COLOR];
    this._coverMaterial.diffuseColor = tint.diffuse;
  }

  dispose() {
    for (const m of this._meshes) m.dispose();
    this._meshes = [];
    this._coverMaterial?.dispose();
    this._legMaterial?.dispose();
    this._pivot?.dispose();
    this.container.dispose();
  }

  // ─── Static shared loader ─────────────────────────────────────────────────

  /** Loads the tent OBJ once per scene and caches hidden source meshes for cloning. */
  static _getSourceMeshes(scene) {
    const cached = Tent._sourcePromise;
    const cachedSceneDisposed = !!cached?.scene && (
      (typeof cached.scene.isDisposed === 'function' && cached.scene.isDisposed())
      || cached.scene.isDisposed === true
    );
    if (!cached || cached.scene !== scene || cachedSceneDisposed) {
      const lastSlash = tentUrl.lastIndexOf('/');
      const rootUrl   = tentUrl.substring(0, lastSlash + 1);
      const fileName  = tentUrl.substring(lastSlash + 1);
      const promise = SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene)
        .then(result => {
          for (const m of result.meshes) {
            m.isVisible  = false;
            m.isPickable = false;
          }
          return result.meshes;
        });
      Tent._sourcePromise = { scene, promise };
    }
    return Tent._sourcePromise.promise;
  }

  /** Call this when unloading a scene so the next scene gets a fresh load. */
  static clearCache() {
    Tent._sourcePromise = null;
  }
}
