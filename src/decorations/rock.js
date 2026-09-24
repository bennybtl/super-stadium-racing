import { StandardMaterial, Color3, Texture } from "@babylonjs/core";
import { rockColors, ROCK_COLOR_OPTIONS } from "../constants.js";
import { ROCK_PRESET_IDS, ROCK_COLOR_BASE, rockOptions, growRock, meshRock } from "./lib/rock/RockGen.js";
import { masterFromBuffers, attachLods, LOD_COVERAGE } from "./lib/ez-tree/babylon.js";
import { scatterDuplicate } from "./lib/ez-tree/decoration.js";
import { instancedDecoration } from "./lib/instanced-decoration.js";
import rockyTextureUrl from "../assets/textures/rocky.texture.png";
import stoneNormalUrl from "../assets/normals/stone.normal.jpg";

const DEFAULT_BODY = "gray";
const DEFAULT_PRESET = "boulder";
const BASE_RADIUS = 0.6; // `radius` the presets are sized for (the old rock's default)

// Icosphere level per LOD level (see LOD_COVERAGE for the switch points).
const FULL_DETAIL = { subdivisions: 4 };
const LOD_DETAILS = [{ subdivisions: 3 }, { subdivisions: 2 }];

const LABEL = (id) => id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const tint = (name, fallback) => (rockColors[name] ?? rockColors[fallback]).diffuse;

// ── Shared textures (one of each per scene, every variant) ──────────────────
//
// RockGen box-projects UVs in body units (a 1× rock is ~1.3 across).
const GRAIN_TILE = 1.6;          // diffuse grain: world units per repeat
const BUMP_TILE = 0.9;           // stone normal map: world units per repeat
const GRAIN_MEAN = 0.39;         // rocky.texture.png's mean brightness
const BUMP_LEVEL = 0.8;

const _textures = new WeakMap(); // scene → { grain, bump }

function rockTextures(scene) {
  let t = _textures.get(scene);
  if (t && !t.grain.isDisposed?.()) return t;
  const grain = new Texture(rockyTextureUrl, scene);
  grain.uScale = grain.vScale = 1 / GRAIN_TILE;
  // Undo the texture's darkness and the vertex colour's base, so the palette
  // tint is the rock's average colour.
  grain.level = 1 / (GRAIN_MEAN * ROCK_COLOR_BASE);
  const bump = new Texture(stoneNormalUrl, scene);
  bump.uScale = bump.vScale = 1 / BUMP_TILE;
  bump.level = BUMP_LEVEL;
  t = { grain, bump };
  _textures.set(scene, t);
  return t;
}

/**
 * Procedural rock (ROCKS.md): a radius-field rock from ./lib/rock/RockGen.js
 * (ellipsoid cut by fracture planes, noise, flat buried bottom), built into
 * one master with screen-coverage LOD. Surface: rocky grain + stone normal
 * map on RockGen's box UVs, times its baked AO / dust vertex colours.
 * Caching / instancing / editor contract in ./lib/instanced-decoration.js.
 * `radius` is JSON-only (rock.json featureDefaults).
 */
export default instancedDecoration({
  colliderGroup: "rock",
  variantProps: ["preset"],
  duplicate: scatterDuplicate(1.5),

  variantParams(feature, def) {
    const fd = def.featureDefaults ?? {};
    return {
      preset:    feature.preset ?? fd.preset ?? DEFAULT_PRESET,
      seed:      Number(feature.seed ?? fd.seed ?? 1),
      radius:    Number(fd.radius ?? BASE_RADIUS),
      bodyColor: feature.color ?? def.bodyColor ?? DEFAULT_BODY,
    };
  },

  variantKey: (p) => [p.preset, p.seed, p.radius, p.bodyColor].join("|"),

  buildVariant(scene, p, key) {
    const mat = new StandardMaterial(`rockBody_${key}`, scene);
    mat.diffuseColor = tint(p.bodyColor, DEFAULT_BODY);
    mat.specularColor = new Color3(0.03, 0.03, 0.03);
    const { grain, bump } = rockTextures(scene);
    mat.diffuseTexture = grain;
    mat.bumpTexture = bump; // vertex colours (AO + dust) come from RockGen

    const options = rockOptions(p.preset, p.seed);
    const skeleton = growRock(options);
    const scale = p.radius / BASE_RADIUS;
    const build = (detail, suffix) => {
      const buf = meshRock(skeleton, options, detail);
      const mesh = masterFromBuffers(`rockBody_${key}${suffix}`, buf, scene, { scale });
      if (mesh) mesh.material = mat;
      return { mesh, buf };
    };

    const full = build(FULL_DETAIL, "");
    let height = 0;
    for (let i = 1; i < full.buf.verts.length; i += 3) height = Math.max(height, full.buf.verts[i] * scale);

    const groups = { rock: full.mesh };
    attachLods(groups, LOD_DETAILS.map((detail, i) => ({
      coverage: LOD_COVERAGE[i],
      groups: { rock: build(detail, `_lod${i + 1}`).mesh },
    })));

    return { groups, mats: [mat], height };
  },

  controls: {
    preset:  { type: "select", label: "Type", options: ROCK_PRESET_IDS.map((id) => ({ value: id, label: LABEL(id) })) },
    color:   { type: "color", label: "Colour", options: ROCK_COLOR_OPTIONS },
    seed:    { type: "range", label: "Variant",  min: 1,   max: 40,  step: 1, random: true },
    scale:   { type: "range", label: "Scale",    min: 0.5, max: 4,   step: 0.1, unit: "×" },
    heading: { type: "range", label: "Rotation", min: 0,   max: 360, step: 1,   unit: "°" },
  },
});
