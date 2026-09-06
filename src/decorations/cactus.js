import { StandardMaterial, Color3 } from "@babylonjs/core";
import { basicColors } from "../constants.js";
import { ProceduralCactus, CACTUS_DEFAULTS } from "./lib/Cactus.js";
import { instancedDecoration } from "./lib/instanced-decoration.js";

const DEFAULT_BODY = "green";

const tint = (name, fallback) => (basicColors[name] ?? basicColors[fallback]).diffuse;

/**
 * Procedural cactus — a ribbed saguaro column with 0–4 arms. Geometry in
 * ./lib/Cactus.js; caching / instancing / editor contract in
 * ./lib/instanced-decoration.js. `trunkHeight` / `ribs` are JSON-only
 * (cactus.json featureDefaults); the panel exposes seed + colour.
 */
export default instancedDecoration({
  colliderGroup: "trunk", // trunk-sized collider; arms stay pass-through

  variantParams(feature, def) {
    const fd = def.featureDefaults ?? {};
    return {
      seed:        Number(feature.seed ?? fd.seed ?? CACTUS_DEFAULTS.seed),
      trunkHeight: Number(fd.trunkHeight ?? CACTUS_DEFAULTS.trunkHeight),
      trunkRadius: Number(fd.trunkRadius ?? CACTUS_DEFAULTS.trunkRadius),
      ribs:        Number(fd.ribs ?? CACTUS_DEFAULTS.ribs),
      bodyColor:   feature.color ?? def.bodyColor ?? DEFAULT_BODY,
    };
  },

  variantKey: (p) => [p.seed, p.trunkHeight, p.trunkRadius, p.ribs, p.bodyColor].join("|"),

  buildVariant(scene, p, key) {
    const { trunk, arms, height } = ProceduralCactus.buildMasters(scene, p);

    const body = new StandardMaterial(`cactusBody_${key}`, scene);
    body.diffuseColor = tint(p.bodyColor, DEFAULT_BODY).scale(0.55);
    body.specularColor = new Color3(0.05, 0.05, 0.05);

    if (trunk) trunk.material = body;
    if (arms) arms.material = body;

    return { groups: { trunk, arms }, mats: [body], height };
  },

  controls: {
    color:   { type: "color", label: "Colour" },
    seed:    { type: "range", label: "Variant",  min: 1,   max: 40,  step: 1, random: true },
    scale:   { type: "range", label: "Scale",    min: 0.5, max: 4,   step: 0.1, unit: "×" },
    heading: { type: "range", label: "Rotation", min: 0,   max: 360, step: 1,   unit: "°" },
  },
});
