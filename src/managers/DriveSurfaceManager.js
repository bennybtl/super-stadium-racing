import { Vector3, VertexBuffer } from "@babylonjs/core";
import { SurfaceLayers, createGroundLayer, createTriangleLayer } from "../world/surface-layers.js";
import { TUNNEL_BORE_DISCARD_ABOVE } from "../world/tunnel-geometry.js";
// Side-effect import: registers AbstractMesh.prototype.createOrUpdateSubmeshesOctree
// and the picking-octree scene component (tree-shaken out otherwise). Required by
// _enablePickingAcceleration below.
import "@babylonjs/core/Culling/Octrees/octreeSceneComponent.js";

/**
 * DriveSurfaceManager
 *
 * Central registry for all drivable world surfaces. Each registered mesh gets
 * one record:
 *
 *   { surfaceId, mesh, kind, level }
 *
 *   kind   'ground' — the terrain and the outskirts plain
 *          'deck'   — a bridge deck or drive box top
 *          'seam'   — the invisible ramp from a deck edge down to the terrain
 *          'tunnel' — a tunnel floor
 *   level  layer number (ground 0; bridges default 1, drive boxes 0, tunnels -1)
 *
 * A mesh with no record is not drivable.
 *
 * Every registered mesh also gets a height layer in `this.layers` (see
 * world/surface-layers.js), built from the mesh's own vertex data; that is what
 * TerrainQuery answers from.
 */
export class DriveSurfaceManager {
  constructor(scene) {
    this.scene = scene;
    this._records = new WeakMap();
    this._nextSurfaceId = 1;
    this.layers = new SurfaceLayers();
    // Inside a tunnel bore the ground isn't there: the ground shader discards
    // it, and this drops it from the height layers to match (the mesh's smear
    // of a portal face would otherwise be a ramp inside the mouth). Read live,
    // since TunnelManager republishes the bore on every rebuild.
    this.layers.groundVoidAt = (x, z) => {
      const b = scene.metadata?.tunnelBore?.sample(x, z);
      return b ? { min: b.floorY + TUNNEL_BORE_DISCARD_ABOVE, max: b.ceilingY } : null;
    };
    // Meshes of elevated drive surfaces (bridge decks, level > 0). Used by
    // hasElevatedSurfaceNear() to gate expensive AI multi-probe sampling to
    // trucks actually near a bridge. Empty on the common no-bridge track.
    this._elevatedSurfaceMeshes = [];
  }

  /**
   * Register a mesh as a drive surface. Re-registering a mesh keeps its id.
   * @param {BABYLON.AbstractMesh} mesh
   * @param {object} [options]
   * @param {'ground'|'deck'|'seam'} [options.kind='ground']
   * @param {number} [options.level=0]
   * @param {{ width: number, depth: number, subdivisions: number }} [options.lattice]
   *   The ground mesh passes its CreateGround lattice (Track.getGroundLattice)
   *   so its layer is sampled in closed form instead of as loose triangles.
   * @returns {number|null} surfaceId
   */
  register(mesh, { kind = "ground", level = 0, lattice = null } = {}) {
    if (!mesh) return null;
    const existing = this._records.get(mesh);
    if (existing) this.layers.remove(existing.layerEntry);
    this._records.set(mesh, {
      surfaceId: existing?.surfaceId ?? this._nextSurfaceId++,
      mesh, kind, level, lattice,
      layerEntry: null,
    });
    this.refreshLayer(mesh);
    if (!existing) mesh.onDisposeObservable.addOnce(() => this.unregisterByMesh(mesh));

    // The editor's placement picks and the decal projection still use
    // `scene.pick` against the ground. Partition it into submeshes with an
    // octree so each pick tests only the triangles under the ray instead of the
    // whole mesh. Decks/seams are small, so brute-force picking is cheap.
    if (kind === "ground") this._enablePickingAcceleration(mesh);

    // Track decks and anything above ground level so AI multi-probe sampling
    // can be gated to bridge proximity (see hasElevatedSurfaceNear).
    if ((kind === "deck" || level > 0) && !this._elevatedSurfaceMeshes.includes(mesh)) {
      this._elevatedSurfaceMeshes.push(mesh);
    }
    return this._records.get(mesh).surfaceId;
  }

