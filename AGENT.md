# Offroad Racing Game — Agent Documentation

## Project Overview
An isometric offroad racing game built with Babylon.js and Havok Physics. Features arcade-style truck physics, terrain effects, AI drivers, checkpoints, lap tracking, a track editor, season championship mode, and a full Vue-based menu/HUD. Inspired by classic Super Off-Road.

## Technology Stack
- **Babylon.js 7** — 3D rendering engine
- **Havok Physics 1.3** — WASM-based physics (MESH for terrain/bridges, BOX for trucks/walls)
- **Vue 3 + Pinia** — Reactive UI layer (menus, editor panels, HUD, store)
- **Vite 6** — Build tool and dev server
- **ES Modules** — Vanilla JS everywhere except Vue components
- **Tailwind CSS** — Utility CSS for UI components

## File Structure

```
offroad/
├── index.html
├── package.json
├── vite.config.js
├── public/
│   └── tracks/                      # JSON track definitions + PNG previews
├── vehicles/                        # Vehicle model assets and configs
└── src/
    ├── main.js                      # Game entry point, Babylon scene setup, mode bootstrap
    ├── track.js                     # Track class: feature definitions, height/terrain queries, serialization
    ├── terrain.js                   # Grid-based terrain with surface types and physics modifiers
    ├── terrain-utils.js             # Terrain mesh generation and blending
    ├── terrain-blend-utils.js       # Multi-level surface blending helpers
    ├── polyline-utils.js            # Polyline expansion and bezier interpolation
    ├── constants.js                 # Game constants (truck dimensions, colors, physics params)
    ├── settingsStorage.js           # localStorage persistence
    ├── ai/
    │   ├── AIDriver.js              # A* pathfinding, skill config, stuck detection, respawn
    │   └── setupAIDrivers.js        # AI driver instantiation helper
    ├── editor/                      # Track editor subsystem (one file per entity type)
    │   ├── EditorController.js      # Main editor coordinator (~78KB): input, undo/redo, entity delegation
    │   ├── EditorMaterials.js       # Shared material definitions for editor visualization
    │   ├── ActionZoneEditor.js
    │   ├── AiPathEditor.js
    │   ├── BezierWallEditor.js
    │   ├── BridgeMeshEditor.js
    │   ├── CheckpointEditor.js
    │   ├── DecorationsEditor.js
    │   ├── HillEditor.js
    │   ├── MeshGridEditor.js
    │   ├── NormalMapDecalEditor.js
    │   ├── ObstacleEditor.js
    │   ├── PolyCurbEditor.js
    │   ├── PolyHillEditor.js
    │   ├── PolyWallEditor.js
    │   ├── SquareHillEditor.js
    │   ├── SurfaceDecalEditor.js
    │   ├── TerrainPathEditor.js
    │   ├── TerrainShapeEditor.js
    │   └── TrackSignEditor.js
    ├── managers/
    │   ├── AudioManager.js          # Music/SFX management
    │   ├── BannerStringManager.js   # Decorative banner strings between poles
    │   ├── BridgeMeshManager.js     # BridgeMesh lifecycle (create/dispose/physics)
    │   ├── CameraController.js      # Isometric camera with lerp follow and zoom
    │   ├── CheckpointManager.js     # Gate detection, lap counting, sequential enforcement
    │   ├── DebugManager.js          # Debug overlay: telemetry, frame stats
    │   ├── DriveSurfaceManager.js   # Central registry for all drivable surfaces
    │   ├── EngineAudio.js           # Engine sound RPM mapping
    │   ├── FlagManager.js           # Flag rendering + truck collision (spring physics)
    │   ├── FrameProfiler.js         # Per-frame performance monitoring
    │   ├── GameState.js             # Race state machine (waiting, countdown, racing, finished)
    │   ├── InputManager.js          # Keyboard input
    │   ├── MenuManager.js           # Main menu UI coordination
    │   ├── ObstacleManager.js       # Tire stacks and cones (movable physics objects)
    │   ├── PickupManager.js         # Item pickups (boosts, repairs)
    │   ├── SeasonManager.js         # Season championship: points, tracks, AI drivers, persistence
    │   ├── StaticBodyCollisionManager.js  # Truck-to-static mesh collision handling
    │   ├── SteepSlopeColliderManager.js   # Invisible colliders on steep terrain faces
    │   ├── SurfaceDecalManager.js   # Normal-map decals on terrain
    │   ├── SurfaceRegistry.js       # Canonical surface registry with surfaceId/level/role metadata
    │   ├── SurfaceTopologyGraph.js  # Multi-level surface connectivity graph for AI/recovery
    │   ├── TelemetryPlayer.js       # Replay recorded telemetry
    │   ├── TelemetryRecorder.js     # Record truck telemetry for replay
    │   ├── TerrainQuery.js          # Layered raycast + cross-pattern sampler for floor detection
    │   ├── TrackLoader.js           # JSON track loading from public/tracks/
    │   ├── TrackSignManager.js      # Track name sign rendering
    │   ├── TruckAudioController.js  # Per-truck audio: engine, collision, pickups
    │   ├── TruckCollisionManager.js # Truck-to-truck collision detection and response
    │   ├── UIManager.js             # HUD elements
    │   ├── UpgradeStorage.js        # Vehicle upgrade system with localStorage
    │   ├── VehicleLoader.js         # Vehicle definition loading from vehicles/
    │   └── WallManager.js           # Wall/barrier physics meshes
    ├── modes/
    │   ├── ModeController.js        # Orchestrates switching between game modes
    │   ├── BaseMode.js              # Abstract base: visibility handling, physics reset, respawn
    │   ├── DriveMode.js             # Base class for gameplay modes (shared scene setup)
    │   ├── SceneBuilder.js          # Shared scene construction: ground, lights, managers, physics
    │   ├── EditorMode.js
    │   ├── MenuMode.js
    │   ├── PracticeMode.js
    │   ├── RaceMode.js              # Full race: lap tracking, AI drivers, timing, UI
    │   └── TestMode.js
    ├── objects/                     # Visual + physics track entities
    │   ├── BannerString.js          # Decorative rope/banner between poles
    │   ├── BezierWall.js            # Curved wall with Bezier interpolation
    │   ├── BridgeMesh.js            # Multi-level drivable bridge/overpass mesh
    │   ├── Checkpoint.js            # Race gate with terrain-aware barrel heights
    │   ├── Flag.js                  # Decorative flag with spring-damper bend physics
    │   ├── Hill.js                  # Legacy circular Gaussian hill
    │   ├── Obstacle.js              # Tire stacks, cones, barrels
    │   ├── Pickup.js                # Item collectibles
    │   ├── PolyCurb.js              # Polyline-based curb
    │   ├── PolyWall.js              # Polyline-based wall mesh
    │   ├── TrackSign.js             # Track name sign with DynamicTexture
    │   └── WallSegment.js           # Single wall segment
    ├── truck/
    │   ├── index.js                 # Re-exports Truck class
    │   ├── truck.js                 # Truck class — coordinates all subsystems
    │   ├── Controls.js              # Steering, acceleration, boost logic
    │   ├── DriftPhysics.js          # Grip, slip angle, drag
    │   ├── ParticleEffects.js       # Drift smoke, water splash, nitro burst
    │   ├── TerrainPhysics.js        # Gravity, suspension spring, slope orientation
    │   └── TruckBody.js             # Visual puppet: OBJ body + procedural wheels
    └── vue/
        ├── main.js                  # Vue app bootstrap
        ├── store.js                 # Pinia state store (~47KB): all reactive game/editor state
        ├── AppShell.vue             # Root container mounting all UI panels
        ├── DebugPanel.vue           # Performance metrics overlay
        ├── MenuOverlay.vue          # Main menu
        ├── RaceHUD.vue              # Race status: time, lap, position
        ├── LoadingOverlay.vue       # Asset loading indicator
        ├── RaceConfig.vue           # Race configuration panel
        ├── TruckSelection.vue       # Vehicle picker
        ├── TruckSetup.vue           # Upgrade/setup screen
        └── editor/                  # Editor UI panels
            ├── AddEntityMenu.vue
            ├── BezierWallPanel.vue
            ├── BridgeMeshPanel.vue
            ├── CheckpointPanel.vue
            ├── EditorPanel.vue      # Draggable panel base component
            ├── EditorStatusBar.vue
            ├── FlagPanel.vue
            ├── HillPanel.vue
            ├── NormalMapDecalPanel.vue
            ├── ObstaclePanel.vue
            ├── PickupPanel.vue
            ├── PolyCurbPanel.vue
            ├── PolyHillPanel.vue
            ├── PolyWallPanel.vue
            ├── SquareHillPanel.vue
            ├── TerrainCirclePanel.vue
            ├── TerrainShapePanel.vue
            ├── TerrainRectPanel.vue
            └── TrackSignPanel.vue
```

