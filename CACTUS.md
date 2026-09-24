# Procedural Cactus Plan

Replace the low-poly `ProceduralCactus` (src/decorations/lib/Cactus.js) with a
generator built on the ideas proven in the ez-tree port (see EZ_TREE.md).
Status: **Phases 1–3 done** (Sept 23 2026). The Cactus decoration uses the new generator with 4 species; phases 4 (spines) and 5 (cleanup) are open.

## Problems with the current cactus

- Each arm is about 6 overlapping `CreateCylinder`s, plus `CreateSphere` domes,
  all merged. The bends are faceted polylines and the joints rely on hidden
  overlap.
- "Ribs" are just the 8 facets of a low-tessellation cylinder after
  `convertToFlatShadedMesh`, so there are no real pleats.
- The arm bend is scripted (a fixed angle per step for the first 60%), so every
  arm has the same elbow.
- There is only one species (saguaro).

## What we take from ez-tree

1. **Skeleton, then mesh.** Grow a skeleton of sections (`{p, t, n, r}`:
   position, tangent, ring frame, radius) using all the RNG. Then mesh each
   stem as **one continuous tube**, with no RNG. That gives smooth elbows,
   tips closed by shrinking the last rings into a dome (no separate sphere),
   and LOD by ring stride, as the tree LOD does.
