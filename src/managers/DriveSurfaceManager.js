import { SurfaceRegistry } from "./SurfaceRegistry.js";
import { Ray, Vector3 } from "@babylonjs/core";

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
    this._surfaceRegistry = new SurfaceRegistry(scene);
    this._rayDown = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 2000);
    this._rayUp = new Ray(Vector3.Zero(), new Vector3(0, 1, 0), 2000);
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
    return this._surfaceRegistry.registerSurface(mesh, {
      ...options,
      role: "drive",
    });
  }

  unregisterByMesh(mesh) {
    this._surfaceRegistry.unregisterByMesh(mesh);
  }

  getAll() {
    return this._surfaceRegistry.getAllSurfaceMeshes();
  }

  getSurface(surfaceId) {
    return this._surfaceRegistry.getSurface(surfaceId);
  }

  getSurfaceByMesh(mesh) {
    return this._surfaceRegistry.getSurfaceByMesh(mesh);
  }

  getAllSurfaceRecords() {
    return this._surfaceRegistry.getAllSurfaces();
  }

  /**
   * Cast downward and resolve the nearest matching drivable surface.
   * @returns {{pickInfo: object, surface: object|null}|null}
   */
  castDownToDriveSurface(x, z, fromY = 500, options = {}) {
    const maxDistance = Math.max(1, options.maxDistance ?? (fromY + 200));
    this._rayDown.origin.set(x, fromY, z);
    this._rayDown.length = maxDistance;
    return this._castRayToSurface(this._rayDown, options);
  }

  /**
   * Resolve a surface near a hint Y by trying down first, then up fallback.
   * @returns {{pickInfo: object, surface: object|null}|null}
   */
  queryDriveSurfaceAt(x, z, hintY = 500, options = {}) {
    const down = this.castDownToDriveSurface(x, z, hintY, options);
    if (down?.pickInfo?.pickedPoint) {
      const penetrationThreshold = options.penetrationThreshold ?? 1.5;
      const dy = hintY - down.pickInfo.pickedPoint.y;
      if (dy <= penetrationThreshold) return down;
      const up = this.castUpToDriveSurface(x, z, hintY - 0.05, {
        ...options,
        maxDistance: dy + 1,
      });
      return up ?? down;
    }
    return this.castUpToDriveSurface(x, z, hintY - 0.05, {
      ...options,
      maxDistance: options.maxDistance ?? 50,
    });
  }

  castUpToDriveSurface(x, z, fromY = 0, options = {}) {
    const maxDistance = Math.max(1, options.maxDistance ?? 50);
    this._rayUp.origin.set(x, fromY, z);
    this._rayUp.length = maxDistance;
    return this._castRayToSurface(this._rayUp, options);
  }

  _castRayToSurface(ray, options = {}) {
    const filtered = hit => this._isHitAllowed(hit, options);

    const multiHits = this.scene.multiPickWithRay?.(ray, mesh => this._isMeshEligible(mesh, options));
    if (Array.isArray(multiHits) && multiHits.length > 0) {
      const sortedHits = multiHits
        .filter(hit => hit?.hit && hit.pickedPoint)
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
      const picked = sortedHits.find(filtered) ?? null;
      if (picked) {
        return {
          pickInfo: picked,
          surface: this.getSurfaceByMesh(picked.pickedMesh),
        };
      }
      return null;
    }

    const single = this.scene.pickWithRay(ray, mesh => this._isMeshEligible(mesh, options));
    if (!single?.hit || !single.pickedPoint || !filtered(single)) return null;
    return {
      pickInfo: single,
      surface: this.getSurfaceByMesh(single.pickedMesh),
    };
  }

  _isMeshEligible(mesh, options = {}) {
    if (!mesh) return false;

    const requestedLayer = options.layer;
    const requestedRole = options.role ?? "drive";
    const record = this.getSurfaceByMesh(mesh);

    if (record) {
      if (requestedRole && record.role !== requestedRole) return false;
      if (Number.isFinite(requestedLayer) && record.level !== requestedLayer) return false;
      return true;
    }

    // Legacy fallback path for meshes tagged before surface records are available.
    const isLegacyDriveMesh = mesh.metadata?.isDriveSurface === true || mesh.metadata?.isTerrain === true;
    if (!isLegacyDriveMesh) return false;
    if (requestedRole && requestedRole !== "drive") return false;
    if (Number.isFinite(requestedLayer) && mesh.metadata?.level !== requestedLayer) return false;
    return true;
  }

  _isHitAllowed(hit, options = {}) {
    if (!hit?.hit || !hit.pickedPoint) return false;

    const minNormalY = options.minNormalY;
    if (!Number.isFinite(minNormalY)) return true;

    const normal = hit.getNormal?.(true, true);
    if (!normal) return true;
    return normal.y >= minNormalY;
  }

  get count() {
    return this._surfaceRegistry.count;
  }
}