---

## Core Systems

### 1. Track System (`track.js`)
Defines terrain layouts using a composable `features[]` array. Tracks are loaded from JSON in `public/tracks/` or built programmatically.

**Feature Types:**
- `hill` — circular Gaussian hill
- `squareHill` — flat-topped rectangle with cosine transition skirt; negative height = pit
- `slopedRect` — rectangle sloping along X or Z; supports `transition` cosine falloff
- `polyHill` — triangular-profile hill extruded along a polyline with optional rounded corners
- `meshGrid` — arbitrary height field defined by a grid of control points
- `terrainRect` / `terrainCircle` — areas with specific terrain types (mud, water, etc.)
- `checkpoint` — racing gate with optional sequential numbering
- `polyWall` — wall defined by an array of `{x, z}` points
- `bezierWall` — curved wall using Bezier interpolation
- `polyCurb` — low polyline curb
- `obstacle` — tire stack, cone, or barrel
- `pickup` — item collectible (boost, repair)
- `flag` — decorative flag with spring-damper bend physics
- `trackSign` — track name sign with DynamicTexture
- `bridgeMesh` — drivable elevated surface (see §Multi-Level Surfaces)
- `normalMapDecal` — normal-map decal on terrain surface

**Key Methods:**
- `getHeightAt(x, z)` — additive sum of all elevation features at a world point
- `getTerrainTypeAt(x, z)` — returns the terrain type of the topmost matching feature

