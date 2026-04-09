# Offroad Racing Game - Agent Documentation

## Project Overview
An isometric offroad racing game built with Babylon.js and Havok Physics. Features arcade-style truck physics, terrain effects, AI drivers, checkpoints, lap tracking, a track editor, and a menu system. Inspired by classic games like Super Off-Road.

## Technology Stack
- **Babylon.js** - 3D rendering engine
- **Havok Physics** - Physics simulation (MESH shape for ground, BOX for walls/tires)
- **Vue 3 + Pinia** - Reactive UI layer (menus, editor panels, HUD)
- **Vite** - Build tool and dev server
- **ES Modules** - Vanilla JS everywhere except the Vue component layer

## File Structure

```
offroad/
├── index.html
├── package.json
├── vite.config.js
├── tracks/                        # JSON track definitions
│   ├── Fandango.json
│   ├── HuevosGrande.json
│   ├── hills.json
│   └── mudPit.json
└── src/
    ├── main.js                    # Scene setup, game loop, scene orchestration
    ├── terrain.js                 # Terrain grid, types, physics modifiers
    ├── track.js                   # Track feature definitions + height/terrain queries
    ├── truck.js                   # Legacy factory shim (createTruck / updateTruck)
    ├── ai/
    │   └── AIDriver.js            # A* pathfinding, skill config, stuck detection, respawn
    ├── assets/
    │   └── offroad-truck-v3.obj   # OBJ body mesh (loaded async; box fallback if missing)
    ├── editor/                    # Editor sub-system (one file per entity type)
    │   ├── CheckpointEditor.js
    │   ├── EditorController.js    # Main editor coordinator
    │   ├── FlagEditor.js
    │   ├── HillEditor.js
    │   ├── NormalMapDecalEditor.js
    │   ├── SquareHillEditor.js
    │   ├── TerrainShapeEditor.js
    │   ├── TireStackEditor.js
    │   └── TrackSignEditor.js
    ├── managers/
    │   ├── BezierWallTool.js      # Editor: bezier curve walls
    │   ├── CameraController.js    # Isometric camera + zoom
    │   ├── CheckpointManager.js   # Gate detection, lap counting
    │   ├── FlagManager.js         # Game-mode flag rendering + truck collision
    │   ├── GameState.js           # Race state machine
    │   ├── InputManager.js        # Keyboard input
    │   ├── MenuManager.js         # Main menu UI
    │   ├── TrackLoader.js         # JSON track loading
    │   ├── TrackSignManager.js    # Game-mode track sign rendering
    │   ├── TireStackManager.js    # Movable tire obstacles
    │   ├── UIManager.js           # HUD elements
    │   └── WallManager.js         # Wall/barrier physics meshes
    ├── modes/
    │   ├── BaseMode.js
    │   ├── EditorMode.js
    │   ├── MenuMode.js
    │   ├── ModeController.js
    │   ├── PracticeMode.js
    │   ├── RaceMode.js
    │   ├── SceneBuilder.js        # Shared scene construction (ground, lights, managers)
    │   └── TestMode.js
    ├── objects/
    │   ├── BezierWall.js          # Bezier curve wall mesh
    │   ├── Checkpoint.js          # Checkpoint gate mesh (terrain-aware barrel heights)
    │   ├── Flag.js                # Decorative flag with spring-damper bend physics
    │   ├── PolyHill.js            # Polyline hill visual mesh
    │   ├── PolyWall.js            # Polyline wall mesh
    │   ├── TireStack.js           # Tire stack physics object
    │   ├── TrackSign.js           # Track name sign with DynamicTexture
    │   └── WallSegment.js         # Single wall segment
    ├── vue/                       # Vue 3 UI components
    │   ├── AppShell.vue           # Main app container — mounts all panels
    │   ├── DebugPanel.vue         # Debug info overlay
    │   ├── MenuOverlay.vue        # Main menu
    │   ├── RaceHUD.vue            # Race status display
    │   ├── main.js                # Vue app bootstrap
    │   ├── store.js               # Pinia state store (menu, race, debug, editor stores)
    │   └── editor/                # Editor UI panels (one per entity type)
    │       ├── AddEntityMenu.vue
    │       ├── BezierWallPanel.vue
    │       ├── CheckpointPanel.vue
    │       ├── EditorPanel.vue     # Draggable panel base component
    │       ├── EditorStatusBar.vue
    │       ├── FlagPanel.vue
    │       ├── HillPanel.vue
    │       ├── NormalMapDecalPanel.vue
    │       ├── PolyHillPanel.vue
    │       ├── PolyWallPanel.vue
    │       ├── SquareHillPanel.vue
    │       ├── TerrainCirclePanel.vue
    │       ├── TerrainShapePanel.vue
    │       ├── TerrainRectPanel.vue
    │       └── TrackSignPanel.vue
    └── truck/
        ├── index.js               # Re-exports Truck class
        ├── truck.js               # Truck class — coordinates all subsystems
        ├── Controls.js            # Steering, acceleration, boost logic
        ├── DriftPhysics.js        # Grip, slip angle, drag
        ├── ParticleEffects.js     # Drift smoke, water splash, nitro burst
        ├── TerrainPhysics.js      # Gravity, suspension spring, slope orientation, downhill tracking
        └── TruckBody.js           # Visual puppet: OBJ body + procedural wheels
```

