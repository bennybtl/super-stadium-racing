# Adding a Decoration

Decorations are static props placed on the terrain in the editor (tent, tree, …).
To add a new one, drop two files into this folder — **no code changes required**:

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

  "castsShadows": true,
  "editable": { "color": true, "scale": true, "heading": true }  // panel controls
}
```

## Notes

- Find your model's mesh group names with: `grep '^g ' myprop.obj`.
- Materials in the OBJ are ignored (`SKIP_MATERIALS`); colour comes from the JSON.
- Placed instances are stored in the track as
  `{ "type": "model", "model": "myprop", "x", "z", "heading", "scale", "color" }`.
- The bundled `tent` and `tree` are examples of this format.
