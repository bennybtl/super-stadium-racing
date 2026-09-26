# Terrain Tunnel Plan

Add a `tunnel` track feature: a drivable passage that goes *through* terrain
(a hill, a mesa), with portals at each end, and the hill above it staying
drivable and decorated as normal.

Status: **Phase 1 done** (Sept 26 2026): tunnels render and are editable;
not drivable yet, and the terrain still covers the mouths. Phase 2 is next.

## Why this is a new concept

Everything drivable today is at or above the heightfield: the ground is
`track.getHeightAt`, and bridges and drive boxes stack on top of it. A tunnel
is the first surface that sits *under* the ground, which breaks a few
assumptions:

- **"Ground height at (x, z)" stops being one number.** About 57 callers use
  `getHeightAt` and would get the hilltop instead of the tunnel floor. The ones
  that matter are respawn, checkpoint gates, AI path heights and wear baking.
- **The heightfield can't have a hole.** A portal is a vertical opening in a
  slope, but the ground is a single-valued mesh. The triangles running from the
  approach floor up the hill face would sit across the tunnel mouth.
- **The isometric camera can't see inside.** The hill hides the truck the
  moment it enters.
- **Lighting doesn't know about it.** The terrain doesn't cast shadows (see
  SceneBuilder: the ground receives but never casts) and the hemispheric
  ambient light is never blocked, so without extra work the inside of a tunnel
  is lit like open ground.
- **Terrain side systems.** `SteepSlopeColliderManager` would put blockers on
  the portal face, and the AI blocked grid is 2D only.

## Prerequisite: layered surface sampling (done)

Landed as the surface-layer refactor (plan A, Sept 2026): `TerrainQuery`
answers from `DriveSurfaceManager.layers` (`world/surface-layers.js`), with no
raycasts. `SurfaceLayers.sample(x, z, fromY)` takes the surface at or below
`fromY` (allowing a small penetration), with a limited upward fallback (at most
1 m) for a truck that has sunk into a slope.

A tunnel floor is then just another layer. Inside the tunnel the truck's
`fromY` is far below the hilltop, so the ground is out of reach and the floor
wins, with no special casing. On the hill above, the ground wins. This is the
same rule that already puts a truck on or under a bridge deck.

## Data model

```js
{
  type: 'tunnel',
  points: [{ x, z, radius?, floorY? }, ...], // open centreline; floorY pins the floor there
  width: 10,                  // inner width (m)
  height: 6,                  // clearance, floor to crown (m)
  cover: 2,                   // terrain wanted above the lining (editor warning)
  liningColor: '#6b6660',     // walls + arch + headwalls (no panel control yet)
  floorColor: '#7a6548',      // flat colour for now; terrain look later
}
```

**The author shapes the terrain.** There is no automatic trench: the author
builds the hill and the cuttings leading to each portal with the existing
terrain tools (hills, terrain paths), then lays the tunnel's centreline from
one cutting to the other.

