import { Constants, MaterialPluginBase, RawTexture, Texture } from "@babylonjs/core";

/**
 * Water surface shading — the shader half of the water build.
 *
 * `WaterSurfacePlugin` rides on the StandardMaterial built in Water.js the same
 * way TerrainBlendPlugin rides on the ground material: StandardMaterial keeps
 * lighting, shadow receiving and the per-vertex depth tint/alpha, and the plugin
 * only perturbs the per-pixel surface normal.
 *
 * Phases 0–2 of WATER_REACTIVE.md: two scrolling normal layers of ambient
 * motion, plus the wake field the trucks stamp into (WakeFieldManager.js),
 * sampled in the same hook for extra slope and for foam.
 *
 * Two hazards this file is shaped around, both inherited from ground-shader.js:
 *
 * 1. Values baked into the shader SOURCE via getCustomCode() are invisible to
 *    Babylon's effect cache, which keys on the defines string alone. Two water
 *    materials with identical defines would share one compiled shader and the
 *    second would silently run the first one's baked-in constants — the bug
 *    that produced stretched terrain on non-square tracks.
 *
 *    Everything baked below is a global constant, so there is nothing to key
 *    on. The one genuinely per-track value — the wake field's world bounds —
 *    is deliberately a UNIFORM rather than baked, which sidesteps the hazard
 *    instead of managing it. It also fixes a bug baking would have introduced:
 *    the material is cached per scene and survives an editor water rebuild,
 *    while the bounds change whenever a water feature moves, so baked bounds
 *    would go stale on the very first edit. Keep new per-track values uniforms.
 * 2. ground-shader.js records that "a plugin uniform declared through
 *    getUniforms() never reaches the GLSL on that path" and bakes its constants
 *    instead. That is fine for constants and useless for a clock. getUniforms()
 *    below declares `waterTime` through BOTH routes Babylon offers, which is
 *    what that note was missing:
 *      - `ubo:` lands the declaration inside the Material uniform block
 *        (defaultUboDeclaration) and registers the name so the effect can find
 *        its location. This is the live path — StandardMaterial resolves
 *        `#include<__decl__defaultFragment>` to the UBO variant whenever the
 *        engine supports uniform buffers, i.e. always on WebGL2.
 *      - `fragment:` lands a plain `uniform float` in the non-UBO variant.
 *    Exactly one of the two insertion points exists in any given compile, so
 *    declaring both is safe rather than a duplicate declaration.
 */

const _waterNormalModules = import.meta.glob('../assets/normals/water.normal.jpg', {
  eager: true, query: '?url', import: 'default',
});
const WATER_NORMAL_URL = Object.values(_waterNormalModules)[0];

// Seconds before the clock wraps, kept well inside float32's comfortable range
// so the GLSL side keeps sub-millisecond resolution on the value.
//
// The wrap is a hard discontinuity, and the scroll offsets below are built on
// it. Every DRIFT component is chosen so WATER_TIME_WRAP × drift is a whole
// number of texture repeats — the UV lands exactly where it started and the
// wrap is invisible. Retune a drift and keep that property, or the ripples will
// jump once every ten minutes.
const WATER_TIME_WRAP = 600;

// Two layers of the same normal map at different scales drifting in different
// directions. One texture sampled twice: a second asset would buy a little more
// variety for another bind, and at these scales the repeat is already hidden by
// the cross-fade between layers.
//
// TILE is world units per repeat; DRIFT is UV per second, so world speed is
// TILE × DRIFT. WEIGHT is each layer's share of the summed slope.
const LAYER_A = { tile: 9.0,  drift: [0.050, 0.020], weight: 0.60 };
const LAYER_B = { tile: 21.0, drift: [-0.030, 0.045], weight: 0.40 };

// Wake field (WakeFieldManager.js). The gradient between neighbouring texels of
// a soft blob is small, so the slope gain is large; foam is the field's raw
// value pushed toward opaque white, which is what makes churn read on shallow
// water where the surface is nearly transparent.
const WAKE_TEX_SIZE = 256;
const WAKE_SLOPE_STRENGTH = 7.0;
const WAKE_FOAM_GAIN = 1.3;
const WAKE_FOAM_WHITE = 0.85;
const WAKE_FOAM_ALPHA = 0.80;

