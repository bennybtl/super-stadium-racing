# Reactive water — phased plan

**Status:** Phases 0 + 1 landed and confirmed in-app (2026-09-07) — subtle
moving ripple, tuning left at the shipped defaults. Phase 2 landed
(2026-09-07) and confirmed — it reads as a trough pressed into the surface that
fills back in, which is what a field with no propagation gives you. Phase 4
landed and confirmed in-app (2026-09-07) after two tuning passes. Phases 3 and 5
not started; the entry-splash rings from Phase 4 are also still open.

## Why

Water today is a correct but inert sheet. `buildWaterBodies` produces a flat
horizontal mesh with per-vertex depth tint/alpha plus static foam ribbons on the
shorelines (`src/objects/Water.js`). Nothing moves, and nothing responds to a
truck driving through it — the truck side already knows it is wading
(`ParticleEffects` sprays, `TruckAudioController` splashes), but the surface
itself never acknowledges it.

Goal: the water reads as a liquid, and a truck driving through it visibly
disturbs it.

## What the current build constrains

Two facts from the existing code drive every decision below:

1. **The surface is deliberately under-tessellated.** `buildSurfaceGeometry`
   ([water-field.js:407](src/objects/water-field.js:407)) merges each run of
   fully submerged cells into one quad, so a large pool is a handful of
   triangles. Any approach that *displaces geometry* needs a tessellation change
   first. Anything texture-based drops straight in.
2. **Shading is StandardMaterial + vertex colours**, with one material per scene
   shared across all bodies (`_waterMaterials` WeakMap,
   [Water.js:76](src/objects/Water.js:76)). The natural insertion point is a
   `MaterialPluginBase`, exactly like `TerrainBlendPlugin` — it keeps the depth
   tint/alpha vertex stream and all the StandardMaterial lighting/shadow work
   intact.

So: **texture-space first, geometry last.**

## End state

- Ambient motion on every water surface (scrolling normals, cheap).
- A **wake field**: one world-space R8 texture covering the union bounds of the
  track's water bodies, decayed each frame and stamped where trucks are wading.
- That field drives, in order of payoff: surface normal perturbation + foam
  whiteness on the water, foam-ribbon pulsing at the shore, and a UV wobble on
  the lakebed in `TerrainBlendPlugin` (fake refraction).
- Wake trail ribbons behind wading trucks, as an art-directed layer on top.
- Optional, gated: real height-field simulation with vertex displacement.

## Guiding principles

- **Ship each phase.** Every phase leaves the app working and is independently
  revertible.
- **One material, one texture.** Do not go per-body — the shared material is
  worth keeping. Size the wake texture to the union of water-body bounds, not
  the whole track, and bake those bounds into the shader source.
- **No new quality tier unless a phase demands it.** `DEFAULT_DISPLAY_SETTINGS`
  ([settingsStorage.js:52](src/settingsStorage.js:52)) already carries
  `shadow` / `lights` / `aiTruckShadows`; add `water: 'off' | 'low' | 'high'`
  only when Phase 5 lands, not before.
- **Two recurring hazards, both now closed.** The uniform-injection one was
  settled in Phase 0. The effect-cache one was dissolved rather than managed:
  Phase 2's per-track value is a uniform, not baked source. Keep it that way —
  bake global constants only.

---

## Phase 0 — Plugin spike: can we get a time uniform in?  ✅ DONE (2026-09-07)

Not cosmetic work; this decided the shape of every later phase.

`TerrainBlendPlugin` bakes all its per-track constants into the shader *source*
via `getCustomCode()`, with a note that "this material does not use uniform
buffers, and a plugin uniform declared through `getUniforms()` never reaches the
GLSL on that path" ([ground-shader.js:955](src/shaders/ground-shader.js:955)).
Static constants are fine to bake. **Animation time is not** — a baked constant
cannot tick.

**Result: the uniform route works.** That note was half-right about the symptom
and wrong about the cause. Traced through Babylon 8's plugin machinery:

- `MaterialPluginManager` consumes `getUniforms()` in two places
  ([materialPluginManager.js:205](node_modules/@babylonjs/core/Materials/materialPluginManager.js:205)).
  `ubo:` entries are pushed into the Material uniform block at
  `#define ADDITIONAL_UBO_DECLARATION`; `fragment:` strings are pushed into the
  plain-uniform block at `#define ADDITIONAL_FRAGMENT_DECLARATION`.
- Which of the two blocks exists depends on the shader processor: it rewrites
  `#include<__decl__defaultFragment>` to the **Ubo** variant whenever
  `supportsUniformBuffers` ([shaderProcessor.js:320](node_modules/@babylonjs/core/Engines/Processors/shaderProcessor.js:320)),
  i.e. always on WebGL2. StandardMaterial does use that include.
- So declaring only one of the two routes fails on the other path, silently —
  the injection point simply is not in the source and `String.replace` no-ops.
  **Declare both.** Exactly one insertion point exists per compile, so this is
  not a duplicate declaration. `ubo:` also registers the name in the effect's
  uniform list, which is what makes the location resolvable at all.
- Attaching the plugin after the material is constructed is safe:
  `_addPlugin` rebuilds the uniform buffer if the layout was already built, and
  `Material.buildUniformLayout()` fires `PrepareUniformBuffer` *before*
  `ubo.create()` ([material.js:863](node_modules/@babylonjs/core/Materials/material.js:863)).

Landed in `src/shaders/water-shader.js`:

- `WaterSurfacePlugin` — declares `waterTime` through both routes, pushes it in
  `bindForSubMesh` with `uniformBuffer.updateFloat`.
- The clock is **stateless**: `(performance.now() * 0.001) % WATER_TIME_WRAP`,
  not a delta accumulated in the plugin. `bindForSubMesh` runs once per submesh
  per frame and every body shares one material, so an accumulator there would
  run at N× speed on a track with N water bodies. Stateless also leaves nothing
  to tear down on an editor rebuild.
- `WATER_TIME_DEBUG` (on) injects a travelling brightness band at
  `CUSTOM_FRAGMENT_UPDATE_DIFFUSE`, proving the clock both arrives and advances.
  Phase 1 deletes it and puts the real work in the same hook.
- `attachWaterSurfacePlugin(material)` no-ops below WebGL2, matching how
  `createTerrainMaterial` gates `TerrainBlendPlugin`.
- Wired in at `getWaterMaterial` ([Water.js:80](src/objects/Water.js:80)) — one
  attach per scene, so all bodies share one compiled effect.

**Deferred, deliberately:** the effect-cache hazard. Per-track values baked into
`getCustomCode()` are invisible to Babylon's effect cache, which keys on the
defines string only — that is what caused the stretched-terrain bug (see
[ground-shader.js:922](src/shaders/ground-shader.js:922)). Phase 0 bakes no
per-track values, so there is nothing to key yet. Phase 2 bakes the wake-field
world bounds, and **must** add a `prepareDefines` setting `WATER_BOUNDS_*_KEY`
in the same commit. There is a comment in the file's header saying so.

**Confirmed in-app (2026-09-07):** the band sweeps. The `bumpTexture.uOffset`
fallback is not needed and Phase 1 deleted the band.

---

## Phase 1 — Ambient motion  ✅ DONE (2026-09-07)

No truck reaction; just kills the static-sheet read.

Landed in `src/shaders/water-shader.js`, replacing the Phase 0 debug band in the
same hook:

- **Two scrolling layers of `assets/normals/water.normal.jpg`**, sampled in
  world-space XZ at different tile sizes drifting in different directions, summed
  by weight and used to tilt `normalW`. One texture sampled twice rather than two
  assets: a second map buys a little more variety for another bind, and at these
  scales the repeat is already hidden by the cross-fade between layers.
- **World-space UVs, not mesh UVs.** The surface mesh has no meaningful UV set
  (`buildSurfaceGeometry` emits positions, indices and depths only), world space
  keeps the pattern continuous across the merged quads, and it stays put across
  an editor rebuild.
- The perturbation goes in `CUSTOM_FRAGMENT_UPDATE_DIFFUSE`, which runs after
  Babylon's `bumpFragment` and before lighting — the same place and for the same
  reason as the ground's detail relief. The water is flat and horizontal, so
  tangent X/Y are world X/Z and the layers just add, exactly as in
  `_TERRAIN_BLEND_UPDATE_DIFFUSE`.
