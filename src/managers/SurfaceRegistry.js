/**
 * SurfaceRegistry
 *
 * Canonical registry for gameplay-relevant world surfaces.
 * Phase 1 keeps this compatible with existing metadata tagging while exposing
 * richer surface records for layered-terrain refactor work.
 */
export class SurfaceRegistry {
  constructor(scene) {
    this.scene = scene;
    this._nextSurfaceId = 1;
    this._recordsById = new Map();
    this._surfaceIdByMesh = new WeakMap();
  }

  /**
   * Register a mesh as a surface and return its surface id.
   * @param {BABYLON.AbstractMesh} mesh
   * @param {object} [options]
   * @param {string} [options.surfaceType='generic']
   * @param {number} [options.level=0]
   * @param {string} [options.role='drive']
   * @param {number} [options.priority=0]
   * @param {object} [options.tags]
   * @returns {number|null}
   */
  registerSurface(mesh, options = {}) {
    if (!mesh) return null;

    const {
      surfaceType = "generic",
      level = 0,
      role = "drive",
      priority = 0,
      tags = {},
    } = options;
    const isDriveRole = role === "drive";

    const existingId = mesh.metadata?.surfaceId;
    const surfaceId = Number.isFinite(existingId) ? existingId : this._nextSurfaceId++;

    mesh.metadata = {
      ...(mesh.metadata ?? {}),
      // Legacy flags still used by TerrainQuery and existing systems.
      isTerrain: isDriveRole,
      isDriveSurface: isDriveRole,
      // Layered-surface metadata.
      surfaceId,
      surfaceType,
      level,
      surfaceRole: role,
      surfacePriority: priority,
      ...tags,
    };

    const record = {
      surfaceId,
      mesh,
      surfaceType,
      level,
      role,
      priority,
      tags,
    };

    this._recordsById.set(surfaceId, record);
    this._surfaceIdByMesh.set(mesh, surfaceId);

    // Keep registry in sync when mesh is disposed.
    mesh.onDisposeObservable.addOnce(() => {
      this._recordsById.delete(surfaceId);
      this._surfaceIdByMesh.delete(mesh);
    });

    return surfaceId;
  }

  unregisterByMesh(mesh) {
    if (!mesh) return;
    const id = this._surfaceIdByMesh.get(mesh) ?? mesh.metadata?.surfaceId;
    if (!Number.isFinite(id)) return;
    this._recordsById.delete(id);
    this._surfaceIdByMesh.delete(mesh);
  }

  getSurface(surfaceId) {
    return this._recordsById.get(surfaceId) ?? null;
  }

  getSurfaceByMesh(mesh) {
    if (!mesh) return null;
    const id = this._surfaceIdByMesh.get(mesh) ?? mesh.metadata?.surfaceId;
    if (!Number.isFinite(id)) return null;
    return this._recordsById.get(id) ?? null;
  }

  getAllSurfaces() {
    return Array.from(this._recordsById.values());
  }

  getAllSurfaceMeshes() {
    return this.getAllSurfaces().map(record => record.mesh);
  }

  get count() {
    return this._recordsById.size;
  }
}
