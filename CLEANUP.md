# Codebase Cleanup / Refactor Review

_Review date: 2026-09-03 · ~50k lines across 202 JS/Vue files_

## Overall health: good

Before the list of problems, the things that are working:

- **Comment culture is strong** — most non-obvious code carries a "why", not just a "what". Keep this.
- **No `TODO`/`FIXME`/`HACK` debt markers**, and effectively **no dead code** (one unused export, below).
- **`src/ai/` is the model to copy** — one coordinator (`AIDriver`) delegating to focused controllers in `ai/controllers/`, with its own `ARCHITECTURE.md`. Every other subsystem should aspire to this shape.
- **`src/modes/` hierarchy is sound** — `BaseMode → DriveMode → {Race,Practice,HotLap,Menu}Mode`, with shared drive helpers already hoisted into `DriveMode`.

The opportunities below are about **the editor subsystem's size, one god-function in `RaceMode`, and directory hygiene** — not rot.

---

## Tier 1 — high value, low risk

> **Status (2026-09-03):** 1.2 and 1.3 done on branch `cleanup/tier-1`. **1.1 deferred into 2.2** — see the note under it.

### 1.1 Collapse `EditorController` prop/action forwarders (~200 lines) — DEFERRED

> **Deferred to 2.2.** Investigation found the forwarders are load-bearing: `scripts/check-panel-bindings.mjs` statically verifies every `setFeatureProp('hill','radiusX')` panel binding resolves to a real `changeHillRadiusX` method — collapsing them to dynamic `this.hillEditor.changeRadiusX` dispatch would make that check parse every editor file to follow the `panelKey → editorField → method` chain, trading a solid build-time guarantee for ~80 fewer lines. The 81 mechanical forwarders + the 18-row `_getSelectedFeatureActions()` table + the ~40 `featureAction` forwarders all want the same **entity registry** that 2.2 introduces; do this collapse there, against that table, and update the check script once.

_Original writeup, for context:_


`EditorController.js` is **2622 lines**, and **209 of them** are one-line pass-throughs:

```js
changeHillRadius(val)     { this.hillEditor.changeRadius(val); }
changeCheckpointWidth(val) { this.checkpointEditor.changeWidth(val); }
deselectCheckpoint()       { this.checkpointEditor.deselect(); }
// ...×140
```

But `setFeatureProp` / `featureAction` (called from the Vue panels) **already dispatch dynamically**:

```js
setFeatureProp(panelKey, prop, val) {
  this[`change${cap(panelKey)}${cap(prop)}`]?.(val);   // → the forwarder
}
featureAction(method, ...args) { this[method]?.(...args); }
```

So the forwarders are a redundant hop. Route directly:

```js
setFeatureProp(panelKey, prop, val) {
  this[`${panelKey}Editor`]?.[`change${cap(prop)}`]?.(val);
}
```

Keep the ~10 forwarders that carry real logic (`changeTrackDefaultTerrain`, `changeTrackBorderTerrain`, the `_updateAiPathWear` group). Delete the rest. Net: one 2622-line file drops toward ~2400, and adding a slider to a panel stops requiring a matching stub here.

**Risk:** low. `check:panels` (`npm run check:panels`) already validates panel↔controller bindings — run it after.

### 1.2 Consolidate color parsing (3 copies) — DONE
`parseColorValue` in `src/utils/mesh-color.js` is now the single parser (Color3 / `[r,g,b]` / hex / `{r,g,b}` / `{diffuse:{r,g,b}}` → fresh `Color3`, or `null`). `EditorMaterials.toColor3` is an alias of it; `loadVehicleModel.parseColor` was deleted, its 3 call sites now `parseColorValue(x) ?? fallback`.

_Not done:_ the ad-hoc `[c.r,c.g,c.b]` serialization and `toCssColor` in `RaceHUD.vue` — those go the other direction (Color3 → array/css) and are one-liners; left alone.

### 1.3 Remove the one dead export — DONE
`startGridLayout` deleted from `src/start-grid.js`.

