import { StandardMaterial, Color3 } from "@babylonjs/core";
import { basicColors } from "../constants.js";
import { ProceduralTree, TREE_DEFAULTS } from "./lib/Tree.js";
import { instancedDecoration } from "./lib/instanced-decoration.js";

const DEFAULT_LEAF = "green";
const DEFAULT_WOOD = "brown";

const tint = (name, fallback) => (basicColors[name] ?? basicColors[fallback]).diffuse;

/**
 * Procedural tree — a trunk with 1–4 primary branches, one distinct foliage blob
 * each. Geometry in ./lib/Tree.js; caching / instancing / editor contract in
 * ./lib/instanced-decoration.js. `trunkHeight` / `maxDepth` / `radialSegments`
 * are JSON-only (tree.json featureDefaults); the panel exposes seed + colour.
 */
export default instancedDecoration({
  colliderGroup: "trunk", // trunk-sized collider; canopy stays pass-through

  variantParams(feature, def) {
    const fd = def.featureDefaults ?? {};
    return {
      seed:           Number(feature.seed ?? fd.seed ?? TREE_DEFAULTS.seed),
      trunkHeight:    Number(fd.trunkHeight ?? TREE_DEFAULTS.trunkHeight),
      trunkRadius:    Number(fd.trunkRadius ?? TREE_DEFAULTS.trunkRadius),
      maxDepth:       Number(fd.maxDepth ?? TREE_DEFAULTS.maxDepth),
      radialSegments: Number(fd.radialSegments ?? TREE_DEFAULTS.radialSegments),
      woodColor:      def.woodColor ?? DEFAULT_WOOD,
      leafColor:      feature.color ?? def.leafColor ?? DEFAULT_LEAF,
    };
  },

  variantKey: (p) => [
    p.seed, p.trunkHeight, p.trunkRadius, p.maxDepth, p.radialSegments, p.woodColor, p.leafColor,
  ].join("|"),

  buildVariant(scene, p, key) {
    const { trunk, branch, leaf, height } = ProceduralTree.buildMasters(scene, p);

    const wood = new StandardMaterial(`treeWood_${key}`, scene);
    wood.diffuseColor = tint(p.woodColor, DEFAULT_WOOD);
    wood.specularColor = new Color3(0.02, 0.02, 0.02);

    // basicColors are UI-bright; foliage wants a darker, flatter forest green.
    const foliage = new StandardMaterial(`treeLeaf_${key}`, scene);
    foliage.diffuseColor = tint(p.leafColor, DEFAULT_LEAF).scale(0.5);
    foliage.specularColor = Color3.Black();

    if (trunk) trunk.material = wood;
    if (branch) branch.material = wood;
    if (leaf) leaf.material = foliage;

    return { groups: { trunk, branch, leaf }, mats: [wood, foliage], height };
  },

  controls: {
    color:   { type: "color", label: "Foliage" },
    seed:    { type: "range", label: "Variant",  min: 1,   max: 40,  step: 1, random: true },
    scale:   { type: "range", label: "Scale",    min: 0.5, max: 4,   step: 0.1, unit: "×" },
    heading: { type: "range", label: "Rotation", min: 0,   max: 360, step: 1,   unit: "°" },
  },
});
