# 3D Velocity Refactor Plan

## Problem

`state.velocity` is XZ-only and `state.verticalVelocity` is a separate spring-driven value.
These two systems don't know about each other, so a truck climbing a 39° slope is represented as:
- XZ: full 24.9 m/s horizontal
- Y: spring fighting to track the surface

...instead of a single velocity vector tilted at 39°. Every patch (bleed rate, liftoff correction, drag blending) is compensating for this mismatch. At a crest the slope flattens to 0°, vvel bleeds to ~0, and the truck launches nearly horizontally instead of carrying the 39° angle into the air.

## Solution

Merge `verticalVelocity` into `state.velocity` as a proper 3D vector. When grounded, project velocity onto the surface tangent plane after each physics step — this naturally gives the correct Y component for any slope, and at liftoff it's already right.

---

## Step-by-step

### 1. `truck.js` — Remove `verticalVelocity` from state
- Remove `verticalVelocity: 0` from `createState()`
- Change position integration from separate X/Z + TerrainPhysics Y to a single `mesh.position.addInPlace(state.velocity.scale(dt))`
- Remove `applyUphillGravity` call (replaced by 3D gravity + surface projection)
- Update debug return: `verticalVelocity: this.state.velocity.y`

### 2. `TerrainPhysics.js` — Core refactor
- Gravity acts on `state.velocity.y` instead of `state.verticalVelocity`
- Spring/damping same logic, same field (`state.velocity.y`)
- Remove the `mesh.position.y += verticalVelocity * dt` line (truck.js now does full 3D integration)
- **New**: After spring, when grounded — project velocity onto the surface tangent plane: strip the component pointing into the surface. This is what naturally gives correct slope vvel at any angle.
- Remove the vvel clamping/bleed block (problem solved by projection)
- Remove `applyUphillGravity` method and `UPHILL` constants (3D gravity + surface projection replaces it)
- Update `_updateSuspension` and `_updatePitch` to use `state.velocity.y`

### 3. `Controls.js` — Surface-tangent engine force
- `handleForwardInput`/`handleBackwardInput`: project the `forward` vector onto the surface tangent plane before applying acceleration impulse — engine force follows the slope, so climbing naturally costs XZ speed

### 4. `DriftPhysics.js` — Preserve velocity.y
- `applyGripAndDrift`: save `velocity.y` before XZ reconstruction, restore it after — grip only corrects lateral sliding, not vertical
- `applyDrag`: apply only to XZ, not Y — gravity handles vertical deceleration

### 5. `StaticBodyCollisionManager.js` — Unify velocity
- Replace the `vel.x * nx + verticalVelocity * ny + vel.z * nz` pattern with `state.velocity.dot(worldNormal)`
- Replace `verticalVelocity -= ny * velDot` with `state.velocity.y -= ny * velDot`

### 6. `AIDriver.js` — one-liner
- `state.verticalVelocity = 0` → `state.velocity.y = 0`

---

## Key insight

The surface projection in step 2 is what makes everything else fall out naturally:

```
// Strip the velocity component pointing into (or out of) the surface normal
const vIntoSurface = state.velocity.dot(normal);
if (vIntoSurface < 0) {  // only when moving into the surface
  state.velocity.x -= normal.x * vIntoSurface;
  state.velocity.y -= normal.y * vIntoSurface;
  state.velocity.z -= normal.z * vIntoSurface;
}
```

On a 39° slope: after projection, velocity.y = hSpeed × tan(39°) automatically.
On flat ground: velocity.y → 0 automatically.
At liftoff: no correction needed — the velocity is already correct.

---

## Status

- [x] Step 1 — `truck.js`
- [x] Step 2 — `TerrainPhysics.js`
- [x] Step 3 — `Controls.js`
- [x] Step 4 — `DriftPhysics.js`
- [x] Step 5 — `StaticBodyCollisionManager.js`
- [x] Step 6 — `AIDriver.js`
- [x] Step 7 — `BaseMode.js` + `RaceMode.js` (respawn resets)
