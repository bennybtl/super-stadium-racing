import { ShadowGenerator } from "@babylonjs/core";

/**
 * A drop-in stand-in for a single Babylon `ShadowGenerator` that fans shadow
 * casters and quality knobs out to several generators — one per shadow-casting
 * light.
 *
 * SceneBuilder threads one `shadows` object through ~15 call sites (managers,
 * every placed Object, the trucks). They only ever call `addShadowCaster`,
 * `removeShadowCaster` and `getShadowMap`, so those fan out here and everything
 * downstream is unchanged.
 *
 * Only the primary generator is built eagerly. Secondaries are created lazily
 * the first time `setActiveCount()` asks for them (a cube shadow map is tens of
 * MB of VRAM, not worth holding for a tier the player may never pick) and the
 * tracked caster set is replayed into each new one. Turning a secondary back
 * off just parks it — `light.shadowEnabled = false`, refresh 0 — so re-enabling
 * is instant.
 */
export class ShadowCasterGroup {
  constructor() {
    this._gens = [];
    this._lights = [];
    this._mapSize = 1024;
    this._activeCount = 0;
    /** mesh -> includeDescendants, replayed into lazily-created generators. */
    this._casters = new Map();
    /** last configure() payload, re-applied to new generators. */
    this._quality = {};
  }

  /**
   * @param {import("@babylonjs/core").IShadowLight[]} lights  ordered; [0] is
   *   the primary/key light, the rest are optional secondary casters.
   * @param {{ mapSize?: number, eagerCount?: number }} [opts]
   */
  static create(lights, { mapSize = 1024, eagerCount = 1 } = {}) {
    const group = new ShadowCasterGroup();
    group._lights = (lights ?? []).filter(Boolean);
    group._mapSize = mapSize;
    const eager = Math.max(1, Math.min(eagerCount, group._lights.length));
    for (let i = 0; i < eager; i++) group._gens.push(new ShadowGenerator(mapSize, group._lights[i]));
    group._activeCount = group._gens.length;
    return group;
  }

  get primary() {
    return this._gens[0] ?? null;
  }

  get generators() {
    return this._gens.slice();
  }

  get activeGenerators() {
    return this._gens.slice(0, this._activeCount);
  }

  get activeCount() {
    return this._activeCount;
  }

  /** The primary shadow map — callers that tweak `refreshRate` directly hit this. */
  getShadowMap() {
    return this.primary?.getShadowMap?.() ?? null;
  }

  addShadowCaster(mesh, includeDescendants = true) {
    if (!this._casters.has(mesh)) {
      // Keep the replay set from accumulating dead refs across a scene's life.
      mesh.onDisposeObservable?.addOnce?.(() => this._casters.delete(mesh));
    }
    this._casters.set(mesh, includeDescendants);
    for (const g of this._gens) g.addShadowCaster(mesh, includeDescendants);
    return this;
  }

  removeShadowCaster(mesh, includeDescendants = true) {
    this._casters.delete(mesh);
    for (const g of this._gens) g.removeShadowCaster(mesh, includeDescendants);
    return this;
  }

  /**
   * How many generators (from the front) actually render. 0 disables shadows
   * entirely. Values above the current generator count create the missing
   * generators (up to the number of lights given) and replay every caster into
   * them.
   */
  setActiveCount(n) {
    const want = Math.max(0, Math.min(n | 0, this._lights.length));

    while (this._gens.length < want) {
      const gen = new ShadowGenerator(this._mapSize, this._lights[this._gens.length]);
      this._applyQualityTo(gen);
      for (const [mesh, inc] of this._casters) gen.addShadowCaster(mesh, inc);
      this._gens.push(gen);
    }

    this._activeCount = want;
    this._gens.forEach((g, i) => {
      const on = i < want;
      const light = g.getLight?.();
      if (light) light.shadowEnabled = on;
      if (!on) {
        const map = g.getShadowMap?.();
        if (map) map.refreshRate = 0;
      }
    });
  }

  /** Fan quality knobs to every generator; refresh rate only to active ones. */
  configure(quality = {}) {
    this._quality = { ...this._quality, ...quality };
    for (let i = 0; i < this._gens.length; i++) {
      this._applyQualityTo(this._gens[i], i < this._activeCount ? quality.refreshRate : undefined);
    }
  }

  _applyQualityTo(gen, refreshRate = this._activeCount > 0 ? this._quality.refreshRate : undefined) {
    const q = this._quality;
    if (q.blurKernel !== undefined) gen.blurKernel = q.blurKernel;
    if (q.bias !== undefined) gen.bias = q.bias;
    if (q.normalBias !== undefined) gen.normalBias = q.normalBias;
    if (q.darkness !== undefined) gen.setDarkness(q.darkness);
    if (q.useBlurExponentialShadowMap !== undefined) gen.useBlurExponentialShadowMap = q.useBlurExponentialShadowMap;
    if (q.usePoissonSampling !== undefined) gen.usePoissonSampling = q.usePoissonSampling;
    if (refreshRate !== undefined) {
      const map = gen.getShadowMap?.();
      if (map) map.refreshRate = refreshRate;
    }
  }

  /** Set the shadow-map refresh rate on the active generators (RaceMode/MenuMode). */
  setRefreshRate(rate) {
    this._quality.refreshRate = rate;
    for (const g of this.activeGenerators) {
      const map = g.getShadowMap?.();
      if (map) map.refreshRate = rate;
    }
  }

  dispose() {
    for (const g of this._gens) g.dispose?.();
    this._gens = [];
    this._casters.clear();
    this._activeCount = 0;
  }
}