## Core Systems

### 1. Track System (`track.js`)
Defines terrain layouts using composable features stored in a `features[]` array.
Tracks can be built programmatically or loaded from JSON files in `tracks/`.

**Feature Types:**
- `ridgeEW` / `ridgeNS` — hills running east-west or north-south
- `hill` — circular Gaussian hill with radius and height
- `squareHill` — flat-topped rectangle with cosine transition skirt; `height` can be negative for pits
- `slopedRect` — rectangle that slopes along X or Z axis; supports optional `transition` cosine falloff band
- `polyHill` — triangular-profile hill extruded along a polyline with optional rounded corners
- `terrainRect` / `terrainCircle` — areas with specific terrain types (mud, water, etc.)
- `checkpoint` — racing gate with optional sequential numbering
- `wall` — straight immovable wall, terrain-following via segments
- `curvedWall` — arc of box segments approximating a curve
- `polyWall` — wall defined by an array of `{x, z}` points
- `tireStack` — movable stack of 3 tires at a world position
- `flag` — decorative flag on a flexible pole; bends/springs back when hit by trucks
- `trackSign` — a track name sign (black board, red bold italic text) on a post

**Key Methods:**
- `getHeightAt(x, z)` — additive sum of all elevation features at a world point
- `getTerrainTypeAt(x, z)` — returns the terrain type of the topmost matching feature

**`squareHill` math:**
```
edgeDx = max(0, |lx| - halfWidth)
edgeDz = max(0, |lz| - halfDepth)
dist = sqrt(edgeDx² + edgeDz²)      // distance to nearest rectangle edge
t = clamp(dist / transition, 0, 1)
height contribution = feature.height * (cos(t * π) + 1) / 2
```
This correctly handles corners without diagonal artifacts.

**`slopedRect` with `transition`:**
Outside the rectangle, the nearest-edge height is sampled and blended with a cosine falloff so there is no hard cliff at the boundary.

**`polyHill` math:**
Creates a raised terrain feature along a polyline path with a triangular cross-section profile.
- Points: array of `{x, z, radius}` control points
- `height` — peak elevation at the centerline
- `width` — base width of the triangular profile (full width, not half)
- `closed` — whether the polyline forms a closed loop
- Each point's `radius` parameter (0-10) creates smooth rounded corners using circular arcs

Height calculation:
1. Expand control points into a smooth path using `_expandPolylineForHill()` which inserts arc segments at corners based on each point's radius value
2. Find minimum distance from query point to any segment of the expanded polyline
3. If distance < `width/2`: apply triangular falloff
   ```
   linearFalloff = 1 - (minDist / halfWidth)
   height contribution = feature.height * linearFalloff
   ```
   This creates a ridge that comes to a point at the centerline and drops to 0 at the edges.

