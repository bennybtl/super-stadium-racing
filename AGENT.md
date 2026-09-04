# Offroad Racing Game — Agent Documentation

> Architecture reference. Last full pass: 2026-09. When a detail here disagrees
> with the code, trust the code and fix this file.

## Project Overview
An isometric offroad racing game — arcade truck physics, terrain effects, AI
drivers, checkpoints/laps, a full in-game track editor, single-race +
championship + hot-lap + practice modes, and (new) online multiplayer. Vue 3
drives all menus/HUD; the 3D world is Babylon.js + Havok.

## Technology Stack
- **Babylon.js 8** — rendering
- **Havok Physics 1.3** — WASM physics (MESH colliders for terrain/bridges/walls, BOX for trucks)
- **Vue 3 + Pinia** — reactive UI (menus, editor panels, HUD)
- **Vite 6** — build + dev server
- **colyseus 0.16** — authoritative multiplayer server (`server/`), `colyseus.js` client
- **Tailwind CSS** — utility CSS in Vue components
- **ES Modules**, vanilla JS everywhere except `.vue` files
- **Vitest** — unit tests for the pure-logic modules (`test/`)

---

## File Structure

```
offroad/
├── index.html
├── server/                          # colyseus multiplayer server (its own mini-app)
│   ├── index.js                     #   express + colyseus bootstrap
│   ├── DriveRoom.js                 #   per-race room: roster, state broadcast, lap/finish reports
│   └── Dockerfile
├── web/                             # static-site container for the built client
├── docs/                            # design/plan docs (MULTIPLAYER, TERRAIN_REFACTOR, CHAMPIONSHIP_MODE)
├── scripts/                         # build + headless check scripts (check-*.mjs, optimizeDistAssets)
├── test/                            # Vitest suites (pure logic only)
├── track-packs/                     # importable track-pack zips (not built)
└── src/
    ├── main.js                      # entry: engine, loaders, ModeController bootstrap
    ├── constants.js                 # truck dims, colours, shared physics constants
    ├── settingsStorage.js           # controls/audio/display/gameplay localStorage
    ├── utils/                       # dependency-free helpers
    │   ├── math-utils.js            #   clamp / lerp / smoothstep
    │   ├── polyline-utils.js        #   expandPolyline (rounded corners), point-in-polygon, dist-to-polyline
    │   ├── start-grid.js            #   starting-grid layout ↔ race-index math (shared: editor + spawner)
    │   ├── browserSupport.js        #   Safari/WebGL capability warning
    │   └── mesh-bounds / mesh-color (parseColorValue) / mesh-materials / mtl-parser
    ├── world/                       # the static world model — track layout + terrain
    │   ├── track.js                 #   Track class: features[], getHeightAt / getTerrainTypeAt, serialization
    │   ├── terrain.js               #   TerrainManager: grid of surface types, TERRAIN_TYPES table
    │   ├── terrain-utils.js         #   terrain mesh generation, AI-path wear tracing
    │   ├── terrain-blend-utils.js   #   multi-level surface blend helpers
    │   ├── feature-geometry.js      #   feature footprint / bounds helpers
    │   └── surface-textures.js      #   procedural per-surface texture generation
    ├── ai/
    │   ├── AIDriver.js              # coordinator: owns the controllers below, per-tick update
    │   ├── setupAIDrivers.js        # spawn N AI trucks + drivers, wire cross-awareness
    │   ├── driverNames.js           # random driver-name generator (championship rosters)
    │   ├── RubberBand.js            # per-frame catch-up multiplier stepping
    │   ├── ARCHITECTURE.md          # ← read this before touching AI
    │   └── controllers/            # AIPathPlanner, AISteering, AIThrottle, AIBoost,
    │                                 AIStuckRecovery, AISpawnRecovery, AICheckpointGuidance, AIDebugRenderer
    ├── multiplayer/
    │   ├── MultiplayerClient.js     # colyseus.js wrapper: join/leave, roster, state send, lap/finish reports
    │   ├── RemotePuppet.js          # visual-only truck for other players (interpolated from network state)
    │   └── RemoteTruckCollision.js  # local player ↔ remote-puppet push-apart (shares collision-math.js)
    ├── modes/
    │   ├── ModeController.js        # owns the render loop; switchTo(ModeClass); championship orchestration
    │   ├── BaseMode.js              # visibility handler, respawnTruck (teleport + collision flush)
    │   ├── DriveMode.js             # shared for every driving mode — see §Modes
    │   ├── SceneBuilder.js          # buildScene(): ground, lights, physics, all the per-track managers
    │   ├── MenuMode.js              # menu callbacks + the attract-mode demo race behind the menus
    │   ├── RaceMode.js              # single race / championship race: field, laps, timing, finish/DNF, results
    │   ├── MultiplayerMode.js       # networked race: local player + remote puppets, server-authoritative
    │   ├── PracticeMode.js          # free drive, one truck
    │   ├── HotLapMode.js            # solo time attack + ghost
    │   ├── EditorMode.js            # hosts EditorController
    │   └── TestMode.js              # physics sandbox
    ├── editor/                      # one sub-editor per entity type + EditorController coordinator
    │   ├── EditorController.js      #   ~2600 lines: camera/orbit, pointer routing, keybinds, undo/redo,
    │   │                            #   entity dispatch. CLEANUP.md §2.1/§2.2 tracks splitting this.
    │   ├── EditorMaterials.js       #   shared gizmo materials/colours
    │   ├── editor-rebuild.js        #   in-place rebuild registry (rebuild.terrainGrid?.() etc.)
    │   ├── GizmoHandle.js / gizmo-height.js
    │   └── {ActionZone,AiPath,BridgeMesh,Checkpoint,Decorations,DriveBox,Hill,MeshGrid,Obstacle,
    │        PolyCurb,PolyHill,PolyWall,SquareHill,StartPosition,SurfaceDecal,TerrainPath,
    │        TerrainShape,TrackSign}Editor.js
    ├── managers/                    # scene-object lifecycle owners + persistence + small render helpers
    │   ├── SceneBuilder-wired managers: CheckpointManager, WallManager, ObstacleManager,
    │   │   DecorationManager, PickupManager, BridgeMeshManager, TrackSignManager,
    │   │   SurfaceDecalManager, StaticBodyCollisionManager, SteepSlopeColliderManager,
    │   │   DriveSurfaceManager, SurfaceRegistry, SurfaceTopologyGraph, TerrainQuery
    │   ├── race-time: GameState, CheckpointArrow, RacePositionLabels, FloatingTextManager,
    │   │   FireworksManager, TruckCollisionManager, CameraController, UIManager, InputManager,
    │   │   DebugManager, FrameProfiler
    │   ├── audio: AudioManager, EngineAudio, TruckAudioController
    │   ├── ghost/hotlap: GhostRecorder, GhostPlayer, HotLapTracker
    │   ├── telemetry: TelemetryRecorder, TelemetryPlayer
    │   ├── persistence: TrackLoader, TrackStore, TrackPackLoader, VehicleLoader, DecorationLoader,
    │   │   ObstacleLoader, UpgradeStorage, ChampionshipStorage, HotLapStorage
    │   └── render helpers (lowercase): billboardText.js, decalShapes.js, groundDecal.js
    ├── objects/                     # visual + physics track entities
    │   ├── BridgeMesh.js, Checkpoint.js, Obstacle.js, Pickup.js, PolyWall.js, PolyCurb.js,
    │   │   TrackSign.js, DriveBox.js, Water.js / water-field.js, BorderWall.js, Outskirts.js,
    │   │   DirtChunks.js, FireworkLaunchers.js, ModelDecoration.js
    │   └── poly-ribbon.js, sparkColors.js, stripeColors.js
    ├── truck/
    │   ├── truck.js                 # Truck class — coordinates the subsystems below
    │   ├── Controls.js              # steering, acceleration, boost
    │   ├── DriftPhysics.js / DriftTuning.js   # grip, slip, drag + the 4 high-level drift knobs
    │   ├── TerrainPhysics.js        # gravity, suspension spring, slope orientation, depenetration
    │   ├── TruckBody.js             # visual puppet: vehicleDef.modelUrl OBJ + procedural wheels
    │   ├── ParticleEffects.js       # drift / rooster / splash / mud / deep-water / nitro emitters
    │   ├── TireMarks.js             # rubber-stripe trail mesh
    │   ├── collision-math.js        # orientedSupport() — shared truck-shape math (single-player + MP)
    │   └── surface-math.js          # motion-onto-tangent vector helpers
    ├── shaders/
    │   └── ground-shader.js (+ .md) # custom terrain-blend material plugin
    ├── tracks/                      # shipped track JSON + preview images
    ├── vehicles/                    # vehicle JSON + OBJ/MTL (VEHICLE_SETUP.md)
    ├── obstacles/                   # obstacle JSON + OBJ (OBSTACLE_SETUP.md)
    ├── decorations/                 # decoration assets + configs; decorations-registry.js (id→controller);
    │                                  *.js controllers (flag / bannerString / scaffold); lib/ = geometry classes
    └── vue/
        ├── main.js                  # Vue app bootstrap
        ├── store.js                 # barrel re-exporting the 5 Pinia stores in stores/
        ├── stores/                  # menu.js, race.js, editor.js, debug.js, multiplayer.js
        ├── AppShell.vue             # root; mounts every overlay/panel (each self-gates)
        ├── MenuOverlay.vue          # title / main menu / pit / pause / settings / championship setup
        ├── RaceHUD.vue              # timer, lap, per-truck status, countdown, OOB warning
        ├── SingleRaceOverlay.vue    # post-race results + RacePodium3D
        ├── ChampionshipPodium.vue   # cup-complete standings + RacePodium3D
        ├── RacePodium3D.vue         # Babylon mini-scene: top-3 trucks on a podium (shared loadVehicleModel.js)
        ├── Modal.vue                # reusable dimmed-backdrop modal shell
        ├── LoadingOverlay.vue       # spinning-wheel loading modal
        ├── Multiplayer{Lobby,Room}.vue
        ├── settings/                # Controls/Sound/Display/Gameplay/LapRecords/ManageTracks/LocalTracks
        └── editor/                  # one *Panel.vue per entity + AddEntityMenu, EditorStatusBar, EditorPanel
```

