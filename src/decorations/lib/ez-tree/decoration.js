import { StandardMaterial, Color3 } from "@babylonjs/core";
import { foliageColors } from "../../../constants.js";
import { buildEzTreeMasters, ezTreeOptions, leafTexture, barkTexture, EZ_TREE_PRESET_OPTIONS } from "./babylon.js";
import { instancedDecoration } from "../instanced-decoration.js";
import { attachTreeWindPlugin } from "../../../shaders/tree-wind-shader.js";

const DEFAULT_LEAF = "green";

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
 * Duplicate handler that grows a cluster: a new seed, heading and ±20% scale,
 * dropped at a random bearing about `spread` × scale from the source. Rolled
 * once and frozen into the feature, so reloads stay deterministic.
 */
export function scatterDuplicate(spread) {
  return (copy, src) => {
    const srcScale = Number(src.scale) || 1;
    let seed;
    do seed = 1 + Math.floor(Math.random() * 40); while (seed === src.seed);
    copy.seed = seed;
    copy.heading = Math.random() * Math.PI * 2;
    copy.scale = +Math.min(4, Math.max(0.5, srcScale * (0.8 + Math.random() * 0.4))).toFixed(2); // slider range
    const angle = Math.random() * Math.PI * 2;
    const dist = spread * srcScale * (0.7 + Math.random() * 0.6);
    copy.x = src.x + Math.cos(angle) * dist;
    copy.z = src.z + Math.sin(angle) * dist;
  };
}

/**
 * An editor decoration backed by ez-tree presets (EZ_TREE.md): tree.js and
 * bush.js are both thin configs of this. Geometry is generated per
 * (species, seed, colour) variant; caching / instancing / editor contract in
 * ../instanced-decoration.js.
 *
 * @param {object} cfg
 * @param {(id: string) => boolean} cfg.presetFilter  which presets the Species dropdown offers
 * @param {string} cfg.defaultPreset  used when neither feature nor def names one
 * @param {number} cfg.scale          ez-tree units → world units
 * @param {object[]} cfg.colorOptions Foliage dropdown options
 * @param {number} cfg.spread         typical distance (world units, at 1×) from the
 *                                    source when duplicating, about one canopy radius
 */
export function ezTreeDecoration({ presetFilter, defaultPreset, scale, colorOptions, spread }) {
  return instancedDecoration({
    colliderGroup: "trunk", // trunk-sized collider (only if the def lists colliderMeshes)
    variantProps: ["preset"],

    variantParams(feature, def) {
      const fd = def.featureDefaults ?? {};
      return {
        preset:    feature.preset ?? fd.preset ?? defaultPreset,
        seed:      Number(feature.seed ?? fd.seed ?? 1),
        leafColor: feature.color ?? def.leafColor ?? DEFAULT_LEAF,
      };
    },

    variantKey: (p) => [p.preset, p.seed, p.leafColor].join("|"),

    duplicate: scatterDuplicate(spread),

    buildVariant(scene, p, key) {
      const options = ezTreeOptions(p);

      const wood = new StandardMaterial(`ezWood_${key}`, scene);
      wood.diffuseColor = hexColor(options.bark.tint);
      wood.diffuseTexture = barkTexture(scene, options);
      wood.specularColor = new Color3(0.02, 0.02, 0.02);

      const foliage = new StandardMaterial(`ezLeaf_${key}`, scene);
      foliage.diffuseColor = hexColor(options.leaves.tint).multiply(foliageShift(p.leafColor));
      foliage.diffuseTexture = leafTexture(scene, options); // alpha-tested cutout (hasAlpha)
      foliage.alphaCutOff = options.leaves.alphaTest;
      foliage.specularColor = Color3.Black();
      foliage.backFaceCulling = false; // leaf quads are single planes
      attachTreeWindPlugin(foliage);

      const { trunk, branch, leaf, height } = buildEzTreeMasters(
        scene, options, scale, `ezTree_${key}`, { bark: wood, leaf: foliage },
      );
      return { groups: { trunk, branch, leaf }, mats: [wood, foliage], height };
    },

    controls: {
      preset:  { type: "select", label: "Species", options: EZ_TREE_PRESET_OPTIONS.filter((o) => presetFilter(o.value)) },
      color:   { type: "color", label: "Foliage", options: colorOptions },
      seed:    { type: "range", label: "Variant",  min: 1,   max: 40,  step: 1, random: true },
      scale:   { type: "range", label: "Scale",    min: 0.5, max: 4,   step: 0.1, unit: "×" },
      heading: { type: "range", label: "Rotation", min: 0,   max: 360, step: 1,   unit: "°" },
    },
  });
}