2. **Growth force for the arms.** An arm leaves the trunk near-horizontal, runs
   briefly, then turns toward +Y at a seeded bend radius (a curvature limit per
   unit length, like ez-tree's `force.strength`), and rises to a domed tip.
   Every elbow comes out different.
3. **Real ribs.** The ring cross-section is a scalloped profile:
   `ρ(θ) = 1 − depth·f^sharpness` with `f = (1 − cos(ribs·(θ + twist)))/2`.
   That makes narrow ridges and rounded valleys, with an optional slow twist up
   the stem. Normals are analytic (profile slope + axial taper), so there's
   no seam crease.
4. **Species as presets** (plain objects, like ez-tree's JSON). Planned:
   saguaro (phase 1), barrel, organ pipe, prickly pear (flat-oval cross-section
   paddles).
5. **Spines, later:** alpha-cutout clusters on the rib ridges, handled like
   ez-tree leaves (instanced, shadowed, dropped at low LOD).

## Approach

- `src/decorations/lib/cactus/CactusGen.js`: engine-free, like `EzTree.js`.
  - `cactusOptions(preset, seed)`
  - `growCactus(options)` → skeleton `{ trunk: stem, arms: stem[] }`
  - `meshCactus(skeleton, options, detail)` → `{ trunk, arms }`, each
    `{verts, normals, uvs, indices}`
  - RNG is ez-tree's `rng.js`, so the same seed always gives the same cactus.
  - Output is Babylon-native: y up, triangles front-facing in Babylon's
    convention, and world units (no scale factor).
- Groups: `trunk` (the collider target, as today) and `arms`.
- Babylon side (phase 2): the same `masterFromBuffers` / LOD / instancing path
  as the trees, and the Species dropdown and scatter-duplicate from
  `lib/ez-tree/decoration.js`. Cactus doesn't get the wind plugin.
- Verification: `npm run check:cactus` runs in node and checks:
  - the same seed gives identical output
  - all values are finite
  - every index is in range
  - the winding agrees with the normals (`VertexData.ComputeNormals` vs. the
    analytic normals)
  - the trunk base sits at or below ground
  - arm tips end near-vertical
  - triangle counts per preset and per LOD

## Phases

1. ✅ **Generator + saguaro preset + headless check.** Done:
   - `CactusGen.js` holds the parallel-transport tube frames, the scalloped
     rib profile with analytic normals, and quarter-circle tip domes.
   - Arms leave near-horizontal, run clear of the trunk, then turn toward +Y
     at a seeded curvature until vertical and at their target height.
   - `npm run check:cactus` passes over 40 seeds × 3 detail levels. The first
     run caught the winding exactly reversed (0% agreement), which is now
     fixed.
   - A side-view silhouette plot of 12 seeds reads as saguaros: varied
     elbows, 0–4 arms, and armless young ones.
   - Triangles: full 3.2k–15.7k (4 tall arms is the worst case), LOD1
     1k–4.7k, LOD2 0.6k–3.1k. If that's heavy in game, raise `mesh.step`
     or lower `segmentsPerRib` to 3.
2. ✅ **Swap `cactus.js` onto it.** Done:
   - `cactus.js` builds trunk/arms masters with `masterFromBuffers` (now
     exported from `lib/ez-tree/babylon.js`, with a `mirrorZ` option: true
     for ez-tree, false for the Babylon-native cactus).
   - LOD goes through the shared `attachLods` / `LOD_COVERAGE`. The cactus
     details are stride 2 / 2 segments per rib, then stride 4 / 2.
   - The editor gets a Species dropdown and scatter-duplicate via the
     `scatterDuplicate(spread)` helper pulled out of `lib/ez-tree/decoration.js`,
     with spread 1.5.
   - The material is a smooth-shaded StandardMaterial tinted from the Colour
     palette, with a faint specular. No texture yet.
   - `cactus.json` featureDefaults now carry `preset: "saguaro"`.

   Migration: 52 cacti on 5 tracks keep the `cactus` id, so their shapes
   re-roll. Their old `trunkHeight/trunkRadius/ribs` keys are ignored. Many
   were scaled 1.3–2.3× to make the small old cactus readable, so at the new
   size (4.5–9 units at 1×) some will be big. Tune the preset lengths or the
   placements.
3. ✅ **More species.** Done. There are two growth modes: `columnar` (trunk +
   elbowing arms) and `pads`. Each stem carries its own cross-section `shape`
   (ribbed or flat oval), so one mesher serves both.
   - **Normals.** They're now derived from the surface itself:
     `N ∝ S′(θ) × (t + r′·S)`. `r` cancels out, so ends that close to a point
     (dome tips, pad ends) need no special case, and the rib twist drops out.
   - **Organ pipe.** A central column plus 4–9 basal arms that leave steeply
     and rise to staggered heights. It uses coarser rings (step 0.3, 3
     segments per rib) to stay near a saguaro's triangle count: 5–13k
     triangles.
   - **Barrel.** A short, fat trunk with a mid-height `bulge`, a flattened
     crown (`domeScale` 0.5), 22 deep ribs, spiral twist and no arms.
   - **Prickly pear.** A breadth-first tree of flat oval pads (4–11 of them,
     from 1–2 roots). Each child grows from its parent's upper rim, stays
     roughly in the parent's plane and is twisted about its own axis. The pad
     width profile is an ellipse, skewed so the widest point sits past the
     middle.
   - **Fix: sawtooth ridges.** With twist, sharp ridges slid between a fixed
     vertex grid and read as a sawtooth. The ring grid now turns with the
     twist.
   - **Saguaro unchanged.** Its RNG order and taper reference are kept, so
     saguaros already placed keep their shapes.
   - LOD details are now `{sectionStride, segmentFactor}`.
   - `check:cactus` passes for all 4 species.
4. **Spines,** plus maybe a subtle vertical stripe texture.
5. **Cleanup:** delete `lib/Cactus.js`.

## Risks / open questions

- **Style.** The trees are now realistic, so cacti get smooth-shaded ribs. If
  that looks too soft, a flat-shaded option is a one-line switch in the mesh
  builder.
- **Arm junction.** Arms start inside the trunk, as ez-tree children do, so the
  join is hidden but not welded. Close up, a deep rib valley on the trunk could
  expose the arm's rim. Start the arm deeper if so.
- **Triangle budget.** A saguaro with 14 ribs × 4 segments per rib is ~56
  vertices per ring, which lands at a few thousand triangles. Instancing and
  LOD keep that cheap.