---

## Modes

`ModeController` owns the engine render loop and swaps modes via
`switchTo(ModeClass, config)` (tears down the old mode, builds the new scene,
starts rendering). `BaseMode` → `DriveMode` → the concrete driving modes.

**`DriveMode`** carries everything the driving modes share:
- `buildDriveScene(trackKey)` → `SceneBuilder.buildScene` + border-wall fade
- `getStartFinishInfo` / `makeGridSpawner` — grid spawns from a `startPosition`
  marker or stacked rows behind the finish gate (`start-grid.js` math)
- action-zone helpers: `getSlowZones` / `getSpeedBoostZones` / `getFireworkZones`
  / `getOutOfBoundsZones`, `applyZoneEffects`, `updateOutOfBoundsCountdown`
- `makeAIDriverFactory` — the good/ok/bad skill ladder (Race + Menu)
- `runCountdownSequence` — the 3-2-1-GO choreography (Race + Multiplayer)
- `installRaceFrameLoop({ isMenuUp, isCountdownActive, getRaceStartMs, runTimerWhilePaused, onFrame })`
  — the per-frame envelope (dt clamp, profiler frame, photo-mode camera, menu
  bail, HUD-timer throttle). Each mode supplies the `onFrame(dt, input)` body.
- `respawnAtLastCheckpoint(truck, { … })` — teleport back to the last cleared gate
- frame profiler + photo mode + fireworks lifecycle

