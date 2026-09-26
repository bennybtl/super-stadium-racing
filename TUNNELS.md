# Terrain Tunnel Plan

Add a `tunnel` track feature: a drivable passage that goes *through* terrain
(a hill, a mesa), with portals at each end, and the hill above it staying
drivable and decorated as normal.

Status: **Proposed** (Sept 25 2026). Nothing implemented.

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

## Prerequisite: layered surface sampling

The tunnel should be built on the "surface layers" refactor from the surface
review (suggestion A): a list of drivable layers, each with a flat footprint
and a `heightAt(x, z)`, and one query:

```js
surfaces.sample(x, z, refY) // → { y, normal, layer } | null
// = the highest layer at or below refY + stepTolerance
```

A tunnel floor is then just another layer. Inside the tunnel the truck's
`refY` is far below the hilltop, so the ground layer is skipped and the floor
wins, with no special casing. On the hill above, the ground wins. This is the
same rule that already puts a truck on or under a bridge deck.

**Alternative (not recommended):** register the tunnel floor as a raycast
drive mesh in `DriveSurfaceManager`. The down-ray from just above the truck
would find it, but every `getHeightAt` caller would still be wrong, and the
upward-fallback / `maxUpwardRise` logic would be one more thing to reason
about under a roof.

Deliverable for this phase: `surfaces.sample` exists, `TerrainPhysics` and
respawn use it, and `check:surface` / `check:physics` goldens are unchanged on
existing tracks.

## Data model

```js
{
  type: 'tunnel',
  points: [{ x, z }, ...],   // centreline polyline (open), editor like terrainPath
  width: 10,                  // inner width (m)
  height: 6,                  // clearance, floor to crown (m)
  floorHeights: null,         // optional per-point floor Y override; null = auto
  cover: 2,                   // min terrain above the crown for a portal (m)
  approach: true,             // carve an open trench out to each portal
  approachLength: 12,
  liningColor: '#6b6660',     // walls + arch
  floorColor: null,           // null = terrain look, like bridge decks
}
```

**Auto floor:** find the two portal stations where the terrain above the
centreline first rises above `floor + height + cover`, and ramp the floor
linearly between the terrain heights there. Per-point `floorHeights` override
this for dips and climbs inside the tunnel.

**Derived once per build** (in a `tunnel-geometry.js`, shared by rendering,
physics and the shader):

- the resampled centreline with stations and floor Y,
- the portal stations and frames,
- a `heightAt(x, z)` for the floor layer (null outside the footprint),
- `isInsideBore(x, y, z)`.

Rendering, physics and the shader all read this one derivation, so they can't
drift apart. This avoids repeating the three-copies problem the deck height
code has today.

## Phases

### Phase 1: geometry and editor (visual only)

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
- **Approach trench.** A negative-height polyline contribution in
  `getHeightAt`, from each portal outward over `approachLength`, blended with
  `blendWidth` like the polyHill falloff. It lowers the terrain to the floor
  line so the tunnel has a cutting leading into it, instead of a hole halfway
  up a slope.
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
- Headless check: add a `check:physics` scenario that drives straight through a
  tunnel under a hill, asserting the floor contact, no snap to the hilltop at
  the portals, and no wall clipping.

Done when: the player can drive through.

### Phase 4: visibility and lighting

- **Seeing the truck.** Two options (see open questions):
  1. **Silhouette:** draw trucks a second time with an inverted depth test
     (depth-func GREATER) as a flat outline colour, so they show through the
     hill. Cheap, easy to read, standard in isometric games.
  2. **Cutaway:** in the ground and lining shaders, dither out a screen-space
     circle around each truck that's inside a tunnel. It looks nicer and shows
     the interior, but costs more and cuts holes in the hill decorations too.
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
| Respawn / AI recovery | `surfaces.sample` with the gate's or path's `refY` |
| Checkpoints | Give features an optional `layer`/`refY`; simplest v1 is to **block gates inside a tunnel footprint** in `CheckpointEditor` |
| AI path | Waypoints inside a footprint take the floor Y; the 2D blocked grid gets the tunnel walls. Known limit: hill cells directly above the walls count as blocked too |
| Wear / tire ruts bake | Mask the tunnel footprint out of the ground wear bake (like the deck wear split in terrain-utils), or wear prints on the hilltop |
| Decals, tire marks | Resolve the target by layer; ground decals don't project into tunnels in v1 |
| Grass / dirt scatter, decorations | Leave them on the hilltop (correct). Keep them off the approach trench |
| Minimap | Draw the tunnel as a dashed corridor |
| Water | Not supported inside tunnels in v1 |

## Open questions for Ben

1. **Visibility:** silhouette (cheap, clear) or cutaway (prettier, costlier)?
   I'd start with the silhouette.
2. **Scope of the prerequisite:** do the full surface-layer refactor first, or
   a minimal `surfaces.sample` covering ground + decks + tunnels behind the
   existing `TerrainQuery` API?
3. **Should the approach trench be automatic**, or should tunnels require the
   author to shape the hill and cutting with existing hills/paths?
4. **Checkpoints inside tunnels:** block them for v1, or add a `layer` to
   checkpoint features now?

## Risks

- Portal transitions are the most fragile part: the approach trench, the bore
  discard, the headwall and the layer switch all meet there. Build the Phase 3
  headless scenario early and keep it in CI.
- The bore discard costs a per-fragment test on the whole ground. Early-out on
  a bounding box, and cap the segment count.
- Curved tunnels need a proper swept frame (no twist) for the lining and
  headwalls. Keep v1 to gentle curves.
- Hill edits in the editor change the portal stations. Recompute the derived
  tunnel geometry on terrain rebuild, not only on tunnel edits (see the
  editor-rebuild localStorage gotcha: refresh in place).