**`squareHill` math:**
```
edgeDx = max(0, |lx| - halfWidth)
edgeDz = max(0, |lz| - halfDepth)
dist = sqrt(edgeDx² + edgeDz²)
t = clamp(dist / transition, 0, 1)
height = feature.height * (cos(t * π) + 1) / 2
```

**`polyHill` math:**
- Expand control points with rounded corners using arc segments per `radius`
- Find minimum distance from query point to expanded polyline
- If `dist < width/2`: `height = feature.height * (1 - dist / halfWidth)`

**Adding a New Track Feature:**
1. Add `add___()` method to `Track` class with a feature object pushed to `this.features`
2. Add `case` to `getHeightAt()` if it changes elevation
3. Add `case` to `getTerrainTypeAt()` if it changes terrain type
4. Add rendering in `SceneBuilder.js`
5. Add `XxxEditor.js`, `XxxManager.js`, `XxxPanel.vue`
6. Wire into `EditorController` (activate/deactivate, `_applySnapshot`, pointer pick, `deselectAll`, bridge methods)
7. Add to `store.js` and `AppShell.vue` / `AddEntityMenu.vue`

---

### 2. Terrain System (`terrain.js`)
Grid-based terrain that applies physics and visual modifiers.

**Terrain Types:**
| Name | Grip | Drag |
|------|------|------|
| `ASPHALT` | 3.5× | 1.0× |
| `PACKED_DIRT` | 2.0× | 1.0× |
| `LOOSE_DIRT` | 0.5× | 1.2× |
| `MUD` | 0.15× | 2.9× |
| `WATER` | 0.3× | 6.0× |

**Grid System:**
- 160×160 world units, 2×2 cell size → 80×80 grid cells
- `getTerrainAt(position)` snaps to nearest cell center with `Math.round()`
- Ground mesh and terrain grid must both be 160×160 — mismatching breaks physics and texture alignment