`CLEANUP.md §2.4` records this dedup; `§2.3` is the remaining `RaceMode.setup()` /
`MultiplayerMode.setup()` decomposition (still large single functions).

**`RaceMode`** — the field (player + AI), lap/checkpoint tracking, race timer,
finish order + DNF grace timer, rubber-band, telemetry, position labels,
checkpoint arrow. On finish: `menuManager.showSingleRaceResults` (single race)
or `championship.onRaceComplete` (cup). Results rows carry `vehicleKey` + `color`
so the podium can render each finisher's truck.

**`MultiplayerMode`** — one locally-simulated player truck + `RemotePuppet`s
interpolated from server state. The client runs checkpoints/laps for its own
player only and reports lap/finish to the server; the server owns the roster and
race order. `runTimerWhilePaused: true` — a live server race doesn't stop for
this client's pause menu.

**`MenuMode`** — builds the attract-mode demo (a random track, AI-only field,
endless resultless race) that the menus sit on top of; falls back to a blank
scene + the static title art if it can't build.

**`HotLapMode`** — solo time attack with a `GhostPlayer` replay of your best lap.

---

## Championship (cup) mode

`ModeController` orchestrates; `managers/ChampionshipStorage.js` is the pure
scoring + persistence core (unit-tested).

- `createChampionship({ initials, calendar, drivers })` — fixed calendar, fixed
  roster (player + AI), each driver seeded to stock: 0 points, $0, 5 nitro
