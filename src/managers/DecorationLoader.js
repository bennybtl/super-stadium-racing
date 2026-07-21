/**
 * DecorationLoader - Loads model-decoration definitions from JSON files in
 * /decorations/.
 *
 * Each JSON file defines one placeable prop (an OBJ model plus how to orient,
 * scale and colour it). This mirrors VehicleLoader so the rest of the codebase
 * uses the same patterns (glob loading, keyed map, window exposure).
 *
 * Drop a `<name>.obj` + `<name>.json` (and optional preview image) into
 * /decorations/ and it becomes selectable in the editor's Decoration panel —
 * no code changes required.
 *
 * JSON schema:
 *   id              string   unique key (defaults to filename)
 *   name            string   display name
 *   modelFile       string   OBJ filename in /decorations/
 *   imageFile       string   optional preview image in /decorations/
 *   rotationX       number   degrees; corrects Z-up authored models (default 0)
 *   baseScale       number   base model scale before the user scale (default 1)
 *   offsetY         number   vertical offset in model space (default 0)
 *   defaultColor    string   basicColors key for the user-colourable meshes
 *   defaultScale    number   initial user scale for new instances (default 1)
 *   meshColors      { "<groupName>": [r,g,b] | "#rrggbb" }   per-mesh fixed
 *                   colours keyed by exact OBJ group name (like vehicles, see
 *                   `grep '^g ' model.obj`). Meshes not listed take the
 *                   user-chosen colour.
 *   meshTextures    { "<groupName>": "file.png" | { file, scale, uScale,
 *                   vScale, uOffset, vOffset } }   per-mesh texture applied
 *                   instead of a colour (takes priority over meshColors). The
 *                   image must sit in /decorations/ and the model must have UVs.
 *                   `scale`/`uScale`/`vScale` tile the texture (2 = repeats
 *                   twice = pattern half the size); default 1.
 *   castsShadows    boolean  (default true)
 *   editable        { color, scale, heading }  which panel controls to show
 */

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

export class DecorationLoader {
  constructor() {
    /** @type {Map<string, object>} id → decoration definition */
    this.decorations = new Map();
    /** @type {string[]} ordered list of decoration ids */
    this.decorationList = [];
  }

  /**
   * Load all decoration definitions from /decorations/*.json at startup.
   * Uses Vite's import.meta.glob so the files are bundled correctly.
   */
  async loadAllDecorations() {
    const modules = import.meta.glob('/decorations/*.json', { query: '?raw', import: 'default' });
    const objUrls = import.meta.glob('/decorations/*.obj', { query: '?url', import: 'default', eager: true });
    const imgUrls = import.meta.glob('/decorations/*.{png,jpg,jpeg}', { query: '?url', import: 'default', eager: true });

    const loadPromises = Object.entries(modules).map(async ([path, load]) => {
      try {
        const raw = await load();
        const def = JSON.parse(raw);
        const key = def.id ?? path.split('/').pop().replace('.json', '');
        if (def.modelFile) {
          def.modelUrl = objUrls[`/decorations/${def.modelFile}`] ?? null;
        }
        if (def.imageFile) {
          def.imageUrl = imgUrls[`/decorations/${def.imageFile}`] ?? null;
        }
        // Resolve per-mesh texture entries to bundled URLs + tiling params so
        // ModelDecoration can load them by mesh (group) name. An entry is either
        // a filename string or { file, scale, uScale, vScale, uOffset, vOffset }.
        if (def.meshTextures) {
          def.meshTextureUrls = {};
          for (const [mesh, entry] of Object.entries(def.meshTextures)) {
            const t = normalizeTextureEntry(entry);
            if (!t) { console.warn(`[DecorationLoader] ${key}: invalid meshTextures entry for '${mesh}'`); continue; }
            const url = imgUrls[`/decorations/${t.file}`] ?? null;
            if (url) def.meshTextureUrls[mesh] = { url, uScale: t.uScale, vScale: t.vScale, uOffset: t.uOffset, vOffset: t.vOffset };
            else console.warn(`[DecorationLoader] ${key}: texture '${t.file}' for mesh '${mesh}' not found in /decorations/`);
          }
        }
        this.decorations.set(key, def);
        if (!this.decorationList.includes(key)) this.decorationList.push(key);
        console.debug(`[DecorationLoader] Loaded decoration: ${def.name} (${key}) modelUrl=${def.modelUrl ?? 'none'}`);
      } catch (err) {
        console.error(`[DecorationLoader] Error loading decoration ${path}:`, err);
      }
    });

    await Promise.all(loadPromises);
    console.debug(`[DecorationLoader] Loaded ${this.decorations.size} decorations`);
    return this.decorations;
  }

  /** Get a decoration definition by id. */
  getDecoration(id) {
    return this.decorations.get(id);
  }

  /** Returns a flat, UI-friendly list of the loaded decorations. */
  getDecorationList() {
    return this.decorationList.map(id => {
      const def = this.decorations.get(id);
      return {
        id,
        name: def?.name ?? id,
        imageUrl: def?.imageUrl ?? null,
        defaultColor: def?.defaultColor ?? null,
        editable: def?.editable ?? { color: true, scale: true, heading: true },
      };
    });
  }
}