// How hard the summed slope tilts the surface normal. The water is flat and lit
// by one directional light, so this is almost entirely a specular effect —
// turn it up and the glints get busier, not the shading darker.
const WATER_NORMAL_STRENGTH = 0.30;

const _WATER_GLSL_DEFS = `
  // Declared explicitly: Babylon's plugin getSamplers() only registers the name
  // for binding, it does not emit the GLSL declaration.
  uniform sampler2D waterNormalSampler;
  uniform sampler2D waterWakeSampler;

  // Tangent-space XY of a normal-map sample. The surface is flat and horizontal,
  // so tangent X/Y are world X/Z and the layers just add.
  vec2 _waterSlope(vec2 uv) {
    return texture2D(waterNormalSampler, uv).xy * 2.0 - 1.0;
  }
`;

/** Build the world-space scrolling UV expression for one layer. */
function _layerUv({ tile, drift }) {
  const [du, dv] = drift;
  return `vPositionW.xz * ${(1 / tile).toFixed(6)} + waterTime * vec2(${du.toFixed(6)}, ${dv.toFixed(6)})`;
}

const _WATER_UPDATE_DIFFUSE = `
  vec2 _wSlope = _waterSlope(${_layerUv(LAYER_A)}) * ${LAYER_A.weight.toFixed(3)}
               + _waterSlope(${_layerUv(LAYER_B)}) * ${LAYER_B.weight.toFixed(3)};

  // Wake field. Outside its bounds the UV leaves [0,1] and the sampler clamps to
  // the field's padded, permanently-zero border, so this costs three taps and
  // changes nothing on water no truck has touched.
  vec2 _wUv = (vPositionW.xz - waterWakeBounds.xy) * waterWakeBounds.zw;
  float _wake  = texture2D(waterWakeSampler, _wUv).r;
  float _wakeX = texture2D(waterWakeSampler, _wUv + vec2(${(1 / WAKE_TEX_SIZE).toFixed(8)}, 0.0)).r;
  float _wakeZ = texture2D(waterWakeSampler, _wUv + vec2(0.0, ${(1 / WAKE_TEX_SIZE).toFixed(8)})).r;
  // Forward differences, not central: a blob this soft does not need the extra
  // two taps to give a usable direction.
  vec2 _wakeSlope = vec2(_wakeX - _wake, _wakeZ - _wake);

  normalW = normalize(normalW
    + vec3(_wSlope.x, 0.0, _wSlope.y) * ${WATER_NORMAL_STRENGTH.toFixed(3)}
    + vec3(_wakeSlope.x, 0.0, _wakeSlope.y) * ${WAKE_SLOPE_STRENGTH.toFixed(3)});

  // Churn. baseColor already carries the per-vertex depth tint (Babylon applies
  // VERTEXCOLOR before this hook) and alpha the depth ramp, so this whitens the
  // real water colour and locally overrides the shallows' transparency.
  float _churn = clamp(_wake * ${WAKE_FOAM_GAIN.toFixed(3)}, 0.0, 1.0);
  baseColor.rgb = mix(baseColor.rgb, vec3(1.0), _churn * ${WAKE_FOAM_WHITE.toFixed(3)});
  alpha = max(alpha, _churn * ${WAKE_FOAM_ALPHA.toFixed(3)});
`;