- `applyRaceResult(state, finishOrderIds)` — award points + purse by position
  (`awardRace`), advance `currentRaceIndex`; returns a new state (immutable)
- `standings(drivers)` — points desc, cumulative winnings as tiebreak
- Between races: pit screen (standings + wallet + upgrades); AI auto-shop
  (`_runAIPurchasing` — top up nitro, then random affordable stat upgrades)
- Cup complete → `showChampionshipPodium` (final standings + `RacePodium3D`) and
  `saveChampionshipScore` to the results board
- `money` is spendable (drops on upgrade buys); `winnings` is monotonic

---

## Track System (`world/track.js`)

Tracks are a composable `features[]` array, loaded from JSON in `src/tracks/`
(shipped) or `localStorage` (`tracks.custom.<id>`, via `TrackStore` /
`TrackLoader`), or built programmatically.

**Feature types:** `hill`, `squareHill`, `slopedRect`, `polyHill`, `meshGrid`,
`terrainRect` / `terrainCircle`, `terrainPath` (terrain painted along a
polyline), `checkpoint`, `polyWall`, `polyCurb`, `driveBox` (drivable
box/wedge), `bridgeMesh` (elevated drive surface), `obstacle`, `pickup`,
`decoration`, `trackSign`, `startPosition`, `actionZone` (slowZone / speedBoost /
outOfBounds / fireworks), `normalMapDecal` / surface decal.

**Key methods:** `getHeightAt(x,z)` (additive sum of elevation features),
`getTerrainTypeAt(x,z)` (topmost matching terrain feature).

**`squareHill` skirt:** `t = clamp(edgeDist / transition, 0, 1)`,
`height = feature.height * (cos(tπ) + 1) / 2`.

**`polyHill`:** expand control points with rounded-corner arcs, then
`height = feature.height * (1 - dist / halfWidth)` inside `width/2` of the line.

### Adding a track feature
1. `add___()` on `Track` (push to `this.features`); `case` in `getHeightAt` /
   `getTerrainTypeAt` as needed
2. render in `SceneBuilder.js` (usually via a new `XxxManager`)
3. `XxxEditor.js` + `XxxPanel.vue`, wire into `EditorController`
   (activate/deactivate, `_applySnapshot`, pointer pick, the
   `_getSelectedFeatureActions` table) and `AddEntityMenu.vue`
4. add panel state to the editor store; `npm run check:panels` verifies bindings

---

## Terrain System (`world/terrain.js`)

Grid of surface-type cells; `TerrainManager(gridSize, cellSize, worldW, worldD)`
(square by default, non-square tracks supported). `getTerrainAt(position)` snaps
to the nearest cell centre.

**`TERRAIN_TYPES`** (grip × / drag ×): `ASPHALT` 3.8 / 0.3 · `PACKED_DIRT`
2.0 / 0.5 (baseline) · `LOAMY_DIRT` 0.75 / 1.1 · `LOOSE_DIRT` 1.5 / 0.7 ·
`MUD` 0.15 / 2.9 · `WATER` 0.3 / 6.0 · `ROCKY` 1.0 / 0.8 · `GRASS` 0.15 / 1.2.
Each type also carries `color`, `smokeColor`, `dustIntensity`, `roosterTail`.

