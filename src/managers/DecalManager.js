import { Vector3 } from "@babylonjs/core";
import { DECAL_SHAPES, createDecalTexture, decalPolylineLocalOutline } from "./decalShapes.js";
import { projectDecal, makeDecalMaterial, resolveDecalTarget } from "./groundDecal.js";

const DEG = Math.PI / 180;

// A surface counts as "flat" (horizontal — ground or a bridge deck) when its
// normal points mostly up. Everything else is treated as a wall.
const FLAT_NORMAL_Y = 0.7;

// Ground: cast the target ray from well above anything, reaching past the
// deepest valley — the stored/​migrated Y is only a hint.
const GROUND_RAY_TOP = 1000;
const GROUND_RAY_REACH = GROUND_RAY_TOP + 400;
// Wall / prop: probe just around the stored point along its normal.
const SURFACE_RAY_REACH = 1.5;

// World units the baked decal is lifted off its surface so pointer picks hit the
// decal, not the surface behind it. The material's zOffset handles z-fighting.
const GROUND_PICK_LIFT = 0.15;
const WALL_PICK_LIFT = 0.04;

// Projector-box depth (along the normal) by target kind:
//  - ground: single-faced and heavily displaced → the deep default is right.
//  - deck: a thin slab → shallow box, nudged up so its back face clears the
//    underside (tolerates ~MARGIN of slope drop across the decal's downhill half).
//  - wall: thin too → shallow box centred on the face.
const DECK_PROJECTION_DEPTH = 4;
const DECK_PROJECTION_MARGIN = 0.3;
const WALL_PROJECTION_DEPTH = 0.8;

// Distinct wear patterns; a decal picks one from its position so neighbours
// don't share identical noise while the material/texture cache stays bounded.
const WEAR_VARIANTS = 8;
function wearSeed(x, y, z) {
  return Math.abs(Math.round(x * 7 + y * 11 + z * 13)) % WEAR_VARIANTS;
}

/**
 * DecalManager — one manager for every programmatic decal, whatever surface it
 * sits on (ground, bridge deck, wall, ramp).
 *
 * Decals are canvas-backed DynamicTextures (decalShapes.js) projected via
 * Babylon's CreateDecal and given the shared self-lit material (groundDecal.js).
 * CreateDecal bakes its geometry, so any move / rotate / resize rebuilds the
 * mesh (see `rebuild`). A `{ feature, mesh }` entry per decal lets DecalEditor
 * map a picked mesh back to its feature.
 *
 * Feature shape:
 *   { type:"decal", position:[x,y,z], normal:[x,y,z], rotation:<deg>, shape, … }
 * `rotation` is about the surface normal in the stable frame (see
 * groundDecal.decalStableAngle). `position` is a hint; the build re-snaps it to
 * the live surface. Polyline shape carries `points:[{x,z,radius}]` + `thickness`
 * and only applies to flat surfaces.
 */
export class DecalManager {
  constructor(scene, track, ground) {
    this._scene = scene;
    this._track = track;
    this._ground = ground;
    this._entries = [];
    this._matCache = new Map();
  }

  /** Live { feature, mesh } entries — read-only view for DecalEditor's handles. */
  get entries() { return this._entries; }

  /** True when the decal sits on a roughly-horizontal surface (ground / deck). */
  isFlatFeature(feature) {
    const n = feature.normal;
    return !Array.isArray(n) || Math.abs(n[1] ?? 1) > FLAT_NORMAL_Y;
  }

  createDecal(feature) {
    const mesh = this._buildMesh(feature);
    if (!mesh) return null;
    this._entries.push({ feature, mesh });
    return mesh;
  }

  /** Map a picked mesh back to its { feature, mesh } entry (or null). */
  findByMesh(mesh) {
    return this._entries.find((e) => e.mesh === mesh) || null;
  }

  /** Rebuild an entry's baked decal mesh from its (possibly-mutated) feature. */
  rebuild(entry) {
    entry.mesh?.dispose();
    entry.mesh = this._buildMesh(entry.feature);
    return entry.mesh;
  }

  removeByFeature(feature) {
    const idx = this._entries.findIndex((e) => e.feature === feature);
    if (idx === -1) return;
    this._entries[idx].mesh?.dispose();
    this._entries.splice(idx, 1);
  }

  /** Dispose all decal meshes and forget them (snapshot restore). Materials stay cached. */
  clearAll() {
    for (const e of this._entries) e.mesh?.dispose();
    this._entries = [];
  }

  dispose() {
    this.clearAll();
    for (const mat of this._matCache.values()) {
      mat.diffuseTexture?.dispose();
      mat.dispose();
    }
    this._matCache.clear();
  }

  // ─── Feature normalisation ────────────────────────────────────────────────