- The vertex depth tint/alpha is untouched. With one directional light on a flat
  surface this is almost purely a **specular** effect: `WATER_NORMAL_STRENGTH`
  turns the glints busier, not the shading darker.
- `isReadyForSubMesh` holds the surface back until the map has loaded. An
  unready sampler reads black, i.e. a slope of (-1,-1) — a hard uniform tilt on
  every water body for the first frames after a scene build.

**The wrap constraint is now load-bearing.** `WATER_TIME_WRAP` (600 s) is a hard
discontinuity in `waterTime`, and the scroll offsets are built on it. Every
DRIFT component is chosen so `600 × drift` is a whole number of texture repeats
(30, 12, −18, 27) — the UV lands exactly where it started and the wrap is
invisible. Retune a drift and keep that property, or the ripples jump once every
ten minutes.

**Dropped from this phase: the Fresnel rim.** `emissiveFresnelParameters` keys
off the view/normal angle, and under a near-fixed isometric camera looking at a
horizontal plane that angle is close to constant across every pool — the term
would resolve to roughly "raise `emissiveColor` a bit", i.e. a knob that looks
like it does something and does not. What variation it *would* have picked up
comes from the scrolling normals, which the specular already reads more strongly
and more cheaply. Trivial to add later if the water wants more rim light.

**Knobs**, in the order worth reaching for: `WATER_NORMAL_STRENGTH` (overall
tilt), each layer's `tile` (ripple size), each layer's `drift` (speed and
direction — keep the wrap property).

---

## Phase 2 — The wake field  ✅ DONE (2026-09-07)

The systemic answer to "trucks make waves".

**Data.** One `RawTexture.CreateRTexture` (R8, 256²) per scene, covering the
padded union bounds of the track's water bodies. Sizing to the water rather than
the whole track is what keeps resolution usable — a track with one small pond
gets the full 256² over that pond instead of over 200 units of dry land. R8
keeps the per-frame upload at 64 KB.

**Owner.** `src/managers/WakeFieldManager.js`, published on
`scene.metadata.wakeField` beside `waterDepthAt` — the established pattern for
scene-wide water queries, and what makes every consumer a `?.` away from a
no-op. Built in `SceneBuilder` next to the depth sampler and rebuilt in
`EditorMode._rebuildWaterNow` (it disposes the previous field, so repeated
edits do not stack up observers). One `onBeforeRenderObservable` inside the
manager, so every mode gets it without wiring five call sites.

**Stamping** happens in `ParticleEffects.update`, on the *same gate that already
sprays* — the one place per frame that knows the truck is in water and how fast
it is going, with the wading thresholds already tuned. Deliberately **not**
scaled by `effectScaleOverride`: that is a distance-based particle budget, and a
wake an AI truck left across the map should still be there when the camera comes
round to it. A truck on ground merely *painted* water (which `isInWater` also
accepts, by design) stamps outside the field's bounds and is ignored.

**Consumption.** `WaterSurfacePlugin` takes three taps in the existing
`CUSTOM_FRAGMENT_UPDATE_DIFFUSE` hook: the value, and two forward differences
for a gradient it adds to the ambient slope. The value also whitens `baseColor`
and raises `alpha` — Babylon applies VERTEXCOLOR *before* this hook, so both the
depth tint and the depth alpha ramp are final and modifiable there, which is
what makes churn read on shallows that are otherwise nearly transparent.

### Deviations from the plan as written

- **The bounds are a uniform, not baked source with matching defines.** Phase 0
  proved plugin uniforms reach the GLSL, which the plan predated. This dissolves
  the effect-cache hazard rather than managing it, and avoids a bug baking would
  have introduced: the water material is cached for the life of the scene and
  survives an editor water rebuild, so baked bounds would have gone stale the
  first time a water feature moved. The plugin looks `scene.metadata.wakeField`
  up per frame for the same reason — a stored reference would dangle across a
  rebuild. A 1×1 zero texture stands in when there is no field, so the wake
  terms fall out with no branch and no define to recompile against.
