/**
 * ObstacleLoader - Loads obstacle definitions from JSON files in
 * /src/obstacles/.
 *
 * Mirrors DecorationLoader (see that file) so obstacles get the same
 * "drop an obj + json in the folder, no code changes required" workflow —
 * including a model's baked .mtl colours becoming each mesh's default fixed
 * colour automatically, with `colorableMeshes` opting specific groups back
 * into the user-chosen paint colour.
 *
 * JSON schema:
 *   id              string   unique key (defaults to filename)
 *   name            string   display name
 *   modelFile       string   OBJ filename in /src/obstacles/
 *   rotationX       number   degrees; corrects Z-up authored models (default 0)
 *   baseScale       number   base model scale before the user scale (default 1)
 *   offsetY         number   vertical offset in model space (default 0)
 *   meshColors      { "<groupName>": [r,g,b] | "#rrggbb" }   per-mesh fixed
 *                   colours keyed by exact OBJ group name (see
 *                   `grep '^g ' model.obj`). Takes priority over a colour
 *                   baked into the OBJ's .mtl (see colorableMeshes below).
 *                   Meshes with neither take the user-chosen colour.
 *   colorableMeshes string[] OBJ group names that should take the
 *                   user-chosen colour even though the model's .mtl bakes in
 *                   a colour for them. Only relevant when the OBJ has a
 *                   `mtllib` — otherwise every mesh is already user-colourable
 *                   by default. meshColors still overrides a listed mesh.
 *   meshTextures    { "<groupName>": "file.png" | { file, scale, uScale,
 *                   vScale, uOffset, vOffset } }   per-mesh texture applied
 *                   instead of a colour (takes priority over meshColors). The
 *                   image must sit in /src/obstacles/ and the model must have
 *                   UVs. `scale`/`uScale`/`vScale` tile the texture; default 1.
 *
 *   halfExtents     { x, y, z }   physics box half-extents (world units)
 *   mass            number        kg — physics body mass and default weight
 *   contactRadius   number        world units — cheap broad-phase reject test
 *                   used by ObstacleManager's per-frame truck collision scan
 *   linearDamping   number        0..1, how fast it stops sliding once hit
 *   angularDamping  number        0..1, how fast it stops tumbling
 */

import { parseMeshDefaultColors } from "../utils/mtl-parser.js";

/**
 * Normalize a meshTextures entry to { file, uScale, vScale, uOffset, vOffset }.
 * An entry is either a filename string or an object:
 *   "trunk.png"
 *   { "file": "trunk.png", "scale": 2 }                 // uniform tiling
 *   { "file": "trunk.png", "uScale": 2, "vScale": 4 }   // per-axis tiling
 *   { "file": "trunk.png", "uOffset": 0.5 }             // pan
 */
function normalizeTextureEntry(entry) {
  const file = typeof entry === "string" ? entry : entry?.file;
  if (!file) return null;
  const scale = typeof entry === "object" ? entry.scale : undefined;
  const num = (v, fallback) => (typeof v === "number" ? v : fallback);
  return {
    file,
    uScale: num(entry?.uScale, num(scale, 1)),
    vScale: num(entry?.vScale, num(scale, 1)),
    uOffset: num(entry?.uOffset, 0),
    vOffset: num(entry?.vOffset, 0),
  };
}

export class ObstacleLoader {
  constructor() {
    /** @type {Map<string, object>} id → obstacle definition */
    this.obstacles = new Map();
    /** @type {string[]} ordered list of obstacle ids */
    this.obstacleList = [];
  }

  /**
   * Load all obstacle definitions from /src/obstacles/*.json at startup.
   * Uses Vite's import.meta.glob so the files are bundled correctly.
   */
  async loadAllObstacles() {
    const modules = import.meta.glob('/src/obstacles/*.json', { query: '?raw', import: 'default' });
    const objUrls = import.meta.glob('/src/obstacles/*.obj', { query: '?url', import: 'default', eager: true });
    const objText = import.meta.glob('/src/obstacles/*.obj', { query: '?raw', import: 'default', eager: true });
    const mtlText = import.meta.glob('/src/obstacles/*.mtl', { query: '?raw', import: 'default', eager: true });
    const imgUrls = import.meta.glob('/src/obstacles/*.{png,jpg,jpeg}', { query: '?url', import: 'default', eager: true });

    const loadPromises = Object.entries(modules).map(async ([path, load]) => {
      try {
        const raw = await load();
        const def = JSON.parse(raw);
        const key = def.id ?? path.split('/').pop().replace('.json', '');
        if (def.modelFile) {
          def.modelUrl = objUrls[`/src/obstacles/${def.modelFile}`] ?? null;
          // If the OBJ references an .mtl (`mtllib …`), derive each group's
          // baked diffuse colour as its default fixed colour. `colorableMeshes`
          // in the JSON opts specific groups out of this, back to the shared
          // user-chosen colour.
          const obj = objText[`/src/obstacles/${def.modelFile}`];
          const mtlFile = obj?.match(/^mtllib\s+(\S+)/m)?.[1];
          const mtl = mtlFile ? mtlText[`/src/obstacles/${mtlFile}`] : null;
          if (obj && mtl) {
            const meshDefaultColors = parseMeshDefaultColors(obj, mtl);
            if (Object.keys(meshDefaultColors).length) def.meshDefaultColors = meshDefaultColors;
          }
        }
        // Resolve per-mesh texture entries to bundled URLs + tiling params so
        // the material resolver can load them by mesh (group) name.
        if (def.meshTextures) {
          def.meshTextureUrls = {};
          for (const [mesh, entry] of Object.entries(def.meshTextures)) {
            const t = normalizeTextureEntry(entry);
            if (!t) { console.warn(`[ObstacleLoader] ${key}: invalid meshTextures entry for '${mesh}'`); continue; }
            const url = imgUrls[`/src/obstacles/${t.file}`] ?? null;
            if (url) def.meshTextureUrls[mesh] = { url, uScale: t.uScale, vScale: t.vScale, uOffset: t.uOffset, vOffset: t.vOffset };
            else console.warn(`[ObstacleLoader] ${key}: texture '${t.file}' for mesh '${mesh}' not found in /src/obstacles/`);
          }
        }
        this.obstacles.set(key, def);
        if (!this.obstacleList.includes(key)) this.obstacleList.push(key);
        console.debug(`[ObstacleLoader] Loaded obstacle: ${def.name} (${key}) modelUrl=${def.modelUrl ?? 'none'}`);
      } catch (err) {
        console.error(`[ObstacleLoader] Error loading obstacle ${path}:`, err);
      }
    });

    await Promise.all(loadPromises);
    console.debug(`[ObstacleLoader] Loaded ${this.obstacles.size} obstacles`);
    return this.obstacles;
  }

  /** Get an obstacle definition by id. */
  getObstacle(id) {
    return this.obstacles.get(id);
  }

  /** Returns a flat, UI-friendly list of the loaded obstacles. */
  getObstacleList() {
    return this.obstacleList.map(id => {
      const def = this.obstacles.get(id);
      return { id, name: def?.name ?? id };
    });
  }
}