**Visual Texture:**
- `DynamicTexture` drawn per-cell from terrain color
- Per-pixel brightness noise (±9 units) for a matte dirt look
- `specularColor = (0,0,0)`, `specularPower = 0` — no shine

---

### 3. Multi-Level Surface System
Multi-level drivable surfaces (bridges, overpasses) are implemented via three cooperating systems:

**`SurfaceRegistry` (`managers/SurfaceRegistry.js`)**
Canonical registry for all gameplay-relevant world surfaces.
- Each mesh gets a unique `surfaceId`, `surfaceType`, `level`, `surfaceRole` (`"drive"` or `"boundary"`) via `mesh.metadata`
- Legacy fields `isTerrain` and `isDriveSurface` are still set for backward compatibility
- `registerSurface(mesh, options)` — assign id, set metadata, store record

**`DriveSurfaceManager` (`managers/DriveSurfaceManager.js`)**
Central entry point for registering and querying drivable surfaces. Wraps `SurfaceRegistry`.
- `register(mesh, options)` — register drive surface (sets `role: "drive"`); also builds a picking octree on large meshes (see §3b)
- `registerBoundary(mesh, options)` — register boundary (wall/barrier)
- `getAll()` — returns all drivable meshes

**`TerrainQuery` (`managers/TerrainQuery.js`)**
Hybrid raycast + cross-pattern normal sampler for robust multi-level floor detection.
- **Primary ray**: downward from truck position, filtered to `isDriveSurface` meshes
- **Upward fallback**: fires when truck Y has penetrated the mesh (steep slope edge case)
- **Cross-pattern sampling**: 4 short height probes (±0.5m in X and Z) to compute a smooth averaged normal — avoids jitter from per-triangle normals on vertex-displaced meshes
- Maintains `_lastResolvedSurface` for continuity hints (helps stay on bridge deck vs. ground when layers overlap)
- Result: `{ hit: bool, y: number, normal: Vector3, surfaceId, level }`

**`SurfaceTopologyGraph` (`managers/SurfaceTopologyGraph.js`)**
Graph of surface connectivity for AI routing and recovery.
- Nodes = surfaces by `surfaceId`
- Edges = connectors between surfaces (bridge entry/exit ramps)
- Used by BridgeMesh to wire up connector endpoints at creation time

**`BridgeMesh` (`objects/BridgeMesh.js`)**
Drivable elevated mesh with solid top/bottom/sides.
```json
{
  "type":      "bridgeMesh",
  "centerX":   0,
  "centerZ":   0,
  "width":     10,
  "depth":     20,
  "cols":      3,
  "rows":      5,
  "heights":   [2,2,2, 2,2,2, 2,2,2, 2,2,2, 2,2,2],
  "rotation":  0,
  "thickness": 0.5,
  "layerId":   1
}
```
- `heights` array is row-major (rows × cols), absolute world Y
- Top face registered as a drive surface so raycasts land at correct height/slope
- Uses Havok MESH collider for the top face; terrain seam meshes connect bridge edges to ground to prevent gaps

---

### 3b. Terrain Raycast Performance (drive-surface picking octree)
Terrain physics and AI floor detection fire **many downward raycasts per truck per
frame** (multi-probe sampling + cross-pattern normal sampling, each resolved
through `DriveSurfaceManager`/`TerrainQuery` via `scene.multiPickWithRay`). This
cost scales linearly with the number of trucks (AI count) and is the dominant
factor in frame time when many AI drivers are present.

**Picking acceleration:** `DriveSurfaceManager.register()` calls
`_enablePickingAcceleration(mesh)` on every drive surface. For meshes above ~512
triangles (the ground, ~16k tris) it:
1. `mesh.subdivide(n)` — partitions the single submesh into `n` submeshes
   (~128 tris each) so per-submesh AABB culling skips most geometry, and
2. `mesh.createOrUpdateSubmeshesOctree(32, 2)` — builds a submesh octree so the
   candidate-gathering itself is sub-linear.