- **One splat per truck, not two offset points.** A truck is ~2 units across;
  at this resolution that is a handful of texels, and two contacts merge into
  the same blob. The radius is fixed and the intensity ramps with speed — a fast
  truck churns harder, not wider.
- **Stamps land one frame late.** The manager's observer is registered during
  the scene build, before the modes register their truck-update observers, so
  each frame decays and uploads before that frame's stamps arrive. Invisible,
  and not worth a second observer to fix.

### Gotcha that cost a round trip

`RawTexture.CreateRTexture` defaults its `type` argument to **1, which is
`TEXTURETYPE_FLOAT`** — not to unsigned byte, as the "R8" framing suggests.
Created at the default with a `Uint8Array`, the field is read as R32F, i.e. a
quarter of the data the GPU expects, and renders as **nothing at all** — no
error, no warning, just a dead effect. Always pass
`Constants.TEXTURETYPE_UNSIGNED_BYTE` explicitly. Both raw textures here (the
field, and the 1×1 stand-in inside the plugin) hit it.

Left behind for next time: `window.__wakeDiag = true` in the console makes the
field log stamps/second and its peak value once a second, which separates "the
field is not being written" from "the shading is too subtle" without a rebuild.
Off by default, following the `window.__gizmoDiag` precedent in
EditorController.js.

### Verified headless (esbuild bundle + a Babylon stub, as with water-field.js)

- A stamp lands on the expected texel.
- The splat is **round in world space on non-square bounds** — 120×40 world
  units through a square texture gives 0.47 vs 0.16 u/texel, and the splat comes
  out 8 texels across in X and 20 in Z, i.e. the same world diameter both ways.
  World distances convert to texels per axis, never through one shared scale;
  this is the same aspect trap that once stretched the terrain bake.
- Out-of-bounds stamps are ignored, and a stamp on one shoreline puts nothing on
  the opposite edge (clamp, not wrap, against a permanently-zero padded border).
- An untouched field uploads nothing. One stamp clears in 2.5 s, the buffer
  returns to exactly zero (sub-byte values are floored, not left to converge),
  and it uploads nothing further at rest.
- A trail stamped at 12 u/s is continuous — no gaps between successive splats.

**Accepted tradeoff:** a long thin water span spends its 256² anisotropically
(the 120×40 case above wastes resolution on the short axis). Real union bounds
are usually roughly square. Fix by sizing the texture to the bounds' aspect if a
track ever makes it visible.

**Knobs:** `WAKE_DECAY_TIME` (how long a wake persists), `WAKE_RADIUS` and
`WAKE_SPEED_SCALE` (splat size and how hard speed drives it) in
WakeFieldManager.js; `WAKE_SLOPE_STRENGTH`, `WAKE_FOAM_GAIN`,
`WAKE_FOAM_WHITE`, `WAKE_FOAM_ALPHA` in water-shader.js.

---

## Phase 3 — Reactive foam and fake refraction

Two cheap riders on Phase 2's field, both worth more than they cost:

- **Shoreline lapping.** The foam material (`getFoamMaterial`,
  [Water.js:95](src/objects/Water.js:95)) also samples the wake field and scales
  its band alpha by it, so the truck's wake visibly reaches the shore. Note the
  ribbons are static meshes with baked band widths and per-vertex dither — the
  *width* cannot change at runtime without rebuilding geometry, so this is an
  alpha/brightness effect only. Accept that; it reads fine.
- **Lakebed distortion.** `TerrainBlendPlugin` already takes a water overlay
  texture and already knows which pixels are submerged (its alpha). Bind the
  wake field there too and wobble the terrain UV by its gradient under submerged
  pixels. Almost free once Phase 2 exists, and sells "liquid" harder than
  surface normals do — the bottom shimmers, which is the cue people actually
  read as water.

Both are additive and independently revertible. Do the lakebed one first; it is
the bigger payoff.

---

## Phase 4 — Wake trail ribbons  ✅ DONE + CONFIRMED (2026-09-07)

The art-directed layer, and the one that actually reads as "the truck is making
waves". Phase 2 in-app confirmed the prediction this phase was written on: the
field alone reads as *an indent in the surface that fills back in*, because a
decaying scalar has no propagation — a disturbance stays where it was stamped.
A V is a shape, so it is geometry.

