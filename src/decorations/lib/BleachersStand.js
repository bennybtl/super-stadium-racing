import {
  Vector3,
  TransformNode,
} from "@babylonjs/core";
import { MeshMaterialResolver } from "../../utils/mesh-materials.js";
import {
  ModelDecoration,
  applyColliderMetadata,
  colliderEnabledFor,
} from "../../objects/ModelDecoration.js";
import { centerlineNormals, buildChainlinkFence } from "../../objects/poly-ribbon.js";

const DEFAULT_COLOR = "white";
const MIN_UNITS = 1;
const MAX_UNITS = 20;

// Safety rail around the back and top-row ends of the stand so trucks (and
// spectators) can't tumble off the top. Built in model space and parented to
// the unit pivot, so it scales and rotates with the stand. Tweak by eye.
const RAIL_HEIGHT = 1.1;   // model units above the top seating surface
const RAIL_SAMPLE = 1.5;   // model units between rail samples (post spacing driver)

// The riser cube ships as a separate OBJ; resolve its bundled URL the same way
// DecorationLoader resolves modelFile, so the controller can load it directly
// without a second JSON polluting the editor's decoration list.
const OBJ_URLS = import.meta.glob('/src/decorations/*.obj', {
  query: '?url', import: 'default', eager: true,
});
const BOX_URL = OBJ_URLS['/src/decorations/bleachers_box.obj'] ?? null;

/** Clamp a unit count to a whole number in range. */
function clampUnits(v, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_UNITS, Math.max(MIN_UNITS, n));
}

/** Union bounding box of a set of source meshes, in model space. */
function boundsOf(meshes) {
  let min = null;
  let max = null;
  for (const m of meshes) {
    if (!m.getTotalVertices || m.getTotalVertices() === 0) continue;
    const bb = m.getBoundingInfo?.().boundingBox;
    if (!bb) continue;
    if (!min) { min = bb.minimum.clone(); max = bb.maximum.clone(); }
    else { min = Vector3.Minimize(min, bb.minimum); max = Vector3.Maximize(max, bb.maximum); }
  }
  return { min: min ?? Vector3.Zero(), max: max ?? Vector3.Zero() };
}

/**
 * BleachersStand — a raked seating section repeated into a grandstand.
 *
 * `width` seating sections tile across; `height` adds tiers climbing away from
 * the front. Each tier is set one step back (-Z) and up (+Y) from the last,
 * carries a seating section on top, and is supported by a column of riser cubes
 * filled all the way down to the ground (tier t → t cubes):
 *
 *     height 4, side view          height 4, front (width 4)
 *              seat                 ___________________
 *          ___/                    | // | // | // | // |   <- seating sections
 *      ___|bx|/seat                |____|____|____|____|
 *     |bx|bx|/seat
 *     |bx|bx|seat
 *     ‾‾‾‾‾‾‾/seat
 *
 * The seating section's back wall faces -Z; tiers climb away from it in -Z / +Y.
 * Spacing comes straight from each model's own bounding box, so the units always
 * tile flush. The stand is centred on the feature position with the front
 * seating row resting on the ground.
 */
export class BleachersStand {
  constructor(feature, def, groundY, scene, shadows) {
    this.feature = feature;
    this.def = def;
    this._scene = scene;
    this._shadows = (def.castsShadows === false) ? null : (shadows ?? null);
    this._meshes = [];
    this._fenceParts = []; // safety rail (tubing + chain-link), rebuilt with the units
    this._seatSrc = null;
    this._boxSrc = null;
    this._seatB = null;
    this._boxB = null;
    this._disposed = false;
    this.color = feature.color ?? def.defaultColor ?? DEFAULT_COLOR;

    const tag = `${def.id}_${feature.x.toFixed(1)}_${feature.z.toFixed(1)}`;

    // Container: world placement (position + heading + user scale).
    this.container = new TransformNode(`deco_${tag}`, scene);
    this.container.position.copyFromFloats(feature.x, groundY, feature.z);
    this.container.rotation.y = feature.heading ?? 0;
    this._applyScaling();

    // Pivot: authored-orientation correction + base scale, as for plain models.
    this._pivot = new TransformNode(`decoPivot_${tag}`, scene);
    this._pivot.parent = this.container;
    this._pivot.rotation.x = (def.rotationX ?? 0) * Math.PI / 180;
    this._pivot.position.y = def.offsetY ?? 0;
    this._pivot.scaling.setAll(def.baseScale ?? 1);

    // Per-group materials, keyed by OBJ group name (see the def's meshColors /
    // colorableMeshes): the steel frame is a fixed grey, only the seating
    // surface takes the user-chosen colour.
    this._matRes = new MeshMaterialResolver(def, scene, tag);
    this._applyColor(this.color);

    Promise.all([
      ModelDecoration.loadSourceMeshes(scene, def),
      BOX_URL
        ? ModelDecoration.loadSourceMeshes(scene, { id: `${def.id}__box`, modelUrl: BOX_URL })
        : Promise.resolve([]),
    ])
      .then(([seatSrc, boxSrc]) => {
        if (this._disposed || this.container.isDisposed()) return;
        this._seatSrc = (seatSrc ?? []).filter(m => m.getTotalVertices?.() > 0);
        this._boxSrc = (boxSrc ?? []).filter(m => m.getTotalVertices?.() > 0);
        this._seatB = boundsOf(this._seatSrc);
        this._boxB = boundsOf(this._boxSrc);
        this._rebuild();
      })
      .catch(err => console.warn(`[BleachersStand] Failed to load '${def.id}':`, err));
  }

