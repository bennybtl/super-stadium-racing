import { Vector3 } from "@babylonjs/core";

/**
 * TerrainQuery — layered surface lookup + cross-pattern normal sampler.
 *
 * Combines two complementary techniques for robust terrain detection on uneven
 * ground:
 *
 * 1. DOWN-THEN-UP SURFACE LOOKUP
 *    The surface at or below the caller's Y wins (deck vs ground, bridge vs
 *    open terrain). An upward fallback applies when the caller's Y has
 *    penetrated the surface — this catches the common case where the truck
 *    sinks slightly into a steep slope face. Answered from the
 *    DriveSurfaceManager's height layers (world/surface-layers.js); the old
 *    raycast path is kept behind `{ raycast: true }` until it's deleted.
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
 * Surfaces come from the scene's DriveSurfaceManager; without one every query
 * resolves to null/fallback.
 *
 * MISSES ARE EXPLICIT. `castDown`, `tryHeightAt` and `tryHeightAtFast` return
 * null when no drivable surface exists at the point — which is a different
 * statement from "the ground is at y = 0". This matters because a lookup only
 * finds *registered surface meshes*, so it legitimately misses open terrain that
 * the analytic heightfield (`track.getHeightAt`) knows about. The `heightAt`
 * wrapper collapses that distinction into a caller-supplied number; reach for it
 * only when its fallback really is an acceptable answer. `surfaceHeightAt` is
 * the usual combination: raycast first, analytic heightfield on a miss.
 */

// Distance between opposing cross-pattern probes (metres).
// 0.5 m spans roughly one terrain subdivision, giving a good slope average
// without smearing over large-scale curvature changes.
const SAMPLE_DIST = 0.5;
const MIN_DRIVABLE_NORMAL_Y = 0.15;
const MAX_UPWARD_FALLBACK_RISE = 1.0;