---

## Tier 2 — structural, worth doing

### 2.1 Split `EditorController.js` (2622 → ~4 files)
It currently owns: entity dispatch, **camera orbit/pan/zoom**, **pointer routing + gizmo drag**, **keybindings**, **undo/redo + snapshot serialization**, panel sync. Three of those are self-contained and liftable without touching entity code:

| New module | What moves | Approx. lines |
|---|---|---|
| `EditorHistory` | `_undoStack`/`_redoStack`, `saveSnapshot`, `_serializeSnapshot`, `_applySnapshot`, `undo`, `redo` | ~180 |
| `EditorCamera` | `_orbitState`, `_beginOrbit`, `_updateOrbit`, `_handleWheelZoom`, `resetCamera`, `_lockGroundPointUnderCursor`, `viewCenterXZ`, `_groundXZ*` | ~220 |
| `EditorInput` | `handleKeyDown`/`handleKeyUp`, `handlePointerEvent`/`handlePointerDown`, repeating-key state, gizmo-drag begin | ~450 |

Leaves `EditorController` as a ~1200-line coordinator wiring those + the entity editors together. Each piece becomes testable in isolation.

**Risk:** medium — lots of shared `this` state to thread through. Do 2.1 *after* 3.x (tests) if going this far.

### 2.2 A minimal base for the entity editors
`src/editor/` has **10 entity editors, 370–835 lines each** (`CheckpointEditor`, `HillEditor`, `ObstacleEditor`, `PolyWallEditor`, `SquareHillEditor`, …), **none sharing a base class**. Every one re-implements: selection state + `deselectOthers`, `findByMesh` registration, `showProperties`/`hideProperties` panel sync, `deleteSelected`/`duplicateSelected` (snapshot → mutate features → rebuild → re-sync), gizmo-height refresh, `createMaterials`/`dispose`.

This is **not** a call for a deep hierarchy (the geometry per entity genuinely differs). It's a thin `EntityEditor` base holding only the identical mechanics:

```js
class EntityEditor {
  constructor(editor) { this.editor = editor; this.selected = null; }
  deselect() { /* shared: clear gizmos, hide panel, this.selected = null */ }
  deleteSelected() { this.editor.saveSnapshot(); /* remove; */ this._rebuild(); }
  duplicateSelected() { /* shared shell; subclass supplies _cloneFeature() */ }
  // subclass implements: _rebuild(), createVisual(feature), _hitTest(mesh)
}
```

Conservative estimate: 15–25% off ~5000 lines of editor code, and new entity types start from a working skeleton.

**Risk:** medium. High duplication = high payoff, but touches every editor file. Gate on tests.

### 2.3 Break up `RaceMode.setup()` (855-line function)
`RaceMode.setup()` is one function with **11 nested closures** (`triggerRaceEnd`, `handleDNF`, `syncTruckStatus`, `respawnToLastCheckpoint`, `startCountdown`, `resetGame`, `getAIDriver`, …) all closing over `trucks`, `finishOrder`, `dnfTimer`, etc. It's the hardest file in the repo to modify safely.

Extract the cohesive chunks to methods or small collaborators:
- **finish/DNF tracking** → `RaceFinishTracker` (owns `finishOrder`, `dnfTimer`, `triggerRaceEnd`, `handleDNF`, results-row assembly)
- **countdown** → method (`startCountdown` + its timeouts)
- **reset/respawn** → methods (`resetGame`, `respawnToLastCheckpoint`)
- **AI driver factory** (`getAIDriver` good/ok/bad ladder) → shared helper — see 2.4

**Risk:** medium.

### 2.4 De-dupe the AI-race setup shared by `RaceMode` and `MenuMode`
Both build a drive scene, call `setupAIDrivers`, spin up the **identical** good/ok/bad driver ladder, make a grid spawner, and run a per-frame truck-update loop. The `getAIDriver` ladder is copy-pasted (`RaceMode.js:214` ≈ `MenuMode.js:234`). Hoist the driver factory + the per-frame truck update into `DriveMode` (where the grid spawner and zone helpers already live). `MenuMode` becomes "a race with no player and no HUD".