  // ─── Layout ─────────────────────────────────────────────────────────────────

  get _width()  { return clampUnits(this.feature.width,  this.def.featureDefaults?.width  ?? 3); }
  get _height() { return clampUnits(this.feature.height, this.def.featureDefaults?.height ?? 3); }

  /** Clone the units into place. Called on load and on any width/height change. */
  _rebuild() {
    this._clearMeshes();
    if (!this._seatSrc?.length) return;

    const w = this._width;
    const h = this._height;
    const s = this._seatB;
    const b = this._boxB;
    const seatW = (s.max.x - s.min.x) || 1;
    const boxH  = b ? (b.max.y - b.min.y) || 1 : 1;
    const boxD  = b ? (b.max.z - b.min.z) || 1 : 1;

    const hasBox = !!this._boxSrc?.length;

    for (let col = 0; col < w; col++) {
      const px = (col - (w - 1) / 2) * seatW;

      for (let tier = 0; tier < (hasBox ? h : 1); tier++) {
        // Tier 0 rests on the ground; each tier climbs one step back and up.
        // The riser cubes fill the whole column down to the ground so the tier
        // is actually supported.
        const bz = (s.min.z - b.max.z) - (tier - 1) * boxD;
        for (let j = 0; j < tier; j++) {
          const by = -b.min.y + j * boxH;
          this._addUnit(this._boxSrc, `bleachersBox_${col}_${tier}_${j}`, px, by, bz);
        }
        const sy = tier * boxH - s.min.y;
        const sz = -tier * boxD;
        this._addUnit(this._seatSrc, `bleachersSeat_${col}_${tier}`, px, sy, sz);
      }
    }
    this._applyCollider();
    this._buildRail(w, hasBox ? h : 1, s, seatW, boxH, boxD);
  }