export class TerrainQuery {
  /**
   * @param {BABYLON.Scene} scene
   * @param {{ raycast?: boolean }} [options]  `raycast: true` answers with the
   *   old Babylon raycasts instead of the height layers — for the parity check
   *   and A/B testing only; deleted once the layers have proven out.
   */
  constructor(scene, { raycast = false } = {}) {
    this._scene = scene;
    this._driveSurfaceManager = scene?.metadata?.driveSurfaceManager ?? null;
    this._raycast = raycast;
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
    const found = this._raycast
      ? this._resolveByRaycast(x, z, fromY, options)
      : this._resolveByLayers(x, z, fromY, options);
    if (!found) {
      this._lastResolvedSurface = null;
      return null;
    }
    const { y: hitY, surface: resolvedSurface, probe, rayNormalAt } = found;
    // A back-face (upward) hit's vertex normal points down, so skip normal
    // blending when the lookup resolved from the upward fallback.
    const usedUpward = (hitY - fromY) > 1e-4;

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
    const yPX = probe(x + SAMPLE_DIST, z,               probeFromY) ?? hitY;
    const yNX = probe(x - SAMPLE_DIST, z,               probeFromY) ?? hitY;
    const yPZ = probe(x,               z + SAMPLE_DIST, probeFromY) ?? hitY;
    const yNZ = probe(x,               z - SAMPLE_DIST, probeFromY) ?? hitY;

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
    // Skip the blend when the hit came from the upward fallback — a back-face
    // vertex normal points down and corrupts the result.
    let rayNormal = usedUpward ? null : rayNormalAt();
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

  /**
   * The surface hit for castDown from the height layers: its height, surface
   * record, a same-level downward probe for the cross-pattern normal, and the
   * hit's interpolated vertex normal.
   */
  _resolveByLayers(x, z, fromY, options) {
    const layers = this._driveSurfaceManager?.layers;
    const hit = layers?.sample(x, z, fromY, this._preferredSurface(options));
    if (!hit) return null;
    const level = hit.surface.level;
    return {
      y: hit.y,
      surface: hit.surface,
      probe: (px, pz, probeFromY) => layers.downOnLevel(px, pz, probeFromY, level, probeFromY + 50),
      rayNormalAt: () => layers.normalAt(hit, x, z, new Vector3()),
    };
  }

  /** As _resolveByLayers, from the old Babylon raycasts. */
  _resolveByRaycast(x, z, fromY, options) {
    if (!this._driveSurfaceManager?.queryDriveSurfaceAt) return null;
    const queryOptions = {
      ...this._buildContinuityOptions(options),
      maxDistance: fromY + 200,
      minNormalY: MIN_DRIVABLE_NORMAL_Y,
      penetrationThreshold: 1.5,
      maxUpwardRise: MAX_UPWARD_FALLBACK_RISE,
    };
    let hit = this._driveSurfaceManager.queryDriveSurfaceAt(x, z, fromY, queryOptions)?.pickInfo ?? null;
    // Steep terrain faces fail the minNormalY drivability filter, leaving
    // callers (object placement: flags, obstacles, pickups, and the truck on
    // very steep ground) with no height at all.  Retry once without the
    // normal filter so we still resolve a surface height to sit on.
    if (!hit?.hit || !hit.pickedPoint) {
      hit = this._driveSurfaceManager.queryDriveSurfaceAt(x, z, fromY, {
        ...queryOptions,
        minNormalY: 0,
      })?.pickInfo ?? null;
    }
    if (!hit?.hit || !hit.pickedPoint) return null;
    const surface = this._resolveSurfaceInfo(hit);
    return {
      y: hit.pickedPoint.y,
      surface,
      probe: (px, pz, probeFromY) => this._probeHeight(px, pz, probeFromY, surface?.level),
      rayNormalAt: () => hit.getNormal(true, true),
    };
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
   * Where something sits at (x, z): the raycast (sees bridge decks and other
   * registered surfaces), falling back to the analytic heightfield where no
   * registered surface covers the point. This is the default answer — reach for
   * `tryHeightAt` only when a miss needs different handling (e.g. the wheel
   * probes, which must inherit the centre height rather than drop to the ground
   * under a deck).
   *
   * @param {Track|null} track  Analytic fallback; `fallback` is used without one.
   * @param {object} [opts]
   * @param {number} [opts.fromY=500]  Ray origin — pass a truck's own Y so the
   *   ray picks its layer (on a deck vs under it).
   * @param {boolean} [opts.fast=false]  Height-only query (`tryHeightAtFast`),
   *   for per-frame callers.
   * @param {number} [opts.fallback=0]  Only when there is no track either.
   * @param {object} [opts.continuity]  Surface continuity hint (TerrainPhysics).
   * @returns {number}
   */
  surfaceHeightAt(x, z, track, { fromY = 500, fast = false, fallback = 0, continuity } = {}) {
    const y = fast
      ? this.tryHeightAtFast(x, z, fromY, continuity)
      : this.tryHeightAt(x, z, fromY, continuity);
    if (y != null) return y;
    return track ? track.getHeightAt(x, z) : fallback;
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
    if (!this._raycast) {
      const hit = this._driveSurfaceManager?.layers.sample(x, z, fromY, this._preferredSurface(options));
      if (!hit) return null;
      this._lastResolvedSurface = hit.surface;
      return hit.y;
    }
    if (!this._driveSurfaceManager?.queryDriveSurfaceAt) return null;

    const resolved = this._driveSurfaceManager.queryDriveSurfaceAt(x, z, fromY, {
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
        ...(Number.isFinite(layer) ? { layer } : {}),
        maxDistance,
        minNormalY: MIN_DRIVABLE_NORMAL_Y,
      });
      return res?.pickInfo ?? null;
    }
    return null;
  }

  /**
   * The continuity hint as SurfaceLayers.sample takes it: prefer the truck's
   * current surface when it's nearly tied with the nearest one.
   */
  _preferredSurface(options) {
    const lock = options?.transitionLock;
    if (!Number.isFinite(lock?.surfaceId)) return null;
    return { surfaceId: lock.surfaceId, maxDistanceDelta: lock.maxDistanceDelta ?? 0.75 };
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

  /** The hit mesh's surface record: `{ surfaceId, mesh, kind, level }`. */
  _resolveSurfaceInfo(hit) {
    return this._driveSurfaceManager?.getSurfaceByMesh(hit?.pickedMesh) ?? null;
  }
}
