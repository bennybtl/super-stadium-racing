import { SurfaceRegistry } from "./SurfaceRegistry.js";
import { Ray, Vector3 } from "@babylonjs/core";
// Side-effect import: registers AbstractMesh.prototype.createOrUpdateSubmeshesOctree
// and the picking-octree scene component (tree-shaken out otherwise). Required by
// _enablePickingAcceleration below.
import "@babylonjs/core/Culling/Octrees/octreeSceneComponent.js";

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
    // Meshes of elevated drive surfaces (bridge decks, level > 0). Used by
    // hasElevatedSurfaceNear() to gate expensive AI multi-probe sampling to
    // trucks actually near a bridge. Empty on the common no-bridge track.
    this._elevatedSurfaceMeshes = [];
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
    const surfaceId = this._surfaceRegistry.registerSurface(mesh, {
      ...options,
      role: "drive",
    });
    // Drive surfaces are raycast many times per frame by terrain physics and AI
    // (one ray per truck per probe). Partition large STATIC meshes (the ground)
    // into submeshes so each pick tests only the triangles under the ray instead
    // of the whole mesh. See AGENT.md "Performance".
    //
    // Only ground-level static surfaces are accelerated. Bridge decks/seams are
    // small (so brute-force picking is already cheap) and dynamic.
    const isBridgeSurface = String(options.surfaceType ?? "").startsWith("bridge");
    if (mesh && (options.level ?? 0) === 0 && !isBridgeSurface) {
      this._enablePickingAcceleration(mesh);
    }

    // Track elevated decks so AI multi-probe sampling can be gated to bridge
    // proximity (see hasElevatedSurfaceNear).
    if (mesh && ((options.level ?? 0) > 0 || options.surfaceType === "bridgeMesh")) {
      if (!this._elevatedSurfaceMeshes.includes(mesh)) {
        this._elevatedSurfaceMeshes.push(mesh);
      }
    }
    return surfaceId;
  }

  /**
   * True when (x, z) is within `radius` (XZ) of any elevated drive surface
   * (bridge deck). Returns immediately when the track has no elevated surfaces,
   * so flat tracks pay nothing.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {boolean}
   */
  hasElevatedSurfaceNear(x, z, radius) {
    if (this._elevatedSurfaceMeshes.length === 0) return false;
    const r2 = radius * radius;
    for (const mesh of this._elevatedSurfaceMeshes) {
      const bb = mesh?.getBoundingInfo?.()?.boundingBox;
      if (!bb) continue;
      const min = bb.minimumWorld;
      const max = bb.maximumWorld;
      // Distance from the point to the mesh's XZ AABB (0 when inside).
      const cx = Math.max(min.x, Math.min(x, max.x));
      const cz = Math.max(min.z, Math.min(z, max.z));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  /**
   * Partition a large drive-surface mesh into submeshes and build a submesh
   * octree so downward terrain raycasts cull to a handful of triangles. Small
   * meshes (bridge decks, seams) already pick fast and are left untouched.
   * @param {BABYLON.AbstractMesh} mesh
   */
  _enablePickingAcceleration(mesh) {
    try {
      const indices = mesh?.getIndices?.();
      const triCount = indices ? indices.length / 3 : 0;
      // Below this, a brute-force pick is already cheap; partitioning adds overhead.
      if (triCount < 512) return;

      const TARGET_TRIS_PER_SUBMESH = 128;
      const submeshCount = Math.max(2, Math.min(64, Math.ceil(triCount / TARGET_TRIS_PER_SUBMESH)));

      // subdivide() replaces submeshes; only run on a still-single-submesh mesh.
      if ((mesh.subMeshes?.length ?? 0) <= 1) {
        mesh.subdivide(submeshCount);
      }
      mesh.createOrUpdateSubmeshesOctree?.(32, 2);
      mesh.useOctreeForPicking = true;
    } catch (err) {
      // Non-fatal: picking still works (just slower) without the octree.
      console.warn("[DriveSurfaceManager] picking octree build failed", err);
    }
  }

  registerBoundary(mesh, options = {}) {
    return this._surfaceRegistry.registerSurface(mesh, {
      ...options,
      role: "boundary",
    });
  }

  unregisterByMesh(mesh) {
    this._surfaceRegistry.unregisterByMesh(mesh);
    const idx = this._elevatedSurfaceMeshes.indexOf(mesh);
    if (idx !== -1) this._elevatedSurfaceMeshes.splice(idx, 1);
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
   * Query registered surfaces intersecting a world-space bounds volume.
   *
   * Supported bounds shapes:
   *  - { minX, maxX, minY?, maxY?, minZ, maxZ }
   *  - { min: {x,y,z}, max: {x,y,z} }
   *  - { center: {x,y,z}, extents: {x,y,z} }
   *
   * @param {object} bounds
   * @param {object} [filter]
   * @param {string|null} [filter.role='drive']
   * @param {number} [filter.layer]
   * @param {string} [filter.surfaceType]
   * @param {string} [filter.surfaceFace]
   * @param {object} [filter.tags] Exact key/value tag subset match.
   * @param {(record: object) => boolean} [filter.predicate]
   * @returns {object[]} matching surface records
   */
  querySurfacesInBounds(bounds, filter = {}) {
    const queryBounds = this._normalizeBounds(bounds);
    if (!queryBounds) return [];

    const requestedRole = filter.role ?? "drive";
    const requestedLayer = filter.layer;
    const requestedType = filter.surfaceType;
    const requestedFace = filter.surfaceFace;
    const requiredTags = filter.tags;
    const predicate = typeof filter.predicate === "function" ? filter.predicate : null;

    const matches = [];
    for (const record of this.getAllSurfaceRecords()) {
      if (!record?.mesh) continue;
      if (requestedRole && record.role !== requestedRole) continue;
      if (Number.isFinite(requestedLayer) && record.level !== requestedLayer) continue;
      if (requestedType && record.surfaceType !== requestedType) continue;

      const surfaceFace = record.tags?.surfaceFace ?? record.mesh.metadata?.surfaceFace ?? "top";
      if (requestedFace && surfaceFace !== requestedFace) continue;

      if (requiredTags && !this._recordHasTags(record, requiredTags)) continue;
      if (predicate && !predicate(record)) continue;

      const recordBounds = this._getRecordBounds(record);
      if (!recordBounds) continue;
      if (!this._boundsIntersect(queryBounds, recordBounds)) continue;

      matches.push(record);
    }

    return matches;
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
    const maxUpwardRise = Number.isFinite(options.maxUpwardRise)
      ? Math.max(0, options.maxUpwardRise)
      : Infinity;

    // The upward fallback recovers the surface the truck has sunk into (a steep
    // slope it overshot, or its own bridge deck when the down-ray slipped past an
    // edge/seam to the ground below). The maxUpwardRise cap is what keeps it from
    // snapping the truck onto a bridge it is driving *under*. (An earlier level
    // guard here also rejected up-hits onto a higher layer than the down hit, but
    // that blocked the legitimate "re-grab the deck above the ground" case and
    // dropped trucks through bridges — see git history.)
    const isUpwardHitAllowed = hit => {
      if (!hit?.pickInfo?.pickedPoint) return false;
      const upRise = hit.pickInfo.pickedPoint.y - hintY;
      return upRise <= maxUpwardRise;
    };

    if (down?.pickInfo?.pickedPoint) {
      const penetrationThreshold = options.penetrationThreshold ?? 1.5;
      const dy = hintY - down.pickInfo.pickedPoint.y;
      if (dy <= penetrationThreshold) return down;
      const up = this.castUpToDriveSurface(x, z, hintY - 0.05, {
        ...options,
        maxDistance: dy + 1,
      });
      if (isUpwardHitAllowed(up)) return up;
      return down;
    }

    const up = this.castUpToDriveSurface(x, z, hintY - 0.05, {
      ...options,
      maxDistance: options.maxDistance ?? 50,
    });
    return isUpwardHitAllowed(up) ? up : null;
  }

  castUpToDriveSurface(x, z, fromY = 0, options = {}) {
    const maxDistance = Math.max(1, options.maxDistance ?? 50);
    this._rayUp.origin.set(x, fromY, z);
    this._rayUp.length = maxDistance;
    return this._castRayToSurface(this._rayUp, options);
  }

  _castRayToSurface(ray, options = {}) {
    const filtered = hit => this._isHitAllowed(hit, options);
    const continuity = this._normalizeContinuityOptions(options);

    // NOTE: do NOT short-circuit to a single pickWithRay even when there are no
    // elevated surfaces. pickWithRay returns only the *nearest* triangle; if that
    // triangle fails the normal filter (a near-vertical sliver on a steep hill),
    // the whole query returns null → stale floor → the truck tunnels through.
    // multiPickWithRay keeps every hit and selects the nearest *valid* one, so a
    // neighbouring drivable triangle still resolves the surface. The single pick
    // below is only a fallback for when multiPick returns nothing.
    const multiHits = this.scene.multiPickWithRay?.(ray, mesh => this._isMeshEligible(mesh, options));
    if (Array.isArray(multiHits) && multiHits.length > 0) {
      const sortedHits = multiHits
        .filter(hit => hit?.hit && hit.pickedPoint)
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
      const eligibleHits = sortedHits.filter(filtered);
      const picked = this._selectHitWithContinuity(eligibleHits, continuity);
      if (picked) {
        return {
          pickInfo: picked,
          surface: this.getSurfaceByMesh(picked.pickedMesh),
        };
      }
      return null;
    }

    return this._singlePick(ray, options, filtered, continuity);
  }

  _singlePick(ray, options, filtered, continuity) {
    const single = this.scene.pickWithRay(ray, mesh => this._isMeshEligible(mesh, options));
    if (!single?.hit || !single.pickedPoint || !filtered(single)) return null;
    if (!this._hitMatchesContinuity(single, continuity) && continuity.mode === "strict") return null;
    return {
      pickInfo: single,
      surface: this.getSurfaceByMesh(single.pickedMesh),
    };
  }

  _isMeshEligible(mesh, options = {}) {
    if (!mesh) return false;

    const requestedLayer = options.layer;
    const requestedRole = options.role ?? "drive";
    const requestedSurfaceFace = options.surfaceFace;
    const record = this.getSurfaceByMesh(mesh);

    if (record) {
      if (requestedRole && record.role !== requestedRole) return false;
      if (Number.isFinite(requestedLayer) && record.level !== requestedLayer) return false;
      if (requestedSurfaceFace) {
        const face = record.tags?.surfaceFace ?? "top";
        if (face !== requestedSurfaceFace) return false;
      }
      return true;
    }

    // Legacy fallback path for meshes tagged before surface records are available.
    // Kept migration-only: once any canonical surfaces are registered, callers
    // must opt in explicitly via allowLegacyFallback.
    const allowLegacyFallback =
      options.allowLegacyFallback === true ||
      this._surfaceRegistry.count === 0;
    if (!allowLegacyFallback) return false;

    const isLegacyDriveMesh = mesh.metadata?.isDriveSurface === true || mesh.metadata?.isTerrain === true;
    if (!isLegacyDriveMesh) return false;
    if (requestedRole && requestedRole !== "drive") return false;
    if (Number.isFinite(requestedLayer) && mesh.metadata?.level !== requestedLayer) return false;
    if (requestedSurfaceFace) {
      const face = mesh.metadata?.surfaceFace ?? "top";
      if (face !== requestedSurfaceFace) return false;
    }
    return true;
  }

  _isHitAllowed(hit, options = {}) {
    if (!hit?.hit || !hit.pickedPoint) return false;

    const minNormalY = options.minNormalY;
    if (!Number.isFinite(minNormalY)) return true;

    const normal = hit.getNormal?.(true, true);
    if (!normal) return true;

    const record = this.getSurfaceByMesh(hit.pickedMesh);
    const normalFilterMode =
      record?.tags?.normalFilterMode ??
      hit.pickedMesh?.metadata?.normalFilterMode ??
      "upwardY";

    if (normalFilterMode === "absoluteY") {
      return Math.abs(normal.y) >= minNormalY;
    }

    return normal.y >= minNormalY;
  }

  _normalizeContinuityOptions(options = {}) {
    const transitionLock = options.transitionLock ?? null;
    if (transitionLock?.enabled === false) {
      return {
        mode: "off",
        preferredSurfaceId: null,
        preferredLayer: null,
      };
    }

    const mode =
      transitionLock?.mode ??
      options.transitionLockMode ??
      (transitionLock?.strict === true ? "strict" : "prefer");
    const preferredSurfaceId =
      transitionLock?.surfaceId ??
      options.preferredSurfaceId ??
      options.lockSurfaceId ??
      null;
    const preferredLayer =
      transitionLock?.layer ??
      options.preferredLayer ??
      options.lockLayer ??
      null;
    const maxDistanceDelta =
      transitionLock?.maxDistanceDelta ??
      options.transitionLockMaxDistanceDelta ??
      0.75;

    const hasSurface = Number.isFinite(preferredSurfaceId);
    const hasLayer = Number.isFinite(preferredLayer);
    if (!hasSurface && !hasLayer) {
      return {
        mode: "off",
        preferredSurfaceId: null,
        preferredLayer: null,
        maxDistanceDelta,
      };
    }

    return {
      mode: mode === "strict" ? "strict" : "prefer",
      preferredSurfaceId: hasSurface ? preferredSurfaceId : null,
      preferredLayer: hasLayer ? preferredLayer : null,
      maxDistanceDelta,
    };
  }

  _selectHitWithContinuity(hits, continuity) {
    if (!Array.isArray(hits) || hits.length === 0) return null;
    const nearestHit = hits[0] ?? null;
    if (!continuity || continuity.mode === "off") return nearestHit;

    const preferredHit = hits.find(hit => this._hitMatchesContinuity(hit, continuity)) ?? null;
    if (preferredHit) {
      if (continuity.mode === "strict") return preferredHit;

      const nearestDistance = nearestHit?.distance;
      const preferredDistance = preferredHit.distance;
      const maxDistanceDelta = Number.isFinite(continuity.maxDistanceDelta)
        ? Math.max(0, continuity.maxDistanceDelta)
        : 0.75;

      if (!Number.isFinite(nearestDistance) || !Number.isFinite(preferredDistance)) {
        return preferredHit;
      }

      // Prefer continuity only when confidence is high: i.e. preferred and
      // nearest hits are close enough. Otherwise switch to the nearer surface.
      if ((preferredDistance - nearestDistance) <= maxDistanceDelta) {
        return preferredHit;
      }
    }

    if (continuity.mode === "strict") return null;
    return nearestHit;
  }

  _hitMatchesContinuity(hit, continuity) {
    if (!hit || !continuity || continuity.mode === "off") return true;

    const mesh = hit.pickedMesh;
    if (!mesh) return false;

    const record = this.getSurfaceByMesh(mesh);
    const surfaceId = record?.surfaceId ?? mesh.metadata?.surfaceId ?? null;
    const layer = record?.level ?? mesh.metadata?.level ?? null;

    if (Number.isFinite(continuity.preferredSurfaceId) && surfaceId !== continuity.preferredSurfaceId) {
      return false;
    }
    if (Number.isFinite(continuity.preferredLayer) && layer !== continuity.preferredLayer) {
      return false;
    }

    return true;
  }

  _recordHasTags(record, requiredTags) {
    if (!requiredTags || typeof requiredTags !== "object") return true;
    for (const [key, value] of Object.entries(requiredTags)) {
      if (record.tags?.[key] !== value) return false;
    }
    return true;
  }

  _getRecordBounds(record) {
    const mesh = record?.mesh;
    if (!mesh || mesh.isDisposed?.()) return null;
    const info = mesh.getBoundingInfo?.();
    const box = info?.boundingBox;
    if (!box?.minimumWorld || !box?.maximumWorld) return null;
    return {
      minX: box.minimumWorld.x,
      maxX: box.maximumWorld.x,
      minY: box.minimumWorld.y,
      maxY: box.maximumWorld.y,
      minZ: box.minimumWorld.z,
      maxZ: box.maximumWorld.z,
    };
  }

  _normalizeBounds(bounds) {
    if (!bounds || typeof bounds !== "object") return null;

    // Shape: { min: {x,y,z}, max: {x,y,z} }
    if (bounds.min && bounds.max) {
      const minX = this._finiteOrNull(bounds.min.x);
      const maxX = this._finiteOrNull(bounds.max.x);
      const minZ = this._finiteOrNull(bounds.min.z);
      const maxZ = this._finiteOrNull(bounds.max.z);
      if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
        return null;
      }
      return {
        minX: Math.min(minX, maxX),
        maxX: Math.max(minX, maxX),
        minY: this._finiteOr(bounds.min.y, -Infinity),
        maxY: this._finiteOr(bounds.max.y, Infinity),
        minZ: Math.min(minZ, maxZ),
        maxZ: Math.max(minZ, maxZ),
      };
    }

    // Shape: { center: {x,y,z}, extents: {x,y,z} }
    if (bounds.center && bounds.extents) {
      const cx = this._finiteOrNull(bounds.center.x);
      const cz = this._finiteOrNull(bounds.center.z);
      const ex = Math.abs(this._finiteOrNull(bounds.extents.x));
      const ez = Math.abs(this._finiteOrNull(bounds.extents.z));
      if (!Number.isFinite(cx) || !Number.isFinite(cz) || !Number.isFinite(ex) || !Number.isFinite(ez)) {
        return null;
      }
      const cy = this._finiteOr(bounds.center.y, 0);
      const ey = Math.abs(this._finiteOr(bounds.extents.y, Infinity));
      return {
        minX: cx - ex,
        maxX: cx + ex,
        minY: cy - ey,
        maxY: cy + ey,
        minZ: cz - ez,
        maxZ: cz + ez,
      };
    }

    // Shape: { minX, maxX, minY?, maxY?, minZ, maxZ }
    const minX = this._finiteOrNull(bounds.minX);
    const maxX = this._finiteOrNull(bounds.maxX);
    const minZ = this._finiteOrNull(bounds.minZ);
    const maxZ = this._finiteOrNull(bounds.maxZ);
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
      return null;
    }
    return {
      minX: Math.min(minX, maxX),
      maxX: Math.max(minX, maxX),
      minY: this._finiteOr(bounds.minY, -Infinity),
      maxY: this._finiteOr(bounds.maxY, Infinity),
      minZ: Math.min(minZ, maxZ),
      maxZ: Math.max(minZ, maxZ),
    };
  }

  _boundsIntersect(a, b) {
    return !(
      a.maxX < b.minX ||
      a.minX > b.maxX ||
      a.maxY < b.minY ||
      a.minY > b.maxY ||
      a.maxZ < b.minZ ||
      a.minZ > b.maxZ
    );
  }

  _finiteOrNull(value) {
    return Number.isFinite(value) ? value : null;
  }

  _finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  get count() {
    return this._surfaceRegistry.count;
  }
}