  /**
   * Chain-link safety rail around the back edge and both sides of the stand,
   * built in model space (same frame as the unit clones) and parented to the
   * pivot. The side runs rake down at the seating's own slope (boxH per boxD —
   * 45° when the riser cube is square) from the top-back corner to the foot of
   * the stairs, so there's no gap over the lower rows and no overshoot past the
   * front. Reuses the PolyWall fence primitive. Purely visual — the seating
   * units carry collision.
   */
  _buildRail(w, tiers, s, seatW, boxH, boxD) {
    const tier = tiers - 1;
    const seatH = (s.max.y - s.min.y);
    const backY = tier * boxH + seatH; // top seating surface at the back
    const xl = -(w - 1) / 2 * seatW + s.min.x;
    const xr =  (w - 1) / 2 * seatW + s.max.x;
    const zTop = -tier * boxD + s.min.z;  // back edge of the top seat
    const zBot = zTop + tier * boxD;      // foot of the rake (= s.min.z); slope stays boxH/boxD

    // Open polyline. Each corner carries the seating height there; the side runs
    // interpolate, giving a straight rake parallel to the steps.
    const corners = tier === 0
      ? [[xl, zTop, backY], [xr, zTop, backY]]
      : [
          [xl, zBot, seatH],
          [xl, zTop, backY],
          [xr, zTop, backY],
          [xr, zBot, seatH],
        ];
    const xs = [], zs = [], ys = [];
    for (let seg = 0; seg < corners.length - 1; seg++) {
      const [ax, az, ay] = corners[seg];
      const [bx, bz, by] = corners[seg + 1];
      const div = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / RAIL_SAMPLE));
      for (let k = (seg === 0 ? 0 : 1); k <= div; k++) {
        const t = k / div;
        xs.push(ax + (bx - ax) * t);
        zs.push(az + (bz - az) * t);
        ys.push(ay + (by - ay) * t);
      }
    }
    if (xs.length < 2) return;

    const sArr = [0];
    for (let i = 1; i < xs.length; i++) {
      // 3D arc length so post spacing / weave scale stay even down the rake.
      sArr.push(sArr[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1], zs[i] - zs[i - 1]));
    }
    const { nx, nz } = centerlineNormals(xs, zs, false);
    const parts = buildChainlinkFence({
      xs, zs, s: sArr, step: RAIL_SAMPLE, total: sArr[sArr.length - 1],
      nx, nz, smooth: ys,
      closed: false, scene: this._scene, bottom: 0, top: RAIL_HEIGHT,
    });
    for (const m of parts) {
      m.parent = this._pivot;
      m.isPickable = true; // clicking the rail selects the stand
      this._fenceParts.push(m);
    }
  }

  _addUnit(sources, name, x, y, z) {
    for (const src of sources) {
      const m = src.clone(`${name}_${src.name}`, this._pivot);
      m.position.set(x, y, z);
      m.isVisible = true;
      m.isPickable = true; // editor selects the stand by clicking any unit
      m.material = this._matRes.materialFor(src.name);
      if (this._shadows) {
        this._shadows.addShadowCaster(m);
        m.receiveShadows = true;
      }
      this._meshes.push(m);
    }
  }

  /**
   * Every unit is a collider when enabled — the stand is a solid structure, so
   * the def's colliderMeshes list just needs to be non-empty.
   */
  _applyCollider() {
    const on = colliderEnabledFor(this.feature, this.def);
    const targets = this.def.colliderMeshes?.length ? this._meshes : [];
    applyColliderMetadata(targets, on, this.def);
  }

  setCollider(on) {
    this.feature.collider = !!on;
    this._applyCollider();
  }

  _clearMeshes() {
    for (const m of this._meshes) m.dispose();
    this._meshes = [];
    for (const m of this._fenceParts) {
      m.material?.dispose(false, true); // fence makes a fresh material + texture per build
      m.dispose();
    }
    this._fenceParts = [];
  }

  _applyColor(colorName) {
    this._matRes.setColor(colorName ?? DEFAULT_COLOR);
  }

  _applyScaling() {
    const fallback = Number(this.def.defaultScale) || 1;
    const s = Math.max(0.1, Number(this.feature.scale) || fallback);
    this.container.scaling.setAll(s);
  }

  // ─── Instance contract ──────────────────────────────────────────────────────

  containsMesh(mesh) {
    return this._meshes.includes(mesh) || this._fenceParts.includes(mesh);
  }

  get position() {
    return this.container.position.clone();
  }

  /** Top of the stand, so the editor parks its gizmo handle above it. */
  get topY() {
    const s = this._seatB;
    const b = this._boxB;
    const seatH = s ? (s.max.y - s.min.y) : 0;
    const boxH = (b && this._boxSrc?.length) ? ((b.max.y - b.min.y) || 0) : 0;
    // Top tier's seating section sits on (height - 1) stacked steps.
    const localTop = (this._height - 1) * boxH + seatH;
    const scale = Math.max(0.1, Number(this.feature.scale) || Number(this.def.defaultScale) || 1);
    return this.container.position.y + localTop * (this.def.baseScale ?? 1) * scale;
  }

  moveTo(x, z, groundY) {
    this.feature.x = x;
    this.feature.z = z;
    this.container.position.copyFromFloats(x, groundY, z);
  }

  setHeading(radians) {
    this.feature.heading = radians;
    this.container.rotation.y = radians;
  }

  setScale(newScale) {
    this.feature.scale = Math.max(0.1, Number(newScale) || 1);
    this._applyScaling();
  }

  setColor(color) {
    this.color = color;
    this.feature.color = color;
    this._applyColor(color);
  }

  setWidth(units) {
    this.feature.width = clampUnits(units, this._width);
    this._rebuild();
  }

  setHeight(units) {
    this.feature.height = clampUnits(units, this._height);
    this._rebuild();
  }

  dispose() {
    this._disposed = true;
    this._clearMeshes();
    this._matRes?.dispose();
    this._pivot?.dispose();
    this.container.dispose();
  }
}
