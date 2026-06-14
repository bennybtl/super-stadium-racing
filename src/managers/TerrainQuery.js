import { Ray, Vector3 } from "@babylonjs/core";

/**
 * TerrainQuery — hybrid raycast + cross-pattern mesh sampler.
 *
 * Combines two complementary techniques for robust terrain detection on uneven
 * ground:
 *
 * 1. DUAL-DIRECTION RAYCASTING
 *    A primary downward ray resolves the correct surface layer (deck vs ground,
 *    bridge vs open terrain).  An upward fallback fires when the caller's Y has
 *    penetrated the mesh — this catches the common case where the truck sinks
 *    slightly into a steep slope face and the downward ray overshoots, returning
 *    null or a wildly deep hit.
 *
 * 2. CROSS-PATTERN NORMAL SAMPLING
 *    A single triangle's hit normal is unreliable on vertex-displaced terrain —
 *    adjacent triangles can point in very different directions, producing jittery
 *    pitch/roll.  Instead, four short height probes (±SAMPLE_DIST in X and Z)
 *    are cast around the resolved hit point and used to build two tangent vectors
 *    whose cross-product gives a smooth, slope-averaged normal.  This is then
 *    blended 50/50 with the ray's own interpolated vertex normal so fine surface
 *    detail is still captured.
 *
 * Surface tagging (required only for legacy migration fallback scenes):
 *   preferred: metadata.isDriveSurface = true
 *   legacy:    metadata.isTerrain = true
 *
 * All Ray objects are allocated once and reused every frame.
 */

// Distance between opposing cross-pattern probes (metres).
// 0.5 m spans roughly one terrain subdivision, giving a good slope average
// without smearing over large-scale curvature changes.
const SAMPLE_DIST = 0.5;
const MIN_DRIVABLE_NORMAL_Y = 0.15;
// Cap on how far above the ray origin an upward-recovery hit may be accepted.
// The tight value keeps a truck driving *under* a bridge from snapping up onto
// the deck. With no bridges there is exactly one surface per XZ (a heightfield),
// so any upward hit is the truck's own terrain — accept it from any depth so a
// truck that has sunk into a steep slope always recovers, no matter how steep.
const MAX_UPWARD_FALLBACK_RISE = 1.0;
const DEEP_UPWARD_FALLBACK_RISE = Infinity;

