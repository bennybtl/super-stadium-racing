# Decal system unification — phased plan

**Status:** Phase 0 done (2026-09-06). Phases 1–3 pending.

## Why

Two decal subsystems exist for what is one concept — a texture projected onto a
surface at a picked point:

| | SurfaceDecal | WallDecal |
|---|---|---|
| feature | `{centerX, centerZ, angle}` | `{position[3], normal[3], roll}` |
| surfaces | ground + bridge decks (flat only) | perimeter + poly walls (vertical only) |
| projection normal | always `+Y` | stored surface normal |
| editor | ghost preview, XZ-plane drag, polyline shape | blind stamp, surface-repick drag |
| files | `SurfaceDecalManager` (231) + `SurfaceDecalEditor` (912) + `SurfaceDecalPanel.vue` (235) | `WallDecalManager` (193) + `WallDecalEditor` (481) + `WallDecalPanel.vue` (174) |

They already share `decalShapes.js` (texture gen), `groundDecal.js`
(`projectSurfaceDecal`, `makeDecalMaterial`, `resolveDecalTarget`) and
`utils/brand-images.js`.

`normal` is the natural unifier: a ground decal is just `normal = +Y`. The
projection helper and `resolveDecalTarget` already take an arbitrary normal / ray
direction, so ~80% of the plumbing exists.

## End state

One feature type:

```jsonc
{
  "type": "decal",
  "position": [x, y, z],       // hint — re-snapped to the actual surface on build
  "normal":   [x, y, z],       // surface orientation at placement
  "rotation": 0,               // degrees about the normal (single DOF, consistent on any surface)
  "shape": "arrow", "width": 4, "height": 4, "opacity": 1,
  "count": 1, "outline": false, "text": "", "brand": "",
  "points": [...], "thickness": 1,   // polyline shape only (flat surfaces only)
  "attachTo": null             // Phase 3: { kind, id } when stamped on a decoration/obstacle
}
```

One `DecalManager`, one `DecalEditor`, one `DecalPanel.vue`. Ghost preview on any
`decalTarget` surface. Polyline gated to near-flat surfaces.

## Guiding principles

- **Ship each phase.** Every phase leaves the app working and is independently
  revertible.
- **No release yet, single user (the author).** Migration is a one-off codemod
  over the track JSONs — no runtime compat, no `localStorage` handling, no
  schema-version aliasing. After the codemod, `surfaceDecal` / `wallDecal` cease
  to exist; the loader only ever sees `decal`.
- **One recurring hazard: the rotation → CreateDecal `angle` conversion.** Nail it
  in Phase 0 behind a visual regression harness (screenshot decals across a set
  of existing tracks, before/after) and reuse that harness through Phases 1–2.

---

## Phase 0 — Stable projection frame  ✅ DONE (2026-09-06)

`CreateDecal` derives its own in-plane basis from the normal via
`RotationYawPitchRoll(yaw, pitch, angle)` where yaw/pitch come from the normal.
That basis swings ~90° for a barely-tilted surface (yaw jumps as
`atan2(n.z, n.x)` crosses a quadrant) and is undefined at the poles.

Landed in `src/managers/groundDecal.js`:

- `decalStableAngle(normal, rotationRad)` — the `angle` to hand `CreateDecal` so
  the decal's U axis aligns with an **explicit** tangent frame (world +Z
  projected onto the surface; fallback +X when `|n·Z| > 0.9`) rotated by
  `rotationRad`. **Exactly additive**: `decalStableAngle(n, rot) === rot +
  decalStableAngle(n, 0)` (one float add — the normal-dependent part is
  `_decalFrameOffset(n)`).
- `projectDecal(target, name, { position, normal, rotationRad, width, height,
  projectionDepth })` — the new primitive.
- `projectSurfaceDecal` / `projectGroundDecal` rewritten as back-compat wrappers
  that convert their raw `angle` via `rotationRad = angle -
  decalStableAngle(n, 0)`. Checkpoint gate decals + both decal managers now route
  through `projectDecal`.

**Verified:** headless-Babylon (NullEngine) diff of old vs new `CreateDecal`
output across a −180°…180° sweep on ground / wall / ramp targets — UV diff
exactly `0`, position diff `6e-16`. Unit test `test/decal-frame.test.js`
(additivity, shim round-trip, continuity). `npm run build:raw` + full `vitest`
green.

**Key result for Phase 1:** `decalStableAngle(up, 0) === 0`, and the old flat
path fed `CreateDecal` `angle = -(angleDeg·π/180)` → the `surfaceDecal`
migration is simply **`rotation = -angle`** (degrees). Wall decals:
`rotation = roll - decalStableAngle(wallNormal, 0)`, per-decal (the offset varies
with wall facing).

**Known limit:** the reference-axis fallback at `|n·Z| = 0.9` is a discontinuity
if a decal is dragged straight through a near-N/S-facing-wall pose. Irrelevant to
current fixed placements; revisit in Phase 2 if free-surface dragging needs it
(store the ref at placement, or blend).

The `-90°` `GHOST_ROTATION_OFFSET_DEG` fudge in `SurfaceDecalEditor` is NOT
removed yet — it lives in the editor/ghost path and comes out in Phase 2 with the
schema change.

