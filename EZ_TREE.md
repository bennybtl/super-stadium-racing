# EZ-Tree Integration Plan

Replace the low-poly `ProceduralTree` (src/decorations/lib/Tree.js) with a port of
[ez-tree](https://github.com/dgreenheck/ez-tree) (MIT, © 2024 Daniel Greenheck).
Status: **Complete** (Sept 23 2026). The port is bit-exact, and the Tree and Bush decorations use it with real textures, screen-coverage LOD and leaf wind sway. The old generators are deleted.

## What ez-tree is

- Three.js generator. `src/lib/tree.js` (~1200 lines) does the real work in two passes:
  1. `#generateSkeleton()` — all RNG use. It grows branches recursively (levels 0–3)
     using gnarliness, twist, taper, a growth force, child angle/count/start, and
     places leaves on the last level.
  2. `#meshSkeleton(detail)` — no RNG. It turns the skeleton into plain
     `{verts, normals, uvs, indices}` arrays: tapered branch tubes plus single or
     crossed leaf quads. The `detail` argument (sectionStride, segmentFactor,
     leafStride, leafScale, billboard) produces LOD meshes from the same skeleton.
- Deterministic: a small seeded RNG (`rng.js`) gives the same geometry for the same seed.
- Presets: 15 JSON presets for Oak, Ash, Aspen and Pine (S/M/L each) plus 3 bushes.
- The rest is Three-specific: `MeshStandardMaterial`, a wind-sway vertex shader
  injected with `onBeforeCompile`, `THREE.LOD`, and the trellis.
- Textures are caller-supplied: bark comes from ambientCG (CC0) and leaves are alpha
  PNGs. The PNGs live in the repo under Git LFS and **are not in the npm package**.

## Measured (headless node, this machine)

| Preset       | branch verts | leaf verts | gen time |
|--------------|-------------:|-----------:|---------:|
| Oak Medium   | 2.8k         | 21k        | ~17 ms   |
| Pine Medium  | 6.4k         | 20k        | ~14 ms   |
| Ash Medium   | 6.6k         | 22k        | ~17 ms   |
| Aspen Medium | 3.4k         | 4.2k       |          |
| Oak Small    | 2.3k         | 7.2k       |          |

A tree is 10–15k triangles, compared with a few hundred today. The cost is paid once
per variant; hardware instancing makes further copies of the same variant cheap.

## Why not `npm install @dgreenheck/ez-tree`

- The published build **inlines 20 textures as base64**: 4.3 MB minified, 3 MB
  gzipped. That is a non-starter.
- Vendoring `src/lib` as-is still pulls in three core (Group, Mesh, materials): 340 KB
  minified, 79 KB gzipped, for code we would throw away.
- Three uses a right-handed coordinate system and Babylon uses a left-handed one, and
  Three's Euler order is XYZ where Babylon's is YXZ. Mixing the two engines' math is
  a source of subtle bugs.

## Approach: vendor + port the generator only

Create `src/decorations/lib/ez-tree/`, keeping the MIT header and a link back:

- `EzTree.js`: a port of the skeleton and mesh passes (`growSkeleton`,
  `meshSkeleton`, `treeOptions`) **with no Three imports**. It uses small
  plain-object math helpers ported verbatim from three r186, not Babylon math.
  The tree's shape depends on Three's exact XYZ Euler↔quaternion round-trips,
  and a faithful copy is the only way to get bit-exact output. Output is the
  same plain arrays, still in Three's right-handed space.
- `rng.js`, copied verbatim. The options defaults live in `EzTree.js` as
  `defaultTreeOptions()`, without textures or the trellis.
- `presets/*.json`: all 15 are copied, but not the trellis preset. `treeOptions()`
  ignores a preset's `trellis` key.

Handedness: the tree is radially random, so a mirror image is still a valid tree.
Negate z on positions and normals, and **keep the indices as they are**. The
mirror alone turns Three's CCW front faces into Babylon's CW ones. I checked this
headlessly: `VertexData.ComputeNormals` agrees with the supplied normals 100%,
and swapping the winding drops that to 0%.

## Babylon integration: new `tree.js` spec on `instancedDecoration`

The existing `instanced-decoration.js` already covers caching, refcounting,
instancing, per-instance shadow casters and the editor contract. Only the spec
changes:

- `variantParams`: `{ preset, seed, leafTint, barkTint }`, and `variantKey` joins
  them.
- `buildVariant(scene, p, key)`:
  1. Load the preset JSON, override `seed`, then generate the skeleton and the mesh
     buffers.
  2. Build two masters with `VertexData`, `branch` and `leaf`, and bake in a
     normalising scale. ez-tree trunks are 20–37 units long and ours are about 4,
     so scale by roughly 0.12 at build time (or through `def.baseScale`) to keep
     existing placements the same size.
  3. Bark material: `StandardMaterial` with a bark diffuse and normal map from
     ambientCG (CC0, 1K, or 512 given our camera distance). The UV scale comes from
     the preset's `textureScale`.
  4. Leaf material: `StandardMaterial` with the leaf PNG as `diffuseTexture`,
     `hasAlpha = true`, `useAlphaFromDiffuseTexture`, and `backFaceCulling = false`.
     It uses **alpha test, not blend**, so there's no sorting problem and shadows
     work. ShadowGenerator applies alpha-test cutouts automatically when the
     diffuse texture has alpha.
  5. `height`: taken from the bounding box. `groups: { trunk: branch, leaf }`.
- Collider: build a simple cylinder from the level-0 section radius and trunk
  height. Don't use the branch mesh, because its full hull would include limbs.
  `colliderGroup` may need a small hook for this, or add a hidden `trunkCollider`
  master group.
- Editor controls: **Species** (preset dropdown), Variant/seed (`random: true`),
  foliage tint, scale and heading. Recolouring still regenerates the variant,
  which is fine.
- `tree.json`: add `preset: "Oak Medium"` to featureDefaults. Existing saved
  trees have no preset, so they get the default species, and their `seed` values
  re-roll into new shapes. That's acceptable because this is a visual change anyway.

## Phases

1. ✅ **Port + headless diff.** Done: `EzTree.js`, `rng.js` and 15 presets. A
   one-off per-value diff against the Three original (15 presets × 5 seeds ×
   3 detail levels) was bit-exact. Regression guard: `npm run check:eztree`
   compares against `scripts/eztree-golden.json`, which was captured from the
   original. Upstream quirks are kept on purpose: slerp runs B→A, and the
   `'Deciduous'` section-length divisor never applies.
2. ✅ **Spec swap.** Done. `lib/ez-tree/babylon.js` loads the presets with
   `import.meta.glob`, builds three masters per variant (`trunk` = the level-0
   branch only, for the collider; `branch`; `leaf`) and scales them by
   `EZ_TREE_SCALE = 0.22`, which puts an Oak Medium at about 16 units tall. That is 2× the first guess, tuned by eye in game.
   Leaves use a placeholder alpha-tested clump cutout drawn on a per-scene
   DynamicTexture. The `tree.js` spec adds a **Species** `select` control; the
   panel renders `select` like `color`. `instancedDecoration` gained
   `spec.variantProps`, handled by `edit.apply`, so a species change rebuilds
   the variant. `tree.json` featureDefaults went from trunkHeight/maxDepth/… to
   `preset: "oak_medium"`. Old `lib/Tree.js` has since been deleted (phase 6).
3. ✅ **Textures.** Done. `src/assets/trees/` holds 4 leaf sprig PNGs
   (ash/aspen/oak/pine) and the Bark001/002/003 colour maps, each shrunk to 512²
   (about 425 KB in total). Licences are in `LICENSE.md` there: the leaves are
   ez-tree MIT and the bark is ambientCG CC0. **No normal or roughness maps**:
   the trunk is well under 1 unit across on screen, so they aren't worth the
   bytes. One Texture per URL per scene is shared by all variants. Bark
   `textureScale.y` is baked into the UVs, because Bark001 is shared by oak
   (10) and ash (5), so a shared texture can't hold the scale. The leaf
   material is an alpha test (`alphaCutOff` = preset alphaTest), so shadows
   come out cut out. Colour is the preset's own `leaves.tint`/`bark.tint`.
   Foliage `green` means the species' natural colour, and forest/olive/fall
   tint by that palette entry ÷ green, per channel. `woodColor` is gone.
4. ✅ **LOD.** Done. Each group master (trunk/branch/leaf) gets 2 LOD meshes
   meshed from the same skeleton with ez-tree's own `defaultLODLevels` detail
   specs (~40% and ~20% of the triangles). The switch uses
   `useLODScreenCoverage`, not distance, because the camera zooms and trees
   scale from 0.5× to 4×. Thresholds are `LOD_LEVELS` in `babylon.js`: below
   5% screen coverage use LOD1, below 1.5% use LOD2. For reference, a 16-unit
   tree about 40 units from the race camera covers about 14%. Instances pick a
   level per instance, and the shadow pass uses the same camera, so shadows
   drop in detail too. `Mesh.dispose()` doesn't dispose LOD meshes, so each
   one is hooked to its master's `onDisposeObservable`. Materials are created
   before the build and passed into `buildEzTreeMasters` so every level shares
   them (`ezTreeOptions()` gives tree.js the options up front).
5. ✅ **Wind.** Done in `src/shaders/tree-wind-shader.js`: a `TreeWindPlugin`
   on the leaf material, so it applies to every LOD level. It ports ez-tree's
   three-sine sway, weighted by `uv.y` so leaf bases stay attached, with these
   changes:
   - It's applied in **world space** (`CUSTOM_VERTEX_UPDATE_WORLDPOS`). In model
     space, every instance of a variant would sway in lockstep.
   - Two crossed world-xz sines set the phase instead of simplex noise.
   - Amplitude and scale are ez values × 0.22, so tips move about 0.11 units.

   The constants are baked; they're global, so there's no effect-cache hazard.
   The clock is a uniform, declared through both the UBO and plain `vertex:`
   routes, as in water-shader.js. The shadow pass doesn't sway, and at this
   amplitude that isn't visible.
- ✅ **Bushes migrated.** The spec now lives in `lib/ez-tree/decoration.js`
  (`ezTreeDecoration({presetFilter, defaultPreset, scale, colorOptions})`), and
  `tree.js`/`bush.js` are thin configs of it:
  - **Tree:** non-bush presets, scale 0.22.
  - **Bush:** `bush_1..3`, scale 0.12, about 2.3–3.7 units tall versus the old
    blob's ~1.7.

  The `bush` decoration id is unchanged, so all 50 bushes on 6 tracks (and any
  saved or localStorage copies) migrate with no track-file edits. They keep
  their seed, scale, colour and heading, and default to `bush_1`. A leftover
  per-feature `radius` key is simply ignored. Tree's Species dropdown no longer
  lists bushes.
6. ✅ **Cleanup.** The unused `lib/Tree.js` and `lib/Bush.js` are deleted. Cactus
   keeps using `instanced-decoration.js` unchanged.

## Risks / open questions

- **Art style.** The game is flat-shaded and low-poly, and ez-tree is realistic
  with textured cutout leaves. It may clash. Phase 2 (untextured) is the cheap
  point to decide. A middle ground is ez-tree geometry with flat-shaded bark, or
  fewer, larger leaf-clump quads.
- **Leaf aliasing.** At about 0.12 scale a 2.5-unit leaf becomes about 0.3 world
  units, which is a few pixels from the iso camera. Individual leaf cutouts will
  shimmer. Plan to raise `leaves.size`, lower `count`, and use a clump texture
  (several leaves per quad) with mipmaps. Tune per preset.
- **Triangle budget.** 10–15k triangles per variant at full detail (LOD cuts
  this for small or distant trees), plus one shadow-pass draw per instance per
  group (see the shadow note in `procedural-tree-decoration`). For a dense
  forest, use fewer distinct seeds or batch shadows per variant.
- **LOD pop.** Switching levels halves the leaves, so the change may be
  visible. Tune `LOD_LEVELS` coverage by eye.
- **Leaf texture licence.** Resolved: the ez-tree textures LICENSE.md says the
  leaves are under the repo's MIT licence. Textures were fetched from GitHub's
  LFS media URLs at dcf309b.
- **Alpha-test + mipmaps.** Cutout coverage shrinks in the smaller mip levels,
  so far-away canopies can look thinner. If that shows, fix it with
  alpha-to-coverage or by preprocessing the alpha per mip level.
