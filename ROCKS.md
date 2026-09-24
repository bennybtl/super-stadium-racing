# Procedural Rock Plan

Replace the low-poly `ProceduralRock` (src/decorations/lib/Rock.js) with a
generator in the same shape as ez-tree / CactusGen: draw all the randomness
into a small "skeleton", then mesh it deterministically at any resolution.
Status: **Complete** (Sept 23 2026). There are 4 types (boulder, granite, slab, outcrop) with texture and baked shading, and the old `lib/Rock.js` is deleted.

## Problems with the current rock

- A random Babylon polyhedron (6–24 vertices) with per-axis jitter and 2–4
  "bump" swells, then flat-shaded. It reads as a gem or a crumpled box, not a
  rock, next to the ez-tree trees and the new cacti.
- There's no geological character: no fracture faces, no rounded weathering,
  no strata, no surface grain.
- There's no ground contact. It's a convex blob sunk 10–20% into the terrain.
- One species, a flat colour with no texture, and no LOD (it doesn't need one
  at 8–26 faces, but it will once rocks get detail).

## Approach: a star-shaped radius field

A rock is a function `r(ω)`: its radius along each unit direction `ω` from its
centre. The mesher takes an icosphere at any subdivision and moves each vertex
to `ω · r(ω)`. Because every vertex is only moved along its own ray, the
surface can't self-intersect. And because the same field is evaluated at any
resolution, LOD levels are the same rock, just coarser.

`r(ω)` is built up in layers. The generator (`growRock`) consumes all the RNG
and draws their parameters:

1. **Base body.** An ellipsoid with seeded proportions (e.g. 1 : 0.55–0.9 :
   0.7–1.1), so rocks sit wider than tall.
2. **Fracture planes.** N planes `(n_i, d_i)` cut the body; along a ray the
   plane's distance is `d_i / (ω·n_i)` where `ω·n_i > 0`. The radius is
   the **soft minimum** of the ellipsoid and every plane:
   `r = smin(r_ellipsoid, d_1/(ω·n_1), …; k)`. Planes give the flat fractured
   faces and hard edges that make rocks read as rock. The softness `k`
   controls weathering: `k≈0` is fresh granite, larger is a river-worn
   boulder.
3. **Strata** (sandstone/slab). A periodic ripple on `ω.y·r` (terraced
   ledges) with a seeded tilt, so layers run slightly off-horizontal.
4. **Surface noise.** Low-amplitude 3D fBm (value noise over `ω`, 2–3
   octaves) for lumps and grain, with no RNG in the mesh pass: offsets come
   from the skeleton.
5. **Ground contact.** A final flat plane cut at `y = −embed` gives a flat
   buried bottom so no ray pokes out below the terrain, and the rock sits
   `embed` into the ground.

**Normals.** Smoothed from the mesh itself (area-weighted), with a crease
split where adjacent faces differ by more than ~45°, so fracture edges stay
crisp at `k≈0` without every facet going flat. This is done engine-free in the
generator, as CactusGen does.

**Why not flat-shaded low-poly?** The trees and cacti went realistic. If the
smooth look is wrong, a `flat: true` detail flag duplicates vertices per face,
which is a one-liner, and the fracture planes still give good silhouettes.

## Species (presets)

Plain objects, like the cactus presets:

| Preset | Body | Planes | Softness | Extras |
|---|---|---|---|---|
| boulder | round, squat | 3–6 | soft | lumpy noise |
| granite | blocky | 8–13 | hard | low noise |
| slab | wide, flat (y 0.3–0.45) | 4–6 + bedding top | medium | strata |
| outcrop | 2–4 rocks of `granite`/`slab`, touching and buried | per rock | — | one variant |

`outcrop` places several separate closed rocks, resting against each other
and buried, not intersecting deeply. Rock.js deliberately avoided merged
overlapping solids because the seams showed. Touching with shallow overlap
under soft shading should hide that; check in game, and if not, use a small
cluster via scatter-duplicate instead.

## Surface

- **UVs:** box-projected per vertex (dominant normal axis). The crease split
  means sharp faces get clean projections; smooth areas stretch a little.
- **Textures:** the existing `src/assets/textures/rocky.texture.png` for
  detail and `src/assets/normals/stone.normal.jpg` as a bump map, shared per
  scene like the ez-tree bark. Tinted by the Colour palette, as today.
- **Vertex colour** (baked in the mesh pass, no RNG):
  - **cavity AO:** darker in concave areas and near the ground line
  - **top dust:** a light tint on upward faces, so rocks sit in dusty tracks

  Both are cheap, and they are most of what makes a procedural rock not look
  like plastic.

## LOD and budget

| Level | Icosphere subdivisions | Triangles |
|---|---|---|
| full | 4 | ~5k |
| LOD1 | 3 | ~1.3k |
| LOD2 | 2 | ~320 |

The switch points are the shared `LOD_COVERAGE` values. With hardware
instancing that's affordable for 15 rocks on quarry_run. If full detail is
heavy, drop it to subdivision 3; the fracture planes carry the silhouette.

## Babylon side

- `src/decorations/lib/rock/RockGen.js`: engine-free.
  - `rockOptions(preset, seed)`
  - `growRock(options)`: the skeleton (body, planes, noise offsets, embed)
  - `meshRock(skeleton, options, detail)`: `{verts, normals, uvs, colors, indices}`
- `rock.js` stays on `instancedDecoration`, using `masterFromBuffers`,
  `attachLods`, a Species select (`variantProps: ["preset"]`) and
  `scatterDuplicate` for quick rock fields. `masterFromBuffers` gains
  vertex colours.
- **Collider:** unchanged. The `rock` group's bounds become the truck
  collider, now tighter because the bottom is flat.