Each downward ray then tests only the triangles beneath its XZ cell instead of
the whole mesh. Only static, ground-level surfaces are accelerated — bridge decks
and seams are excluded: they are built from the coarse control-point grid
(~16–32 triangles) so they already pick in microseconds, and they are *dynamic*
(rebuilt on edit), which would leave a once-built submesh octree stale and
silently mis-pick. (Small meshes are also caught by the `triCount < 512` guard.)

**AI terrain-sampling LOD (multi-probe gated to bridges):** AI trucks no longer
run the expensive multi-probe floor sampling every frame. `Truck.update()` enables
`forceMultiProbe` only when the truck is on an elevated surface
(`floorSurface.surfaceLevel > 0`) or within `AI_BRIDGE_MULTIPROBE_RADIUS` of a
bridge deck (`DriveSurfaceManager.hasElevatedSurfaceNear`), with a
`AI_BRIDGE_MULTIPROBE_STICKY_S` hysteresis timer so it stays on through approaches
and exits. On flat tracks the elevated-surface list is empty, so the proximity
check returns instantly and AI use the cheap single-probe `heightAtFast` path.
AI also sample full normals at `AI_NORMAL_SAMPLE_INTERVAL` (1/30 s) instead of
every frame — except near bridges, where `TerrainPhysics` forces every-frame
normals so ramp slope stays accurate. Player trucks are unchanged (continuous
multi-probe + every-frame normals).

**Required side-effect import:** `createOrUpdateSubmeshesOctree` and the picking
octree scene component are tree-shaken out of `@babylonjs/core` by default.
`DriveSurfaceManager.js` imports `@babylonjs/core/Culling/Octrees/octreeSceneComponent.js`
for its side effects — without it the method is `undefined` and acceleration
silently no-ops. The prototype method lazily registers the scene component on
first use, so no scene-level setup is needed.

**Reading the FPS overlay (`vue/AppShell.vue`):** the top-right counter shows
`<avg> (min <worst>)`. The average is a 500 ms, vsync-capped, rounded frame
*count* — it reads a steady 60 even through hitches and **cannot reveal stutter**.
The `min` value is `1000 / longest-frame-ms` within the same window, so a single
long frame surfaces there (e.g. `60 (min 32)`) and is colored amber below ~50 /
red below ~30. Use **min**, not the average, to judge hitches; the `FrameProfiler`
console report (`maxFrameMs` + per-section `truck.terrainPhysics`) localizes them.

**Center-sample reuse:** `TerrainPhysics.update()` resolves the truck's centre
floor once per frame (`centerFloorY`) and reuses it for the multi-probe lift
comparison and the suspension downhill passes (`_updateSuspension` no longer
re-queries the centre XZ). The normal-sampling `castDown` still issues its own
centre query — it needs the precise hit + cross-pattern normal there, and merging
it would flip the multi-probe-lift / castDown precedence the bridge handling
relies on, so that one duplicate is left intentionally.

**Single-pick fast path:** `DriveSurfaceManager._castRayToSurface` skips the
`multiPickWithRay` scan (and its per-call array allocation) and uses a single
`pickWithRay` when there are no elevated surfaces registered — with no overlapping
layers there is at most one drivable surface under any XZ, so the nearest hit is
correct. Bridge tracks still take the multi-hit + continuity path.

**AI occupancy grid:** `AIDriver.isBlocked` no longer scans every wall/curb
segment per call. Segments are static during a race, so they are rasterized once
(lazily) into a cached `Uint8Array` grid (`_ensureBlockedGrid`); subsequent
queries — many per AI tick from steering/boost probes — are O(1) lookups.
`invalidateBlockedGrid()` drops the cache if walls change.

**Remaining levers (not yet implemented):** distance/speed `lowDetail` gating for
far AI (the `lowDetail` / `LOW_DETAIL_NORMAL_SAMPLE_INTERVAL` plumbing exists in
`TerrainPhysics.js`) is the main one left. Measure with the `FrameProfiler`
(`truck.terrainPhysics` label is already instrumented).

---

### 4. Truck Physics (modular, in `src/truck/`)
The `Truck` class coordinates four subsystems updated each frame:

