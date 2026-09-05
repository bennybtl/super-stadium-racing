import { Vector3, Ray } from "@babylonjs/core";
import { DECAL_SHAPES, createDecalTexture } from "./decalShapes.js";
import { projectSurfaceDecal, makeDecalMaterial } from "./groundDecal.js";

// How far the decal is lifted off the wall along its normal so it wins pointer
// picks over the wall behind it. Small enough to still read as flush.
const PICK_LIFT = 0.04;

// Projector-box depth along the normal. Kept small so a decal on a thin poly
// wall doesn't punch through to the far face.
const WALL_PROJECTION_DEPTH = 0.8;

// How far in front of / behind the stored point we look for the target surface.
const TARGET_RAY_REACH = 1.5;

// Distinct wear patterns; a decal picks one from its position so neighbours
// don't share identical noise while the material cache stays bounded.
const WEAR_VARIANTS = 8;
function wearSeed(x, y, z) {
  return Math.abs(Math.round(x * 7 + y * 11 + z * 13)) % WEAR_VARIANTS;
}

/**
 * WallDecalManager — places programmatic decals on vertical / arbitrary
 * surfaces (perimeter walls, poly walls, anything tagged
 * `mesh.metadata.decalTarget`), the counterpart to SurfaceDecalManager's
 * ground-only markings.
 *
 * Textures (decalShapes.js) and the self-lit material recipe (groundDecal.js)
 * are shared with the ground decals; only the projection differs — here the
 * decal is projected along a stored surface normal instead of straight down.
 *
 * The manager keeps a { feature, mesh } entry per decal so the editor can map a
 * picked mesh back to its feature. CreateDecal bakes its geometry, so any edit
 * that moves / rotates / resizes a decal rebuilds its mesh (see rebuild()).
 *
 * Feature format (stored in track JSON):
 * {
 *   type:     "wallDecal",
 *   position: [x, y, z],   // world point on the target surface
 *   normal:   [x, y, z],   // outward surface normal at that point
 *   roll:     number,      // degrees, rotation of the marking in the surface plane
 *   shape:    string,      // "arrow" | "chevron" | "line" | "oval" | "rect" | "triangle" | "text"
 *   count:    number,      // repeats, 1–10 (chevron only)
 *   outline:  boolean,     // draw as outline instead of solid
 *   text:     string,      // marking text (text shape only)
 *   color:    string,      // CSS color, default "white"
 *   width:    number,      // world units across the surface
 *   height:   number,      // world units up the surface
 *   opacity:  number,      // 0–1, default 1
 * }
 */
export class WallDecalManager {
  constructor(scene, track) {
    this._scene = scene;
    this._track = track;
    this._entries = [];
    this._matCache = new Map();
  }

  /** Live { feature, mesh } entries — read-only view for the editor's handles. */
  get entries() { return this._entries; }

  createDecal(feature) {
    const mesh = this._buildMesh(feature);
    if (!mesh) return null;
    this._entries.push({ feature, mesh });
    return mesh;
  }

  /** Map a picked mesh back to its { feature, mesh } entry (or null). */
  findByMesh(mesh) {
    return this._entries.find(e => e.mesh === mesh) || null;
  }

  /** Rebuild an entry's baked decal mesh from its (possibly-mutated) feature. */
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

  /** Dispose all decal meshes and forget them (snapshot restore). Materials stay cached. */
  clearAll() {
    for (const e of this._entries) e.mesh?.dispose();
    this._entries = [];
  }

  /**
   * The mesh a decal at `position` / `normal` should project onto: whatever
   * decal-target surface a short ray through that point hits. Re-resolved on
   * every build so a decal survives its wall being rebuilt.
   */
  _resolveTarget(position, normal) {
    const origin = position.add(normal.scale(TARGET_RAY_REACH * 0.5));
    const ray = new Ray(origin, normal.scale(-1), TARGET_RAY_REACH);
    const hit = this._scene.pickWithRay(
      ray,
      (m) => m?.isEnabled?.() && m.metadata?.decalTarget === true,
    );
    return hit?.hit ? hit.pickedMesh : null;
  }

  _buildMesh(feature) {
    const {
      position, normal,
      roll = 0,
      shape = 'arrow',
      color = 'white',
      width = 4,
      height = 4,
      opacity = 1,
      count = 1,
      outline = false,
      text = '',
      brand = '',
    } = feature;

    if (!Array.isArray(position) || position.length !== 3 ||
        !Array.isArray(normal) || normal.length !== 3) {
      console.warn('[WallDecalManager] decal missing position/normal', feature);
      return null;
    }
    if (!DECAL_SHAPES.includes(shape) || shape === 'polyline') {
      console.warn(`[WallDecalManager] unsupported decal shape: "${shape}"`);
      return null;
    }

    const pos = Vector3.FromArray(position);
    const nrm = Vector3.FromArray(normal);
    if (nrm.lengthSquared() < 1e-6) return null;
    nrm.normalize();

    const target = this._resolveTarget(pos, nrm);
    if (!target) {
      console.warn('[WallDecalManager] no decal-target surface at', position);
      return null;
    }

    const decal = projectSurfaceDecal(target, `wallDecal_${position.join('_')}`, {
      position: pos,
      normal: nrm,
      width,
      height,
      angle: (roll * Math.PI) / 180,
      projectionDepth: WALL_PROJECTION_DEPTH,
    });
    if (!decal) return null;

    decal.material = this._getMaterial(
      shape, color, opacity, wearSeed(pos.x, pos.y, pos.z),
      count, outline, text, width, height, brand,
    );
    decal.isPickable = true;
    decal.metadata = { ...(decal.metadata ?? {}), wallDecal: true };
    // Lift a hair off the surface so pointer picks hit the decal, not the wall.
    decal.position.addInPlace(nrm.scale(PICK_LIFT));

    return decal;
  }

  _getMaterial(shape, color, opacity, seed, count, outline, text, width, height, brand = '') {
    const worldWidth = Math.max(1, Math.round(width));
    const worldHeight = Math.max(1, Math.round(height));
    const brandKey = shape === 'brand' ? brand : '';
    const key = `${shape}:${color}:${opacity}:${seed}:${count}:${outline}:${text}:${brandKey}:${worldWidth}x${worldHeight}`;
    if (this._matCache.has(key)) return this._matCache.get(key);

    const tex = createDecalTexture(this._scene, shape, {
      color, seed, count, outline, text, brand,
      worldWidth, worldDepth: worldHeight,
    });
    const mat = makeDecalMaterial(this._scene, `wallDecalMat_${key}`, tex, opacity);
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