**Adding a New Track Feature:**
1. Add `add___()` method to `Track` class with a feature object pushed to `this.features`
2. Add a `case` to `getHeightAt()` if it changes elevation
3. Add a `case` to `getTerrainTypeAt()` if it changes terrain type

### 2. Terrain System (`terrain.js`)
Grid-based terrain management that applies physics and visual modifiers.

**Terrain Types (built-in):**
| Name | Grip Mult | Drag Mult |
|------|-----------|-----------|
| `ASPHALT` | 3.5× | 1.0× |
| `PACKED_DIRT` | 2.0× | 1.0× |
| `LOOSE_DIRT` | 0.5× | 1.2× |
| `MUD` | 0.15× | 2.9× |
| `WATER` | 0.3× | 6.0× |

**Grid System:**
- 160×160 world units, 2×2 cell size → 80×80 grid cells
- Cell centers: `(col - cellsPerSide/2 + 0.5) * cellSize`
- `getTerrainAt(position)` snaps to nearest cell center with `Math.round()`

**Important:** The terrain grid size and ground mesh size must both be 160×160.

**Visual Texture:**
- `DynamicTexture` drawn per-cell from terrain color
- Per-pixel brightness noise (±9 units) applied on top for a matte dirt look
- Ground material: `specularColor = (0,0,0)`, `specularPower = 0` (no shine)

### 3. Truck Physics (modular, in `src/truck/`)
The `Truck` class in `truck/truck.js` coordinates four physics subsystems:

**`TerrainPhysics.js`** — vertical physics
- Spring-based terrain collision: `springStrength: 150`, `damping: 7`
- Returns `{ groundedness, penetration }` each frame
- `penetration` is direct geometry (not lerped) — use `penetration > -0.3` to gate terrain effects
- **Downhill tracking** — a `DOWNHILL` config object at the top of the file holds all tuning knobs for two passes that keep the truck grounded on descents:
  - **Pass 1** (`followMaxGap`, `followHeightDrop`, `followFakeCompression`, …) — injects fake suspension compression when the truck is slightly airborne but clearly following a downward slope
  - **Pass 2** (`boostMaxGap`, `boostHeightDrop`, `boostGroundedness`, …) — clamps `groundedness` to a minimum value so the truck retains steering grip through the descent

**`DriftPhysics.js`** — horizontal traction
- `applyGripAndDrift(speed, forward, groundedness)`: early-returns when `groundedness <= 0` (no air correction)
- `applyDrag(speed, input, deltaTime, terrainDragMultiplier, groundedness)`: uses `coastingMultiplier = 0.02` and `drag = 1.0` when airborne

**`Controls.js`** — steering and acceleration
- Steering inverts when `fwdSpeed < 0` (reversing) so the truck turns naturally in both directions
- Boost: `boostActive`, `boostTimer`, `boostCount` (max 5), `boostDuration: 3.0s`, `boostAccelMult: 2.5×`, `boostSpeedMult: 1.8×`

**`TruckBody.js`** — visual puppet
- Loads `offroad-truck-v3.obj` asynchronously via `SceneLoader.ImportMeshAsync`; falls back to a box mesh if loading fails
- Uses two `TransformNode` roots parented to the physics box:
  - `_visualRoot` — body/chassis gets **partial** terrain correction (allows suspension bounce)
  - `_wheelRoot` — wheels get **full** terrain correction (always stay above ground surface)
- Animates steering angle, suspension compression, roll

**Key State (on `truck.state`):**
- `heading` — direction truck faces (radians); 0 = +Z north
- `velocity` — world-space movement vector (can diverge from heading = drift)
- `slipAngle` — angle between heading and velocity direction
- `boostActive` / `boostTimer` / `boostCount`

**Airborne terrain gating** (`truck/truck.js`):
```js
const isGrounded = penetration > -0.3;
if (terrainManager && isGrounded) { /* apply terrain modifiers */ }
```

### 4. Particle Effects (`truck/ParticleEffects.js`)
Three independent `ParticleSystem` instances managed per-truck:

**Drift smoke** (`driftParticles`)
- Emitter attached to truck mesh (moves with truck)
- `emitRate = driftIntensity * 300`; zero when speed < 0.5
- Color adapts to terrain via `DRIFT_COLORS` map — system is recreated via `setDriftColor()` only when terrain name changes

**`DRIFT_COLORS` presets:**
| Terrain | Color |
|---------|-------|
| `default` / `packed_dirt` | Dusty brown |
| `loose_dirt` | Lighter tan |
| `mud` | Dark brown |
| `asphalt` | Grey |
| `water` | Blue-white |

**Water splash** (`splashParticles`)
- `emitRate = speed * 80` when `isInWater && isGrounded && speed > 1`
- Gated by `isGrounded` (penetration-based) so no splash while flying over water

**Nitro burst** (`nitroParticles`)
- Fires once on the rising edge of `state.boostActive` (rising-edge detection via `_wasBoostActive`)
- Emitter is a **fixed world-space `Vector3`** snapped to truck's rear at fire time — particles stay on track and don't follow the truck
- Direction vectors are rotated into world space from `state.heading` at fire time
- Active for 0.35 seconds then `emitRate` drops to 0
- White → grey with `gravity = (0, 1.5, 0)` for rising smoke effect

### 5. AI Driver (`ai/AIDriver.js`)
Autonomous driver using A* pathfinding on a 160×160 / 2-unit-resolution grid.

**Skill Config:**
`AIDriver` accepts an optional `skillConfig` object as its fifth constructor argument:
```js
new AIDriver(track, checkpointManager, wallManager, scene, {
  lookAheadDistance: 20,   // Good: 20  OK: 15  Bad: 12
  maxSpeed:          0.8,  // Good: 0.8 OK: 0.65 Bad: 0.5
  steeringPrecision: 1.0,  // Good: 1.0 OK: 0.85 Bad: 0.7
});
```
Defaults produce a "good" AI. Reduce values to create slower/sloppier opponents.

**Pathfinding:**
- Grid cells are marked blocked if they overlap any wall segment (with 2-unit safety margin)
- A* uses 8-directional movement (diagonal cost = 1.414)
- On checkpoint pass: exit point (10 units ahead along gate heading) is used as the A* start position, then 4 blend waypoints are prepended for a smooth curve through the gate

**Steering:**
- `getInput(position, heading, fwdSpeed)` — `fwdSpeed` is actual velocity dot forward
- Left/right are flipped when `fwdSpeed < -0.3` to compensate for physics reversing the steering effect

**Stuck detection (two independent systems):**
1. **No-throttle timer** — if coasting/reversing for 3+ seconds → respawn
2. **Position timer** — samples position every 1s; if moved < 1 unit in 3s → respawn

**Respawn (`_findClearPosition`):**
1. Walk back along path — first unblocked waypoint within 30 units
2. Radial sweep — 16 directions, 2–12 unit radius
3. Last resort — stay put

### 6. Checkpoint System (`managers/CheckpointManager.js`)
- Gate detection: perpendicular distance < `width/2`, forward distance < 2 units, velocity dot forward > 0
- Numbered checkpoints enforce sequential order
- `lastCheckpointPassed` index prevents double-triggers
- On lap complete: all checkpoints reset, lap counter increments
- **Terrain-aware barrels:** each barrel samples terrain height at its own world position (derived from `feature.centerX/Z` + heading offset × `halfWidth`), converting the height difference to a local Y offset so barrels sit correctly on sloped ground

### 7. Camera (`managers/CameraController.js`)
- Fixed isometric offset from truck: `(0, 28, -20)`
- Lerp follows truck position (factor 0.08)
- Zoom: `-` / `=` keys, scales offset in range 0.5×–2.0×

### 8. Track Editor System
In-game track editor for creating and modifying track features visually.

**Architecture:**
- `src/editor/EditorController.js` — main coordinator; handles input (WASD, Delete, Ctrl+Z/Y), pointer picking, undo/redo stack, and delegates everything else to sub-editors
- One sub-editor per entity type in `src/editor/`: `CheckpointEditor`, `HillEditor`, `SquareHillEditor`, `TerrainShapeEditor`, `NormalMapDecalEditor`, `TireStackEditor`, `FlagEditor`, `TrackSignEditor`, `MeshGridTool`, `PolyHillTool`, `PolyWallTool`, `BezierWallTool`
- Vue 3 components in `src/vue/editor/` — UI panels, all self-gate on `store.selectedType`
- Pinia store (`src/vue/store.js`) — reactive state bridge between panels and editor tools