**`TerrainPhysics.js`** — vertical physics
- Spring-based terrain collision: `springStrength: 150`, `damping: 7`
- Returns `{ groundedness, penetration }` each frame
- Multi-probe floor sampling: several points around the truck's footprint are all queried via `TerrainQuery` for robust detection on edges
- `penetration > -0.3` gates terrain effects (use this, not `groundedness > 0` which never fully zeros)
- **Downhill tracking**: `DOWNHILL` config object at file top holds all tuning knobs:
  - Pass 1 (`followMaxGap`, `followHeightDrop`, …) — injects fake suspension compression when slightly airborne on a downward slope
  - Pass 2 (`boostMaxGap`, `boostGroundedness`, …) — clamps `groundedness` to a minimum so the truck retains steering through descents

**`DriftPhysics.js`** — horizontal traction
- `applyGripAndDrift(speed, forward, groundedness)` — early-returns when `groundedness <= 0`
- `applyDrag(speed, input, deltaTime, terrainDragMultiplier, groundedness)` — uses `coastingMultiplier = 0.02`, `drag = 1.0` when airborne

**`Controls.js`** — steering and acceleration
- Steering inverts when `fwdSpeed < 0` so the truck turns naturally in reverse
- Boost: `boostActive`, `boostTimer`, `boostCount` (max 5), `boostDuration: 3.0s`, `boostAccelMult: 2.5×`, `boostSpeedMult: 1.8×`

**`TruckBody.js`** — visual puppet
- Loads `offroad-truck-v3.obj` via `SceneLoader.ImportMeshAsync`; box fallback on failure
- Two `TransformNode` roots parented to the physics box:
  - `_visualRoot` — body/chassis gets **partial** terrain correction (allows suspension bounce)
  - `_wheelRoot` — wheels get **full** terrain correction (always above ground)
- Animates steering angle, suspension compression, roll

**Key State (on `truck.state`):**
- `heading` — direction truck faces (radians); 0 = +Z north
- `velocity` — world-space movement vector (can diverge from heading = drift)
- `slipAngle` — angle between heading and velocity direction
- `boostActive` / `boostTimer` / `boostCount`

**Airborne terrain gating (`truck/truck.js`):**
```js
const isGrounded = penetration > -0.3;
if (terrainManager && isGrounded) { /* apply terrain modifiers */ }
```

---

### 5. Particle Effects (`truck/ParticleEffects.js`)
Three independent `ParticleSystem` instances per truck:

**Drift smoke** — `emitRate = driftIntensity * 300`; color from `DRIFT_COLORS` map:
| Terrain | Color |
|---------|-------|
| `packed_dirt` | Dusty brown |
| `loose_dirt` | Lighter tan |
| `mud` | Dark brown |
| `asphalt` | Grey |
| `water` | Blue-white |

**Water splash** — `emitRate = speed * 80` when `isInWater && isGrounded && speed > 1`

