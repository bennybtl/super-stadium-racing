# Decal system unification — phased plan

**Status:** Phases 0 + 1 + 2 done (QA passed 2026-09-09). Phase 3 landed 2026-09-10,
pending in-app QA.

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

The `-90°` `GHOST_ROTATION_OFFSET_DEG` fudge in `SurfaceDecalEditor` came out in
Phase 2 with the schema change — the merged `DecalEditor` orients its ghost plane
by the proper basis `(u, v=u×n, u×v)` instead.

---

## Phase 1 — Unified manager  ✅ DONE (2026-09-06)

*(manager-only; no data or editor changes)*

Split out of the original Phase 1: the manager merge is genuinely low-risk and
lands alone. The codemod + editor merge + one-feature-type moved to Phase 2
(they're coupled — the codemod turns every decal into `type:"decal"`, which the
editors must understand the same day, and the editors are ~1400 lines).

- New `DecalManager` subsuming `SurfaceDecalManager` + `WallDecalManager` (their
  non-`_buildMesh` code was ~line-identical). One `_decalParams(feature)`
  normalises `surfaceDecal` | `wallDecal` | `decal` → `{ position, normal,
  rotationRad, shape, width, height, … }`; the rotation conversion uses Phase 0's
  additive `decalStableAngle` so it reproduces the old `CreateDecal` calls
  bit-for-bit (`surfaceDecal`: `rotationRad = -(angle·π/180)`; `wallDecal`:
  `rotationRad = roll·π/180 − decalStableAngle(normal, 0)`).
- `_buildMesh` merges the two projection paths: target via `resolveDecalTarget`
  (downward long-reach for `|normal.y| > 0.7`, else back-along-`-normal`
  short-reach), then box params — ground → deep box on the surface; deck (flat,
  not ground) → shallow lifted box; wall → shallow box along the normal.
- `SceneBuilder` / `EditorMode` / `EditorController` wire the one manager; both
  editors point their `_decalManager` at it and read `surfaceEntries` /
  `wallEntries` (type-filtered getters) in place of `entries`.
- Delete `SurfaceDecalManager.js`, `WallDecalManager.js`.

**Ships:** one manager, identical behavior, feature shapes + editors untouched.
**Risk:** low — the rotation conversion is Phase 0 math already verified; the
`_buildMesh` merge is a reshuffle of working code.

**Landed:** `src/managers/DecalManager.js` (new); `SurfaceDecalManager.js` +
`WallDecalManager.js` deleted; `SceneBuilder` / `EditorMode` build & wire one
`decalManager`; `EditorController.setDecalManager` feeds both decal editors;
each editor reads `surfaceEntries` / `wallEntries`. `groundDecal.js`
`projectGroundDecal` / `projectSurfaceDecal` kept (checkpoint decals + the
manager's legacy path use them). Test `test/decal-manager.test.js` (param
normalisation + partitioning); `npm run build:raw` + `vitest` (72) green.
`decalStableAngle`'s additivity makes the legacy `surfaceDecal` / `wallDecal`
projections bit-identical to the old managers'.

---

## Phase 2 — Codemod + editor merge + one feature type  ✅ DONE (2026-09-06; QA passed 2026-09-09)

**Landed:** `scripts/migrate-decals.mjs` rewrote 92 decals in 17 files
(`src/tracks/**` + `track-packs/**`) to `type:"decal"`; `SurfaceDecalEditor` →
`DecalEditor` (absorbs `WallDecalEditor`, deleted) — one ghost that orients to
the surface under the cursor (`decalStableU` for the U axis; the ghost plane is
oriented by the proper basis `(u, v=u×n, u×v)` so it matches CreateDecal's
left-handed decal frame — no `GHOST_V` / `GHOST_ROTATION_OFFSET_DEG` fudge
survives), flat decals drag on the XZ plane / wall decals re-pick the surface,
polyline gated to flat surfaces; `SurfaceDecalPanel` → `DecalPanel` (absorbs
`WallDecalPanel`); `editor.js` one `decal` slice; `EditorController` one
`decalEditor` + `setDecal*`/`changeDecal*`; `AddEntityMenu` one "Decal";
`DecalManager._decalParams` dropped its legacy branches (feature is `decal`
only), `entries` (no more surface/wall split). `_rotation` maps to
`feature.rotation` directly (stable frame) — the old SurfaceDecal slider
direction is reversed for new edits, consistent with walls now.

