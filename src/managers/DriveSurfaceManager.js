/**
 * DriveSurfaceManager
 *
 * Central registry for all drivable world surfaces (ground, bridges, ramps,
 * overpasses, etc). Registration standardizes mesh metadata so runtime systems
 * (raycasts, physics helpers, AI/nav in later phases) can treat every drive
 * surface through one common path.
 */
export class DriveSurfaceManager {
  constructor(scene) {
    this.scene = scene;
    this._nextSurfaceId = 1;
    this._surfaces = new Map(); // surfaceId -> mesh
  }

  /**
   * Register a mesh as a drive surface.
   * @param {BABYLON.AbstractMesh} mesh
   * @param {object} [options]
   * @param {string} [options.surfaceType='generic']
   * @param {number} [options.level=0]
   * @param {object} [options.tags]
   * @returns {number|null} surfaceId
   */
  register(mesh, options = {}) {
    if (!mesh) return null;

    const {
      surfaceType = "generic",
      level = 0,
      tags = {},
    } = options;

    const existingId = mesh.metadata?.surfaceId;
    const surfaceId = Number.isFinite(existingId) ? existingId : this._nextSurfaceId++;

    mesh.metadata = {
      ...(mesh.metadata ?? {}),
      isTerrain: true,
      isDriveSurface: true,
      surfaceType,
      level,
      surfaceId,
      ...tags,
    };

    this._surfaces.set(surfaceId, mesh);

    // Keep registry in sync when the mesh is disposed.
    mesh.onDisposeObservable.addOnce(() => {
      this._surfaces.delete(surfaceId);
    });

    return surfaceId;
  }

  unregisterByMesh(mesh) {
    if (!mesh) return;
    const id = mesh.metadata?.surfaceId;
    if (Number.isFinite(id)) this._surfaces.delete(id);
  }

  getAll() {
    return Array.from(this._surfaces.values());
  }

  get count() {
    return this._surfaces.size;
  }
}
