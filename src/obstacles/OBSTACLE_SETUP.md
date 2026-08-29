# Adding an Obstacle

Obstacles are tumbling physics props placed on the track (barrel, hay bale,
tire stack, …). To add a new one, drop two files into this folder — **no code
changes required**:

1. `myprop.obj` — the model.
2. `myprop.json` — its config (see schema below).

It then appears automatically in the editor's **Obstacle** panel Type
dropdown. Loading is handled by `src/managers/ObstacleLoader.js`; each
instance is built by `src/objects/Obstacle.js` (runtime) and
`src/editor/ObstacleEditor.js` (editor preview).

This mirrors `src/decorations/` (see `DECORATION_SETUP.md`) — same JSON-driven
material system — plus the physics fields an obstacle needs that a static
decoration doesn't.

## JSON schema

```jsonc
{
  "id": "myprop",                 // unique key (defaults to filename)
  "name": "My Prop",              // shown in the editor dropdown
  "modelFile": "myprop.obj",      // OBJ filename in this folder

  "rotationX": -90,               // degrees; use -90 for Z-up authored models
  "baseScale": 0.1,               // base model scale before the user scale
  "offsetY": 0,                   // vertical offset in model space

  // Per-mesh fixed colours, keyed by exact OBJ group name (like vehicles /
  // decorations). RGB (0..1) arrays or "#rrggbb" hex. Meshes NOT listed here
  // take the user-chosen colour from the editor panel.
  "meshColors": {
    "Cylinder_dark_grey": [0.03, 0.03, 0.03]
  },

  // If the OBJ has a `mtllib` (an accompanying .mtl), every group's baked Kd
  // colour becomes its default fixed colour automatically — no meshColors
  // needed. List group names here to make those specific meshes take the
  // user-chosen colour instead (e.g. a barrel's drum body, not its steel
  // hoops). meshColors above still overrides a listed mesh.
  "colorableMeshes": ["Cylinder_Material"],

  // Per-mesh texture, keyed by exact OBJ group name. Image lives in this
  // folder. Takes priority over meshColors. Requires UVs on the model.
  //   "scale": 2   tiles it twice; "uScale"/"vScale" per-axis; "uOffset"/
  //   "vOffset" pan it.
  "meshTextures": {
    "label_obj_0": { "file": "label.png", "scale": 1 }
  },

  // Physics — a box collider sized to halfExtents, tumbled by Havok.
  "halfExtents": { "x": 0.45, "y": 0.55, "z": 0.45 },
  "mass": 20,              // kg — physics body mass, and the panel's default weight
  "contactRadius": 0.5,    // world units — cheap broad-phase reject before the
                           // per-frame truck-collision check (ObstacleManager)
  "linearDamping": 0.55,   // 0..1, how fast it stops sliding once hit
  "angularDamping": 0.35,  // 0..1, how fast it stops tumbling

  // Optional: makes the obstacle a vertical stack of `count` copies of
  // modelFile instead of one fixed mesh — the panel gets a Tires/Count slider
  // (min..max), defaulting new placements to `default`. See tireStack.json.
  // When present, halfExtents/mass above are for ONE unit — the physics box
  // height and default weight scale by count. Units are spaced using the
  // model's own bounding-box height (see utils/mesh-bounds.js unitSizeOf),
  // same technique as the decorations' scaffold arch.
  "stack": { "min": 1, "max": 8, "default": 4 }
}
```

## Notes

- Find your model's mesh group names with: `grep '^g ' myprop.obj`.
- Babylon's own OBJ material import is disabled (`SKIP_MATERIALS`) — but if the
  OBJ ships an .mtl, `ObstacleLoader` parses its `Kd` colours itself and uses
  them as each group's default fixed colour, same as decorations.
- Obstacles have one paint colour, chosen in the editor panel (`obstacle.color`,
  from a small fixed palette in `useEditorStore`) and applied to every mesh not
  pinned by `meshColors`/`meshTextures`/baked-mtl. There's no per-instance
  `editable` toggle like decorations — every obstacle always shows Scale,
  Weight and Color; Rotation is hidden for radially-symmetric types via a
  hardcoded check in `ObstaclePanel.vue`.
- An obstacle's `id` is what saved tracks reference (`feature.obstacleType`),
  so **renaming it orphans existing placements**. Keep ids stable once tracks
  use them.
- `barrel`, `tireStack`, `hayBale`, `softWall` are the bundled examples;
  `barrel` shows the mtl-driven `colorableMeshes` pattern (steel hoops stay
  fixed, the drum body stays user-paintable); `tireStack` shows the `stack`
  pattern (one `tire.obj` unit repeated 1-8 times).
