# Offroad Racing Game - Agent Documentation

## Project Overview
An isometric offroad racing game built with Babylon.js and Havok Physics. Features arcade-style truck physics, terrain effects, AI drivers, checkpoints, lap tracking, a track editor, and a menu system. Inspired by classic games like Super Off-Road.

## Technology Stack
- **Babylon.js** - 3D rendering engine
- **Havok Physics** - Physics simulation (MESH shape for ground, BOX for walls/tires)
- **Vite** - Build tool and dev server
- **Vanilla JavaScript** - No framework, ES modules

## File Structure

```
offroad/
├── index.html
├── package.json
├── vite.config.js
├── tracks/                        # JSON track definitions
│   ├── simple.json
│   ├── hills.json
│   ├── mudPit.json
│   ├── rollercoaster.json
│   ├── bankedTurn.json
│   └── crossroads.json
└── src/
    ├── main.js                    # Scene setup, game loop, scene orchestration
    ├── terrain.js                 # Terrain grid, types, physics modifiers
    ├── track.js                   # Track feature definitions + height/terrain queries
    ├── truck.js                   # Legacy factory shim (createTruck / updateTruck)
    ├── ai/
    │   └── AIDriver.js            # A* pathfinding, stuck detection, respawn
    ├── managers/
    │   ├── BarrierManager.js      # Track boundary barriers
    │   ├── CameraController.js    # Isometric camera + zoom
    │   ├── CheckpointManager.js   # Gate detection, lap counting
    │   ├── EditorController.js    # In-game track editor
    │   ├── GameState.js           # Race state machine
    │   ├── InputManager.js        # Keyboard input
    │   ├── MenuManager.js         # Main menu UI
    │   ├── TrackLoader.js         # JSON track loading
    │   ├── TireStackManager.js    # Movable tire obstacles
    │   ├── UIManager.js           # HUD elements
    │   └── WallManager.js         # Wall/barrier physics meshes
    └── truck/
        ├── index.js               # Re-exports Truck class
        ├── truck.js               # Truck class — coordinates all subsystems
        ├── Controls.js            # Steering, acceleration, boost logic
        ├── DriftPhysics.js        # Grip, slip angle, drag
        ├── EntityPhysics.js       # Havok body sync
        ├── ParticleEffects.js     # Drift smoke, water splash, nitro burst
        ├── TerrainPhysics.js      # Gravity, suspension spring, slope orientation
        └── TruckBody.js           # Visual puppet mesh (cabin, wheels, etc.)
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
- `terrainRect` / `terrainCircle` — areas with specific terrain types (mud, water, etc.)
- `checkpoint` — racing gate with optional sequential numbering
- `wall` — straight immovable wall, terrain-following via segments
- `curvedWall` — arc of box segments approximating a curve
- `polyWall` — wall defined by an array of `{x, z}` points
- `tireStack` — movable stack of 3 tires at a world position

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

**`DriftPhysics.js`** — horizontal traction
- `applyGripAndDrift(speed, forward, groundedness)`: early-returns when `groundedness <= 0` (no air correction)
- `applyDrag(speed, input, deltaTime, terrainDragMultiplier, groundedness)`: uses `coastingMultiplier = 0.02` and `drag = 1.0` when airborne

**`Controls.js`** — steering and acceleration
- Steering inverts when `fwdSpeed < 0` (reversing) so the truck turns naturally in both directions
- Boost: `boostActive`, `boostTimer`, `boostCount` (max 5), `boostDuration: 3.0s`, `boostAccelMult: 2.5×`, `boostSpeedMult: 1.8×`

**`TruckBody.js`** — visual puppet
- A separate visible mesh that rides on top of the invisible Havok physics box
- Animates cabin, wheels, suspension compression, roll

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

### 7. Camera (`managers/CameraController.js`)
- Fixed isometric offset from truck: `(0, 28, -20)`
- Lerp follows truck position (factor 0.08)
- Zoom: `-` / `=` keys, scales offset in range 0.5×–2.0×

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

## Adding New Features

### New terrain type
1. Add to `TERRAIN_TYPES` in `terrain.js` with `gripMultiplier`, `dragMultiplier`, `color`
2. Add to `DRIFT_COLORS` in `ParticleEffects.js` for correct drift smoke color
3. Use via `addTerrainRect()` or `addTerrainCircle()` in a track definition

### New track feature
1. Add `add___()` method to `Track` class (push to `this.features`)
2. Add `case` to `getHeightAt()` for elevation
3. Add `case` to `getTerrainTypeAt()` for terrain type override

### New track (JSON)
Place a `.json` file in `tracks/` with a `name` and `features` array. Each feature object mirrors the parameters of the corresponding `add___()` method.
