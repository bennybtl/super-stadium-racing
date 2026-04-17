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
 * Surface tagging (required in SceneBuilder):
 *   preferred: metadata.isDriveSurface = true
 *   legacy:    metadata.isTerrain = true (still supported)
 *
 * All Ray objects are allocated once and reused every frame.
 */

// Distance between opposing cross-pattern probes (metres).
// 0.5 m spans roughly one terrain subdivision, giving a good slope average
// without smearing over large-scale curvature changes.
const SAMPLE_DIST = 0.5;

export class TerrainQuery {
  constructor(scene) {
    this._scene = scene;

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

  /**
   * Resolve terrain height and smooth surface normal at (x, z).
   *
   * @param {number} x
   * @param {number} z
   * @param {number} fromY  Ray origin Y.  Pass the truck's centre Y + a small
   *                        epsilon so the primary ray selects the right surface layer.
   * @returns {{ y: number, normal: Vector3 } | null}
   */
  castDown(x, z, fromY = 500) {
    // -------------------------------------------------------------------------
    // Pass 1 — downward ray from caller's Y.
    // -------------------------------------------------------------------------
    this._rayDown.origin.set(x, fromY, z);
    this._rayDown.length = fromY + 200;

    let hit = this._scene.pickWithRay(this._rayDown, this._predicate);

    // -------------------------------------------------------------------------
    // Pass 2 — upward fallback.
    //
    // Two situations call for the upward ray:
    //   a) The downward ray missed entirely (no terrain below fromY).
    //   b) The hit is suspiciously far below fromY, indicating the origin has
    //      penetrated a steep slope face and the ray exited through the back.
    //      Threshold: 1.5 m is safely above normal suspension travel (~0.25 m)
    //      but below any legitimate mid-air height.
    // -------------------------------------------------------------------------
    const PENETRATION_THRESHOLD = 1.5;
    const downMissed = !hit?.hit || !hit.pickedPoint;
    const likelyPenetrated = !downMissed && (fromY - hit.pickedPoint.y) > PENETRATION_THRESHOLD;

    // Track whether we ended up using the upward fallback.
    // getNormal() on a back-face (upward hit) returns a downward-pointing normal
    // that will corrupt the blend, so we skip it and use cross-pattern only.
    let usedUpward = false;

    if (downMissed || likelyPenetrated) {
      this._rayUp.origin.set(x, fromY - 0.05, z);
      this._rayUp.length = likelyPenetrated ? (fromY - hit.pickedPoint.y + 1) : 50;
      const upHit = this._scene.pickWithRay(this._rayUp, this._predicate);
      if (upHit?.hit && upHit.pickedPoint) {
        hit = upHit;
        usedUpward = true;
      } else if (downMissed) {
        return null;
      }
      // If upward also missed but downward found something, keep the downward hit.
    }

    const hitY = hit.pickedPoint.y;

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
    const yPX = this._probeHeight(x + SAMPLE_DIST, z,             probeFromY) ?? hitY;
    const yNX = this._probeHeight(x - SAMPLE_DIST, z,             probeFromY) ?? hitY;
    const yPZ = this._probeHeight(x,               z + SAMPLE_DIST, probeFromY) ?? hitY;
    const yNZ = this._probeHeight(x,               z - SAMPLE_DIST, probeFromY) ?? hitY;

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
    const rayNormal = usedUpward ? null : hit.getNormal(true, true);
    const normal = rayNormal
      ? Vector3.Normalize(crossNormal.add(rayNormal).scale(0.5))
      : crossNormal;

    return { y: hitY, normal };
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
  heightAt(x, z, fromY = 500, fallback = 0) {
    return this.castDown(x, z, fromY)?.y ?? fallback;
  }

  /**
   * Fast height-only query for high-frequency callers (e.g. wheel visuals).
   * Uses a single downward ray and optional upward fallback, without normal
   * smoothing probes.
   */
  heightAtFast(x, z, fromY = 500, fallback = 0) {
    this._rayDown.origin.set(x, fromY, z);
    this._rayDown.length = fromY + 200;

    let hit = this._scene.pickWithRay(this._rayDown, this._predicate);
    if (hit?.hit && hit.pickedPoint) return hit.pickedPoint.y;

    // Fallback for penetration/underside cases.
    this._rayUp.origin.set(x, fromY - 0.05, z);
    this._rayUp.length = 50;
    hit = this._scene.pickWithRay(this._rayUp, this._predicate);
    return (hit?.hit && hit.pickedPoint) ? hit.pickedPoint.y : fallback;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Cast a short downward probe to sample height only (no normal, no blending).
   * Uses the dedicated _rayProbe object so it never clobbers _rayDown mid-frame.
   * @returns {number|null}
   */
  _probeHeight(x, z, fromY) {
    this._rayProbe.origin.set(x, fromY, z);
    this._rayProbe.length = fromY + 50;
    const hit = this._scene.pickWithRay(this._rayProbe, this._predicate);
    return hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : null;
  }
}
