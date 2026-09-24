import { StandardMaterial, Color3, DynamicTexture, Texture } from "@babylonjs/core";
import { FOLIAGE_COLOR_OPTIONS } from "../constants.js";
import { CACTUS_PRESET_IDS, cactusOptions, growCactus, meshCactus, spineCactus } from "./lib/cactus/CactusGen.js";
import { masterFromBuffers, attachLods, LOD_COVERAGE } from "./lib/ez-tree/babylon.js";
import { scatterDuplicate, foliageShift } from "./lib/ez-tree/decoration.js";
import { instancedDecoration } from "./lib/instanced-decoration.js";

const DEFAULT_BODY = "green";
const DEFAULT_PRESET = "saguaro";

// Ring stride / rib resolution per LOD level (see LOD_COVERAGE for the switch points).
const LOD_DETAILS = [
  { sectionStride: 2, segmentFactor: 0.5 },
  { sectionStride: 4, segmentFactor: 0.5 },
];

const LABEL = (id) => id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ── Procedural textures (one of each per scene, shared by every variant) ─────
//
// CactusGen lays UVs out one tile per areole (u = rib, v = spine row), so both
// textures only ever draw a single areole.

const _textures = new WeakMap(); // scene → { areole, spines }

function drawTexture(scene, name, size, draw) {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext();
  draw(ctx, size);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

function cactusTextures(scene) {
  let t = _textures.get(scene);
  if (t && !t.areole.isDisposed?.()) return t;
  t = {
    // Body: white (so diffuseColor shows through) with a felted areole dot
    // at the tile corner, which is where the ridge meets the spine row. It's
    // drawn at all four corners so it wraps into one dot. The dot is squashed
    // in v because a tile is about twice as tall as it is wide on the stem.
    areole: drawTexture(scene, "cactusAreole", 64, (ctx, S) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, S, S);
      for (const [x, y] of [[0, 0], [S, 0], [0, S], [S, S]]) {
        ctx.fillStyle = "#e9e1c8";
        ctx.beginPath(); ctx.ellipse(x, y, S * 0.16, S * 0.09, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#b8ad90";
        ctx.beginPath(); ctx.ellipse(x, y, S * 0.06, S * 0.035, 0, 0, Math.PI * 2); ctx.fill();
      }
    }),
    // Spines: a fan of thin spines from the bottom centre (the quad's base on
    // the surface), cut out by alpha. Mipmaps thin them out with distance.
    spines: drawTexture(scene, "cactusSpines", 64, (ctx, S) => {
      ctx.clearRect(0, 0, S, S);
      ctx.strokeStyle = "#fff";
      ctx.lineCap = "round";
      const fan = [-1.15, -0.8, -0.45, -0.15, 0.15, 0.45, 0.8, 1.15, 0];
      fan.forEach((a, k) => {
        const len = S * (k === fan.length - 1 ? 0.95 : 0.55 + 0.3 * ((k * 7) % 4) / 3);
        ctx.lineWidth = k === fan.length - 1 ? 2.5 : 1.6;
        ctx.beginPath();
        ctx.moveTo(S / 2, S);
        ctx.lineTo(S / 2 + Math.sin(a) * len, S - Math.cos(a) * len);
        ctx.stroke();
      });
    }),
  };
  t.spines.hasAlpha = true;
  _textures.set(scene, t);
  return t;
}

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
    // Species' own colour; the Colour palette shifts it relative to "green".
    const [r, g, b] = cactusOptions(p.preset, p.seed).preset.color;
    body.diffuseColor = new Color3(r, g, b).multiply(foliageShift(p.bodyColor));
    body.specularColor = new Color3(0.06, 0.06, 0.06);
    const textures = cactusTextures(scene);
    body.diffuseTexture = textures.areole;

    const spineMat = new StandardMaterial(`cactusSpines_${key}`, scene);
    spineMat.diffuseColor = new Color3(0.93, 0.88, 0.72); // pale straw
    spineMat.diffuseTexture = textures.spines;             // alpha-tested cutout
    spineMat.alphaCutOff = 0.35;
    spineMat.specularColor = Color3.Black();
    spineMat.backFaceCulling = false;

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

    // Spines are full-detail only: a null level culls them from LOD1 down.
    full.groups.spines = masterFromBuffers(`cactusSpines_${key}`, spineCactus(skeleton, options), scene);
    if (full.groups.spines) full.groups.spines.material = spineMat;

    attachLods(full.groups, LOD_DETAILS.map((detail, i) => ({
      coverage: LOD_COVERAGE[i],
      groups: { ...buildLevel(detail, `_lod${i + 1}`).groups, spines: null },
    })));

    return { groups: full.groups, mats: [body, spineMat], height };
  },

  controls: {
    preset:  { type: "select", label: "Species", options: CACTUS_PRESET_IDS.map((id) => ({ value: id, label: LABEL(id) })) },
    color:   { type: "color", label: "Colour", options: FOLIAGE_COLOR_OPTIONS },
    seed:    { type: "range", label: "Variant",  min: 1,   max: 40,  step: 1, random: true },
    scale:   { type: "range", label: "Scale",    min: 0.5, max: 4,   step: 0.1, unit: "×" },
    heading: { type: "range", label: "Rotation", min: 0,   max: 360, step: 1,   unit: "°" },
  },
});