Visual: procedural per-surface `DynamicTexture` (`surface-textures.js`) plus the
custom terrain-blend material (`shaders/ground-shader.js`, documented in its
`.md`) — blends between painted regions, bakes AI-path wear ruts.

### Adding a terrain type
Add to `TERRAIN_TYPES` (grip, drag, color, smokeColor). Paint via
`terrainRect` / `terrainCircle` / `terrainPath`, or set as a hill's
`terrainType`.

---

## Multi-Level Surfaces (bridges / overpasses)

- **`SurfaceRegistry`** — every gameplay surface gets `mesh.metadata` with
  `surfaceId`, `surfaceType`, `level`, `surfaceRole` (`drive` | `boundary`).
- **`DriveSurfaceManager`** — register/query drive surfaces; builds a submesh
  octree on large static meshes for fast downward picks (see below).
- **`TerrainQuery`** — hybrid raycast + cross-pattern normal sampler. Downward
  ray filtered to drive surfaces, upward fallback on penetration, 4 short probes
  for a smooth averaged normal, `_lastResolvedSurface` continuity hint so the
  truck stays on the deck vs. the ground under it.
- **`SurfaceTopologyGraph`** — surface connectivity for AI routing / recovery.
- **`BridgeMesh`** — solid elevated mesh; `heights[]` row-major absolute Y,
  optional `offsetsX/Z` per control point, `smoothing` (Catmull-Rom densify),
  Havok MESH collider, terrain seams to the ground.

### Drive-surface picking performance
Terrain physics + AI floor detection fire many downward `multiPickWithRay`s per
truck per frame; cost scales with AI count.
- `DriveSurfaceManager.register()` subdivides + octrees meshes > ~512 tris (the
  ground). Requires the side-effect import
  `@babylonjs/core/Culling/Octrees/octreeSceneComponent.js` — without it the
  octree method is `undefined` and acceleration silently no-ops.
- Bridge decks/seams are excluded (coarse + dynamic).
- AI multi-probe floor sampling is gated to elevated surfaces / bridge proximity
  (`hasElevatedSurfaceNear` + a sticky timer); flat tracks use the cheap
  single-probe `heightAtFast` path. AI normals sample at ~1/30 s except near
  bridges. AI beyond `AI_TERRAIN_LOW_DETAIL_DIST` (75 m) run `TerrainPhysics` in
  `lowDetail`.
- **Do not** replace `multiPickWithRay` with a single `pickWithRay` in
  `_castRayToSurface` — tried and reverted; a single pick returns only the
  nearest triangle, which on a steep face is a vertical sliver that fails the
  normal filter → null floor → truck tunnels through.

### FPS overlay (`AppShell.vue`)
`<avg> (min <worst>)`. The average is a vsync-capped frame *count* over 500 ms —
reads a steady 60 through hitches. Judge stutter by **min** (`1000 / longest
frame`), amber < 50 / red < 30. The `FrameProfiler` console report localizes.

---

## Truck Physics (`src/truck/`)

`Truck` coordinates four subsystems per frame:

- **`TerrainPhysics`** — vertical. Spring terrain collision
  (`springStrength 150`, `damping 7`), returns `{ groundedness, penetration }`.
  Multi-probe footprint sampling. `penetration > -0.3` gates terrain effects (use
  this, not `groundedness > 0`, which never fully zeros). `DOWNHILL` config at
  file top: pass 1 fakes suspension when slightly airborne downhill, pass 2
  floors `groundedness` so steering survives descents. `_applyDepenetration`:
  on deep penetration reading downhill past `tunnelingSlope`, eases the truck
  back to the surface and bleeds horizontal speed (uphill climbs left alone).
- **`DriftPhysics`** / **`DriftTuning`** — horizontal traction. `DriftTuning`'s
  four knobs are the only intended drift interface; they expand into the raw
  grip/slip/drag params.