**Risk:** low–medium.

---

## Tier 3 — housekeeping

### 3.1 Add a thin unit-test net (do this *before* Tier 2)
There is no test framework — only `build:raw` + 5 ad-hoc `check:*.mjs` scripts + manual visual testing. That's fine for rendering code, but the **pure-logic hotspots are cheap to lock down** and would de-risk every refactor above:

- `ChampionshipStorage`: `applyRaceResult`, `standings`, `awardRace`, score persistence
- `UpgradeStorage`: `applyPurchase` math
- `start-grid.js`: `layoutIndexFor` / `startGridLayoutSlot`
- `polyline-utils.js`, `math-utils.js`
- `loadVehicleModel` color parsing (post-1.2)
- the editor snapshot round-trip (`_serializeSnapshot` → `_applySnapshot`)

Add `vitest` (dev-only, no runtime cost), aim for ~20 focused tests, not coverage targets.

While here: **`npm run check:water` currently crashes** (`Node.js v24.11.1` stack dump, not an assertion failure) and **`check:terrain` reports "8 track(s) failed"** — both on a clean `main`, unrelated to any recent change. Either they've rotted or they're flagging real track-data drift; worth a look since a check that doesn't run is worse than no check.

### 3.2 Reorganize `src/managers/` (44 files)
It's a catch-all mixing three kinds of thing:

- **True managers** (own lifecycle/scene objects): `CheckpointManager`, `WallManager`, `ObstacleManager`, `DecorationManager`, `PickupManager`, `CameraController`, …
- **Persistence** (localStorage / file IO, no scene): `ChampionshipStorage`, `HotLapStorage`, `UpgradeStorage`, `TrackStore`, `TrackLoader`, `TrackPackLoader`, `VehicleLoader`, `DecorationLoader`, `ObstacleLoader`, `settingsStorage.js`
- **Plain render utils** (lowercase, not classes): `billboardText.js`, `decalShapes.js`, `groundDecal.js`

Move persistence → `src/persistence/`, the lowercase render helpers → `src/utils/` or `src/render/`. Leaves `managers/` meaning one thing.

**Risk:** low (pure moves), but a big import-path churn — script it, one commit.

### 3.3 Cluster the terrain/track modules out of `src/` root
14 modules sit at `src/` top level. The terrain/track cluster — `terrain.js`, `terrain-utils.js`, `terrain-blend-utils.js`, `track.js`, `feature-geometry.js`, `polyline-utils.js`, `surface-textures.js` — belongs in `src/track/` (mirrors the existing `src/truck/`, `src/ai/`). Leaves root for genuine entry-point/config files (`main.js`, `constants.js`, `settingsStorage.js`, `browserSupport.js`).

### 3.4 Documentation hygiene
- **`AGENT.md` is stale** — 162 files changed since its last edit (Aug 29). The file-structure section is still roughly accurate; the prose isn't. Schedule a refresh pass (and it can shrink — 633 lines).
- **Root `.md` sprawl**: `TERRAIN_REFACTOR.md` reads as completed-work notes, `CHAMPIONSHIP_MODE.md` / `MULTIPLAYER.md` are design docs. Move design/historical docs to `docs/`; keep only `README.md` + `AGENT.md` at root.

### 3.5 Logging
114 `console.*` calls, mostly `console.debug`. Either route through a tiny `debug(namespace)` helper with a runtime toggle, or strip `console.debug` in the Vite production build. Low priority.

---

## Suggested order

1. **3.1** (tests) — the safety net everything else leans on
2. **1.1, 1.2, 1.3** — quick wins, immediately less code
3. **3.2, 3.3, 3.4** — mechanical moves, do in dedicated commits
4. **2.4 → 2.3** — RaceMode/MenuMode
5. **2.1 → 2.2** — the editor, the biggest lift, last