**Text input focus:**
`EditorController.handleKeyDown` bails early when `event.target` is an `<input>` or `<textarea>`, so typing in fields (e.g. TrackSignPanel name input) never triggers WASD/Delete/undo hotkeys.

**Editor Tools:**
- **PolyHillTool** — polyline hills with control points, radius (rounded corners), height, width
- **PolyWallTool** — polyline walls with control points, radius, height, thickness
- **BezierWallTool** — bezier curve walls with anchor/handle manipulation
- **MeshGridTool** — terrain deformation via grid control points

**Control Point Manipulation:**
- Click to select control points (shown as colored spheres)
- WASD keys move selected point
- Drag with mouse to reposition
- Insert/delete points via UI panel buttons
- Per-point radius for rounded corners (where applicable)

**Vue Reactivity Pattern:**
Each tool has a `_syncStoreToFeature(feature, selectedIdx)` method that updates individual store properties (NOT replacing the entire reactive object):
```js
store.polyHill.height = feature.height ?? 3;
store.polyHill.width = feature.width ?? 5;
// etc.
```
This preserves Vue 3's reactivity tracking. Replacing the whole object (`store.polyHill = {...}`) breaks reactivity!

**Property Update Flow:**
1. User drags slider in Vue panel
2. Store action updates reactive property: `polyHill.height = val`
3. Store action calls bridge method: `_bridge.value?.changePolyHillHeight(val)`
4. Bridge calls tool method: `this.polyHillTool.setHeight(val)`
5. Tool updates feature and rebuilds visual/terrain: `this._rebuildHill(feature)`

**Important:** Rebuild methods should be called immediately (not deferred) when triggered by UI sliders to ensure real-time visual feedback.

### 9. Flag System

**Feature format:**
```json
{ "type": "flag", "x": 10, "z": 20, "color": "red" }
```
Colors: `"red"` | `"blue"`.

**Runtime (game/practice mode — `FlagManager` + `Flag`):**
- `FlagManager.createFlag(feature)` creates a `Flag` instance per feature
- `FlagManager.update(trucks, dt)` is called each frame; detects truck collisions and advances the spring-damper bend simulation
- `Flag` physics: spring-damper on X and Z axes (`SPRING_K = 26`, `DAMPING = 1.5`, `MAX_BEND ≈ 50°`). The pole pivots at its base — `setPivotPoint` at the bottom. Bend impulse is proportional to truck approach speed.

**Editor (`FlagEditor`):**
- `FlagEditor` owns flag meshes, selection state, and all placement/mutation logic directly
- Flags are added at the camera look-ahead position; WASD moves the selected flag

### 10. Track Sign System

**Feature format:**
```json
{ "type": "trackSign", "x": 0, "z": -30, "name": "Track Name", "rotation": 0 }
```
`rotation` is in radians (stored); the editor panel displays/accepts degrees.

**Object (`TrackSign`):**
- Grey post (`height: 2.5`, `diam: 0.25`) + black box board (`10 × 3 × 0.2` world units)
- Board uses a `DynamicTexture` (512 × 128 px): black fill, red border, red bold italic text
- Font auto-shrinks if the text overflows the texture width
- `setName(text)` redraws the texture; `setRotation(radians)` rotates the board; `moveTo(x, z, groundY)` repositions both post and board
- `backFaceCulling = false` + emissive texture → readable from both sides and in shadows

**Runtime:** `TrackSignManager.createSign(feature)` — purely decorative, no game interaction.

**Editor:** `TrackSignEditor` follows the same pattern as other sub-editors. The `TrackSignPanel.vue` has a styled text `<input>` (red bold italic) and a rotation slider.

