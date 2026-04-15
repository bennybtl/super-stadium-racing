import { Ray, Vector3 } from "@babylonjs/core";

/**
 * TerrainQuery — scene-raycast-based terrain height and normal sampler.
 *
 * Fires a downward ray from a caller-supplied Y, and only strikes meshes
 * tagged with `mesh.metadata.isTerrain = true`.  Because the ray origin Y
 * matches the truck's current elevation, the cast naturally selects the
 * correct surface without any bridge-specific special-casing:
 *
 *   • Truck on bridge deck  → origin above deck → hits deck
 *   • Truck under bridge    → origin below deck → hits ground
 *   • Truck on open terrain → hits ground mesh
 *
 * Terrain meshes that should be queryable must be tagged in SceneBuilder:
 *   ground.metadata = { isTerrain: true };
 *   bridgeDeck.metadata = { isTerrain: true };
 *
 * The internal Ray object is reused every call to avoid per-frame allocation.
 */
export class TerrainQuery {
  constructor(scene) {
    this._scene = scene;
    // Reuse a single Ray object — direction is always straight down.
    this._ray = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 2000);
    this._predicate = mesh => mesh.metadata?.isTerrain === true;
  }

  /**
   * Fire a downward ray from (x, fromY, z).
   *
   * @param {number} x
   * @param {number} z
   * @param {number} fromY  Starting Y of the ray.  Pass the truck's center Y + a
   *                        small epsilon so the ray correctly resolves the surface
   *                        the truck is currently on.
   * @returns {{ y: number, normal: Vector3 } | null}
   */
  castDown(x, z, fromY = 500) {
    this._ray.origin.set(x, fromY, z);
    this._ray.length = fromY + 200; // always reaches the lowest possible terrain

    const hit = this._scene.pickWithRay(this._ray, this._predicate);
    if (!hit?.hit || !hit.pickedPoint) return null;

    // useWorldCoordinates=true, useVertexNormal=true → smooth interpolated normal
    const normal = hit.getNormal(true, true) ?? Vector3.Up();
    return { y: hit.pickedPoint.y, normal };
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
}