**Auto floor:** the floor ramps linearly between the terrain heights at the
two ends of the centreline (which sit on the cutting floors). A control
point's `floorY` pins the floor there, for dips and climbs inside the tunnel.
(Per point rather than a parallel array, so inserting and deleting points in
the editor can't misalign them.) The
**portals** are the stations where the terrain above the centreline first
rises above the crown (`floor + height`). Where the hill, having risen to
`cover` above the lining, dips below that again, the editor shows a warning
(not a fix); the ramps up from the portals don't count.

**Derived once per build** in `world/tunnel-geometry.js` (`deriveTunnel`),
shared by the mesh, the editor and later physics and the shader:

- stations every ~1 m along the rounded centreline, each with floor Y, ground
  Y and a left normal (done),
- the portal stations and the low-cover flags (done),
- the bore profile, `archContour` (done),
- a `heightAt(x, z)` for the floor layer, null outside the footprint (Phase 3),
- `isInsideBore(x, y, z)` (Phase 2).

Rendering, physics and the shader all read this one derivation, so they can't
drift apart. This avoids repeating the three-copies problem the deck height
code has today.

## Phases

### Phase 1: geometry and editor (visual only) — done

Built as `objects/Tunnel.js` (lining, floor slab and headwalls, all closed
outward-wound solids from one `sweepSection` helper), `TunnelManager`,
`TunnelEditor` + `TunnelPanel` (on `PolyPointEditor`), with unit tests in
`test/tunnel-geometry.test.js`. Differences from the plan below: nothing casts
shadows yet (the lining is buried in the hill, and the terrain doesn't occlude,
so it would shadow the far hillside; Phase 4 has to solve that for interior
darkness), and the floor is a flat colour rather than the terrain look. The
editor rebuilds tunnels on every terrain rebuild, since the portals follow the
terrain.

- `Tunnel.js`: the lining is a swept profile along the centreline (flat floor,
  vertical walls, arched roof), built as a **closed, single-sided solid** so it
  casts shadows correctly (see the bridge double-shadow note: casters must stay
  closed and not dip below grade outside the hill).
- Portal headwalls: a flat facade at each portal, from the arch up to the
  terrain surface, covering the jagged edge where the terrain is cut. Keep the
  geometry simple for now, like the TrackLight poles; a nicer model can come
  later.
- `TunnelEditor.js`: based on `PolyPointEditor` / `TerrainPathEditor`, with
  width/height/cover controls and per-point floor handles. Draw portals and the
  floor ramp as a gizmo so a bad placement ("this hill is too low for a
  tunnel") is visible straight away.
- `TunnelManager`, built from `SceneBuilder` like `BridgeMeshManager`, with
  per-feature rebuild in the editor.

Done when: tunnels render and are editable, but the terrain still covers the
mouth.

### Phase 2: open the terrain

- **Bore discard in the ground shader.** Pass the tunnel segments to the ground
  shader (as a uniform array with a small cap, or a baked texture if tracks
  need many) and `discard` ground fragments inside the bore volume: distance to
  the centreline under half the width, and height between floor and crown.
  Inside the hill the terrain is above the crown, so this only ever removes the
  triangles across each mouth. Portal headwalls hide the uneven edge.
- `SteepSlopeColliderManager`: skip cells inside the tunnel footprint near the
  portals.
- Ground Havok MESH (obstacles only): the portal-face triangles still block
  dynamic obstacles. Ignore this for v1 unless obstacles in tunnels become a
  thing.

Done when: you can fly the free camera through an open tunnel.

### Phase 3: driving

- Register the floor as a surface layer (`kind: 'tunnel'`, level −1).
- **Walls:** oriented box colliders along each side, spanning floor to crown,
  tagged `truckCollider` for `StaticBodyCollisionManager`. Because they're
  boxes with real height, a truck on the hill above passes over them.
- **Roof:** clamp the truck's Y to `crown − halfHeight` in `TerrainPhysics`
  while on a tunnel layer, and kill upward velocity. It's cheaper and more
  predictable than roof colliders, and jumping into the roof should feel like
  a thud.
- Headless check: add a `check:collision` scenario (it already builds real
  surface layers and colliders) that drives straight through a tunnel under a
  hill, asserting the floor contact, no snap to the hilltop at
  the portals, and no wall clipping.

Done when: the player can drive through.

### Phase 4: visibility and lighting

- **Seeing the truck: silhouette.** Draw trucks a second time with an
  inverted depth test (depth-func GREATER) as a flat outline colour, so they
  show through the hill. Cheap, easy to read, standard in isometric games. (A
  cutaway, a dithered screen-space hole in the hill around the truck, was the
  alternative; it can come later if the silhouette isn't enough.)
- **Interior darkness.** The lining roof casts onto the floor under the sun
  shadow. Ambient still leaks, so add a per-truck `tunnelDarkness` (0 at a
  portal, rising to 1 a few metres in) that tints the truck materials, plus a
  darker lining material. Tunnels at night get the player headlight for free.
- Optional: tunnel light strips (emissive lining detail), audio reverb and
  engine echo while inside.

### Phase 5: game systems audit

Go through `getHeightAt` callers and pick layer-aware sampling where it matters:

| System | v1 decision |
|---|---|
| Respawn / AI recovery | `surfaceHeightAt` with the gate's or path's Y as `fromY` |
| Checkpoints | **Not allowed inside a tunnel.** `CheckpointEditor` refuses to place or move a gate inside a tunnel footprint |
| AI path | Waypoints inside a footprint take the floor Y; the 2D blocked grid gets the tunnel walls. Known limit: hill cells directly above the walls count as blocked too |
| Wear / tire ruts bake | Mask the tunnel footprint out of the ground wear bake (like the deck wear split in terrain-utils), or wear prints on the hilltop |
| Decals, tire marks | Resolve the target by layer; ground decals don't project into tunnels in v1 |
| Grass / dirt scatter, decorations | Leave them on the hilltop (correct). The cuttings are ordinary author-shaped terrain |
| Minimap | Draw the tunnel as a dashed corridor |
| Water | Not supported inside tunnels in v1 |

## Decisions (Ben, Sept 26 2026)

1. **Visibility:** silhouette first.
2. **Prerequisite:** the full surface-layer refactor (done).
3. **Approach cuttings:** the author shapes the terrain; no automatic trench.
4. **Checkpoints:** none inside tunnels.

## Risks

- Portal transitions are the most fragile part: the cutting, the bore
  discard, the headwall and the layer switch all meet there. Build the Phase 3
  headless scenario early and keep it in CI.
- The bore discard costs a per-fragment test on the whole ground. Early-out on
  a bounding box, and cap the segment count.
- Curved tunnels need a proper swept frame (no twist) for the lining and
  headwalls. Keep v1 to gentle curves.
- Hill edits in the editor change the portal stations. Recompute the derived
  tunnel geometry on terrain rebuild, not only on tunnel edits (see the
  editor-rebuild localStorage gotcha: refresh in place).
