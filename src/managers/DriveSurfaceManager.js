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

  /**
   * Rebuild a registered mesh's picking data after its vertices moved.
   *
   * Displacing the ground (an editor terrain edit) invalidates everything the
   * pick path culls against: `setVerticesData` collapses the subdivided
   * submeshes back into one global submesh, and `_submeshesOctree` keeps the
   * bounding boxes of the terrain as it was when the track loaded. Rays then get
   * culled where a newly raised hill stands and hit whatever lies beyond it —
   * the ground *looks* right but picks (and every TerrainQuery raycast) answer
   * for the old shape.
   *
   * @param {BABYLON.AbstractMesh} mesh
   */
  refreshPickingAcceleration(mesh) {
    if (!mesh) return;
    // Refreshes the mesh bbox *and* every submesh's, from the current positions.
    mesh.refreshBoundingInfo();
    this._enablePickingAcceleration(mesh);
  }

  unregisterByMesh(mesh) {
    this._surfaceRegistry.unregisterByMesh(mesh);
    const idx = this._elevatedSurfaceMeshes.indexOf(mesh);
    if (idx !== -1) this._elevatedSurfaceMeshes.splice(idx, 1);
  }

  getSurfaceByMesh(mesh) {
    return this._surfaceRegistry.getSurfaceByMesh(mesh);
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

    // A mesh with no surface record is not drivable. (There used to be a
    // migration fallback here that read `isDriveSurface`/`isTerrain` metadata
    // while the registry was empty — unreachable in practice: SceneBuilder
    // registers the ground synchronously before anything that can query.)
    return false;
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

  /**
   * `transitionLock` is the one accepted shape: `{ mode?, surfaceId?, layer?,
   * maxDistanceDelta? }`. Absent or without a surface/layer to prefer, continuity
   * is off and the nearest eligible hit wins.
   */
  _normalizeContinuityOptions(options = {}) {
    const transitionLock = options.transitionLock ?? null;

    const mode = transitionLock?.mode ?? "prefer";
    const preferredSurfaceId = transitionLock?.surfaceId ?? null;
    const preferredLayer = transitionLock?.layer ?? null;
    const maxDistanceDelta = transitionLock?.maxDistanceDelta ?? 0.75;

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

  get count() {
    return this._surfaceRegistry.count;
  }
}
