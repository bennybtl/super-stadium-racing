# Offroad Racing Game - Agent Documentation

## Project Overview
This is an isometric offroad racing game built with Babylon.js and Havok Physics. It features arcade-style truck physics, terrain effects, checkpoints, and lap tracking. The game is inspired by classic games like Super Off-Road.

## Technology Stack
- **Babylon.js** - 3D rendering engine
- **Havok Physics** - Physics simulation
- **Vite** - Build tool and dev server
- **Vanilla JavaScript** - No framework, ES modules

## File Structure

```
offroad/
├── index.html           # Main HTML file with canvas and UI elements
├── package.json         # Dependencies and scripts
├── vite.config.js       # Vite configuration
└── src/
    ├── main.js          # Scene setup, game loop, checkpoint system
    ├── truck.js         # Truck creation and physics (vertical + horizontal)
    ├── track.js         # Track system with terrain features and checkpoints
    └── terrain.js       # Terrain grid system with different surface types
```

## Core Systems

### 1. Track System (`track.js`)
Defines terrain layouts using composable features:

**Feature Types:**
- `ridgeEW/ridgeNS` - Hills running east-west or north-south
- `hill` - Circular hills with radius and height
- `slopedRect` - Rectangular areas that slope along X or Z axis
- `terrainRect/terrainCircle` - Areas with specific terrain types (mud, water, etc.)
- `checkpoint` - Racing gates with optional numbering for ordered sequences

**Key Methods:**
- `getHeightAt(x, z)` - Returns terrain height at world position
- `getTerrainTypeAt(x, z)` - Returns terrain type at world position
- `addCheckpoint(centerX, centerZ, heading, width, checkpointNumber)` - Add checkpoint gate

**Example Tracks:**
Located in `EXAMPLE_TRACKS` object with pre-built track configurations.

### 2. Terrain System (`terrain.js`)
Grid-based terrain management that applies physics modifiers:

**Terrain Types:**
- `ASPHALT` - Best grip (3.5x), low drag
- `PACKED_DIRT` - Default baseline (2.0x grip)
- `LOOSE_DIRT` - Slides more (0.5x grip)
- `MUD` - Very slippery (0.15x grip), high drag (2.9x)
- `WATER` - Low grip (0.3x), very high drag (8.0x)

**Grid System:**
- Default: 160x160 world units, 2x2 cell size = 80x80 grid
- Cells are sampled at their centers: `(col - cellsPerSide/2 + 0.5) * cellSize`
- `getTerrainAt(position)` uses `Math.round()` to find nearest cell center

**Important:** Terrain grid size must match ground mesh size (both 160x160).

### 3. Truck Physics (`truck.js`)
Two-part physics system:

**Vertical Physics:**
- Spring-based terrain collision (springStrength: 150, damping: 7)
- Suspension compression tracking for visual effects
- Groundedness calculation based on suspension state

**Horizontal Physics:**
- Arcade-style drift mechanics with slip angle calculation
- Speed-based understeer (turn rate decreases at high speed)
- Grip system: velocity lerps toward heading direction
- Terrain modifiers apply to grip and drag
- Separate handling for forward/reverse movement
- Particle effects for drifting and water splashing

**Key State:**
- `heading` - Direction truck is facing (radians)
- `velocity` - Actual movement vector (can diverge from heading = drift)
- `slipAngle` - Angle between heading and velocity
- `grip` - How fast velocity aligns to heading (modified by terrain)

### 4. Checkpoint System (`main.js`)
Racing checkpoint system with lap tracking:

**Visual Elements:**
- Two orange barrel cylinders marking the gate
- Yellow arrow indicating correct direction
- Numbered billboard (if checkpoint has a number)
- Turns green when passed

**Detection Logic:**
- Checks perpendicular distance to gate line (within width/2)
- Checks forward distance along heading (within 2 units)
- Requires velocity in correct direction (dot product > 0)
- Prevents same checkpoint triggering twice consecutively
- If numbered: enforces sequential order (must pass 1, then 2, then 3, etc.)

**Lap Completion:**
- When all checkpoints passed, lap counter increments
- All checkpoints reset for next lap
- Checkpoint counter resets to 0

### 5. Camera System (`main.js`)
- Fixed isometric offset from truck: `(0, 28, -20)`
- Smoothly follows truck position with lerp (0.08 factor)
- Zoom controls: `-` to zoom out (2x max), `=` to zoom in (0.5x min)
- Zoom scales the base offset while maintaining angle