## Coordinate System
- Origin at track centre; +X = East, +Z = North, +Y = Up
- `heading`: 0 = facing +Z (north), π/2 = facing +X (east)
- Steering: `heading -= turnSpeed` turns left, `+= turnSpeed` turns right

## Key Game Loop Flow

1. **`Controls.updateBoost(deltaTime)`** — decrement boost timer
2. **`TerrainPhysics.update()`** → returns `{ groundedness, penetration }`
3. **Terrain modifiers** — gated on `penetration > -0.3`
4. **`Controls.updateSteering()` / `updateAcceleration()`**
5. **`DriftPhysics.applyDrag()` / `applyGripAndDrift()`**
6. **Position update** — X/Z from velocity, Y from `TerrainPhysics`
7. **`DriftPhysics.updateRoll()`** — visual lean
8. **`ParticleEffects.update()`** — drift, splash, nitro
9. **`CheckpointManager`** — gate detection, lap logic
10. **`CameraController`** — lerp camera

## Controls
| Key | Action |
|-----|--------|
| W / ↑ | Forward |
| S / ↓ | Back / Brake |
| A / ← | Turn Left |
| D / → | Turn Right |
| Space | Nitro boost |
| - | Zoom Out |
| = | Zoom In |

## Common Gotchas

**Terrain modifiers applying in the air:**
Use `penetration > -0.3` (direct geometry), not `groundedness > 0` (lerp-based, never fully zeros).

**Particles following the truck when they shouldn't:**
Setting `emitter = this.mesh` makes already-emitted particles move with the mesh. Use a fixed `Vector3` emitter for world-space effects (e.g. nitro burst).

**AI steering inverted when reversing:**
Physics inverts steering when `fwdSpeed < 0`. AI must check actual `fwdSpeed`, not its own `shouldReverse` intent.

**A* routing backward through a checkpoint:**
If A* starts from the truck's position AT the checkpoint, it routes to the approach side of the next one — backward. Fix: use the exit point (10u ahead) as the A* start.

**NaN vertex positions crashing Havok:**
If a track feature JSON is missing a required field (e.g. `depth`, `transition`), height calculations return `NaN`, poisoning the mesh vertices. Always add defensive `?? fallback` values.

**Terrain texture/physics misalignment:**
Both must sample at cell centers with `+ 0.5` offset. Ground mesh and grid must both be 160×160.

**Editor UI not updating during slider drag (Vue 3):**
When syncing from feature to store in editor tools, update individual reactive properties:
```js
// CORRECT ✓
store.polyHill.height = feature.height;
store.polyHill.width = feature.width;

// WRONG ✗ - breaks reactivity
store.polyHill = { height: feature.height, width: feature.width };
```
Replacing the entire reactive object loses Vue's proxy tracking.

**Radius changes not applying immediately:**
Editor tool property setters should call `_rebuildHill(feature)` or equivalent immediately, not use deferred rebuilds (`_rebuildDeferred`), to ensure real-time visual feedback when dragging sliders.

## Adding New Features

### New terrain type
1. Add to `TERRAIN_TYPES` in `terrain.js` with `gripMultiplier`, `dragMultiplier`, `color`
2. Add to `DRIFT_COLORS` in `ParticleEffects.js` for correct drift smoke color
3. Use via `addTerrainRect()` or `addTerrainCircle()` in a track definition

### New track feature
1. Add `add___()` method to `Track` class (push to `this.features`)
2. Add `case` to `getHeightAt()` for elevation
3. Add `case` to `getTerrainTypeAt()` for terrain type override
4. Add rendering in `SceneBuilder.js` (game/practice mode)
5. Add an `XxxEditor.js` in `src/editor/`, a `XxxManager.js` in `src/managers/`, an `XxxPanel.vue` in `src/vue/editor/`
6. Wire into `EditorController` (activate/deactivate, `_applySnapshot`, pointer pick, `deselectAll`, bridge methods)
7. Add to `store.js` (reactive state + actions)
8. Add to `AppShell.vue` and `AddEntityMenu.vue`

### New track (JSON)
Place a `.json` file in `tracks/` with a `name` and `features` array. Each feature object mirrors the parameters of the corresponding `add___()` method.
