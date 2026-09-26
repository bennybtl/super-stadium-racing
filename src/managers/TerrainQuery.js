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
 *    DriveSurfaceManager's height layers (world/surface-layers.js).
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
 * the analytic heightfield (`track.getHeightAt`) knows about.
 * `surfaceHeightAt` is the usual combination: surface lookup first, analytic
 * heightfield on a miss.
 */

// Distance between opposing cross-pattern probes (metres).
// 0.5 m spans roughly one terrain subdivision, giving a good slope average
// without smearing over large-scale curvature changes.
const SAMPLE_DIST = 0.5;
// Normal probes start this far above the hit and reach this far below it.
const PROBE_ABOVE = 5;
const PROBE_REACH = 55;

export class TerrainQuery {
  constructor(scene) {
    this._scene = scene ?? null;
    this._layers = scene?.metadata?.driveSurfaceManager?.layers ?? null;
    this._lastResolvedSurface = null;
  }

  /**
   * The tunnel bore at (x, z) — `{ floorY, ceilingY, depth }`, see
   * tunnel-geometry.js sampleBore — or null outside every tunnel.
   */
  tunnelBoreAt(x, z) {
    return this._scene?.metadata?.tunnelBore?.sample(x, z) ?? null;
  }

  /**
   * Resolve terrain height and smooth surface normal at (x, z).
   *
   * @param {number} x
   * @param {number} z
   * @param {number} fromY  Look-up height. Pass the truck's centre Y + a small
   *                        epsilon so the lookup selects the right surface layer.
   * @param {object} [options]  `{ transitionLock }` continuity hint (TerrainPhysics).
   * @returns {{ y: number, normal: Vector3 } | null}
   */
  castDown(x, z, fromY = 500, options = {}) {
    const layers = this._layers;
    const hit = layers?.sample(x, z, fromY, this._preferredSurface(options));
    if (!hit) {
      this._lastResolvedSurface = null;
      return null;
    }
    const hitY = hit.y;
    const level = hit.surface.level;
    const probe = (px, pz) => layers.downOnLevel(px, pz, hitY + PROBE_ABOVE, level, PROBE_REACH);
    // An upward-fallback hit is on a surface's underside, whose vertex normal
    // points down, so skip normal blending then.
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
    const yPX = probe(x + SAMPLE_DIST, z)               ?? hitY;
    const yNX = probe(x - SAMPLE_DIST, z)               ?? hitY;
    const yPZ = probe(x,               z + SAMPLE_DIST) ?? hitY;
    const yNZ = probe(x,               z - SAMPLE_DIST) ?? hitY;

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

    // Blend cross-pattern normal with the hit's interpolated vertex normal.
    // The vertex normal captures sub-triangle surface detail; the cross-pattern
    // suppresses per-triangle faceting artifacts over bumpy displacement.
    // Skip the blend when the hit came from the upward fallback — a back-face
    // vertex normal points down and corrupts the result.
    let rayNormal = usedUpward ? null : layers.normalAt(hit, x, z, new Vector3());
    if (rayNormal && Vector3.Dot(rayNormal, crossNormal) < 0) {
      // Some custom meshes can report opposite-facing triangle normals.
      // Flip to match the sampled slope frame so pitch/roll remain correct.
      rayNormal = rayNormal.scale(-1);
    }
    const normal = rayNormal
      ? Vector3.Normalize(crossNormal.add(rayNormal).scale(0.5))
      : crossNormal;

    this._lastResolvedSurface = hit.surface;

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
   * Where something sits at (x, z): the surface lookup (sees bridge decks and
   * other registered surfaces), falling back to the analytic heightfield where no
   * registered surface covers the point. This is the default answer — reach for
   * `tryHeightAt` only when a miss needs different handling (e.g. the wheel
   * probes, which must inherit the centre height rather than drop to the ground
   * under a deck).
   *
   * @param {Track|null} track  Analytic fallback; `fallback` is used without one.
   * @param {object} [opts]
   * @param {number} [opts.fromY=500]  Look-up height — pass a truck's own Y so
   *   the lookup picks its layer (on a deck vs under it).
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
   * Where a truck respawning at (x, z) should sit: `surfaceHeightAt` from
   * above (so bridge decks count), except inside a tunnel's footprint, where
   * it looks down from just under the roof and lands on the tunnel floor. A
   * respawn point there (an AI path waypoint) is on the route through the
   * tunnel; waypoints carry no height, so a route crossing *over* a tunnel
   * would also land inside it where it crosses — a known limit.
   *
   * @returns {number}
   */
  respawnHeightAt(x, z, track) {
    const bore = this.tunnelBoreAt(x, z);
    return this.surfaceHeightAt(x, z, track, bore ? { fromY: bore.ceilingY - 0.5 } : undefined);
  }

  /**
   * Fast height-only query for high-frequency callers (e.g. wheel visuals).
   * Single surface query, without the normal-smoothing probes castDown runs.
   *
   * @returns {number|null} null when no drivable surface exists at (x, z).
   */
  tryHeightAtFast(x, z, fromY = 500, options = {}) {
    const hit = this._layers?.sample(x, z, fromY, this._preferredSurface(options)) ?? null;
    this._lastResolvedSurface = hit?.surface ?? null;
    return hit?.y ?? null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * The continuity hint as SurfaceLayers.sample takes it: prefer the truck's
   * current surface when it's nearly tied with the nearest one.
   */
  _preferredSurface(options) {
    const lock = options?.transitionLock;
    if (!Number.isFinite(lock?.surfaceId)) return null;
    return { surfaceId: lock.surfaceId, maxDistanceDelta: lock.maxDistanceDelta ?? 0.75 };
  }
}
