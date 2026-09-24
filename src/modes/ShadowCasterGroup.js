import { ShadowGenerator, Light } from "@babylonjs/core";

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
    /** Extra always-on generators added at runtime (e.g. night track lights),
     *  kept outside the front-N `_activeCount` model. light -> ShadowGenerator. */
    this._extra = new Map();
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
    for (const g of this._extra.values()) g.addShadowCaster(mesh, includeDescendants);
    return this;
  }

  removeShadowCaster(mesh, includeDescendants = true) {
    this._casters.delete(mesh);
    for (const g of this._gens) g.removeShadowCaster(mesh, includeDescendants);
    for (const g of this._extra.values()) g.removeShadowCaster(mesh, includeDescendants);
    return this;
  }

  /**
   * Attach an extra shadow-casting light on top of the fixed key set — used for
   * the night track lights, which don't exist when the group is created. Builds
   * a generator now (not lazy — these are meant to be on), replays every tracked
   * caster into it, and applies the current quality knobs. Idempotent per light.
   */
  addLight(light, { mapSize = 512, refreshRate } = {}) {
    if (!light || this._extra.has(light)) return this._extra.get(light) ?? null;
    const gen = new ShadowGenerator(mapSize, light);
    this._applyQualityTo(gen, refreshRate ?? this._quality.refreshRate);
    for (const [mesh, inc] of this._casters) gen.addShadowCaster(mesh, inc);
    light.shadowEnabled = true;
    this._extra.set(light, gen);
    return gen;
  }

  /** Detach and dispose an extra light's generator (see addLight). */
  removeLight(light) {
    const gen = this._extra.get(light);
    if (!gen) return;
    this._extra.delete(light);
    if (light) light.shadowEnabled = false;
    gen.dispose?.();
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
    for (const g of this._extra.values()) this._applyQualityTo(g, quality.refreshRate);
  }

  _applyQualityTo(gen, refreshRate = this._activeCount > 0 ? this._quality.refreshRate : undefined) {
    const q = this._quality;
    if (q.blurKernel !== undefined) gen.blurKernel = q.blurKernel;
    this._applyBias(gen);
    if (q.normalBias !== undefined) gen.normalBias = q.normalBias;
    if (q.darkness !== undefined) gen.setDarkness(q.darkness);
    // Filter flags are applied in this order so the one set true wins (each
    // setter only clears the filter when it's the current one). Babylon falls
    // back from PCF to Poisson on point-light cube maps by itself.
    if (q.useBlurExponentialShadowMap !== undefined) gen.useBlurExponentialShadowMap = q.useBlurExponentialShadowMap;
    if (q.usePoissonSampling !== undefined) gen.usePoissonSampling = q.usePoissonSampling;
    if (q.usePercentageCloserFiltering !== undefined) gen.usePercentageCloserFiltering = q.usePercentageCloserFiltering;
    if (q.filteringQuality !== undefined) gen.filteringQuality = q.filteringQuality;
    if (refreshRate !== undefined) {
      const map = gen.getShadowMap?.();
      if (map) map.refreshRate = refreshRate;
    }
  }

  /**
   * Depth bias. With PCF, Babylon adds `bias` to the shadow pass's clip-space
   * z, so a world-unit `biasWorld` is converted per light wherever the light
   * has an explicit shadowMinZ/shadowMaxZ (sun, moon, track-light spots):
   *   - orthographic (directional): NDC depth is linear, Δworld = bias·(f−n)/2
   *   - perspective (spot): NDC depth is ~1/d, Δworld = bias·(f−n)·d²/(2fn),
   *     so it's exact at a reference distance d (mid-range) and grows ∝ d²
   *     beyond it. A plain fraction there put a lit strip along wall bases.
   * Other lights (point/cube maps) take the plain fractional `bias`.
   */
  _applyBias(gen) {
    const q = this._quality;
    const light = gen.getLight?.();
    const n = light?.shadowMinZ, f = light?.shadowMaxZ;
    if (q.biasWorld === undefined || !(f > n && n > 0)) {
      if (q.bias !== undefined) gen.bias = q.bias;
      return;
    }
    if (light.getTypeID?.() === Light.LIGHTTYPEID_SPOTLIGHT) {
      const d = (n + f) / 2;
      gen.bias = (q.biasWorld * 2 * f * n) / ((f - n) * d * d);
    } else {
      gen.bias = (2 * q.biasWorld) / (f - n);
    }
  }

  /** Re-derive an extra light's bias after its shadowMinZ/shadowMaxZ changed. */
  refreshLight(light) {
    const gen = this._extra.get(light);
    if (gen) this._applyBias(gen);
  }

  /** Set the shadow-map refresh rate on the active generators (RaceMode/MenuMode). */
  setRefreshRate(rate) {
    this._quality.refreshRate = rate;
    for (const g of this.activeGenerators) {
      const map = g.getShadowMap?.();
      if (map) map.refreshRate = rate;
    }
    for (const g of this._extra.values()) {
      const map = g.getShadowMap?.();
      if (map) map.refreshRate = rate;
    }
  }

  dispose() {
    for (const g of this._gens) g.dispose?.();
    for (const g of this._extra.values()) g.dispose?.();
    this._extra.clear();
    this._gens = [];
    this._casters.clear();
    this._activeCount = 0;
  }
}
