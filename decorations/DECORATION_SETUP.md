# Adding a Decoration

Decorations are static props placed on the terrain in the editor (tent, tree,
arrow sign, …). To add a new one, drop two files into this folder — **no code
changes required**:

1. `myprop.obj` — the model.
2. `myprop.json` — its config (see schema below).

It then appears automatically in the editor's **Decoration** panel Type dropdown.
Loading is handled by `src/managers/DecorationLoader.js`; each instance is built by
`src/objects/ModelDecoration.js`.

## JSON schema

```jsonc
{
  "id": "myprop",                 // unique key (defaults to filename)
  "name": "My Prop",              // shown in the editor dropdown
  "modelFile": "myprop.obj",      // OBJ filename in this folder
  "imageFile": "myprop.png",      // optional preview image (this folder)

  "rotationX": -90,               // degrees; use -90 for Z-up authored models
  "baseScale": 1,                 // base model scale before the user scale
  "offsetY": 0,                   // vertical offset in model space

  "defaultColor": "green",        // basicColors key for user-colourable meshes
  "defaultScale": 1,              // initial user scale for new instances

  // Per-mesh fixed colours, keyed by exact OBJ group name (like vehicles).
  // RGB (0..1) arrays or "#rrggbb" hex. Meshes NOT listed here take the
  // user-chosen colour from the editor panel.
  "meshColors": {
    "trunk_obj_0": [0.28, 0.22, 0.16]
  },

  // Per-mesh texture, keyed by exact OBJ group name. Image lives in this
  // folder. Takes priority over meshColors. Omit for no texture (there is no
  // default). NOTE: the model must have UV coordinates (grep '^vt ' model.obj)
  // for a texture to map correctly.
  //
  // A value is either a filename, or an object to tile/pan the texture:
  //   "scale": 2   tiles it twice (pattern appears half the size); default 1.
  //   "uScale"/"vScale" tile per-axis; "uOffset"/"vOffset" pan it.
  "meshTextures": {
    "leaves_obj_0.001": "leaves.png",
    "trunk_obj_0": { "file": "trunk.png", "scale": 2 }
  },

  // OBJ group names that become solid to trucks when the instance's Collider
  // toggle is switched on — e.g. a tree's trunk but not its leaves. Declaring
  // any group adds the Collider toggle to the panel. Each listed mesh collides
  // using its own bounds, so keep them tight (trunk, post, box).
  "colliderMeshes": ["trunk_obj_0"],
  "colliderFriction": 0.9,        // 0..1 surface friction (default 0.9)

  "castsShadows": true,           // default true

  // Initial props for a newly placed instance. Include "collider": true to have
  // new instances start solid.
  "featureDefaults": { "heading": 0 },

  // Which panel sliders/dropdowns to show. Omitted → all true. Mirror (below)
  // is always available for model decorations regardless of this.
  "editable": { "color": true, "scale": true, "heading": true }
}
```

## Folder layout

```
decorations/
  myprop.json      // config (required)
  myprop.obj       // model — omit for procedural decorations
  myprop.png       // optional texture / preview image
  myprop.js        // optional controller (see below)
  lib/             // geometry classes shared by controllers
    Flag.js
    BannerString.js
```

Only top-level `*.js` files are treated as controllers, so helper modules live
in `lib/`. Adding a decoration — including a procedural one — never requires
editing anything under `src/`.

## Controllers (decorations that need code)

Most props need only the JSON above. A decoration that has *behaviour* — it
animates, builds its own geometry, or needs conditional controls — can add a
`myprop.js` next to the JSON. It's picked up automatically by filename (or set
`"controller": "other.js"`). Every hook is optional:

```js
export default {
  // Procedural geometry instead of an OBJ. Omit modelFile from the JSON when
  // you use this. Must return an object with feature/containsMesh/moveTo/dispose.
  build(feature, def, { scene, groundY, shadows }) { return new Thing(...); },

  // Per-frame behaviour, run by DecorationManager during a race.
  update(instance, { dt, trucks, scene }) { ... },

  edit: {
    // Which panel controls to show — can vary per feature (dynamic editing).
    // Types: 'color', 'range' (min/max/step/unit), 'toggle', 'mirror'.
    controls: (feature, def) => ({
      width: { type: 'range', label: 'Width', min: 5, max: 50, step: 1, unit: 'm' },
    }),
    // Optional: intercept a control. Return true if you handled it, else the
    // shared mapping (setColor/setHeading/setScale/…) runs.
    apply: (instance, prop, value) => false,
  },
};
```

A decoration simply omitting a setter opts out of that edit — a flag has no
`setHeading`, so it never rotates. The bundled `flag` (procedural + spring
physics + colour-only editing) and `bannerString` (procedural, width drives the
pennant count) are the worked examples; their geometry classes sit in `lib/`.

A `build()` instance is otherwise plain — the editor and runtime only require
`feature`, `containsMesh(mesh)`, `moveTo(x, z, groundY)` and `dispose()`, plus
whichever optional setters (`setColor`, `setHeading`, `setScale`, `setWidth`, …)
match the controls you expose. An optional `topY` getter parks the editor's
gizmo handle above the prop.

## Editor controls

Selecting a placed decoration opens the **Decoration** panel. Available edits:

- **Move** — drag the handle, or WASD.
- **Rotation** (`editable.heading`) — Q/E, or the Rotation slider.
- **Scale** (`editable.scale`) — scroll wheel, or the Scale slider.
- **Color** (`editable.color`) — dropdown; tints every mesh not pinned by
  `meshColors`/`meshTextures`.
- **Mirror** — **Flip X** / **Flip Z** buttons. Mirrors the model on that axis
  (useful for directional props like the arrow sign). Always shown for models.
- **Collider** — shown only when the JSON declares `colliderMeshes`. Off by
  default; switching it on makes those meshes solid to trucks.

## Notes

- Find your model's mesh group names with: `grep '^g ' myprop.obj`. Split a
  single joined mesh into separate groups in Blender via Edit Mode → **P** →
  *By Loose Parts*, then rename each object (the names become the `g` groups).
- Materials in the OBJ are ignored (`SKIP_MATERIALS`); colour/texture come from
  the JSON.
- Placed instances are stored in the track as
  `{ "type": "model", "model": "myprop", "x", "z", "heading", "scale", "color" }`,
  plus `"mirrorX"` / `"mirrorZ"` booleans when mirrored.
- Legacy tracks that stored `{ "type": "tent" | "flag" | "bannerString", … }`
  still load — a feature typed after a decoration id is treated as that decoration.
- A decoration's `id` is what saved tracks reference, so **renaming it orphans
  existing features**. Keep ids stable once tracks use them.
- The bundled `tent`, `tree_1/2/3`, and `arrow_sign` are plain JSON-only props;
  `flag` and `bannerString` show the controller form.