**QA passed (2026-09-09):** migrated decals render correctly across the bundled
tracks (chihuahua_flats 20 incl. 6 wall, desert_doublecross 4 wall, mesa_madness
/ surfs_up ground + deck); ghost matches the stamp on ground / deck / wall /
ramp; rotation slider direction correct (reversed from old SurfaceDecal, matches
walls); wall re-pick drag and flat XZ-plane drag both good; polyline places on
flat only and point-edit works.

**Known limitation (accepted, not fixed):** dragging the ghost off a
**north/south-facing wall** (normal within ~26° of ±Z) onto the ground rotates
the decal 90° — `decalStableU`'s reference axis falls back from world +Z to
world +X on those walls (the Phase 0 `DECAL_REF_POLE` discontinuity). Both
resting states bake correctly; only the live drag across that boundary is wrong.
Decals are placed once, not dragged wall↔ground, so this stays parked — fix via
a per-decal stored ref axis (Phase 0 "Known limit") only if free-surface
dragging ever needs it.

---

### Migration codemod  *(one-off, no runtime layer)*

Counts at time of writing: **122 `surfaceDecal` + 10 `wallDecal`**, across:

- `src/tracks/**` — bundled tracks (canonical).
- `track-packs/**` — non-bundled tracks. Also migrate.
- ~~`public/tracks/`~~ (worktree) — dead location, ignore.

A node script rewrites those JSONs in place; then `DecalManager._decalParams`
drops its `surfaceDecal` / `wallDecal` branches and the old type strings leave
the editors. Run once → review the git diff → hand-fix any visually-off rotations.

Conversions are trivial because `position` is a *hint* the build re-snaps to the
live surface — no terrain-height computation:

- `surfaceDecal` → `{ type:"decal", position:[centerX, 0, centerZ],
  normal:[0,1,0], rotation: -angle, ...rest }` (Phase 0: `decalStableAngle(up,0)
  === 0`, so it's exactly `-angle`; `y:0` corrected on first load).
- `wallDecal` → `rotation = roll - decalStableAngle(normal, 0)·180/π` (per-decal,
  the offset varies with wall facing); `position` / `normal` unchanged.

The script imports Phase 0's `decalStableAngle` rather than reimplementing it.

### Editor merge  *(the payoff)*

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

**Phase 2 ships:** one feature type, one manager, one editor — "click almost
anywhere, place a decal" (ground, decks, walls, ramps, hillsides).
**Risk:** the codemod's angle conversion; drag / rotate feel regressions;
polyline near the flat/non-flat boundary.

---

## Phase 3 — Attach to movable objects  ✅ LANDED 2026-09-10 (pending in-app QA)

**Landed:** decals stick to plain `ModelDecoration` props and obstacle stacks.
`feature.attachTo = { kind, id }` + `position`/`normal` in the prop's `decalAnchor`
local frame; the baked decal `setParent`s to that anchor so it follows the prop's
move / rotate / uniform-scale (and physics tumble for obstacles) with no rebuild.

- `ModelDecoration.decalAnchor` = `container`; `Obstacle.decalAnchor` = a body-child
  node pinned (at rest) to the ground-pose frame so it matches `ObstacleEditor`'s
  own `decalAnchor` — the editor still substitutes its own obstacle visual, but the
  two anchors share one transform so a decal round-trips between modes.
- Prop meshes tagged `decalTarget`; controller props (bleachers/trees/flags) have no
  `decalAnchor` so they're silently non-attachable.
- `DecalManager.setAttachResolver(fn)` — race wires the runtime managers
  (`SceneBuilder`), editor wires the sub-editors (`EditorController.setDecalManager`,
  which also rebuilds decals since the runtime prop managers are gone by then).
- `DecalEditor`: `_attachInfoFor` + `_applyAttach` — stamping / dragging onto a prop
  attaches, dragging off detaches, all in the existing move()/stamp() flow.
- Lifecycle (`src/editor/attached-decal-lifecycle.js`): delete a prop → its decals go;
  duplicate a prop → decals copied with a fresh id; type-swap carries the id.
- Async props: `_createAttached` retries on `parent.ready` (decorations) or via
  `rebuildAttachedTo` after the obstacle editor finishes cloning meshes.
- New `src/utils/feature-id.js` (lazy prop ids), `test/decal-attach.test.js`.

**v1 non-goals:** drive-box faces; polyline on props; width/height stay world units
at build time (a decal placed then the prop scaled, then the decal edited, re-bakes
at the original world size); handle position for an attached decal on a prop that
moves while the decal editor is closed can go stale until the next interaction.

### Original plan
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