export class WaterSurfacePlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, "WaterSurface", 200, {});
    const scene = material.getScene();
    this._normalTex = WATER_NORMAL_URL ? new Texture(WATER_NORMAL_URL, scene) : null;
    if (this._normalTex) {
      this._normalTex.wrapU = Texture.WRAP_ADDRESSMODE;
      this._normalTex.wrapV = Texture.WRAP_ADDRESSMODE;
    }
    // Stands in for the wake field on a track with no water, before the field
    // is built, and between an editor rebuild disposing one and creating the
    // next. Reads zero, so the wake terms fall out with no branch in the GLSL
    // and no define to recompile against.
    // The explicit type matters: CreateRTexture defaults `type` to
    // TEXTURETYPE_FLOAT, which does not match a Uint8Array.
    this._emptyWake = RawTexture.CreateRTexture(
      new Uint8Array(1), 1, 1, scene, false, false,
      Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE
    );
    this._emptyWake.wrapU = Texture.CLAMP_ADDRESSMODE;
    this._emptyWake.wrapV = Texture.CLAMP_ADDRESSMODE;
    this._emptyWake.gammaSpace = false;
    this._enable(true);
  }

  // Hold the surface back until the map has loaded. Binding an unready texture
  // samples black, i.e. a slope of (-1,-1) everywhere — a hard uniform tilt on
  // every water body for the first frames after a scene build.
  isReadyForSubMesh() {
    return this._normalTex ? this._normalTex.isReady() : true;
  }

  getSamplers(samplers) {
    samplers.push("waterNormalSampler", "waterWakeSampler");
  }

  getUniforms() {
    return {
      ubo: [
        { name: "waterTime", size: 1, type: "float" },
        // (minX, minZ, 1/sizeX, 1/sizeZ) of the wake field in world space. A
        // uniform rather than baked into the source on purpose — see the note
        // on hazard 1 at the top of this file.
        { name: "waterWakeBounds", size: 4, type: "vec4" },
      ],
      fragment: "uniform float waterTime;\nuniform vec4 waterWakeBounds;",
    };
  }

  getActiveTextures(activeTextures) {
    if (this._normalTex) activeTextures.push(this._normalTex);
  }

  hasTexture(texture) {
    return texture === this._normalTex;
  }

  bindForSubMesh(uniformBuffer, scene) {
    // Read straight off the wall clock rather than accumulating deltas here:
    // this runs once per submesh per frame and every body shares one material,
    // so an accumulator would run at N× speed on a track with N water bodies.
    // Stateless also means nothing to tear down on an editor rebuild.
    uniformBuffer.updateFloat("waterTime", (performance.now() * 0.001) % WATER_TIME_WRAP);

    // Looked up per frame rather than held: the material is cached for the life
    // of the scene, while an editor water edit disposes the field and builds a
    // new one with different bounds. A stored reference would go dangling.
    const wake = scene.metadata?.wakeField;
    if (wake) {
      const { minX, minZ, sizeX, sizeZ } = wake.bounds;
      uniformBuffer.updateFloat4("waterWakeBounds", minX, minZ, 1 / sizeX, 1 / sizeZ);
    } else {
      // No field: any world position maps far outside [0,1] and clamps to the
      // 1×1 zero texture below.
      uniformBuffer.updateFloat4("waterWakeBounds", 0, 0, 0, 0);
    }

    if (scene.texturesEnabled) {
      if (this._normalTex) uniformBuffer.setTexture("waterNormalSampler", this._normalTex);
      uniformBuffer.setTexture("waterWakeSampler", wake?.texture ?? this._emptyWake);
    }
  }

  // Convention-following: the texture is scene-owned, so a plain material
  // dispose leaves it to the scene and only a forced dispose reclaims it here.
  dispose(forceDisposeTextures) {
    // The 1×1 placeholder is this plugin's own, so it goes either way; the
    // normal map is scene-owned and only a forced dispose reclaims it here.
    this._emptyWake?.dispose();
    this._emptyWake = null;
    if (forceDisposeTextures) this._normalTex?.dispose();
  }

  getCustomCode(shaderType) {
    if (shaderType !== "fragment") return null;
    return {
      "CUSTOM_FRAGMENT_DEFINITIONS": _WATER_GLSL_DEFS,
      "CUSTOM_FRAGMENT_UPDATE_DIFFUSE": _WATER_UPDATE_DIFFUSE,
    };
  }
}

/**
 * Attach the plugin to a water surface material. No-op on WebGL1, matching how
 * createTerrainMaterial gates TerrainBlendPlugin — that path already falls back
 * to flat unblended terrain, and flat unanimated water belongs with it.
 *
 * @param {import('@babylonjs/core').StandardMaterial} material
 * @returns {WaterSurfacePlugin|null}
 */
export function attachWaterSurfacePlugin(material) {
  const webGLVersion = material?.getScene?.()?.getEngine?.()?.webGLVersion ?? 2;
  if (webGLVersion < 2) return null;
  return new WaterSurfacePlugin(material);
}
