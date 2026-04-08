/**
 * VehicleLoader - Loads vehicle definitions from JSON files in /vehicles/
 *
 * Each JSON file defines one vehicle's identity and performance parameters.
 * The structure mirrors TrackLoader so the rest of the codebase can use
 * the same patterns (glob loading, keyed map, window exposure).
 */
export class VehicleLoader {
  constructor() {
    /** @type {Map<string, object>} key → raw vehicle definition object */
    this.vehicles = new Map();
    /** @type {string[]} ordered list of vehicle keys */
    this.vehicleList = [];
  }

  /**
   * Load all vehicle definitions from /vehicles/*.json at startup.
   * Uses Vite's import.meta.glob so the files are bundled correctly.
   */
  async loadAllVehicles() {
    const modules = import.meta.glob('/vehicles/*.json', { query: '?raw', import: 'default' });

    const loadPromises = Object.entries(modules).map(async ([path, load]) => {
      try {
        const raw = await load();
        const def = JSON.parse(raw);
        const key = def.id ?? path.split('/').pop().replace('.json', '');
        this.vehicles.set(key, def);
        if (!this.vehicleList.includes(key)) this.vehicleList.push(key);
        console.log(`[VehicleLoader] Loaded vehicle: ${def.name} (${key})`);
      } catch (err) {
        console.error(`[VehicleLoader] Error loading vehicle ${path}:`, err);
      }
    });

    await Promise.all(loadPromises);
    console.log(`[VehicleLoader] Loaded ${this.vehicles.size} vehicles`);
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
    }));
  }
}
