import { StandardMaterial, Color3 } from "@babylonjs/core";
import { foliageColors, TREE_FOLIAGE_COLOR_OPTIONS } from "../constants.js";
import { buildEzTreeMasters, ezTreeOptions, leafTexture, barkTexture, EZ_TREE_PRESET_OPTIONS } from "./lib/ez-tree/babylon.js";
import { instancedDecoration } from "./lib/instanced-decoration.js";

const DEFAULT_LEAF = "green";
const DEFAULT_PRESET = "oak_medium";

// ez-tree works in large units (an Oak Medium is ~72 tall); this brings it to
// ~16 world units (2× the old procedural tree — tuned by eye in game).
const EZ_TREE_SCALE = 0.22;

const hexColor = (hex) => new Color3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

// The leaf textures are already naturally coloured, so the Foliage choice
// tints them relative to "green": green = the species' own colour, and
// forest/olive/fall shift it by that palette entry ÷ green, per channel.
function foliageShift(name) {
  const base = foliageColors[DEFAULT_LEAF].diffuse;
  const c = (foliageColors[name] ?? foliageColors[DEFAULT_LEAF]).diffuse;
  return new Color3(c.r / base.r, c.g / base.g, c.b / base.b);
}

/**
 * Procedural tree via the ez-tree port (./lib/ez-tree, EZ_TREE.md). Geometry is
 * generated per (species, seed, colours) variant; caching / instancing / editor
 * contract in ./lib/instanced-decoration.js.
 */
export default instancedDecoration({
  colliderGroup: "trunk", // trunk-sized collider; branches + canopy pass-through
  variantProps: ["preset"],

  variantParams(feature, def) {
    const fd = def.featureDefaults ?? {};
    return {
      preset:    feature.preset ?? fd.preset ?? DEFAULT_PRESET,
      seed:      Number(feature.seed ?? fd.seed ?? 1),
      leafColor: feature.color ?? def.leafColor ?? DEFAULT_LEAF,
    };
  },

  variantKey: (p) => [p.preset, p.seed, p.leafColor].join("|"),

  buildVariant(scene, p, key) {
    const options = ezTreeOptions(p);

    const wood = new StandardMaterial(`treeWood_${key}`, scene);
    wood.diffuseColor = hexColor(options.bark.tint);
    wood.diffuseTexture = barkTexture(scene, options);
    wood.specularColor = new Color3(0.02, 0.02, 0.02);

    const foliage = new StandardMaterial(`treeLeaf_${key}`, scene);
    foliage.diffuseColor = hexColor(options.leaves.tint).multiply(foliageShift(p.leafColor));
    foliage.diffuseTexture = leafTexture(scene, options); // alpha-tested cutout (hasAlpha)
    foliage.alphaCutOff = options.leaves.alphaTest;
    foliage.specularColor = Color3.Black();
    foliage.backFaceCulling = false; // leaf quads are single planes

    const { trunk, branch, leaf, height } = buildEzTreeMasters(
      scene, options, EZ_TREE_SCALE, `ezTree_${key}`, { bark: wood, leaf: foliage },
    );
    return { groups: { trunk, branch, leaf }, mats: [wood, foliage], height };
  },

  controls: {
    preset:  { type: "select", label: "Species", options: EZ_TREE_PRESET_OPTIONS },
    color:   { type: "color", label: "Foliage", options: TREE_FOLIAGE_COLOR_OPTIONS },
    seed:    { type: "range", label: "Variant",  min: 1,   max: 40,  step: 1, random: true },
    scale:   { type: "range", label: "Scale",    min: 0.5, max: 4,   step: 0.1, unit: "×" },
    heading: { type: "range", label: "Rotation", min: 0,   max: 360, step: 1,   unit: "°" },
  },
});