**Nitro burst** — fires once on rising edge of `state.boostActive`; emitter is a **fixed world-space `Vector3`** snapped to truck rear at fire time (particles don't follow the truck)

---

### 6. AI Driver (`ai/AIDriver.js`)
A* pathfinding on 160×160 / 2-unit-resolution grid.

**Skill Config (`AI_SKILL_PRESETS`):**
```js
// Exported presets: good / ok / bad
new AIDriver(track, checkpointManager, wallManager, scene, AI_SKILL_PRESETS.good);
```
| Preset | lookAheadDistance | maxSpeed | steeringPrecision |
|--------|-------------------|----------|-------------------|
| good | 20 | 0.8 | 1.0 |
| ok | 15 | 0.65 | 0.85 |
| bad | 12 | 0.5 | 0.7 |

**Pathfinding:**
- Grid cells blocked if they overlap wall segments (2-unit safety margin)
- A* with 8-directional movement (diagonal cost = 1.414)
- On checkpoint pass: use exit point 10u ahead as A* start, prepend 4 blend waypoints for smooth curve through gate

**Stuck detection (two systems):**
1. No-throttle timer — coasting/reversing 3+ seconds → respawn
2. Position timer — moved <1 unit in 3s → respawn

**Respawn (`_findClearPosition`):** walk back along path → radial sweep (16 directions, 2–12u) → stay put

---

### 7. Season Mode (`managers/SeasonManager.js`)
Pure-JS manager (no Babylon or Vue imports). Persists to localStorage.

**Season Tracks:** Fandango → Huevos Grande → Sidewinder → Big Dukes → Blaster → Cliff Hanger → Wipeout

**Points:** 1st = 10, 2nd = 5, 3rd = 3, 4th = 1

**AI Drivers:**
| Name | Skill |
|------|-------|
| Crusher | hard (`AI_SKILL_PRESETS.good`) |
| Wheels | medium (`AI_SKILL_PRESETS.ok`) |
| Dusty | easy (`AI_SKILL_PRESETS.bad`) |

**State persistence:** `localStorage.season_state` — JSON-serialized `SeasonState`

**`UpgradeStorage.js`** — vehicle upgrade system; persists per-vehicle upgrade levels and player balance to localStorage.

---

### 8. Checkpoint System (`managers/CheckpointManager.js`)
- Gate detection: perpendicular distance < `width/2`, forward distance < 2u, velocity dot forward > 0
- Numbered checkpoints enforce sequential order; `lastCheckpointPassed` prevents double-triggers
- **Terrain-aware barrels:** each barrel samples terrain height at its own world position, converting height diff to a local Y offset

---

### 9. Audio System
Three cooperating classes:
- **`AudioManager`** — music and global SFX (loaded on first user interaction)
- **`EngineAudio`** — engine sound with RPM-to-pitch mapping
- **`TruckAudioController`** — per-truck wrapper: engine, collision impact, pickup sounds

---

### 10. Track Editor System
In-game track editor for creating and modifying track features visually.

**Architecture:**
- `src/editor/EditorController.js` — main coordinator: input (WASD, Delete, Ctrl+Z/Y), pointer picking, undo/redo stack, delegates to sub-editors
- One sub-editor per entity type in `src/editor/`
- Vue 3 panels in `src/vue/editor/` — self-gate on `store.selectedType`
- Pinia store (`src/vue/store.js`) — reactive bridge between panels and editor tools

**Text input focus:**
`EditorController.handleKeyDown` bails early when `event.target` is an `<input>` or `<textarea>` — typing in fields never triggers WASD/Delete/undo.

**Vue Reactivity Pattern:**
Each tool has a `_syncStoreToFeature(feature, selectedIdx)` that updates **individual** store properties — NOT replacing the whole reactive object:
```js
// CORRECT ✓
store.polyHill.height = feature.height;
store.polyHill.width = feature.width;

// WRONG ✗ — breaks reactivity
store.polyHill = { height: feature.height, width: feature.width };
```

**Property Update Flow:**
1. User drags slider in Vue panel
2. Store action updates reactive property: `polyHill.height = val`
3. Store action calls bridge method: `_bridge.value?.changePolyHillHeight(val)`
4. Bridge calls tool method: `this.polyHillTool.setHeight(val)`
5. Tool updates feature and rebuilds visual: `this._rebuildHill(feature)`

Rebuild methods must be called **immediately** (not deferred) for real-time slider feedback.

---

### 11. Flag System
**Feature format:** `{ "type": "flag", "x": 10, "z": 20, "color": "red" }`

**Runtime:** `FlagManager` + `Flag` — spring-damper bend physics (`SPRING_K = 26`, `DAMPING = 1.5`, `MAX_BEND ≈ 50°`). Pivot at base. Bend impulse proportional to truck speed.

**Editor:** `FlagEditor` owns placement/mutation directly.

---

### 12. Camera (`managers/CameraController.js`)
- Fixed isometric offset: `(0, 28, -20)`
- Lerp follows truck (factor 0.08)
- Zoom: `-` / `=` keys, range 0.5×–2.0×

---

## Coordinate System
- Origin at track centre; **+X = East, +Z = North, +Y = Up**
- `heading`: 0 = facing +Z (north), π/2 = facing +X (east)
- Steering: `heading -= turnSpeed` turns left, `+= turnSpeed` turns right

---

## Key Game Loop Flow

1. `Controls.updateBoost(deltaTime)` — decrement boost timer
2. `TerrainPhysics.update()` → `{ groundedness, penetration }` (via `TerrainQuery`)
3. Terrain modifiers gated on `penetration > -0.3`
4. `Controls.updateSteering()` / `updateAcceleration()`
5. `DriftPhysics.applyDrag()` / `applyGripAndDrift()`
6. Position update — X/Z from velocity, Y from `TerrainPhysics`
7. `DriftPhysics.updateRoll()` — visual lean
8. `ParticleEffects.update()` — drift, splash, nitro
9. `CheckpointManager` — gate detection, lap logic
10. `CameraController` — lerp camera

---

## Controls
| Key | Action |
|-----|--------|
| W / ↑ | Forward |
| S / ↓ | Back / Brake |
| A / ← | Turn Left |
| D / → | Turn Right |
| Space | Nitro boost |
| - | Zoom out |
| = | Zoom in |

---

## Common Gotchas

**Terrain modifiers applying in the air:**
Use `penetration > -0.3` (direct geometry), NOT `groundedness > 0` (lerped, never fully zeros).

**Particles following the truck when they shouldn't:**
Setting `emitter = this.mesh` makes already-emitted particles move with the mesh. Use a fixed `Vector3` emitter for world-space effects (e.g. nitro burst).

**AI steering inverted when reversing:**
Physics inverts steering when `fwdSpeed < 0`. AI must check actual `fwdSpeed`, not its own `shouldReverse` intent.

**A* routing backward through a checkpoint:**
If A* starts from the truck's position AT the checkpoint, it routes to the approach side of the next one — backward. Fix: use the exit point (10u ahead) as the A* start.

**NaN vertex positions crashing Havok:**
Missing required JSON fields (e.g. `depth`, `transition`) make height calculations return `NaN`, poisoning mesh vertices. Always add defensive `?? fallback` values.

**Terrain texture/physics misalignment:**
Both must sample at cell centers with `+ 0.5` offset. Ground mesh and grid must both be 160×160.

**Editor UI not updating during slider drag:**
Update individual reactive store properties — never replace the whole reactive object (see §Vue Reactivity Pattern above).

**Radius changes not applying immediately:**
Property setters in editor tools should call `_rebuildHill(feature)` (or equivalent) immediately, not `_rebuildDeferred`.

**TerrainQuery returning wrong surface when layers overlap:**
Feed the `_lastResolvedSurface` continuity hint back each frame so the query prefers to stay on the current surface when raycasts are ambiguous between bridge deck and ground below.

---

## Adding New Features

### New terrain type
1. Add to `TERRAIN_TYPES` in `terrain.js` with `gripMultiplier`, `dragMultiplier`, `color`
2. Add to `DRIFT_COLORS` in `ParticleEffects.js` for correct drift smoke color
3. Use via `addTerrainRect()` or `addTerrainCircle()` in a track definition

### New track feature
1. Add `add___()` method to `Track` class (push to `this.features`)
2. Add `case` to `getHeightAt()` for elevation
3. Add `case` to `getTerrainTypeAt()` for terrain type override
4. Add rendering in `SceneBuilder.js`
5. Add `XxxEditor.js` in `src/editor/`, `XxxManager.js` in `src/managers/`, `XxxPanel.vue` in `src/vue/editor/`
6. Wire into `EditorController` (activate/deactivate, `_applySnapshot`, pointer pick, `deselectAll`, bridge methods)
7. Add to `store.js`, `AppShell.vue`, `AddEntityMenu.vue`

### New track (JSON)
Place a `.json` file in `public/tracks/` with `name` and `features[]`. Feature objects mirror the parameters of the corresponding `add___()` method.

### New vehicle
Place assets and config in `vehicles/`. `VehicleLoader.js` discovers vehicles from that directory.

---

## Build & Deployment
- **Dev:** `npm run dev` — Vite HMR dev server
- **Build:** `npm run build` — Vite bundle then `build:optimize` script (WAV→OGG, PNG recompression, WEBP conversion, asset URL rewriting)
- **Deploy:** GitHub Pages via `.github/workflows/deploy-pages.yml`; `VITE_BASE_PATH` auto-configured for user/project sites
