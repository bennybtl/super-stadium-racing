import { parseMeshDefaultColors } from "../utils/mtl-parser.js";

/**
 * VehicleLoader - Loads vehicle definitions from JSON files in /src/vehicles/
 *
 * Each JSON file defines one vehicle's identity and performance parameters.
 * The structure mirrors TrackLoader so the rest of the codebase can use
 * the same patterns (glob loading, keyed map, window exposure).
 *
 * Body colour: if the OBJ ships a `mtllib`, each group's baked Kd colour is
 * parsed into `def.meshDefaultColors` and used as that mesh's fixed colour.
 * `def.colorableMeshes` (OBJ group names) lists which meshes take the
 * driver-selected colour instead — see TruckBody._meshColorFor.
 */
export class VehicleLoader {
  constructor() {
    /** @type {Map<string, object>} key → raw vehicle definition object */
    this.vehicles = new Map();
    /** @type {string[]} ordered list of vehicle keys */
    this.vehicleList = [];
  }

  /**
   * Load all vehicle definitions from /src/vehicles/*.json at startup.
   * Uses Vite's import.meta.glob so the files are bundled correctly.
   */
  async loadAllVehicles() {
    const modules = import.meta.glob('/src/vehicles/*.json', { query: '?raw', import: 'default' });
    // Eagerly resolve OBJ URLs so Vite bundles them and we can look them up by filename
    const objUrls = import.meta.glob('/src/vehicles/*.obj', { query: '?url', import: 'default', eager: true });
    // Raw OBJ/MTL text, to derive each mesh's baked-in default colour.
    const objText = import.meta.glob('/src/vehicles/*.obj', { query: '?raw', import: 'default', eager: true });
    const mtlText = import.meta.glob('/src/vehicles/*.mtl', { query: '?raw', import: 'default', eager: true });
    // Eagerly resolve image URLs (png/jpg)
    const imgUrls = import.meta.glob('/src/vehicles/*.{png,jpg,jpeg}', { query: '?url', import: 'default', eager: true });

    const loadPromises = Object.entries(modules).map(async ([path, load]) => {
      try {
        const raw = await load();
        const def = JSON.parse(raw);
        const key = def.id ?? path.split('/').pop().replace('.json', '');
        // Resolve the OBJ URL from the vehicles folder
        if (def.modelFile) {
          def.modelUrl = objUrls[`/src/vehicles/${def.modelFile}`] ?? null;
          // If the OBJ references an .mtl (`mtllib …`), derive each group's
          // baked diffuse colour as its default fixed colour.
          const obj = objText[`/src/vehicles/${def.modelFile}`];
          const mtlFile = obj?.match(/^mtllib\s+(\S+)/m)?.[1];
          const mtl = mtlFile ? mtlText[`/src/vehicles/${mtlFile}`] : null;
          if (obj && mtl) {
            const meshDefaultColors = parseMeshDefaultColors(obj, mtl);
            if (Object.keys(meshDefaultColors).length) def.meshDefaultColors = meshDefaultColors;
          }
        }
        // Resolve the image URL from the vehicles folder
        if (def.imageFile) {
          def.imageUrl = imgUrls[`/src/vehicles/${def.imageFile}`] ?? null;
        }
        this.vehicles.set(key, def);
        if (!this.vehicleList.includes(key)) this.vehicleList.push(key);
        console.debug(`[VehicleLoader] Loaded vehicle: ${def.name} (${key}) modelUrl=${def.modelUrl ?? 'none'}`);
      } catch (err) {
        console.error(`[VehicleLoader] Error loading vehicle ${path}:`, err);
      }
    });

    await Promise.all(loadPromises);
    console.debug(`[VehicleLoader] Loaded ${this.vehicles.size} vehicles`);
    return this.vehicles;
  }

  /**
   * Get a vehicle definition by key.
   * @param {string} key
   * @returns {object|undefined}
   */
  getVehicle(key) {
    return this.vehicles.get(key);
  }

  /**
   * Returns a flat list of { key, name } for UI use.
   * @returns {{ key: string, name: string }[]}
   */
  getVehicleList() {
    return this.vehicleList.map(key => ({
      key,
      name: this.vehicles.get(key)?.name ?? key,
      imageUrl: this.vehicles.get(key)?.imageUrl ?? null,
      modelUrl: this.vehicles.get(key)?.modelUrl ?? null,
      defaultColor: this.vehicles.get(key)?.defaultColor ?? null,
      meshDefaultColors: this.vehicles.get(key)?.meshDefaultColors ?? null,
      colorableMeshes: this.vehicles.get(key)?.colorableMeshes ?? null,
      bodyTransform: this.vehicles.get(key)?.bodyTransform ?? null,
      wheels: this.vehicles.get(key)?.wheels ?? null,
    }));
  }
}
