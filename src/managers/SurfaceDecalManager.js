import { Vector3 } from "@babylonjs/core";
import { DECAL_SHAPES, createDecalTexture, decalPolylineLocalOutline } from "./decalShapes.js";
import { projectGroundDecal, makeDecalMaterial, resolveDecalTarget } from "./groundDecal.js";

// World-units the decal mesh is raised off the terrain so it wins pointer picks
// over the ground. Kept tiny so the marking still reads as flush with the surface.
const PICK_LIFT = 0.15;

// Downward target-resolution ray: cast from well above anything and reach far
// enough to clear the deepest valley.
const TARGET_RAY_TOP = 1000;
const TARGET_RAY_REACH = TARGET_RAY_TOP + 400;

// Projector box for a decal on a bridge deck: shallow (the slab is thin), and
// its centre is lifted so the box bottom clears the deck's underside. Tolerates
// deck slope up to ~MARGIN of drop across the decal's downhill half.
const DECK_PROJECTION_DEPTH = 4;
const DECK_PROJECTION_MARGIN = 0.3;

// Number of distinct wear patterns. Decals pick one from their position so
// neighbours don't share identical noise, while the material/texture cache
// stays bounded at a handful of entries per shape+colour+opacity.
const WEAR_VARIANTS = 8;

function wearSeed(x, z) {
  return Math.abs(Math.round(x * 7 + z * 13)) % WEAR_VARIANTS;
}

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
 *   shape:   string,       // "arrow" | "chevron" | "line" | "oval" | "rect" | "triangle" | "polyline"
 *   count:   number,       // repeats, 1–10 (chevron only)
 *   outline: boolean,      // draw as outline instead of solid (oval/rect/triangle/text)
 *   text:    string,       // marking text (text shape only)
 *   color:   string,       // CSS color, default "white"
 *   width:   number,       // world units (ignored for polyline — derived from points)
 *   depth:   number,       // world units (ignored for polyline — derived from points)
 *   angle:   number,       // degrees, rotation around Y (up) axis (ignored for polyline)
 *   opacity: number,       // 0–1, default 1
 *   points:  Array<{x, z, radius}>, // polyline shape only — world-space, open, rounded corners
 *   thickness: number,     // polyline shape only — stroke width in world units
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

  /** Live { feature, mesh } entries — read-only view for the editor's gizmo handles. */
  get entries() { return this._entries; }

  /**
   * The surface a decal at (x, z) should project onto: the topmost
   * `metadata.surfaceDecalTarget` mesh a downward ray hits — the ground, or a
   * bridge deck where one spans that point. Re-resolved on every build so a
   * decal follows its deck through a rebuild (like WallDecalManager's target).
   * Falls back to the ground mesh at the analytic height on a miss.
   *
   * @returns {{ mesh: import("@babylonjs/core").AbstractMesh, y: number }}
   */
  _resolveTarget(x, z) {
    const hit = resolveDecalTarget(this._scene, {
      origin: new Vector3(x, TARGET_RAY_TOP, z),
      direction: Vector3.Down(),
      reach: TARGET_RAY_REACH,
      tag: "surfaceDecalTarget",
    });
    return hit
      ? { mesh: hit.mesh, y: hit.point.y }
      : { mesh: this._ground, y: this._track.getHeightAt(x, z) };
  }

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
      count  = 1,
      outline = false,
      text = '',
      brand = '',
      points,
      thickness = 1,
    } = feature;

    if (!DECAL_SHAPES.includes(shape)) {
      console.warn(`[SurfaceDecalManager] unknown decal shape: "${shape}". Available: ${DECAL_SHAPES.join(', ')}`);
      return null;
    }

    // Polyline shape: the projector box (position/size/angle) and canvas path
    // both derive from the (possibly-rounded) point list + stroke thickness
    // rather than the stored width/depth/angle, which don't apply to a
    // hand-drawn line — decalPolylineLocalOutline picks the box's own angle
    // (radians, CreateDecal's own convention — not `-(feature.angle*PI/180)`
    // like every other shape below) to fit it tightly around the line.
    let boxCenterX = centerX, boxCenterZ = centerZ, boxWidth = width, boxDepth = depth;
    let boxAngle = -(angle * Math.PI) / 180;
    let localPoints = null;
    if (shape === 'polyline') {
      if (!Array.isArray(points) || points.length < 2) {
        console.warn('[SurfaceDecalManager] polyline decal missing points');
        return null;
      }
      const outlineData = decalPolylineLocalOutline(points, thickness);
      boxCenterX = outlineData.centerX;
      boxCenterZ = outlineData.centerZ;
      boxWidth = outlineData.width;
      boxDepth = outlineData.depth;
      boxAngle = outlineData.angleRad;
      localPoints = outlineData.localPoints;
    }

    const { mesh: target, y: surfaceY } = this._resolveTarget(boxCenterX, boxCenterZ);
    const onGround = target === this._ground;
    // On the (single-faced, heavily displaced) ground the default deep projector
    // box is right. A bridge deck is a thin slab: use a shallow box nudged up so
    // the decal lands only on the deck top, not its underside.
    const projectionDepth = onGround ? undefined : DECK_PROJECTION_DEPTH;
    const posY = onGround ? surfaceY : surfaceY + DECK_PROJECTION_DEPTH / 2 - DECK_PROJECTION_MARGIN;

    const decal = projectGroundDecal(target, `surfaceDecal_${boxCenterX}_${boxCenterZ}`, {
      position: new Vector3(boxCenterX, posY, boxCenterZ),
      width: boxWidth,
      depth: boxDepth,
      angle: boxAngle,
      projectionDepth,
    });

    decal.material = this._getMaterial(shape, color, opacity, wearSeed(boxCenterX, boxCenterZ), count, outline, text, boxWidth, boxDepth, localPoints, thickness, brand);
    decal.isPickable = true;
    decal.metadata = { ...(decal.metadata ?? {}), surfaceDecal: true };
    // Lift the baked mesh a hair off the terrain so pointer picks hit the decal
    // instead of the ground beneath it. Small enough to be visually flush; the
    // material's zOffset already handles render-order z-fighting.
    decal.position.y += PICK_LIFT;

    return decal;
  }

  _getMaterial(shape, color, opacity, seed, count, outline, text, width, depth, localPoints = null, thickness = 1, brand = '') {
    // Wear is baked per world size, so the footprint is part of the key. It is
    // rounded to whole units to keep the cache from growing per slider step.
    const worldWidth = Math.max(1, Math.round(width));
    const worldDepth = Math.max(1, Math.round(depth));
    // A polyline's path isn't captured by the enum key above, so its outline +
    // thickness (rounded to keep the cache from growing per pixel of drag) join it.
    const pointsKey = localPoints
      ? `${localPoints.map(p => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(';')}@${thickness.toFixed(1)}`
      : '';
    const brandKey = shape === 'brand' ? brand : '';
    const key = `${shape}:${color}:${opacity}:${seed}:${count}:${outline}:${text}:${brandKey}:${worldWidth}x${worldDepth}:${pointsKey}`;
    if (this._matCache.has(key)) return this._matCache.get(key);

    const tex = createDecalTexture(this._scene, shape, { color, seed, count, outline, text, brand, worldWidth, worldDepth, localPoints, thickness });
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
