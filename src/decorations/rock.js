import { StandardMaterial, Color3 } from "@babylonjs/core";
import { rockColors, ROCK_COLOR_OPTIONS } from "../constants.js";
import { ProceduralRock, ROCK_DEFAULTS } from "./lib/Rock.js";
import { instancedDecoration } from "./lib/instanced-decoration.js";

const DEFAULT_BODY = "gray";

const tint = (name, fallback) => (rockColors[name] ?? rockColors[fallback]).diffuse;

/**
 * Procedural rock — a cluster of 1–3 angular boulders. Geometry in
 * ./lib/Rock.js; caching / instancing / editor contract in
 * ./lib/instanced-decoration.js. `radius` is JSON-only (rock.json
 * featureDefaults); the panel exposes seed + colour.
 */
export default instancedDecoration({
  colliderGroup: "rock",

  variantParams(feature, def) {
    const fd = def.featureDefaults ?? {};
    return {
      seed:      Number(feature.seed ?? fd.seed ?? ROCK_DEFAULTS.seed),
      radius:    Number(fd.radius ?? ROCK_DEFAULTS.radius),
      bodyColor: feature.color ?? def.bodyColor ?? DEFAULT_BODY,
    };
  },

  variantKey: (p) => [p.seed, p.radius, p.bodyColor].join("|"),

  buildVariant(scene, p, key) {
    const { rock, height } = ProceduralRock.buildMasters(scene, p);

    const mat = new StandardMaterial(`rockBody_${key}`, scene);
    mat.diffuseColor = tint(p.bodyColor, DEFAULT_BODY);
    mat.specularColor = new Color3(0.03, 0.03, 0.03);

    if (rock) rock.material = mat;

    return { groups: { rock }, mats: [mat], height };
  },

  controls: {
    color:   { type: "color", label: "Colour", options: ROCK_COLOR_OPTIONS },
    seed:    { type: "range", label: "Variant",  min: 1,   max: 40,  step: 1, random: true },
    scale:   { type: "range", label: "Scale",    min: 0.5, max: 4,   step: 0.1, unit: "×" },
    heading: { type: "range", label: "Rotation", min: 0,   max: 360, step: 1,   unit: "°" },
  },
});