Landed in `src/truck/WakeRibbon.js`, built like `TireMarks.js` — a trail of
nodes laid as the truck moves, triangles bridging each consecutive pair — with
one structural difference that is the whole point:

- **A tire mark is written once and never touched again; a wake node widens and
  fades as it ages.** Half-width starts at 0.8 m and opens at `SPREAD_RATE` per
  second of age, so a node is narrow at the truck and wide by the time it is
  metres behind. The opening angle of the V is therefore set by `SPREAD_RATE`
  against the truck's speed, the same relation that sets a real wake's.
- **Alpha holds before it fades.** A node sits at full strength for the first
  `FADE_HOLD` of its life and only then ramps down. The original plain
  `(1 - age)²` curve started dimming from the moment a node was laid, which made
  the whole trail read as faint; holding first keeps it solid along most of its
  length and soft only at the far end.
- Because nothing survives a frame unchanged, the nodes are a plain **deque, not
  TireMarks' ring** — a ring buys nothing when the whole buffer is rewritten
  anyway. Slots past the live nodes collapse onto the newest at alpha zero so the
  static index buffer always has something degenerate to point at.
- **Three vertices per node** (left edge, centre, right edge), with the edges at
  `EDGE_ALPHA` and the centre at `CENTRE_ALPHA` fading faster. An old stretch of
  wake thins to two diverging lines rather than staying a solid wedge.
- Laid from the **same rear point as the tire marks** (`-rearWheelGeometry.axleZ`)
  — a wake trails from where the truck displaces water, not from its centre.
- Reuses the shoreline swirl mask via a new `getSharedFoamTexture(scene)` export
  from Water.js (which `getFoamMaterial` now also uses), so the wake and the
  shoreline foam read as one material. **Its offsets must not be mutated** — it
  is shared, and scrolling it here would have dragged every shoreline band along
  with it. That is why the ribbon has no texture scroll.
- One material per scene, not one per truck: a race fields up to eight.

**Gating** matches the splash spray in `ParticleEffects`, *not* the tire marks:
wading holds `groundedness` around 0.3 because the suspension extends over the
submerged bed, so the strict grounded test the marks use would suppress the wake
exactly when the truck is deepest. `terrain` non-null is what stops a truck
jumping over a lake, or crossing a bridge above one, from drawing a wake.

**Surface height** comes from `sampleY(x, z) + waterDepth` — the drivable
surface under water is the bed, and the depth query is the distance from the bed
to the level. Both values are already at the call site in truck.js, so this
needs no new water-level sampler.

