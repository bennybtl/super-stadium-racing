/**
 * Node stand-ins for the few browser APIs the headless sim still touches.
 *
 * The sim-scene managers build their meshes and materials even without a
 * renderer (see src/sim/sim-scene.js); a couple of those draw into a canvas
 * (checkpoint number decals), which NullEngine creates as an OffscreenCanvas.
 * A no-op 2D context is enough — nothing is ever rendered.
 */
export function installHeadlessEnv() {
  if (globalThis.OffscreenCanvas) return;
  const noop = new Proxy(function () {}, {
    get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : noop),
    apply: () => noop,
  });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return noop;
    }
  };
}
