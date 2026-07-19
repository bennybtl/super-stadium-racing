import { Vector3 } from "@babylonjs/core";
import { DECAL_SHAPES, createDecalTexture } from "./decalShapes.js";
import { projectGroundDecal, makeDecalMaterial } from "./groundDecal.js";

// World-units the decal mesh is raised off the terrain so it wins pointer picks
// over the ground. Kept tiny so the marking still reads as flush with the surface.
const PICK_LIFT = 0.15;

/**
 * SurfaceDecalManager — places static ground markings (arrows, etc.) onto the
 * ground mesh using Babylon's CreateDecal.
 *
 * Decals are drawn programmatically as canvas-backed DynamicTextures (see
 * decalShapes.js) rather than loaded from image files, then projected and
 * materialised via the shared helpers in groundDecal.js.
 *
 * The manager keeps a { feature, mesh } entry per decal so the editor can map a
 * picked mesh back to its feature for selection/editing. CreateDecal bakes its
 * geometry from the projection, so moving/rotating/scaling a decal means
 * rebuilding its mesh (see rebuild()).
 *
 * Feature format (stored in track JSON):
 * {
 *   type:    "surfaceDecal",
 *   centerX: number,       // world X
 *   centerZ: number,       // world Z
 *   shape:   string,       // e.g. "arrow"
 *   color:   string,       // CSS color, default "white"
 *   width:   number,       // world units
 *   depth:   number,       // world units
 *   angle:   number,       // degrees, rotation around Y (up) axis
 *   opacity: number,       // 0–1, default 1
 * }
 */
export class SurfaceDecalManager {
  constructor(scene, track, ground) {
    this._scene  = scene;
    this._track  = track;
    this._ground = ground;
    this._entries = [];   // { feature, mesh }[]
    // Shared materials keyed by "shape:color:opacity" to avoid redundant GPU objects
    this._matCache = new Map();
  }

  createDecal(feature) {
    const mesh = this._buildMesh(feature);
    if (!mesh) return null;
    this._entries.push({ feature, mesh });
    return mesh;
  }

  createDecalsForTrack() {
    for (const feature of this._track.features) {
      if (feature.type === 'surfaceDecal') this.createDecal(feature);
    }
  }

  /** Map a picked mesh back to its { feature, mesh } entry (or null). */
  findByMesh(mesh) {
    return this._entries.find(e => e.mesh === mesh) || null;
  }

  /**
   * Rebuild an entry's decal mesh from its (possibly-mutated) feature. Returns
   * the new mesh. CreateDecal geometry is baked, so this is how position /
   * rotation / scale edits take effect.
   */
  rebuild(entry) {
    entry.mesh?.dispose();
    entry.mesh = this._buildMesh(entry.feature);
    return entry.mesh;
  }

  removeByFeature(feature) {
    const idx = this._entries.findIndex(e => e.feature === feature);
    if (idx === -1) return;
    this._entries[idx].mesh?.dispose();
    this._entries.splice(idx, 1);
  }

  /** Dispose all decal meshes and forget them (used on snapshot restore). Materials stay cached. */
  clearAll() {
    for (const e of this._entries) e.mesh?.dispose();
    this._entries = [];
  }

  _buildMesh(feature) {
    const {
      centerX, centerZ,
      shape = 'arrow',
      color = 'white',
      width  = 4,
      depth  = 4,
      angle  = 0,
      opacity = 1,
    } = feature;

    if (!DECAL_SHAPES.includes(shape)) {
      console.warn(`[SurfaceDecalManager] unknown decal shape: "${shape}". Available: ${DECAL_SHAPES.join(', ')}`);
      return null;
    }

    const terrainY = this._track.getHeightAt(centerX, centerZ);

    const decal = projectGroundDecal(this._ground, `surfaceDecal_${centerX}_${centerZ}`, {
      position: new Vector3(centerX, terrainY, centerZ),
      width,
      depth,
      angle: -(angle * Math.PI) / 180,
    });

    decal.material = this._getMaterial(shape, color, opacity);
    decal.isPickable = true;
    decal.metadata = { ...(decal.metadata ?? {}), surfaceDecal: true };
    // Lift the baked mesh a hair off the terrain so pointer picks hit the decal
    // instead of the ground beneath it. Small enough to be visually flush; the
    // material's zOffset already handles render-order z-fighting.
    decal.position.y += PICK_LIFT;

    return decal;
  }

  _getMaterial(shape, color, opacity) {
    const key = `${shape}:${color}:${opacity}`;
    if (this._matCache.has(key)) return this._matCache.get(key);

    const tex = createDecalTexture(this._scene, shape, color);
    const mat = makeDecalMaterial(this._scene, `surfaceDecalMat_${key}`, tex, opacity);

    this._matCache.set(key, mat);
    return mat;
  }

  dispose() {
    this.clearAll();
    for (const mat of this._matCache.values()) {
      mat.diffuseTexture?.dispose();
      mat.dispose();
    }
    this._matCache.clear();
  }
}
