import { MaterialPluginBase } from "@babylonjs/core";

/**
 * Leaf wind sway for ez-tree foliage (EZ_TREE.md phase 5) — a port of the
 * vertex sway ez-tree injects via onBeforeCompile, as a StandardMaterial
 * plugin (same pattern as water-shader.js).
 *
 * Each leaf quad's vertices move by `uv.y` × a sum of three sines, so the base
 * of the quad (uv.y = 0, attached to the twig) stays put and the tip flutters.
 * Changes from upstream:
 *  - Applied in WORLD space (CUSTOM_VERTEX_UPDATE_WORLDPOS), not model space.
 *    Every placed tree is an instance of a shared master, so a model-space
 *    phase would make every copy of a variant sway in lockstep. World space
 *    also keeps one wind direction regardless of each tree's heading.
 *  - The phase comes from two crossed sines of world xz instead of ez-tree's
 *    3D simplex noise. It's cheaper and still smooth across the canopy, so
 *    nearby leaves move together and a gust reads as a wave.
 *  - Amplitude and phase scale are ez-tree's values × the tree's world scale
 *    (~0.22), because the sway is added after the world transform.
 *
 * Shadows don't sway: the shadow-map pass uses its own depth shader, not this
 * material. At ~0.1 units of tip movement the mismatch isn't visible.
 *
 * Constants are baked (global, identical for every leaf material, so the
 * effect-cache hazard described in water-shader.js doesn't apply). The clock
 * is a uniform, declared through both the UBO and plain-uniform routes for the
 * reason given there.
 */

// Wraps the clock well inside float32 precision. The sway is periodic in time
// only per-frequency, so the wrap is a one-frame hitch every ~17 minutes.
const WIND_TIME_WRAP = 1000;

const _WIND_DEFS = /* glsl */ `
  const vec2 TREE_WIND_STRENGTH = vec2(0.11, 0.11); // world xz, at uv.y = 1
  const float TREE_WIND_FREQUENCY = 0.5;
`;

const _WIND_UPDATE_WORLDPOS = /* glsl */ `
#ifdef UV1
  {
    vec2 p = worldPos.xz;
    float windOffset = 3.0 * (sin(dot(p, vec2(0.071, 0.043))) + sin(dot(p, vec2(-0.037, 0.083))));
    float t = treeWindTime * TREE_WIND_FREQUENCY;
    float sway = 0.5 * sin(t + windOffset)
               + 0.3 * sin(2.0 * t + 1.3 * windOffset)
               + 0.2 * sin(5.0 * t + 1.5 * windOffset);
    worldPos.xz += uvUpdated.y * TREE_WIND_STRENGTH * sway;
  }
#endif
`;

export class TreeWindPlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, "TreeWind", 200, {});
    this._enable(true);
  }

  getUniforms() {
    return {
      ubo: [{ name: "treeWindTime", size: 1, type: "float" }],
      vertex: "uniform float treeWindTime;",
    };
  }

  bindForSubMesh(uniformBuffer) {
    // Stateless wall clock: every tree variant has its own material, so an
    // accumulator here would run at N× speed.
    uniformBuffer.updateFloat("treeWindTime", (performance.now() * 0.001) % WIND_TIME_WRAP);
  }

  getCustomCode(shaderType) {
    if (shaderType !== "vertex") return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: _WIND_DEFS,
      CUSTOM_VERTEX_UPDATE_WORLDPOS: _WIND_UPDATE_WORLDPOS,
    };
  }
}

/** Attach to a leaf material. No-op on WebGL1, like the water plugins. */
export function attachTreeWindPlugin(material) {
  const webGLVersion = material?.getScene?.()?.getEngine?.()?.webGLVersion ?? 2;
  if (webGLVersion < 2) return null;
  return new TreeWindPlugin(material);
}