  /**
   * A height layer from the mesh's current vertex data, in world space.
   * Ground-kind triangles only count when they face up (the outskirt slabs are
   * boxes; their bottoms are not a surface), matching the raycasts' upward-only
   * normal filter for ground.
   */
  _buildLayer(mesh, kind, lattice) {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
    // CreateGround's mesh sits untransformed at the origin.
    if (lattice) return createGroundLayer(lattice, positions, normals);

    const m = mesh.computeWorldMatrix(true);
    const worldPositions = new Float64Array(positions.length);
    const worldNormals = new Float64Array(positions.length);
    const v = new Vector3();
    for (let i = 0; i < positions.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(positions[i], positions[i + 1], positions[i + 2], m, v);
      worldPositions[i] = v.x; worldPositions[i + 1] = v.y; worldPositions[i + 2] = v.z;
      Vector3.TransformNormalFromFloatsToRef(normals[i], normals[i + 1], normals[i + 2], m, v);
      worldNormals[i] = v.x; worldNormals[i + 1] = v.y; worldNormals[i + 2] = v.z;
    }
    let indices = mesh.getIndices();
    if (kind === "ground") {
      const up = [];
      for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t], b = indices[t + 1], c = indices[t + 2];
        if (worldNormals[a * 3 + 1] >= 0 && worldNormals[b * 3 + 1] >= 0 && worldNormals[c * 3 + 1] >= 0) {
          up.push(a, b, c);
        }
      }
      indices = up;
    }
    return createTriangleLayer(worldPositions, indices, worldNormals);
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
   * Partition a large mesh into submeshes and build a submesh octree so
   * `scene.pick` rays cull to a handful of triangles. Small meshes already pick
   * fast and are left untouched.
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
   * Rebuild a registered mesh's height layer from its current vertex data, so
   * TerrainQuery answers for the new shape. Cheap for the ground (the lattice
   * layer just wraps the buffers), so the editor calls it on every terrain
   * rebuild.
   * @param {BABYLON.AbstractMesh} mesh
   */
  refreshLayer(mesh) {
    const record = this.getSurfaceByMesh(mesh);
    if (!record) return;
    if (record.layerEntry) this.layers.remove(record.layerEntry);
    record.layerEntry = this.layers.add(this._buildLayer(mesh, record.kind, record.lattice), record);
  }

  /**
   * refreshLayer plus the picking data, after a mesh's vertices moved (an editor
   * terrain edit displacing the ground). `setVerticesData` collapses the
   * subdivided submeshes back into one global submesh, and `_submeshesOctree`
   * keeps the terrain's old bounding boxes, so `scene.pick` rays get culled
   * where a newly raised hill stands until this runs.
   * @param {BABYLON.AbstractMesh} mesh
   */
  refreshSurface(mesh) {
    const record = this.getSurfaceByMesh(mesh);
    if (!record) return;
    this.refreshLayer(mesh);
    // Refreshes the mesh bbox *and* every submesh's, from the current positions.
    mesh.refreshBoundingInfo();
    if (record.kind === "ground") this._enablePickingAcceleration(mesh);
  }

  unregisterByMesh(mesh) {
    const record = this.getSurfaceByMesh(mesh);
    if (!record) return;
    this.layers.remove(record.layerEntry);
    this._records.delete(mesh);
    const idx = this._elevatedSurfaceMeshes.indexOf(mesh);
    if (idx !== -1) this._elevatedSurfaceMeshes.splice(idx, 1);
  }

  getSurfaceByMesh(mesh) {
    return (mesh && this._records.get(mesh)) ?? null;
  }
}