## Coordinate Systems

### World Space
- Origin at center of track
- +X = East, +Z = North, +Y = Up
- Heading: 0 = facing +Z (north), π/2 = facing +X (east)

### Terrain Grid
- Cells are indexed by `row * cellsPerSide + col`
- Cell centers calculated as: `(index - cellsPerSide/2 + 0.5) * cellSize`
- Sampling and collision detection both use cell centers (important for alignment!)

### Texture Coordinates
- Ground texture is flipped in both X and Z to match world orientation
- Dynamic texture drawn per-cell based on terrain grid

## Key Game Loop Flow

1. **Physics Update** (`updateTruck`)
   - Vertical physics (gravity, spring, suspension)
   - Get terrain at truck position → modifiers
   - Horizontal physics (steering, acceleration, grip, drag)
   - Particle system updates (drift smoke, water splash)

2. **Checkpoint Detection**
   - For each checkpoint mesh
   - Check if next in sequence (if numbered)
   - Check spatial conditions (width, distance, direction)
   - Mark passed, increment counter, visual feedback

3. **Lap Completion Check**
   - If checkpointCount == total, increment lap
   - Reset all checkpoints and counter

4. **Camera Update**
   - Lerp camera to truck position + offset
   - Apply zoom scaling

5. **Debug Panel Update**
   - Display suspension, speed, grip, terrain, coordinates

## Important Implementation Details

### Terrain Texture Alignment
The visual terrain texture and physics terrain grid must use identical sampling:
- Both sample at cell centers: `(col - cellsPerSide/2 + 0.5) * cellSize`
- `getTerrainAt()` rounds to nearest cell: `Math.round((pos + halfGrid)/cellSize - 0.5)`
- Ground mesh and terrain grid must be same size (160x160)

### Checkpoint Sequential Ordering
- `checkpointNumber` parameter is optional (null = any order)
- Numbered checkpoints enforce `expectedNumber = checkpointCount + 1`
- `lastCheckpointPassed` index prevents duplicate triggers
- Resets to -1 on lap completion

### Particle Systems
- Drift particles: emit rate based on slip angle and speed
- Water splash particles: emit when in water terrain with speed > 1
- Both use cloud/flare textures from Babylon.js assets

## Controls
- **W/↑** - Forward
- **S/↓** - Back/Brake
- **A/←** - Turn Left
- **D/→** - Turn Right
- **-** (minus) - Zoom Out
- **=** (equals) - Zoom In

## Debug Panel Elements
Located in top-left, shows real-time physics data:
- Compression, Groundedness, Penetration (suspension)
- Vertical Velocity, Horizontal Speed
- Effective Grip, Slip Angle
- Terrain Multiplier
- X, Y, Z coordinates

## UI Elements
- **Checkpoint Counter** (top-right, yellow) - Current checkpoint progress
- **Lap Counter** (top-right, cyan) - Completed laps
- **Debug Panel** (top-left, green) - Physics debugging info

## Adding New Features

### Adding a New Terrain Type
1. Add to `TERRAIN_TYPES` in `terrain.js` with grip/drag multipliers and color
2. Use in track features via `addTerrainRect()` or `addTerrainCircle()`

### Adding a New Track
1. Add to `EXAMPLE_TRACKS` in `track.js`
2. Chain feature methods: `.addHill(...).addCheckpoint(...)`
3. Update `main.js` to use: `EXAMPLE_TRACKS.yourTrack()`

### Adding a New Track Feature
1. Add feature type to `Track` class with `add___()` method
2. Implement in `getHeightAt()` for elevation changes
3. Implement in `getTerrainTypeAt()` if it affects terrain type

## Common Issues

**Texture/Physics Misalignment:**
- Ensure terrain grid size matches ground mesh size
- Both must sample at cell centers with `+ 0.5` offset
- `getTerrainAt()` must use `Math.round()` with `-0.5` correction

**Checkpoint Triggering Multiple Times:**
- Use `lastCheckpointPassed` index to prevent consecutive triggers
- Check velocity direction (dot product with heading > 0)

**Lap Not Completing:**
- Verify all checkpoints in sequence are being passed
- Check `checkpointCount === totalCheckpoints` condition
- Ensure checkpoint reset happens after lap increment