  /**
   * Normalise a `decal` feature to the internal build form.
   * @returns {object|null}
   */
  _decalParams(feature) {
    const shape = feature.shape ?? "arrow";
    if (!DECAL_SHAPES.includes(shape)) {
      console.warn(`[DecalManager] unknown decal shape: "${shape}"`);
      return null;
    }
    if (!Array.isArray(feature.position)) {
      console.warn("[DecalManager] decal missing position", feature);
      return null;
    }

    const common = {
      shape,
      color: feature.color ?? "white",
      opacity: feature.opacity ?? 1,
      count: feature.count ?? 1,
      outline: feature.outline ?? false,
      text: feature.text ?? "",
      brand: feature.brand ?? "",
      width: feature.width ?? 4,
      thickness: feature.thickness ?? 1,
      points: feature.points ?? null,
    };

    const normal = Array.isArray(feature.normal) ? Vector3.FromArray(feature.normal) : Vector3.Up();
    if (normal.lengthSquared() < 1e-6) return null;
    normal.normalize();
    return {
      ...common,
      position: Vector3.FromArray(feature.position),
      normal,
      height: feature.height ?? 4,
      rotationRad: (feature.rotation ?? 0) * DEG,
    };
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  _buildMesh(feature) {
    const p = this._decalParams(feature);
    if (!p) return null;

    const flat = Math.abs(p.normal.y) > FLAT_NORMAL_Y;

    // Polyline: the projector box (centre / size / rotation) comes from the
    // point list, not width/height/rotation. Flat surfaces only.
    let boxCenter = p.position.clone();
    let boxWidth = p.width;
    let boxHeight = p.height;
    let rotationRad = p.rotationRad;
    let localPoints = null;
    if (p.shape === "polyline") {
      if (!flat) return null;
      if (!Array.isArray(p.points) || p.points.length < 2) {
        console.warn("[DecalManager] polyline decal missing points");
        return null;
      }
      const outline = decalPolylineLocalOutline(p.points, p.thickness);
      boxCenter = new Vector3(outline.centerX, p.position.y, outline.centerZ);
      boxWidth = outline.width;
      boxHeight = outline.depth;
      // outline.angleRad is CreateDecal's raw angle; decalStableAngle(up,0)===0.
      rotationRad = outline.angleRad;
      localPoints = outline.localPoints;
    }

    // Resolve the surface to project onto.
    const { target, surfaceY } = this._resolveTarget(boxCenter, p.normal, flat);
    if (!target) {
      console.warn("[DecalManager] no decal-target surface at", boxCenter.asArray());
      return null;
    }

    // Projector box + placement by target kind.
    const onGround = target === this._ground;
    let projPos;
    let projectionDepth;
    if (!flat) {
      projPos = boxCenter.clone();
      projectionDepth = WALL_PROJECTION_DEPTH;
    } else if (onGround) {
      projPos = new Vector3(boxCenter.x, surfaceY, boxCenter.z);
      projectionDepth = undefined; // deep default
    } else {
      projPos = new Vector3(boxCenter.x, surfaceY + DECK_PROJECTION_DEPTH / 2 - DECK_PROJECTION_MARGIN, boxCenter.z);
      projectionDepth = DECK_PROJECTION_DEPTH;
    }

    const decal = projectDecal(target, `decal_${boxCenter.x.toFixed(1)}_${boxCenter.z.toFixed(1)}`, {
      position: projPos,
      normal: p.normal,
      rotationRad,
      width: boxWidth,
      height: boxHeight,
      projectionDepth,
    });
    if (!decal) return null;

    decal.material = this._getMaterial(p, boxCenter, boxWidth, boxHeight, localPoints);
    decal.isPickable = true;
    decal.metadata = { ...(decal.metadata ?? {}), decal: true, [feature.type]: true };
    if (flat) decal.position.y += GROUND_PICK_LIFT;
    else decal.position.addInPlace(p.normal.scale(WALL_PICK_LIFT));

    return decal;
  }

  /**
   * The mesh to project onto. Flat decals cast straight down for a
   * `surfaceDecalTarget` (ground / deck), falling back to the ground mesh at the
   * analytic height. Wall decals cast back along `-normal` for a `decalTarget`.
   * Re-resolved every build so a decal follows its surface through a rebuild.
   */
  _resolveTarget(position, normal, flat) {
    if (flat) {
      const hit = resolveDecalTarget(this._scene, {
        origin: new Vector3(position.x, GROUND_RAY_TOP, position.z),
        direction: Vector3.Down(),
        reach: GROUND_RAY_REACH,
        tag: "surfaceDecalTarget",
      });
      return hit
        ? { target: hit.mesh, surfaceY: hit.point.y }
        : { target: this._ground, surfaceY: this._track.getHeightAt(position.x, position.z) };
    }
    const hit = resolveDecalTarget(this._scene, {
      origin: position.add(normal.scale(SURFACE_RAY_REACH * 0.5)),
      direction: normal.scale(-1),
      reach: SURFACE_RAY_REACH,
      tag: "decalTarget",
    });
    return { target: hit?.mesh ?? null, surfaceY: hit?.point.y ?? position.y };
  }

  // ─── Material cache ───────────────────────────────────────────────────────

  _getMaterial(p, boxCenter, width, height, localPoints) {
    const worldWidth = Math.max(1, Math.round(width));
    const worldHeight = Math.max(1, Math.round(height));
    const seed = wearSeed(boxCenter.x, boxCenter.y, boxCenter.z);
    const pointsKey = localPoints
      ? `${localPoints.map((q) => `${q.x.toFixed(2)},${q.z.toFixed(2)}`).join(";")}@${p.thickness.toFixed(1)}`
      : "";
    const brandKey = p.shape === "brand" ? p.brand : "";
    const key = `${p.shape}:${p.color}:${p.opacity}:${seed}:${p.count}:${p.outline}:${p.text}:${brandKey}:${worldWidth}x${worldHeight}:${pointsKey}`;
    if (this._matCache.has(key)) return this._matCache.get(key);

    const tex = createDecalTexture(this._scene, p.shape, {
      color: p.color, seed, count: p.count, outline: p.outline, text: p.text, brand: p.brand,
      worldWidth, worldDepth: worldHeight, localPoints, thickness: p.thickness,
    });
    const mat = makeDecalMaterial(this._scene, `decalMat_${key}`, tex, p.opacity);
    this._matCache.set(key, mat);
    return mat;
  }
}