export class TerrainQuery {
  constructor(scene, options = {}) {
    this._scene = scene;
    this._driveSurfaceManager = scene?.metadata?.driveSurfaceManager ?? null;
    this._lastResolvedSurface = null;
    this._allowLegacySceneFallback = options.allowLegacySceneFallback === true;

    // Primary downward ray — resolves the correct surface layer.
    this._rayDown = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 2000);
    // Upward fallback — detects the surface when the origin has penetrated the mesh.
    this._rayUp   = new Ray(Vector3.Zero(), new Vector3(0,  1, 0), 50);
    // Short downward probe reused for the four cross-pattern height samples.
    this._rayProbe = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 200);

    this._predicate = mesh =>
      mesh.metadata?.isDriveSurface === true ||
      mesh.metadata?.isTerrain === true;
  }

  /** Max upward-recovery rise: deep on bridgeless tracks, tight where bridges exist. */
  _maxUpwardRise() {
    return this._driveSurfaceManager?.hasElevatedSurfaces?.()
      ? MAX_UPWARD_FALLBACK_RISE
      : DEEP_UPWARD_FALLBACK_RISE;
  }

  /**
   * Resolve terrain height and smooth surface normal at (x, z).
   *
   * @param {number} x
   * @param {number} z
   * @param {number} fromY  Ray origin Y.  Pass the truck's centre Y + a small
   *                        epsilon so the primary ray selects the right surface layer.
   * @returns {{ y: number, normal: Vector3 } | null}
   */
  castDown(x, z, fromY = 500, options = {}) {
    const continuityOptions = this._buildContinuityOptions(options);
    const maxUpwardRise = this._maxUpwardRise();
    let hit = null;
    // getNormal() on a back-face (upward hit) returns a downward-pointing normal,
    // so skip normal blending when queryDriveSurfaceAt resolved from upward fallback.
    let usedUpward = false;

    if (this._driveSurfaceManager?.queryDriveSurfaceAt) {
      const queryOptions = {
        role: "drive",
        surfaceFace: "top",
        ...(continuityOptions ?? {}),
        maxDistance: fromY + 200,
        minNormalY: MIN_DRIVABLE_NORMAL_Y,
        penetrationThreshold: 1.5,
        maxUpwardRise,
      };
      let resolved = this._driveSurfaceManager.queryDriveSurfaceAt(x, z, fromY, queryOptions);
      hit = resolved?.pickInfo ?? null;
      // Steep terrain faces fail the minNormalY drivability filter, leaving
      // callers (object placement: flags, obstacles, pickups, and the truck on
      // very steep ground) with no height at all.  Retry once without the
      // normal filter so we still resolve a surface height to sit on.
      if (!hit?.hit || !hit.pickedPoint) {
        resolved = this._driveSurfaceManager.queryDriveSurfaceAt(x, z, fromY, {
          ...queryOptions,
          minNormalY: 0,
        });
        hit = resolved?.pickInfo ?? null;
      }
      if (!hit?.hit || !hit.pickedPoint) {
        this._lastResolvedSurface = null;
        return null;
      }
      usedUpward = (hit.pickedPoint.y - fromY) > 1e-4;
    } else {
      // -----------------------------------------------------------------------
      // Legacy migration-only path: direct scene raycasts without surface manager.
      // -----------------------------------------------------------------------
      if (!this._allowLegacySceneFallback) {
        this._lastResolvedSurface = null;
        return null;
      }

      this._rayDown.origin.set(x, fromY, z);
      this._rayDown.length = fromY + 200;
      hit = this._pickDown(x, z, fromY, fromY + 200, undefined, continuityOptions);

      const PENETRATION_THRESHOLD = 1.5;
      const downMissed = !hit?.hit || !hit.pickedPoint;
      const likelyPenetrated = !downMissed && (fromY - hit.pickedPoint.y) > PENETRATION_THRESHOLD;

      if (downMissed || likelyPenetrated) {
        this._rayUp.origin.set(x, fromY - 0.05, z);
        this._rayUp.length = likelyPenetrated ? (fromY - hit.pickedPoint.y + 1) : 50;
        const upHit = this._pickUp(
          x,
          z,
          fromY - 0.05,
          likelyPenetrated ? (fromY - hit.pickedPoint.y + 1) : 50,
          continuityOptions
        );
        const upRise = (upHit?.hit && upHit.pickedPoint)
          ? (upHit.pickedPoint.y - fromY)
          : Infinity;
        if (upHit?.hit && upHit.pickedPoint && upRise <= maxUpwardRise) {
          hit = upHit;
          usedUpward = true;
        } else if (downMissed) {
          this._lastResolvedSurface = null;
          return null;
        }
      }
    }

    const hitY = hit.pickedPoint.y;
    const resolvedSurface = this._resolveSurfaceInfo(hit);
    const probeLayer = Number.isFinite(resolvedSurface?.surfaceLevel)
      ? resolvedSurface.surfaceLevel
      : undefined;

    // -------------------------------------------------------------------------
    // Normal computation — cross-pattern height sampling.
    //
    // Sample terrain height at four neighbours (±SAMPLE_DIST along X and Z).
    // Build two tangent vectors and take their cross-product.  Missing probes
    // (e.g. off the mesh edge) fall back to the hit Y so the tangent stays flat.
    //
    //       yNZ
    //  yNX --+-- yPX
    //       yPZ
    // -------------------------------------------------------------------------
    const probeFromY = hitY + 5; // always above the surface
    const yPX = this._probeHeight(x + SAMPLE_DIST, z,               probeFromY, probeLayer) ?? hitY;
    const yNX = this._probeHeight(x - SAMPLE_DIST, z,               probeFromY, probeLayer) ?? hitY;
    const yPZ = this._probeHeight(x,               z + SAMPLE_DIST, probeFromY, probeLayer) ?? hitY;
    const yNZ = this._probeHeight(x,               z - SAMPLE_DIST, probeFromY, probeLayer) ?? hitY;

    // tanX points in the +X direction across the surface.
    // tanZ points in the +Z direction across the surface.
    const tanXx = 2 * SAMPLE_DIST, tanXy = yPX - yNX, tanXz = 0;
    const tanZx = 0,               tanZy = yPZ - yNZ, tanZz = 2 * SAMPLE_DIST;

    // cross(tanZ, tanX) → upward-facing normal
    const cx = tanZy * tanXz - tanZz * tanXy;
    const cy = tanZz * tanXx - tanZx * tanXz;
    const cz = tanZx * tanXy - tanZy * tanXx;
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
    const crossNormal = new Vector3(cx / len, cy / len, cz / len);

    // Blend cross-pattern normal with the ray's interpolated vertex normal.
    // The vertex normal captures sub-triangle surface detail; the cross-pattern
    // suppresses per-triangle faceting artifacts over bumpy displacement.
    // Skip the blend when the hit came from the upward fallback — getNormal() on
    // a back-face returns a downward-pointing normal that corrupts the result.
    let rayNormal = usedUpward ? null : hit.getNormal(true, true);
    if (rayNormal && Vector3.Dot(rayNormal, crossNormal) < 0) {
      // Some custom meshes can report opposite-facing triangle normals.
      // Flip to match the sampled slope frame so pitch/roll remain correct.
      rayNormal = rayNormal.scale(-1);
    }
    const normal = rayNormal
      ? Vector3.Normalize(crossNormal.add(rayNormal).scale(0.5))
      : crossNormal;

    this._lastResolvedSurface = resolvedSurface;

    return { y: hitY, normal };
  }

  getLastResolvedSurface() {
    return this._lastResolvedSurface;
  }

  /**
   * Convenience: return just the floor Y, or `fallback` if no terrain is hit.
   *
   * @param {number} x
   * @param {number} z
   * @param {number} fromY
   * @param {number} fallback  Value returned when no hit is found.
   * @returns {number}
   */
  heightAt(x, z, fromY = 500, fallback = 0, options = {}) {
    return this.castDown(x, z, fromY, options)?.y ?? fallback;
  }

  /**
   * Fast height-only query for high-frequency callers (e.g. wheel visuals).
   * Uses a single downward ray and optional upward fallback, without normal
   * smoothing probes.
   */
  heightAtFast(x, z, fromY = 500, fallback = 0, options = {}) {
    const continuityOptions = this._buildContinuityOptions(options);
    const maxUpwardRise = this._maxUpwardRise();
    if (this._driveSurfaceManager?.queryDriveSurfaceAt) {
      const resolved = this._driveSurfaceManager.queryDriveSurfaceAt(x, z, fromY, {
        role: "drive",
        surfaceFace: "top",
        ...(continuityOptions ?? {}),
        maxDistance: fromY + 200,
        minNormalY: MIN_DRIVABLE_NORMAL_Y,
        penetrationThreshold: 1.5,
        maxUpwardRise,
      });
      const hit = resolved?.pickInfo ?? null;
      if (hit?.hit && hit.pickedPoint) {
        this._lastResolvedSurface = this._resolveSurfaceInfo(hit);
        return hit.pickedPoint.y;
      }
      this._lastResolvedSurface = null;
      return fallback;
    }

    if (!this._allowLegacySceneFallback) {
      this._lastResolvedSurface = null;
      return fallback;
    }

    this._rayDown.origin.set(x, fromY, z);
    this._rayDown.length = fromY + 200;

    let hit = this._pickDown(x, z, fromY, fromY + 200, undefined, continuityOptions);
    if (hit?.hit && hit.pickedPoint) {
      this._lastResolvedSurface = this._resolveSurfaceInfo(hit);
      return hit.pickedPoint.y;
    }

    // Legacy no-manager fallback for penetration/underside cases.
    this._rayUp.origin.set(x, fromY - 0.05, z);
    this._rayUp.length = 50;
    hit = this._pickUp(x, z, fromY - 0.05, 50, continuityOptions);
    const upRise = (hit?.hit && hit.pickedPoint)
      ? (hit.pickedPoint.y - fromY)
      : Infinity;
    if (hit?.hit && hit.pickedPoint && upRise <= maxUpwardRise) {
      this._lastResolvedSurface = this._resolveSurfaceInfo(hit);
      return hit.pickedPoint.y;
    }

    this._lastResolvedSurface = null;
    return fallback;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Cast a short downward probe to sample height only (no normal, no blending).
   * Uses the dedicated _rayProbe object so it never clobbers _rayDown mid-frame.
   * @returns {number|null}
   */
  _probeHeight(x, z, fromY, layer = undefined, continuityOptions = undefined) {
    const hit = this._pickDown(x, z, fromY, fromY + 50, layer, continuityOptions);
    return hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : null;
  }

  _pickDown(x, z, fromY, maxDistance, layer = undefined, continuityOptions = undefined) {
    if (this._driveSurfaceManager?.castDownToDriveSurface) {
      const res = this._driveSurfaceManager.castDownToDriveSurface(x, z, fromY, {
        role: "drive",
        surfaceFace: "top",
        ...(Number.isFinite(layer) ? { layer } : {}),
        ...(continuityOptions ?? {}),
        maxDistance,
        minNormalY: MIN_DRIVABLE_NORMAL_Y,
      });
      return res?.pickInfo ?? null;
    }

    if (!this._allowLegacySceneFallback) return null;

    this._rayDown.origin.set(x, fromY, z);
    this._rayDown.length = maxDistance;
    return this._scene.pickWithRay(this._rayDown, this._predicate);
  }

  _pickUp(x, z, fromY, maxDistance, continuityOptions = undefined) {
    if (this._driveSurfaceManager?.castUpToDriveSurface) {
      const res = this._driveSurfaceManager.castUpToDriveSurface(x, z, fromY, {
        role: "drive",
        surfaceFace: "top",
        ...(continuityOptions ?? {}),
        maxDistance,
        minNormalY: MIN_DRIVABLE_NORMAL_Y,
      });
      return res?.pickInfo ?? null;
    }

    if (!this._allowLegacySceneFallback) return null;

    this._rayUp.origin.set(x, fromY, z);
    this._rayUp.length = maxDistance;
    return this._scene.pickWithRay(this._rayUp, this._predicate);
  }

  _buildContinuityOptions(options = {}) {
    if (!options || typeof options !== "object") return {};

    const transitionLock = options.transitionLock ?? null;
    if (transitionLock?.enabled === false) {
      return { transitionLock: { enabled: false } };
    }

    const hasTransitionLock = transitionLock && typeof transitionLock === "object";
    const hasFlatHints =
      Number.isFinite(options.preferredSurfaceId) ||
      Number.isFinite(options.preferredLayer) ||
      Number.isFinite(options.lockSurfaceId) ||
      Number.isFinite(options.lockLayer) ||
      typeof options.transitionLockMode === "string";

    if (!hasTransitionLock && !hasFlatHints) return {};

    return {
      ...(hasTransitionLock ? { transitionLock } : {}),
      ...(Number.isFinite(options.preferredSurfaceId) ? { preferredSurfaceId: options.preferredSurfaceId } : {}),
      ...(Number.isFinite(options.preferredLayer) ? { preferredLayer: options.preferredLayer } : {}),
      ...(Number.isFinite(options.lockSurfaceId) ? { lockSurfaceId: options.lockSurfaceId } : {}),
      ...(Number.isFinite(options.lockLayer) ? { lockLayer: options.lockLayer } : {}),
      ...(typeof options.transitionLockMode === "string" ? { transitionLockMode: options.transitionLockMode } : {}),
    };
  }

  _resolveSurfaceInfo(hit) {
    const mesh = hit?.pickedMesh;
    if (!mesh) return null;

    const record = this._driveSurfaceManager?.getSurfaceByMesh?.(mesh) ?? null;
    if (record) {
      return {
        surfaceId: record.surfaceId,
        surfaceType: record.surfaceType ?? "generic",
        surfaceKind: record.tags?.surfaceKind ?? "unknown",
        surfaceFace: record.tags?.surfaceFace ?? "top",
        surfaceLevel: record.level ?? 0,
      };
    }

    return {
      surfaceId: mesh.metadata?.surfaceId ?? null,
      surfaceType: mesh.metadata?.surfaceType ?? "generic",
      surfaceKind: mesh.metadata?.surfaceKind ?? "unknown",
      surfaceFace: mesh.metadata?.surfaceFace ?? "top",
      surfaceLevel: mesh.metadata?.level ?? 0,
    };
  }
}