- **`Controls`** — steering (inverts below `fwdSpeed < 0` for natural reverse),
  acceleration, boost (`boostCount` max 5, `boostDuration 3.0s`,
  `boostAccelMult 2.5`, `boostSpeedMult 1.8`).
- **`TruckBody`** — visual puppet. Loads `vehicleDef.modelUrl` (from
  `VehicleLoader`) via `SceneLoader.ImportMeshAsync`, box fallback. `_visualRoot`
  (partial terrain correction, allows bounce) + `_wheelRoot` (full correction).
  Wheels are instanced from `assets/models/truck-tire-v2.obj`.

**`truck.state`:** `heading` (rad, 0 = +Z), `velocity` (world, diverges from
heading = drift), `slipAngle`, `boostActive/Timer/Count`,
`speedBoostActive/Timer/…`, `slowZoneActive`, `rubberBandSpeedMult`.

---

## Particle Effects (`truck/ParticleEffects.js`)

Six emitter kinds, declared as `EMITTER_SPECS` and built by `_buildEmitter`:
`drift` (terrain-tinted cruise/drift smoke), `rooster` (paired rear-tire dirt
under throttle), `splash` (water spray, uses `water-spray.png`), `mud`,
`deep` (deep-water burst), `nitro` (world-space burst on boost rising edge).
Terrain-tinted emitters recolour from `terrain.smokeColor` on surface change.

---

## AI Driver (`ai/AIDriver.js`)

**Read `src/ai/ARCHITECTURE.md` first.** `AIDriver` is a thin coordinator that
delegates to focused controllers in `ai/controllers/`: path planning
(`AIPathPlanner`), analog steering (`AISteeringController` — velocity/trajectory
referenced, not binary), throttle + corner-speed taper (`AIThrottleController`),
boost (`AIBoostController`), stuck / spawn recovery, checkpoint guidance, debug
rendering. Skill presets `AI_SKILL_PRESETS` = `good` / `ok` / `bad`; outside a
championship the field cycles through them by index
(`DriveMode.makeAIDriverFactory`).

Perf: `isBlocked` uses a cached rasterized occupancy grid (not per-segment
scans); `invalidateBlockedGrid()` on wall changes. Terrain LOD as above.

---

## Vehicle Upgrades (`managers/UpgradeStorage.js`)

`UPGRADES` = topSpeed / acceleration / tires / suspension / nitro. `applyPurchase`
(pure, unit-tested) gates on cost + `maxLevel` (6; nitro is a 0-99 consumable
count). Single-race upgrades are free (`getUpgradeCatalog({ ignoreBalance: true })`)
and global; a **championship** driver spends a real per-cup wallet
(`ChampionshipStorage`). Shown on the pit screen (`TruckSetup.vue`), applied to
truck stats at spawn.

---

## Checkpoint / lap system (`managers/CheckpointManager.js`)

Gate detection: perpendicular dist < `width/2`, forward dist < 2 u, velocity·
forward > 0. Numbered checkpoints enforce order; `lastCheckpointPassed` blocks
double-triggers. Alternative gates share a checkpoint *step*. Reverse races
rebuild the manager with flipped headings + renumbered sequence — always resolve
gates from `checkpointManager.checkpointMeshes`, not raw track features. Barrels
sample terrain height at their own position for a local Y offset.

---

## Editor (`src/editor/`)

`EditorController` (~2600 lines) coordinates: camera orbit/pan/zoom, pointer
picking + gizmo drag, keybindings (WASD nudge, Delete, Ctrl+Z/Y), a 50-deep
undo/redo snapshot stack, and dispatch to one sub-editor per entity type. Vue
panels in `src/vue/editor/` self-gate on `editor.selectedType`.

**Panel ↔ editor dispatch** (validated by `scripts/check-panel-bindings.mjs`):
- `editor.setFeatureProp('hill', 'radiusX', v)` → store mirrors `hill.radiusX`,
  then `EditorController.changeHillRadiusX(v)` → `this.hillEditor.changeRadiusX(v)`
- `editor.featureAction('deleteSelectedHill')` → `EditorController.deleteSelectedHill()`