- **Verification:** `npm run check:rocks` runs in node. It checks:
  - the same seed gives identical output
  - all values are finite and every index is in range
  - the winding agrees with the normals
  - the bottom sits at `−embed` and the rock doesn't float
  - the surface is star-shaped, i.e. every radius is positive
  - triangle counts per preset and per LOD

## Migration

72 rocks on 10 tracks keep the `rock` id, so their shapes re-roll by seed.

- **Size:** scales go up to 4× and the tracks were laid out around the old
  size, so presets are normalised so a 1× rock has about the old footprint
  (radius 0.6). `radius` stays a JSON-only size knob.
- **Colour:** some rocks are saved as `"green"`, which isn't a rock colour and
  falls back to gray. That stays as is.
- **Defaults:** the default preset is `boulder`.

## Phases

1. ✅ **Generator + boulder/granite + headless check.** Done:
   - `lib/rock/RockGen.js` has the radius field (body, planes, smin, fBm
     value noise, flat bottom cut), crease-split normals (45°) and box UVs.
   - `npm run check:rocks` passes over 40 seeds × 3 detail levels:
     determinism, finite values, winding vs normals, outward normals, bottom
     exactly at −embed, and a star-shaped field.
   - Triangles are fixed per level: 5120 / 1280 / 320.
   - A headless render of 18 seeds per preset reads well: boulders are
     lumpy and rounded; granite is blocky with crisp fracture faces (8–13
     planes, cut at 0.55–0.82).
   - At LOD2 the bottom edge zig-zags slightly, but it's mostly buried.
   - Sizes at 1×: boulder 1.3–1.46 wide × 0.5–0.85 tall; granite 1.1–1.3 wide
     × 0.5–0.9 tall.
2. ✅ **Swap `rock.js` onto it.** Done:
   - `rock.js` builds one `rock` master per variant with `masterFromBuffers`,
     plus LODs at subdivisions 3 and 2 through `attachLods` / `LOD_COVERAGE`.
   - The editor gets a Type select (`variantProps: ["preset"]`) and
     scatter-duplicate (spread 1.5).
   - `radius` still scales the rock, relative to the old default of 0.6.
   - The material is still a flat palette tint.
   - `rock.json` featureDefaults gain `preset: "boulder"`, so all 72 placed
     rocks become boulders with re-rolled shapes.
   - `lib/Rock.js` is now unused; it gets deleted in phase 5.
3. ✅ **Surface.** Done:
   - **Material:** `rock.js` uses `rocky.texture.png` as diffuse grain (one
     repeat per 1.6 units) and `stone.normal.jpg` as a bump map (one repeat
     per 0.9 units, level 0.8), both shared per scene on RockGen's box UVs.
   - **Brightness:** the grain texture's level is set to
     `1 / (0.39 mean × ROCK_COLOR_BASE)`, so the palette tint stays the rock's
     average colour.
   - **Vertex colours:** RockGen bakes them in RGBA, no RNG. The shade is
     0.55 at the ground line, fading out over 0.3 body units; up to −35% in
     noise pits (`rockSample` returns the fBm value); and darker on
     undersides. Dust lightens toward warm white on faces with n.y > 0.5.
     The plain surface is 0.8.
   - `masterFromBuffers` passes optional `buf.colors` through.
   - `check:rocks` checks colours are finite and in [0, 1].
4. ✅ **More species.** Done:
   - **Slab:** a wide, flat body (y 0.3–0.45) with 4–6 planes and medium
     softness.
     - **Strata:** a `(0.5 + 0.5·cos)²` groove at each layer line, with
       2–4 layers 0.11–0.16 thick, 3.5–6% deep and a seeded tilt up to 0.2.
       Height is measured from the ground, so layers line up with it.
     - **Flat top:** a top plane cut along the bedding tilt.
     - **Retune:** the first pass used thin `g⁴` grooves every 0.07–0.11.
       They read as contour lines and "stacked pancakes", with rings on the
       top.
     - **RNG order:** strata are drawn last, so boulder and granite don't
       re-roll.
   - **Outcrop:** `growOutcrop` picks one member type (granite or slab) and
     places 2–4 rocks: the main one at the origin, plus others at scale
     0.45–0.8, spread at seeded bearings and at 0.55–0.75 of the summed
     half-widths, so they overlap slightly.
     - Each part has a random yaw and is its own full RockGen rock; the
       buffers are concatenated.
     - Secondary parts mesh one icosphere level coarser, so full detail is
       6.4–9k triangles (from 10–20k).
     - Footprint is 1.8–2.9 across at 1×.
   - `check:rocks` checks outcrops per part (star-shaped) and the pile's
     bottom loosely. The outward-normal check covers single rocks only.
5. ✅ **Cleanup.** `lib/Rock.js` is deleted. `DirtChunks` still uses its own
   jittered polyhedra. Moving it onto `RockGen` at LOD2 is left as an option,
   for if the chunks ever look out of place next to the new rocks.

## Risks / open questions

- **Icosphere sampling vs fracture planes.** An edge between two planes only
  lands on a vertex by chance. At subdivision 4 with soft `k` that's fine; at
  `k≈0` and low LOD, edges may look wobbly. The fallback is to snap vertices
  near a plane crossing onto the crease line, but only if it shows.
- **Stretched projection.** A strongly flattened ellipsoid packs icosphere
  vertices unevenly (sparse on the wide sides). Normalising `ω` by the body
  axes before subdivision (sampling a pre-stretched sphere) fixes that.
- **Texture scale.** Box UVs in world units: at a 4× scale the texture scales
  with the instance, which reads as bigger grain on bigger rocks. That's
  probably fine.