**Two edge cases handled up front:** a respawn is detected as a single-frame
move over `TELEPORT_DIST` and caps the trail with alpha-zero nodes at both ends
(TireMarks' streak-cap trick), so re-entering water elsewhere cannot stripe the
map; and an empty ribbon writes its buffers blank exactly once, so a truck out
of the water — which is nearly all of them, nearly all the time — costs nothing
per frame.

### Verified headless (esbuild bundle + Babylon/Water stubs)

Driving straight at 10 m/s for 3 seconds:

- **The V is there**: half-width 0.84 m at the truck, 7.36 m at the tail,
  monotonically widening backward.
- Edge alpha 1.00 against centre 0.70 on the newest node, held flat for the
  first 55% of the trail; the oldest node has faded to exactly 0, so nodes
  expire invisibly instead of popping.
- No NaN in positions or colours; every padding slot past the live nodes is at
  alpha 0.
- A 280 m jump caps the trail with two zero-strength nodes rather than bridging.

**Not done in this phase: the billboarded expanding rings at entry splashes.**
Entry is already marked by the deep-water burst in `ParticleEffects`
(`_deepSplashPulseTimer`), so a ring would be a second entry cue rather than a
missing one. Additive polish, easy to add on top of the ribbon, deliberately
left for a look at the trail first.

### Second tuning pass (2026-09-07) — the hard-edged slabs

A look in-app showed the wake as two blunt rectangles with straight ends. Two
separate causes, both now fixed:

- **`HALF_WIDTH_MAX` was shaping the wake, not backstopping it.** At 8.0 m
  against a 4 s life, every node past ~3.3 s old was pinned at the cap, so any
  stretch of trail old enough became a *constant-width slab*, not a V. Raised to
  12.0 m, above `HALF_WIDTH_START + SPREAD_RATE × NODE_LIFE`, so it never binds
  during a node's life. Keep that relation when tuning either knob.
- **Streaks had no taper at their ends.** Closing a streak dropped
  `_active` without laying a cap node — TireMarks' streak-taper trick, omitted
  by mistake — so the trail stopped on a full-strength straight edge. Now a
  streak closes with an alpha-zero cap, and `_computeTaper` ramps alpha to zero
  across `TAPER_NODES` (~5 m) at *every* streak boundary: the oldest node, every
  interior cap, and the newest node **only once the truck has stopped laying**.
  While it is still driving the wake stays fully attached to the truck, which is
  the one end that must not fade.

Verified headless: laying at 10 m/s, alpha is 1.00 at the truck and 1.00 five
nodes back, while the trail start ramps 0.00 → 0.18 → 0.50 → 0.90 → 1.00. After
leaving the water that end ramps too, 0.00 → 0.10 → 0.30 → 0.60 → 1.00. No node
is pinned at `HALF_WIDTH_MAX`, and widths run 6.30 m at the tail to 0.80 m at
the truck — continuously tapering, no slab.

**Knobs:** `SPREAD_RATE` (how wide the V opens), `NODE_LIFE` (how far back it
reaches), `FADE_HOLD` (how much of that length stays at full strength), `TAPER_NODES`
(how long the fade-in and fade-out at the ends are),
`EDGE_ALPHA` / `CENTRE_ALPHA` (line-vs-wedge read), `HALF_WIDTH_START`.

Note that `HALF_WIDTH_MAX` and `CAPACITY` are ceilings on `SPREAD_RATE` and
`NODE_LIFE` respectively — raise a knob past its ceiling and the extra is
silently clamped away. Both are commented where they are defined.

Tuned once after a first look (2026-09-07): the initial values read as barely
visible. Spread 1.5 → 2.2, life 2.2 → 4.0 s, edge alpha 0.85 → 1.0, centre
0.40 → 0.70, plus the `FADE_HOLD` curve above; `HALF_WIDTH_MAX` 5 → 8 and
`CAPACITY` 160 → 240 to keep up.

---

## Phase 5 — Height-field simulation (only if still wanted)

Real waves: a ping-pong RTT running a 2D wave equation, trucks injecting
impulses, sampled for both normals and **vertex displacement**. Expanding rings
that reflect off shorelines — the shoreline mask from `traceShorelines` is a
natural boundary condition.

Prerequisites, both real work:

- **Tessellation.** `buildSurfaceGeometry`'s merged runs must be capped to a max
  quad size when this is on. Gate behind the new `water: 'high'` display
  setting so the cheap path keeps its handful of triangles.
- **Two RTTs plus a simulation pass**, scene-wide (the union-bounds texture from
  Phase 2 is the right domain — do not go per-body).

Only worth it if, after Phases 1–4, the flat shoreline silhouette still reads
wrong. Normals cannot move a silhouette; everything else can be faked.

---

## Rejected

- **Babylon's built-in `WaterMaterial`** (`@babylonjs/materials`). Wants a flat
  plane, brings a full reflection/refraction scene re-render, has no interaction
  model, and would discard the per-vertex depth tint and the foam ribbons —
  i.e. all of the Aug 2026 water rework. Wrong shape for per-body geometry.
- **Per-body wake textures / per-body materials.** Multiplies uploads and
  breaks the shared-material design for no visual gain at these body sizes.
- **GPU ping-pong for the Phase 2 field.** At 256² R8 the CPU stamp is simpler,
  matches how `ground-shader.js` already bakes canvases, and is not the
  bottleneck. Revisit only as part of Phase 5.

## Out of scope

Truck-side reaction — buoyancy, wave-driven bobbing, hydrodynamic drag — is a
physics change, not a rendering one. Nothing in this plan touches how the truck
moves through water.