**Vue reactivity:** each sub-editor's `_syncStoreToFeature(feature, selectedIdx)`
sets **individual** store props — never replace the reactive object:
```js
store.polyHill.height = feature.height;   // ✓
store.polyHill = { height: … };           // ✗ breaks reactivity
```
Rebuild methods run **immediately** (not deferred) for live slider feedback.
Full-scene `rebuild` reloads the track from `localStorage` — refresh in place for
unsaved edits (`editor-rebuild.js`).

`EditorController.handleKeyDown` bails when `event.target` is an input/textarea
so typing in fields doesn't trigger shortcuts.

---

## Camera (`managers/CameraController.js`)

Isometric, base offset `(0, 28, -20)`, lerp follow (0.08), zoom `-` / `=`
(0.5×–2.0×). `P` toggles a free "photo mode" camera (WASD + `+`/`-`).

---

## Coordinate system

Origin at track centre. **+X East, +Z North, +Y Up.** `heading` 0 = +Z,
π/2 = +X. `heading -= turn` left, `+= turn` right.

---

## Controls

| Key | Action | | Key | Action |
|---|---|---|---|---|
| W / ↑ | Forward | | R | Reset to last checkpoint |
| S / ↓ | Brake / reverse | | C | Cycle camera |
| A / ← | Turn left | | P | Photo mode |
| D / → | Turn right | | ESC | Pause menu |
| Space | Nitro | | \\ | Debug panel |
| - / = | Zoom | | | (remap in Settings → Controls) |

---

## Common gotchas

- **Terrain effects in the air** — gate on `penetration > -0.3`, not `groundedness`.
- **Particles trailing the truck** — a mesh `emitter` drags emitted particles;
  use a fixed `Vector3` for world-space bursts (nitro).
- **AI steering in reverse** — physics inverts steering below `fwdSpeed < 0`; AI
  must read actual `fwdSpeed`, not intent.
- **NaN vertices crashing Havok** — missing JSON fields (`depth`, `transition`)
  make heights `NaN` and poison the mesh; always `?? fallback`.
- **Teleporting a truck** — use `respawnTruck` / `respawnAtLastCheckpoint`
  (teleport + `notifyTeleport`), or `StaticBodyCollisionManager` snaps it back to
  its stale previous position.
- **Editor slider not updating** — set individual reactive props, never replace
  the object.
- **`TerrainQuery` picking the wrong layer** — feed `_lastResolvedSurface` back
  each frame.
- **Reverse-race respawns** — resolve gates from the CheckpointManager, not
  `track.features`.

---

## Build / test / run

- **Dev:** `npm run dev` (`host: true` — LAN-reachable for multiplayer testing)
- **Server:** `npm run server` (colyseus, `server/index.js`)
- **Build:** `npm run build` → `build:raw` (vite) + `build:optimize` (WAV→OGG,
  PNG/WEBP recompression, asset URL rewriting). `npm run build:raw` alone is the
  fast compile check.
- **Test:** `npm test` — Vitest, pure-logic only (grid math, polyline,
  championship scoring, upgrade economy, colour parsing). No scene, no DOM.
- **Headless checks:** `npm run check:panels` (editor bindings, keep green) ·
  `check:surface` · `check:walls` · `check:terrain` / `check:water` (both
  currently failing on `main` — see `CLEANUP.md §3.1`).
- Rendering / physics / editor interaction: run the app.
- **Deploy:** GitHub Pages (`.github/workflows/deploy-pages.yml`); `web/` +
  `server/` Dockerfiles for the multiplayer stack.

---

## Docs

`README.md` (quick start) · `CLEANUP.md` (maintainability review + refactor
plan, live) · `docs/` (design: MULTIPLAYER, TERRAIN_REFACTOR, CHAMPIONSHIP_MODE).
Scoped, next to their code: `src/ai/ARCHITECTURE.md`, `src/vue/MENUS.md`,
`src/shaders/ground-shader.md`, `src/vehicles/VEHICLE_SETUP.md`,
`src/obstacles/OBSTACLE_SETUP.md`, `src/decorations/DECORATION_SETUP.md`.
