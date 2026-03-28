import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  DynamicTexture,
  TransformNode,
} from "@babylonjs/core";

/**
 * Simple seeded PRNG (mulberry32) — returns a function that yields [0, 1) floats.
 * Using the checkpoint number as the seed gives each gate a consistent wear pattern.
 */
function seededRng(seed) {
  let s = seed * 2654435761 >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

const BARREL_COLOR    = new Color3(0.8, 0.5, 0.1);
const BARREL_FLASH    = new Color3(0, 1, 0);
const FLASH_DURATION  = 1000; // ms

/**
 * Checkpoint — a single racing gate: two barrels and a ground decal.
 *
 * Owns all Babylon mesh/material creation and disposal.
 * The manager is responsible for collision detection and lifecycle orchestration.
 */
export class Checkpoint {
  /**
   * @param {object} feature   - track feature of type "checkpoint"
   * @param {boolean} isFinish - true if this is the final gate (finish line)
   * @param {Track} track      - used to sample terrain height
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(feature, isFinish, track, scene, shadows) {
    this.feature  = feature;
    this.isFinish = isFinish;
    this._scene   = scene;

    const terrainHeight = track.getHeightAt(feature.centerX, feature.centerZ);

    // Parent container — children inherit position + heading rotation
    this.container = new TransformNode("checkpointContainer", scene);
    this.container.position = new Vector3(feature.centerX, terrainHeight, feature.centerZ);
    this.container.rotation.y = feature.heading;

    // Barrels at ±halfWidth along the local X axis
    const halfWidth = feature.width / 2;
    this.barrel1 = this._createBarrel("barrel1",  halfWidth, scene);
    this.barrel2 = this._createBarrel("barrel2", -halfWidth, scene);

    if (shadows) {
      shadows.addShadowCaster(this.barrel1);
      shadows.addShadowCaster(this.barrel2);
    }

    // Ground decal (numbered or finish-line checkerboard)
    this.decal = feature.checkpointNumber !== null
      ? this._createDecal(feature, isFinish, scene)
      : null;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /** Flash barrels green for one second to signal a successful pass. */
  flashGreen() {
    this.barrel1.material.diffuseColor = BARREL_FLASH.clone();
    this.barrel2.material.diffuseColor = BARREL_FLASH.clone();
    setTimeout(() => {
      if (this.barrel1.material) this.barrel1.material.diffuseColor = BARREL_COLOR.clone();
      if (this.barrel2.material) this.barrel2.material.diffuseColor = BARREL_COLOR.clone();
    }, FLASH_DURATION);
  }

  /** Redraw the ground decal after a renumber. */
  updateDecal(checkpointNumber, isFinish) {
    this.isFinish = isFinish;
    if (!this.decal) return;

    const tex = this.decal.material.diffuseTexture;
    const ctx = tex.getContext();
    const texSize = 512;
    ctx.clearRect(0, 0, texSize, texSize);

    if (isFinish) {
      this._drawFinishDecal(ctx, checkpointNumber, texSize, this.feature.width);
    } else {
      this._drawNumberedDecal(ctx, checkpointNumber, texSize);
    }

    tex.update();
  }

  dispose() {
    if (this.decal)    this.decal.dispose();
    if (this.barrel1)  this.barrel1.dispose();
    if (this.barrel2)  this.barrel2.dispose();
    if (this.container) this.container.dispose();
  }

  // ─── Private: mesh construction ──────────────────────────────────────────

  _createBarrel(name, localX, scene) {
    const barrel = MeshBuilder.CreateCylinder(name, { height: 2, diameter: 1 }, scene);
    barrel.position = new Vector3(localX, 1, 0);
    barrel.parent   = this.container;

    const mat = new StandardMaterial(`${name}Mat`, scene);
    mat.diffuseColor = BARREL_COLOR.clone();
    barrel.material  = mat;
    return barrel;
  }

  _createDecal(feature, isFinish, scene) {
    const texSize    = 512;
    const decalTexture = new DynamicTexture("cpDecalTex", { width: texSize, height: texSize }, scene);
    const ctx        = decalTexture.getContext();

    ctx.clearRect(0, 0, texSize, texSize);
    if (isFinish) {
      this._drawFinishDecal(ctx, feature.checkpointNumber, texSize, feature.width);
    } else {
      this._drawNumberedDecal(ctx, feature.checkpointNumber, texSize);
    }
    decalTexture.update();

    const decalSize = isFinish ? feature.width * 0.82 : 8;
    const decal = MeshBuilder.CreatePlane("cpDecal", { width: decalSize, height: decalSize }, scene);
    decal.rotation.x = Math.PI / 2;  // lay flat
    decal.position   = new Vector3(0, 0.06, 0); // just above ground
    decal.parent     = this.container;

    const mat = new StandardMaterial("cpDecalMat", scene);
    mat.diffuseTexture  = decalTexture;
    mat.emissiveTexture = decalTexture;
    mat.opacityTexture  = decalTexture;
    mat.backFaceCulling = false;
    decal.material = mat;

    return decal;
  }

  // ─── Private: decal drawing ───────────────────────────────────────────────

  _drawFinishDecal(ctx, checkpointNumber, texSize, gateWidth) {
    const cols  = Math.max(2, Math.round(gateWidth / 2.5));
    const rows  = 4;
    const rectH = Math.round(texSize * 0.38);
    const rectY = Math.round((texSize - rectH) / 2);
    const cellW = texSize / cols;
    const cellH = cellW;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? "white" : "transparent";
        ctx.fillRect(c * cellW, rectY + r * cellH, cellW, cellH);
      }
    }
    this._applyWearEffect(ctx, checkpointNumber, texSize, false);
  }

  _drawNumberedDecal(ctx, checkpointNumber, texSize) {
    // Direction triangle above the square
    const triCX   = texSize / 2;
    const triTop  = 20, triBase = 120, triHalfW = 70;
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.moveTo(triCX, triTop);
    ctx.lineTo(triCX - triHalfW, triBase);
    ctx.lineTo(triCX + triHalfW, triBase);
    ctx.closePath();
    ctx.fill();

    // Square border
    const sqTop = 148, sqPad = 136;
    const sqLeft = sqPad, sqRight = texSize - sqPad, sqBottom = texSize - sqPad;
    ctx.strokeStyle = "white";
    ctx.lineWidth   = 18;
    ctx.strokeRect(sqLeft, sqTop, sqRight - sqLeft, sqBottom - sqTop);

    // Checkpoint number
    ctx.fillStyle    = "white";
    ctx.font         = "bold 210px Arial";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(checkpointNumber.toString(), texSize / 2, (sqTop + sqBottom + 20) / 2);

    this._applyWearEffect(ctx, checkpointNumber, texSize, true);
  }

  /** Punch seeded random holes through the white paint for a worn stencil look. */
  _applyWearEffect(ctx, seed, texSize, includeScratches) {
    const rng = seededRng(seed);
    ctx.globalCompositeOperation = "destination-out";

    // Fine speckle dropout
    for (let i = 0; i < 2500; i++) {
      const r = rng() * 4.5 + 0.5;
      ctx.beginPath();
      ctx.arc(rng() * texSize, rng() * texSize, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Larger worn scratches / patches
    if (includeScratches) {
      for (let i = 0; i < 60; i++) {
        ctx.save();
        ctx.translate(rng() * texSize, rng() * texSize);
        ctx.rotate(rng() * Math.PI);
        ctx.fillRect(0, 0, rng() * 40 + 8, rng() * 8 + 2);
        ctx.restore();
      }
    }

    ctx.globalCompositeOperation = "source-over";
  }
}
