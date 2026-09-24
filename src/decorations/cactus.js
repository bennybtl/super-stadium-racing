import { StandardMaterial, Color3 } from "@babylonjs/core";
import { foliageColors, FOLIAGE_COLOR_OPTIONS } from "../constants.js";
import { CACTUS_PRESET_IDS, cactusOptions, growCactus, meshCactus } from "./lib/cactus/CactusGen.js";
import { masterFromBuffers, attachLods, LOD_COVERAGE } from "./lib/ez-tree/babylon.js";
import { scatterDuplicate } from "./lib/ez-tree/decoration.js";
import { instancedDecoration } from "./lib/instanced-decoration.js";

const DEFAULT_BODY = "green";
const DEFAULT_PRESET = "saguaro";

// Ring stride / rib resolution per LOD level (see LOD_COVERAGE for the switch points).
const LOD_DETAILS = [
  { sectionStride: 2, segmentFactor: 0.5 },
  { sectionStride: 4, segmentFactor: 0.5 },
];

const tint = (name) => (foliageColors[name] ?? foliageColors[DEFAULT_BODY]).diffuse;
const LABEL = (id) => id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Procedural cactus (CACTUS.md): skeleton → continuous ribbed tubes from
 * ./lib/cactus/CactusGen.js, built into trunk/arms masters with screen-coverage
 * LOD. Caching / instancing / editor contract in ./lib/instanced-decoration.js.
 */
export default instancedDecoration({
  colliderGroup: "trunk", // trunk-sized collider; arms stay pass-through
  variantProps: ["preset"],
  duplicate: scatterDuplicate(1.5),

  variantParams(feature, def) {
    const fd = def.featureDefaults ?? {};
    return {
      preset:    feature.preset ?? fd.preset ?? DEFAULT_PRESET,
      seed:      Number(feature.seed ?? fd.seed ?? 1),
      bodyColor: feature.color ?? def.bodyColor ?? DEFAULT_BODY,
    };
  },

  variantKey: (p) => [p.preset, p.seed, p.bodyColor].join("|"),

  buildVariant(scene, p, key) {
    const body = new StandardMaterial(`cactusBody_${key}`, scene);
    body.diffuseColor = tint(p.bodyColor);
    body.specularColor = new Color3(0.06, 0.06, 0.06);

    const options = cactusOptions(p.preset, p.seed);
    const skeleton = growCactus(options);
    const buildLevel = (detail, suffix) => {
      const { trunk, arms } = meshCactus(skeleton, options, detail);
      const groups = {
        trunk: masterFromBuffers(`cactusTrunk_${key}${suffix}`, trunk, scene),
        arms: masterFromBuffers(`cactusArms_${key}${suffix}`, arms, scene),
      };
      for (const m of Object.values(groups)) if (m) m.material = body;
      return { groups, bufs: [trunk, arms] };
    };

    const full = buildLevel({}, "");
    let height = 0;
    for (const b of full.bufs) for (let i = 1; i < b.verts.length; i += 3) height = Math.max(height, b.verts[i]);
    attachLods(full.groups, LOD_DETAILS.map((detail, i) => ({
      coverage: LOD_COVERAGE[i],
      groups: buildLevel(detail, `_lod${i + 1}`).groups,
    })));

    return { groups: full.groups, mats: [body], height };
  },

  controls: {
    preset:  { type: "select", label: "Species", options: CACTUS_PRESET_IDS.map((id) => ({ value: id, label: LABEL(id) })) },
    color:   { type: "color", label: "Colour", options: FOLIAGE_COLOR_OPTIONS },
    seed:    { type: "range", label: "Variant",  min: 1,   max: 40,  step: 1, random: true },
    scale:   { type: "range", label: "Scale",    min: 0.5, max: 4,   step: 0.1, unit: "×" },
    heading: { type: "range", label: "Rotation", min: 0,   max: 360, step: 1,   unit: "°" },
  },
});
