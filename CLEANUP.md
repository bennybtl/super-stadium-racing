# Codebase Cleanup / Refactor Review

_Review date: 2026-09-03 · ~50k lines across 202 JS/Vue files_

## Overall health: good

Before the list of problems, the things that are working:

- **Comment culture is strong** — most non-obvious code carries a "why", not just a "what". Keep this.
- **No `TODO`/`FIXME`/`HACK` debt markers**, and effectively **no dead code** (one unused export, below).
- **`src/ai/` is the model to copy** — one coordinator (`AIDriver`) delegating to focused controllers in `ai/controllers/`, with its own `ARCHITECTURE.md`. Every other subsystem should aspire to this shape.
- **`src/modes/` hierarchy is sound** — `BaseMode → DriveMode → {Race,Practice,HotLap,Menu}Mode`, with shared drive helpers already hoisted into `DriveMode`.

The opportunities below are about **the editor subsystem's size, god-functions in the mode classes, and directory hygiene** — not rot.

---

## Addendum — multiplayer landed (2026-09-03)

The `multiplayer` branch merged into the base after this review. ~2,900 new lines: `server/` (colyseus room, ~280 lines), `src/multiplayer/` (client + remote-puppet + remote collision, ~440 lines), `src/modes/MultiplayerMode.js` (548 lines), `src/vue/Multiplayer*.vue` + a store, `web/` static-server Dockerfile.

What this changes about the plan:

- **§2.3 / §2.4 got bigger and more valuable.** `MultiplayerMode.setup()` is a **464-line single closure** — the same god-function shape as `RaceMode.setup()` (855). There are now **three** modes (`Race`, `Menu`, `Multiplayer`) that each reimplement "build a drive scene → spawn field → grid spawns → per-frame checkpoint/lap loop → countdown → syncTruckStatus". Extracting that shared race-sim core (into `DriveMode` or a `RaceLoop` collaborator) now deduplicates ~2,000 lines across three files instead of two. **This is the single highest-leverage refactor in the codebase now.**
- **Good sign:** whoever wrote multiplayer factored proactively — `src/truck/collision-math.js` (`orientedSupport`) is a clean shared extraction between `TruckCollisionManager` and `RemoteTruckCollision`.
- **New:** `server/` is a second mini-app (Express + colyseus) with no tests and its own Dockerfile. Out of scope here, but note it exists.
- The rebase that brought multiplayer under the cleanup commits **dropped `package-lock.json`** — restored in `4d1cc92` (it's required by `server/Dockerfile`'s `npm ci` and by any fresh checkout; @colyseus/* deps publish `workspace:` specs that only resolve from a committed lock).

---

## Tier 1 — high value, low risk

> **Status (2026-09-03):** branch `cleanup/tier-1`.
> - 1.2, 1.3 — done
> - 1.1 — deferred into 2.2 (see note under it)
> - 3.1 (tests) — started: vitest + 48 tests
> - 3.4 (docs) — done (root `.md` sprawl + AGENT.md content refresh)

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

### 2.1 Split `EditorController.js` — PARTLY DONE, rest not worth it

**Done (`974632a`):** `EditorHistory` — the undo/redo stacks + debounce, with
`serialize`/`restore` injected as callbacks. 8 unit tests. `deactivate()` now
resets it (was leaking a pending debounced snapshot). ~20 lines out of
EditorController; the value is the testable stack logic, not the LOC.

**The rest (`EditorCamera` / `EditorInput`) — investigated, not worth doing.**
`_serializeSnapshot` (12 lines) and `_applySnapshot` (90 lines) can't leave —
they touch `currentTrack`, every `this.xxxEditor`, `deselectAll`, the rebuild
registry, three panel-sync helpers. `handleKeyDown` / `handlePointerDown` are
*dispatchers* — `this.closeAiPath()`, `this._getActiveSelectionInteraction()`,
`this.deselectAll()`, `this.undo()` — so an `EditorInput` would just hold a
back-reference to the whole controller and call `this.controller.x()` for
everything. The file gets shorter; the coupling doesn't move. Same for the
camera helpers, which share `_groundXZUnderPointer` / `_pointerWorldXZ` with the
placement code. **Leave EditorController as one file.**

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

Revised estimate after looking closely: **~5–10% off** (not 15–25%) plus real
consistency wins — the shared skeleton per method is only ~5 lines
(`saveSnapshot` → `features.indexOf` + `splice` → `selected = null`), and the
per-entity parts (visual disposal, `rebuildTerrain` vs not, `this.meshes` vs
not, `hideProperties` vs `_hideProperties`) genuinely differ. Worth doing for
the skeleton-for-new-editors and to kill the naming drift, plus it's the natural
home for 1.1's forwarder collapse (a `{ key → editor }` registry the base
populates).

**Risk:** medium, and it's **slow** — 10+ files, one at a time, each needing a
click-through of that entity type in the editor afterward (`check:panels` only
covers bindings, not behaviour). Not a single-session job.

### 2.3 Break up the mode god-functions
`RaceMode.setup()` is **855 lines / 11 nested closures** (`triggerRaceEnd`, `handleDNF`, `syncTruckStatus`, `respawnToLastCheckpoint`, `startCountdown`, `resetGame`, `getAIDriver`, …) closing over `trucks`, `finishOrder`, `dnfTimer`. `MultiplayerMode.setup()` is **464 lines** in the same shape. These are the two hardest files in the repo to modify safely.

After 2.4 pulls the shared loop into `DriveMode`, extract the mode-specific chunks to methods / small collaborators:
- **finish/DNF tracking** → `RaceFinishTracker` (owns `finishOrder`, `dnfTimer`, `triggerRaceEnd`, `handleDNF`, results-row assembly)
- **countdown**, **reset/respawn** → methods

**Risk:** medium. Do it right after 2.4, against the shared base.

### 2.4 De-dupe the race-sim core shared by `RaceMode`, `MenuMode`, `MultiplayerMode` — IN PROGRESS

**Done (branch `cleanup/tier-1`) — the shared-core dedup:**
- `c543efd` — `DriveMode.makeAIDriverFactory()` (good/ok/bad ladder, was dup Race↔Menu) + `DriveMode.runCountdownSequence()` (3-2-1-GO choreography, was dup Race↔Multiplayer; `_countdownTimeouts` lifecycle moved up)
- `1441cce` — `DriveMode.installRaceFrameLoop()`: the frame envelope (onAfterRender pipeline-span/endFrame; onBeforeRender hidden-bail, dt clamp, beginFrame, photo-mode camera, menu bail, 20Hz HUD-timer throttle, countdown-gated input). Modes pass `isMenuUp` / `isCountdownActive` / `getRaceStartMs` closures + an `onFrame(dt, input)` body.
- `4020cc8` — `DriveMode.respawnAtLastCheckpoint()` (the ~35-line last-gate teleport, was near-identical Race↔Multiplayer) + `DriveMode.applyZoneEffects()` (slow/boost/firework trio, all 3 modes).

Cumulative: `DriveMode` +~300 (six shared helpers), `RaceMode` −~210, `MultiplayerMode` −~130, `MenuMode` −~25 — one implementation each instead of 2–3.

**In-game verification still open:** photo mode / pause on the frame envelope; OOB respawn (drive off-track, wait the timer) on `respawnAtLastCheckpoint`; anything multiplayer.

**Left — this is now §2.3, not dedup:** `RaceMode.setup()` is still ~640 lines, `MultiplayerMode.setup()` ~330. The remaining bulk is mode-specific glue: the checkpoint-lap handler (~130 lines in RaceMode), finish/DNF tracking, `resetGame`. Extract a `RaceFinishTracker` (owns `finishOrder`/`dnfTimer`/`triggerRaceEnd`/`handleDNF`/results assembly) and pull the closures to methods. Scene-bound, so verification is diff-review + play. Do after the current slices are confirmed in-game.

_original plan below:_

All three build a drive scene, make a grid spawner, run a per-frame checkpoint/lap + `syncTruckStatus` loop, and drive a countdown; Race and Menu also spin up the **identical** good/ok/bad AI-driver ladder (`RaceMode.js:214` ≈ `MenuMode.js:234`). Hoist a `RaceLoop` / shared methods into `DriveMode` (where the grid spawner and zone helpers already live):
- `MenuMode` = race loop with no player, no HUD, no lap limit
- `RaceMode` = race loop + player + finish/DNF + results
- `MultiplayerMode` = race loop + player + network puppets, server-authoritative

Do 2.4 first (defines the shared surface), then 2.3 becomes "move `RaceMode`'s extras onto the shared base". `MultiplayerMode.setup()` (464-line closure) gets the same treatment in the same pass.

**Risk:** medium. This is the biggest structural win now that three modes share the shape — the test net (§3.1) covers the grid/scoring math it touches; add a checkpoint-loop test before starting.

---

## Tier 3 — housekeeping

### 3.1 Add a thin unit-test net (do this *before* Tier 2) — STARTED
`vitest` added (dev-only), `npm test` / `npm run test:watch`, config in `vitest.config.js` (node env, `test/**/*.test.js`). **48 tests across 6 files**, covering the pure-logic hotspots:

- `test/math-utils.test.js` — clamp / clamp01 / lerp / smoothstep
- `test/polyline-utils.test.js` — `isPointInPolygon`, `distToPolyline`, `expandPolyline`
- `test/start-grid.test.js` — `layoutIndexFor`↔`raceIndexFor` inverse, `resolvePoleIndex` clamp, `gridSlotXZ` geometry + heading, custom/fallback slots
- `test/championship-storage.test.js` — `awardRace` table, `applyRaceResult` (scoring, immutability, advance), `standings` sort+tiebreak, `createChampionship` seeding
- `test/upgrade-storage.test.js` — `applyPurchase` (cost/maxLevel gating, nitro ceiling, immutability), `getUpgradeCatalog` affordability
- `test/mesh-color.test.js` — every `parseColorValue` input shape + null cases

_Not yet covered:_ the editor snapshot round-trip (`_serializeSnapshot` → `_applySnapshot`) — needs a track fixture; add alongside 2.1/2.2. The `localStorage`-backed load/save functions are left out (would need a jsdom env or a stub) — their pure cores are tested.

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

### 3.4 Documentation hygiene — PARTLY DONE
- **Root `.md` sprawl** — DONE. `TERRAIN_REFACTOR.md` / `CHAMPIONSHIP_MODE.md` / `MULTIPLAYER.md` moved to `docs/`. Root now holds `README.md`, `AGENT.md`, `CLEANUP.md`. Scoped docs (`src/ai/ARCHITECTURE.md`, `src/vue/MENUS.md`, …) deliberately left next to their code. AGENT.md gained `## Testing` + `## Docs` sections.
- **`AGENT.md` content refresh** — DONE. Full pass: file structure rebuilt against the real tree (multiplayer / modes / championship / all the missing managers + objects + vue files), prose errors fixed (Flag→decorations, upgrades economy, AI controllers, 8 terrain types, TruckBody via VehicleLoader, 6 particle emitters), added Modes / Championship / Multiplayer sections, trimmed the deferred-TODO lists. 646 → 473 lines.

### 3.5 Logging
114 `console.*` calls, mostly `console.debug`. Either route through a tiny `debug(namespace)` helper with a runtime toggle, or strip `console.debug` in the Vite production build. Low priority.

---

## Suggested order

1. ~~**3.1** (tests)~~ — done (48 tests); add a checkpoint-loop test before step 4
2. ~~**1.2, 1.3**~~ — done · ~~**3.4** doc moves~~ — done (AGENT.md prose refresh still open)
3. **2.4 → 2.3** — the shared race-sim core across Race/Menu/Multiplayer. **Highest leverage now** (~2,000 lines of near-duplicate across 3 modes). Test net is in place.
4. **2.1 → 2.2** — the editor split; 1.1's forwarder collapse rides along with 2.2's entity registry
5. **3.2, 3.3** — the `managers/` + `src/track/` dir reorgs. **Do these last** — pure import churn that will conflict hard with `night-race` / `terrain-refactor` until those land.
6. **AGENT.md** content refresh — its own pass, after the structure settles
