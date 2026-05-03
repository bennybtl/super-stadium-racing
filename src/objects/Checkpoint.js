import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  DynamicTexture,
  SceneLoader,
  TransformNode,
} from "@babylonjs/core";
import { OBJFileLoader } from "@babylonjs/loaders/OBJ/objFileLoader";
import barrelUrl from "../assets/barrel.obj?url";

OBJFileLoader.MATERIAL_LOADING_FAILS_SILENTLY = true;
OBJFileLoader.SKIP_MATERIALS = true;

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

const BARREL_COLOR    = new Color3(0.9, 0.6, 0.2);
const BARREL_FLASH    = new Color3(0, 1, 0);
const FLASH_DURATION  = 1000; // ms
const BARREL_MODEL_SCALE = 0.1;
const BARREL_PIVOT_Y = -0.55;

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
    this._track   = track;

    const terrainHeight = track.getHeightAt(feature.centerX, feature.centerZ);

    // Parent container — children inherit position + heading rotation
    this.container = new TransformNode("checkpointContainer", scene);
    this.container.position = new Vector3(feature.centerX, terrainHeight, feature.centerZ);
    this.container.rotation.y = feature.heading;

    // Barrels at ±halfWidth along the local X axis,
    // each placed at the terrain height beneath them
    const halfWidth = feature.width / 2;
    this.barrel1 = this._createBarrel("barrel1",  halfWidth, feature, terrainHeight, track, scene, shadows);
    this.barrel2 = this._createBarrel("barrel2", -halfWidth, feature, terrainHeight, track, scene, shadows);

    // Ground decal (numbered or finish-line checkerboard)
    this.decal = feature.checkpointNumber !== null
      ? this._createDecal(feature, isFinish, scene)
      : null;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /** Flash barrels green for one second to signal a successful pass. */
  flashGreen() {
    if (this._barrel1Mat) this._barrel1Mat.diffuseColor = BARREL_FLASH.clone();
    if (this._barrel2Mat) this._barrel2Mat.diffuseColor = BARREL_FLASH.clone();
    setTimeout(() => {
      if (this._barrel1Mat) this._barrel1Mat.diffuseColor = BARREL_COLOR.clone();
      if (this._barrel2Mat) this._barrel2Mat.diffuseColor = BARREL_COLOR.clone();
    }, FLASH_DURATION);
  }

  /** Redraw the ground decal after a renumber or width change. */
  updateDecal(checkpointNumber, isFinish) {
    this.feature.checkpointNumber = checkpointNumber;
    this.isFinish = isFinish;
    if (!this.decal) return;
    this.decal.dispose();
    this.decal = this._createDecal(this.feature, isFinish, this._scene);
  }

  /** Reposition barrels and rebuild the decal after the gate width changes. */
  updateWidth(newWidth) {
    this.feature.width = newWidth;
    const halfWidth = newWidth / 2;
    const containerTerrainY = this._track.getHeightAt(this.feature.centerX, this.feature.centerZ);
    const cos = Math.cos(this.feature.heading);
    const sin = Math.sin(this.feature.heading);

    // Barrel 1 (+halfWidth)
    const w1x = this.feature.centerX + halfWidth * cos;
    const w1z = this.feature.centerZ - halfWidth * sin;
    const offset1 = this._track.getHeightAt(w1x, w1z) - containerTerrainY;
    this.barrel1.position.x =  halfWidth;
    this.barrel1.position.y =  offset1;

    // Barrel 2 (-halfWidth)
    const w2x = this.feature.centerX - halfWidth * cos;
    const w2z = this.feature.centerZ + halfWidth * sin;
    const offset2 = this._track.getHeightAt(w2x, w2z) - containerTerrainY;
    this.barrel2.position.x = -halfWidth;
    this.barrel2.position.y =  offset2;

    if (this.decal) this.updateDecal(this.feature.checkpointNumber, this.isFinish);
  }

  dispose() {
    if (this.decal)    this.decal.dispose();
    if (this.barrel1)  this.barrel1.dispose();
    if (this.barrel2)  this.barrel2.dispose();
    if (this._barrel1Mat) this._barrel1Mat.dispose();
    if (this._barrel2Mat) this._barrel2Mat.dispose();
    if (this.container) this.container.dispose();
  }

  // ─── Private: mesh construction ──────────────────────────────────────────

  _createBarrel(name, localX, feature, containerTerrainY, track, scene, shadows) {
    const barrelRoot = new TransformNode(name, scene);

    // Compute the barrel's world XZ from the container centre + heading offset
    const cos = Math.cos(feature.heading);
    const sin = Math.sin(feature.heading);
    const worldX = feature.centerX + localX * cos;
    const worldZ = feature.centerZ - localX * sin;

    // Sample terrain height at the barrel's own world position and convert
    // the difference back to local Y so the barrel sits on the ground
    const barrelTerrainY = track.getHeightAt(worldX, worldZ);
    const localYOffset   = barrelTerrainY - containerTerrainY;

    barrelRoot.position = new Vector3(localX, localYOffset, 0);
    barrelRoot.parent   = this.container;

    const barrelMat = new StandardMaterial(`${name}Mat`, scene);
    barrelMat.diffuseColor = BARREL_COLOR.clone();
    barrelMat.specularColor = new Color3(0.12, 0.08, 0.05);

    const pivot = new TransformNode(`${name}Pivot`, scene);
    pivot.parent = barrelRoot;
    pivot.position.y = BARREL_PIVOT_Y * BARREL_MODEL_SCALE;
    pivot.rotation.x = -Math.PI / 2;
    pivot.scaling.setAll(BARREL_MODEL_SCALE);

    Checkpoint._getSourceMeshes(scene).then(sourceMeshes => {
      for (const src of sourceMeshes) {
        const m = src.clone(`${name}Mesh`, pivot);
        m.isVisible = true;
        m.isPickable = true;
        m.material = barrelMat;
        m.receiveShadows = true;
        m.metadata = { ...(m.metadata ?? {}), checkpointBarrel: true };
        if (shadows) shadows.addShadowCaster(m);
      }
    }).catch(err => console.warn(`[Checkpoint] Failed to load barrel model:`, err));

    if (name === "barrel1") this._barrel1Mat = barrelMat;
    if (name === "barrel2") this._barrel2Mat = barrelMat;

    return barrelRoot;
  }

  static _getSourceMeshes(scene) {
    if (!Checkpoint._sourcePromise || Checkpoint._sourceScene !== scene) {
      const lastSlash = barrelUrl.lastIndexOf('/');
      const rootUrl = barrelUrl.substring(0, lastSlash + 1);
      const fileName = barrelUrl.substring(lastSlash + 1);
      Checkpoint._sourceScene = scene;
      Checkpoint._sourcePromise = SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene)
        .then(result => {
          for (const m of result.meshes) {
            m.isVisible = false;
            m.isPickable = false;
          }
          return result.meshes;
        });
    }
    return Checkpoint._sourcePromise;
  }

  _createDecal(feature, isFinish, scene) {
    // Finish: square texture + square decal.
    // Numbered: fixed-height texture/decal (8 world units); width scales with gate so
    // only the connector lines grow — the box and number stay the same size.
    const texH = 512;
    const fixedWorldH = 8;
    const texW   =  Math.max(texH, Math.round(texH * feature.width / fixedWorldH));
    const decalW = feature.width;
    const decalH = fixedWorldH;

    const decalTexture = new DynamicTexture("cpDecalTex", { width: texW, height: texH }, scene);
    const ctx          = decalTexture.getContext();

    ctx.clearRect(0, 0, texW, texH);
    if (isFinish) {
      this._drawFinishDecal(ctx, feature.checkpointNumber, texW, texH);
    } else {
      this._drawNumberedDecal(ctx, feature.checkpointNumber, texW, texH);
    }
    decalTexture.update();

    // Find the ground mesh to project the decal onto
    const ground = scene.getMeshByName("ground");
    if (!ground) {
      // Fallback to flat plane if ground mesh not available
      return this._createFlatDecal(decalTexture, decalW, decalH, scene);
    }

    // World position on the terrain surface at the checkpoint center
    const terrainY = this._track.getHeightAt(feature.centerX, feature.centerZ);
    const worldPos = new Vector3(feature.centerX, terrainY, feature.centerZ);

    // Project the decal onto the ground mesh.
    // - position: world coords on the surface
    // - normal: surface normal (Up for ground)
    // - size: x = width, y = depth on ground plane, z = projection depth along normal
    // - angle: rotation around the normal (heading)
    const decal = MeshBuilder.CreateDecal("cpDecal", ground, {
      position: worldPos,
      normal: Vector3.Up(),
      size: new Vector3(decalW, decalH, 10),
      angle: -feature.heading - Math.PI / 2,
    });

    const mat = new StandardMaterial("cpDecalMat", scene);
    mat.diffuseTexture  = decalTexture;
    mat.emissiveTexture = decalTexture;
    mat.opacityTexture  = decalTexture;
    mat.backFaceCulling = false;
    mat.zOffset         = -2;          // push slightly toward camera to avoid z-fighting
    decal.material = mat;

    return decal;
  }

  /** Fallback flat plane decal when the ground mesh isn't available. */
  _createFlatDecal(decalTexture, decalW, decalH, scene) {
    const decal = MeshBuilder.CreatePlane("cpDecal", { width: decalW, height: decalH }, scene);
    decal.rotation.x = Math.PI / 2;
    decal.position   = new Vector3(0, 0.06, 0);
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
  _drawArrowDecal(ctx, texW, baseWidth = 240) {
    // Direction triangle — fixed size, centered horizontally
    const triCX   = texW / 2;
    const triTop  = 20;
    const triBase = 120;
    const triHalfW = baseWidth / 2;
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.moveTo(triCX, triTop);
    ctx.lineTo(triCX - triHalfW, triBase);
    ctx.lineTo(triCX + triHalfW, triBase);
    ctx.closePath();
    ctx.fill();
  }

  _drawFinishDecal(ctx, checkpointNumber, texW, texH) {
    const rectW = texW;
    const rectX = 0;
    const rectY = 196;

    this._drawArrowDecal(ctx, texW, 240);

    const cols = Math.max(2, Math.round(rectW / 38));
    const rows = 3;
    const cellW = rectW / cols;
    const cellH = cellW;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? "white" : "transparent";
        ctx.fillRect(rectX + c * cellW, rectY + r * cellH, cellW, cellH);
      }
    }

    this._applyWearEffect(ctx, checkpointNumber, texW, false);
  }

  _drawNumberedDecal(ctx, checkpointNumber, texW, texH) {
    this._drawArrowDecal(ctx, texW)

    // Square border — fixed pixel dimensions, always centered horizontally
    const sqW = 240, sqH = 228;
    const sqLeft   = Math.round((texW - sqW) / 2);
    const sqRight  = sqLeft + sqW;
    const sqTop    = 148;
    const sqBottom = sqTop + sqH;
    ctx.strokeStyle = "white";
    ctx.lineWidth   = 18;
    ctx.strokeRect(sqLeft, sqTop, sqW, sqH);

    // Horizontal lines from each barrel edge to the square, with padding on both ends
    const lineThick = 18;
    const linePad   = 64;
    const lineY     = Math.round((sqTop + sqBottom) / 2) - lineThick / 2;
    ctx.fillStyle   = "white";
    ctx.fillRect(linePad,           lineY, sqLeft  - linePad * 2,          lineThick);
    ctx.fillRect(sqRight + linePad, lineY, texW - sqRight - linePad * 2,   lineThick);

    // Checkpoint number
    ctx.fillStyle    = "white";
    ctx.font         = "bold 210px Arial";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(checkpointNumber.toString(), texW / 2, (sqTop + sqBottom + 20) / 2);

    this._applyWearEffect(ctx, checkpointNumber, texW, true, texH);
  }

  /** Punch seeded random holes through the white paint for a worn stencil look. */
  _applyWearEffect(ctx, seed, texW, includeScratches, texH = texW) {
    const rng = seededRng(seed);
    ctx.globalCompositeOperation = "destination-out";

    // Fine speckle dropout
    for (let i = 0; i < 2500; i++) {
      const r = rng() * 4.5 + 0.5;
      ctx.beginPath();
      ctx.arc(rng() * texW, rng() * texH, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Larger worn scratches / patches
    if (includeScratches) {
      for (let i = 0; i < 60; i++) {
        ctx.save();
        ctx.translate(rng() * texW, rng() * texH);
        ctx.rotate(rng() * Math.PI);
        ctx.fillRect(0, 0, rng() * 40 + 8, rng() * 8 + 2);
        ctx.restore();
      }
    }

    ctx.globalCompositeOperation = "source-over";
  }
}
