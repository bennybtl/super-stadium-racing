import {
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
} from "@babylonjs/core";
import { basicColors } from "../../src/constants.js";
import {
  ModelDecoration,
  applyColliderMetadata,
  colliderEnabledFor,
} from "../../src/objects/ModelDecoration.js";

const DEFAULT_COLOR = "gray";
const MIN_UNITS = 1;
const MAX_UNITS = 20;

/** Clamp a unit count to a whole number in range. */
function clampUnits(v, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_UNITS, Math.max(MIN_UNITS, n));
}

/**
 * Union bounding box of the loaded source meshes, in model space. Gives the
 * repeat pitch (one box) and the base offset so row 0 sits on the ground.
 */
function unitSizeOf(meshes) {
  let min = null;
  let max = null;
  for (const m of meshes) {
    if (!m.getTotalVertices || m.getTotalVertices() === 0) continue;
    const bb = m.getBoundingInfo?.().boundingBox;
    if (!bb) continue;
    if (!min) {
      min = bb.minimum.clone();
      max = bb.maximum.clone();
    } else {
      min = Vector3.Minimize(min, bb.minimum);
      max = Vector3.Maximize(max, bb.maximum);
    }
  }
  if (!min) return { x: 1, y: 1, minY: 0 };
  return {
    x: (max.x - min.x) || 1,
    y: (max.y - min.y) || 1,
    minY: min.y,
  };
}

/**
 * ScaffoldArch — one box model repeated into an arch.
 *
 * `width` boxes span the top and `height` boxes make each side pillar, so a
 * 6 × 4 arch reads:
 *
 *     [X][X][X][X][X][X]     <- top row (width)
 *     [X]            [X]
 *     [X]            [X]     <- pillars (height - 1 rows)
 *     [X]            [X]
 *
 * Boxes are cloned from the def's OBJ, so the pitch comes from the model's own
 * bounding box — swap in a bigger box and the spacing follows. The whole arch is
 * centred on the feature position with row 0 resting on the ground.
 */
export class ScaffoldArch {
  constructor(feature, def, groundY, scene, shadows) {
    this.feature = feature;
    this.def = def;
    this._scene = scene;
    this._shadows = (def.castsShadows === false) ? null : (shadows ?? null);
    this._meshes = [];
    this._sources = null;
    this._unit = null;
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

    // One material shared by every box in the arch.
    this._material = new StandardMaterial(`decoMat_${tag}`, scene);
    this._material.specularColor = new Color3(0.15, 0.15, 0.15);
    this._material.specularPower = 0;
    this._applyColor(this.color);

    ModelDecoration.loadSourceMeshes(scene, def)
      .then(sources => {
        if (this._disposed || this.container.isDisposed()) return;
        this._sources = sources;
        this._unit = unitSizeOf(sources);
        this._rebuild();
      })
      .catch(err => console.warn(`[ScaffoldArch] Failed to load '${def.id}':`, err));
  }

  // ─── Layout ─────────────────────────────────────────────────────────────────

  get _width()  { return clampUnits(this.feature.width,  this.def.featureDefaults?.width  ?? 4); }
  get _height() { return clampUnits(this.feature.height, this.def.featureDefaults?.height ?? 4); }

  /**
   * Grid cells making up the arch: a full top row plus a box on each side for
   * every row below it. Deduped, so a 1-wide arch is a single column.
   */
  _cells() {
    const w = this._width;
    const h = this._height;
    const seen = new Set();
    const cells = [];
    const add = (col, row) => {
      const key = `${col},${row}`;
      if (seen.has(key)) return;
      seen.add(key);
      cells.push({ col, row });
    };

    // Top row spans the full width.
    for (let col = 0; col < w; col++) add(col, h - 1);
    // Side pillars fill everything below it.
    for (let row = 0; row < h - 1; row++) {
      add(0, row);
      add(w - 1, row);
    }
    return cells;
  }

  /** Clone one box per cell. Called on load and whenever width/height change. */
  _rebuild() {
    this._clearMeshes();
    if (!this._sources || !this._unit) return;

    const w = this._width;
    const { x: unitX, y: unitY, minY } = this._unit;

    for (const { col, row } of this._cells()) {
      // Centre the span on the feature; row 0 rests on the ground.
      const px = (col - (w - 1) / 2) * unitX;
      const py = row * unitY - minY;

      for (const src of this._sources) {
        const m = src.clone(`scaffoldBox_${col}_${row}`, this._pivot);
        m.position.set(px, py, 0);
        m.isVisible = true;
        m.isPickable = true; // editor selects the arch by clicking any box
        m.material = this._material;
        if (this._shadows) {
          this._shadows.addShadowCaster(m);
          m.receiveShadows = true;
        }
        this._meshes.push(m);
      }
    }
    this._applyCollider();
  }

  /**
   * Every box is a collider when enabled — the arch is a solid structure, so the
   * def's colliderMeshes list just needs to name the box group.
   */
  _applyCollider() {
    const on = colliderEnabledFor(this.feature, this.def);
    const names = this.def.colliderMeshes;
    const targets = names?.length ? this._meshes : [];
    applyColliderMetadata(targets, on, this.def);
  }

  setCollider(on) {
    this.feature.collider = !!on;
    this._applyCollider();
  }

  _clearMeshes() {
    for (const m of this._meshes) m.dispose();
    this._meshes = [];
  }

  _applyColor(colorName) {
    const tint = basicColors[colorName] ?? basicColors[DEFAULT_COLOR];
    this._material.diffuseColor = tint.diffuse;
  }

  _applyScaling() {
    const s = Math.max(0.1, Number(this.feature.scale) || 1);
    this.container.scaling.setAll(s);
  }

  // ─── Instance contract ──────────────────────────────────────────────────────

  containsMesh(mesh) {
    return this._meshes.includes(mesh);
  }

  get position() {
    return this.container.position.clone();
  }

  /** Top of the arch, so the editor parks its gizmo handle above it. */
  get topY() {
    const unitY = this._unit?.y ?? 0;
    const scale = Math.max(0.1, Number(this.feature.scale) || 1);
    return this.container.position.y
      + this._height * unitY * (this.def.baseScale ?? 1) * scale;
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
    this._material?.dispose();
    this._pivot?.dispose();
    this.container.dispose();
  }
}
