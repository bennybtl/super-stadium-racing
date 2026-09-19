import { StandardMaterial, Color3 } from "@babylonjs/core";
import { basicColors } from "../constants.js";
import { ProceduralBush, BUSH_DEFAULTS } from "./lib/Bush.js";
import { instancedDecoration } from "./lib/instanced-decoration.js";

const DEFAULT_LEAF = "green";

const tint = (name, fallback) => (basicColors[name] ?? basicColors[fallback]).diffuse;

/**
 * Procedural bush — a dense clump of overlapping foliage blobs. Geometry in
 * ./lib/Bush.js; caching / instancing / editor contract in
 * ./lib/instanced-decoration.js. `radius` is JSON-only (bush.json
 * featureDefaults); the panel exposes seed + colour.
 */
export default instancedDecoration({
  colliderGroup: "foliage", // bushes have no colliderMeshes in bush.json, so this is unused

  variantParams(feature, def) {
    const fd = def.featureDefaults ?? {};
    return {
      seed:      Number(feature.seed ?? fd.seed ?? BUSH_DEFAULTS.seed),
      radius:    Number(fd.radius ?? BUSH_DEFAULTS.radius),
      leafColor: feature.color ?? def.leafColor ?? DEFAULT_LEAF,
    };
  },

  variantKey: (p) => [p.seed, p.radius, p.leafColor].join("|"),

  buildVariant(scene, p, key) {
    const { foliage, height } = ProceduralBush.buildMasters(scene, p);

    // basicColors are UI-bright; foliage wants a darker, flatter forest green.
    const mat = new StandardMaterial(`bushFoliage_${key}`, scene);
    mat.diffuseColor = tint(p.leafColor, DEFAULT_LEAF).scale(0.5);
    mat.specularColor = Color3.Black();

    if (foliage) foliage.material = mat;

    return { groups: { foliage }, mats: [mat], height };
  },

  controls: {
    color:   { type: "color", label: "Foliage" },
    seed:    { type: "range", label: "Variant",  min: 1,   max: 40,  step: 1, random: true },
    scale:   { type: "range", label: "Scale",    min: 0.5, max: 4,   step: 0.1, unit: "×" },
    heading: { type: "range", label: "Rotation", min: 0,   max: 360, step: 1,   unit: "°" },
  },
});
