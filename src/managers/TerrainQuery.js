import { Vector3 } from "@babylonjs/core";

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
 * All raycasting is delegated to the scene's DriveSurfaceManager; without one
 * every query resolves to null/fallback.
 *
 * MISSES ARE EXPLICIT. `castDown`, `tryHeightAt` and `tryHeightAtFast` return
 * null when no drivable surface exists at the point — which is a different
 * statement from "the ground is at y = 0". This matters because a raycast only
 * finds *registered surface meshes*, so it legitimately misses open terrain that
 * the analytic heightfield (`track.getHeightAt`) knows about. The `heightAt`
 * wrapper collapses that distinction into a caller-supplied number; reach for it
 * only when its fallback really is an acceptable answer.
 */

// Distance between opposing cross-pattern probes (metres).
// 0.5 m spans roughly one terrain subdivision, giving a good slope average
// without smearing over large-scale curvature changes.
const SAMPLE_DIST = 0.5;
const MIN_DRIVABLE_NORMAL_Y = 0.15;
const MAX_UPWARD_FALLBACK_RISE = 1.0;

export class TerrainQuery {
  constructor(scene) {
    this._scene = scene;
    this._driveSurfaceManager = scene?.metadata?.driveSurfaceManager ?? null;
    this._lastResolvedSurface = null;
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
    if (!this._driveSurfaceManager?.queryDriveSurfaceAt) {
      this._lastResolvedSurface = null;
      return null;
    }

    const queryOptions = {
      role: "drive",
      surfaceFace: "top",
      ...(continuityOptions ?? {}),
      maxDistance: fromY + 200,
      minNormalY: MIN_DRIVABLE_NORMAL_Y,
      penetrationThreshold: 1.5,
      maxUpwardRise: MAX_UPWARD_FALLBACK_RISE,
    };
    let resolved = this._driveSurfaceManager.queryDriveSurfaceAt(x, z, fromY, queryOptions);
    let hit = resolved?.pickInfo ?? null;
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
    // getNormal() on a back-face (upward hit) returns a downward-pointing normal,
    // so skip normal blending when queryDriveSurfaceAt resolved from upward fallback.
    const usedUpward = (hit.pickedPoint.y - fromY) > 1e-4;

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
   * Height at (x, z), or `null` when there is no drivable surface there.
   *
   * This is the honest primitive: it distinguishes "no surface here" from "the
   * surface is at y = 0". Prefer it wherever the caller can do something better
   * on a miss than pretend the ground is at sea level — the analytic heightfield
   * (`track.getHeightAt`) is usually the right second choice, since it covers
   * open terrain that carries no registered surface mesh.
   *
   * @returns {number|null}
   */
  tryHeightAt(x, z, fromY = 500, options = {}) {
    return this.castDown(x, z, fromY, options)?.y ?? null;
  }

  /**
   * Convenience wrapper over {@link tryHeightAt} for callers that genuinely have
   * a sensible default. `fallback` is returned on a miss and is indistinguishable
   * from a real hit at that height, so a caller passing the default 0 is
   * asserting "sea level is a fine answer here" — if that isn't true, use
   * `tryHeightAt` and decide.
   *
   * @param {number} fallback  Value returned when no surface is found.
   * @returns {number}
   */
  heightAt(x, z, fromY = 500, fallback = 0, options = {}) {
    return this.tryHeightAt(x, z, fromY, options) ?? fallback;
  }

  /**
   * Fast height-only query for high-frequency callers (e.g. wheel visuals).
   * Single surface query, without the normal-smoothing probes castDown runs.
   *
   * @returns {number|null} null when no drivable surface exists at (x, z).
   */
  tryHeightAtFast(x, z, fromY = 500, options = {}) {
    this._lastResolvedSurface = null;
    if (!this._driveSurfaceManager?.queryDriveSurfaceAt) return null;

    const resolved = this._driveSurfaceManager.queryDriveSurfaceAt(x, z, fromY, {
      role: "drive",
      surfaceFace: "top",
      ...this._buildContinuityOptions(options),
      maxDistance: fromY + 200,
      minNormalY: MIN_DRIVABLE_NORMAL_Y,
      penetrationThreshold: 1.5,
      maxUpwardRise: MAX_UPWARD_FALLBACK_RISE,
    });
    const hit = resolved?.pickInfo ?? null;
    if (!hit?.hit || !hit.pickedPoint) return null;

    this._lastResolvedSurface = this._resolveSurfaceInfo(hit);
    return hit.pickedPoint.y;
  }


  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Cast a short downward probe to sample height only (no normal, no blending).
   * @returns {number|null}
   */
  _probeHeight(x, z, fromY, layer = undefined) {
    const hit = this._pickDown(x, z, fromY, fromY + 50, layer);
    return hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : null;
  }

  _pickDown(x, z, fromY, maxDistance, layer = undefined) {
    if (this._driveSurfaceManager?.castDownToDriveSurface) {
      const res = this._driveSurfaceManager.castDownToDriveSurface(x, z, fromY, {
        role: "drive",
        surfaceFace: "top",
        ...(Number.isFinite(layer) ? { layer } : {}),
        maxDistance,
        minNormalY: MIN_DRIVABLE_NORMAL_Y,
      });
      return res?.pickInfo ?? null;
    }
    return null;
  }

  /**
   * Continuity hints are produced in exactly one shape, by
   * TerrainPhysics._buildSurfaceContinuityOptions: `{ transitionLock: {…} }`.
   * Anything else is passed through untouched.
   */
  _buildContinuityOptions(options = {}) {
    const transitionLock = options?.transitionLock;
    return transitionLock ? { transitionLock } : {};
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