---

## Phase 1 — Unified schema + manager  *(~2–3 days; behind the scenes)*

- New `DecalManager` (merge of the two). Feature `{ type: "decal", position,
  normal, rotation, ... }`.
- Build: re-resolve the target each time via `resolveDecalTarget` (ray from
  `position + normal*reach` along `-normal`), snap `position` to the hit point,
  project with `projectDecal`.
- Projection depth by target: thin slab (deck / wall / drive box) → shallow box
  nudged along the normal so it doesn't print the far face; ground → deep default.
  Read an optional `mesh.metadata.decalProjectionDepth`, else pick by tag.
- Run the migration codemod (section below), then delete `surfaceDecal` /
  `wallDecal` from the loader.
- Optional sequencing aid: point both existing editors at the new feature shape
  first (they keep their own UX, just emit `decal`) so the schema + manager land
  without also rewriting ~1400 lines of editor in the same step. Not needed for
  safety — there's no other user — but keeps the diffs small.

**Ships:** identical behavior, one feature type, one manager, old feature types
gone.
**Risk:** migration correctness (the angle conversion again) — regression harness.

### Migration  *(one-off codemod, no runtime layer)*

Counts at time of writing: **122 `surfaceDecal` + 10 `wallDecal`**, across:

- `src/tracks/**` — bundled tracks (canonical).
- `track-packs/**` — non-bundled tracks. Also migrate.
- ~~`public/tracks/`~~ (worktree) — dead location, ignore.

A node script rewrites those JSONs in place, then the loader's
`surfaceDecal` / `wallDecal` handling is deleted outright. Run once → review the
git diff → hand-fix any visually-off rotations in the editor.

Conversions are trivial because `position` is a *hint* the build re-snaps to the
live surface — no terrain-height computation:

- `surfaceDecal` → `{ type:"decal", position:[centerX, 0, centerZ],
  normal:[0,1,0], rotation: <angle via the Phase 0 frame>, ...rest }`
  (`y:0` is corrected on first load).
- `wallDecal` → rename `roll` → `rotation`; `position` / `normal` unchanged.

The only non-trivial part is the `angle → rotation` conversion — the script
imports the Phase 0 helper rather than reimplementing it.

---

## Phase 2 — Merge editors + panel  *(~3–4 days; the payoff)*

- One `DecalEditor`, one `DecalPanel.vue`. Delete the two old pairs once parity is
  confirmed.
- **Ghost preview:** follows the cursor, orients to the surface normal under it
  (any `decalTarget` mesh, plus ground). Ghost infra already exists in
  `SurfaceDecalEditor`.
- **Rotation:** one "Rotation" slider (+ Q/E increments). Consistent across
  surface orientations thanks to Phase 0.
- **Drag:** one model — reproject onto whatever `decalTarget` surface is under the
  cursor, recompute the normal, keep `rotation`. Ground keeps grid-snap (snap the
  XZ of the reprojected point). Replaces both the XZ-plane drag and the wall
  corner-slide.
- **Polyline:** panel gates it to near-flat placement surfaces
  (`normal·up > threshold`); drawn on the XZ plane and projected down as today.

**Ships:** "click almost anywhere, place a decal" — ground, decks, walls, ramps,
hillsides.
**Risk:** drag / rotate feel regressions; polyline behaviour near the
flat/non-flat boundary.

---

## Phase 3 — Attach to movable objects  *(~2–3 days; the feature that justifies it)*

Decals on decoration meshes (tent, rocks) and obstacles (barrels, tire stacks),
plus drive-box faces.

- Tag static decoration + obstacle meshes `decalTarget`. **Exclude
  geometry-rebuilding controllers** (scaffold arch, banner string) initially.
- When a resolved target belongs to a decoration/obstacle, set
  `attachTo: { kind, id }` and store `position` / `normal` in that object's
  **local** frame.
- Build: resolve the object → local→world → project → parent the baked decal mesh
  to the object's container node so it follows rigid transforms
  (translate / rotate / uniform scale — covers a tent).
- Editor: moving / rotating / mirroring the parent re-syncs its attached decals;
  deleting the parent deletes them.

**Ships:** team logo on a tent, target on a barrel, marking on a drive-box ramp.
**Risk:** lifecycle coupling (orphaned / stale decals on parent edit or delete);
mirrored parent (negative-determinant transform) flips decal winding.

---

## Scope boundaries

- Polyline on non-flat surfaces — out.
- Decorations that rebuild their geometry as decal targets — out (Phase 3
  revisit).
- `position.y` is always a hint; the build re-snaps to the live surface so
  terrain edits never strand a decal.

## If only part of it gets done

- **Phase 0 alone** is a standalone win — deletes the sign fudge, near-zero risk.
- **Phases 1–2** are the unification payoff.
- **Phase 3** is the "decals on props" feature — defer indefinitely, or pull
  forward if that is the actual priority.

## Verify (per repo workflow)

`npm run build:raw` for compile; visual regression harness (screenshot decals
across a fixed track set) for every phase that touches projection or migration;
in-app spot check for editor phases.
