import {
  Mesh,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  TransformNode,
  Vector3,
  VertexData,
} from "@babylonjs/core";

import { basicColors } from "../constants.js";
import { loadBrandImage as _loadBrandImage } from "../utils/brand-images.js";

const BASE_BANNER_W = 10;
const BANNER_H = 2.2;
const POLE_H = 2.2;
const POLE_DIAM = 0.16;
const BANNER_TOP_MARGIN = 0;
const BANNER_CENTER_Y = POLE_H - BANNER_TOP_MARGIN - BANNER_H / 2;
const MIN_BANNER_W = 4;
const MAX_BANNER_W = 40;

const TEX_W = 1024;
const TEX_H = 256;

// ─── Hanging-sheet shape ──────────────────────────────────────────────────
// The banner is a soft sheet tied to the poles at its four corners. The top
// edge carries the load, so it runs nearly straight; below it the cloth hangs
// looser — folds start shallow under the top edge and deepen and fan out
// toward a slacker bottom edge. Static geometry, rebuilt only on width change.
const SHEET_SEGS_PER_M = 4;    // horizontal grid density
const SHEET_SEGS_Y = 10;
const SAG_PER_M = 0.035;       // mid-span droop of the bottom edge per metre of width…
const SAG_MAX = 0.35;          // …capped so wide banners don't hang to the ground
const SAG_TOP = 0.3;           // top-edge droop as a fraction of the bottom's
const FOLD_DEPTH = 0.1;        // peak out-of-plane displacement at the bottom edge, m
const FOLD_TOP = 0.08;         // fold depth under the top edge, fraction of FOLD_DEPTH
const FOLD_FAN = 0.35;         // how much fold spacing widens from top to bottom
// A broad fold, a finer ripple, and a small off-beat crease so no spacing repeats.
const FOLD_WAVELENGTHS = [2.3, 1.35, 0.83]; // m
const FOLD_LEAN = [0.2, -0.3, 0.45];        // diagonal lean (Δphase per m of height)
const FOLD_WEIGHTS = [1, 0.5, 0.25];
const FOLD_PATCHINESS = 0.45;  // along-width strength variation (0 = uniform)
const FOLD_PATCH_WAVELENGTH = 3.7; // m
// Baked fold shading. The banner is mostly self-lit (emissive texture), so
// scene lights alone can't show the ripples; vertex colours multiply the
// final colour, emissive included, and so read by day and at night.
const SHADE_LIGHT = new Vector3(-0.45, 0.55, -1).normalize(); // front-side key direction
const SHADE_STRENGTH = 1.6;
const SHADE_MIN = 0.62;

/** Deterministic 0..1 hash so each sign gets its own folds, stable across rebuilds. */
function hash01(x, z, salt) {
  const h = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Vertex data for the hanging sheet, centred on the banner node. `back`
 * reverses the winding so the same surface faces the other way (the solid
 * back sheet) — coincident with the front, but each side is back-face culled
 * so they never fight.
 */
export function buildSheetVertexData(width, seedX, seedZ, back) {
  const nx = Math.max(8, Math.round(width * SHEET_SEGS_PER_M));
  const ny = SHEET_SEGS_Y;
  const halfW = width / 2;
  const halfH = BANNER_H / 2;
  const sag = Math.min(SAG_MAX, width * SAG_PER_M);
  const phases = FOLD_WAVELENGTHS.map((_, i) => hash01(seedX, seedZ, i + 1) * Math.PI * 2);
  const patchPhase = hash01(seedX, seedZ, 9) * Math.PI * 2;

  const positions = [];
  const uvs = [];
  for (let j = 0; j <= ny; j++) {
    const v = j / ny;
    const y = -halfH + v * BANNER_H;
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const x = -halfW + u * width;
      const t = 2 * u - 1;
      const pinned = 1 - t * t; // 0 at the poles, 1 mid-span
      const hang = 1 - v;       // 0 at the taut top edge, 1 at the bottom
      // Fold lines spread apart going down, as if radiating from the top edge.
      const fanX = x / (1 + FOLD_FAN * hang);
      let fold = 0;
      for (let k = 0; k < FOLD_WAVELENGTHS.length; k++) {
        const kx = (Math.PI * 2) / FOLD_WAVELENGTHS[k];
        fold += FOLD_WEIGHTS[k] * Math.sin(kx * fanX + FOLD_LEAN[k] * kx * y + phases[k]);
      }
      const patch = 1 - FOLD_PATCHINESS * (0.5 + 0.5 * Math.sin((Math.PI * 2 * x) / FOLD_PATCH_WAVELENGTH + patchPhase));
      const depth = FOLD_DEPTH * (FOLD_TOP + (1 - FOLD_TOP) * hang * hang) * patch;
      const droop = sag * (SAG_TOP + (1 - SAG_TOP) * hang);
      positions.push(x, y - droop * pinned, depth * pinned * fold);
      uvs.push(u, v);
    }
  }

  const indices = [];
  const row = nx + 1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * row + i, b = a + 1, c = a + row + 1, d = a + row;
      // Same winding as MeshBuilder.CreatePlane (front faces -Z).
      if (back) indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
    }
  }

  const normals = [];
  VertexData.ComputeNormals(positions, indices, normals);

  // Shade relative to a flat sheet: flat stays at full brightness, faces
  // turned away from the key darken. The back side mirrors the key through
  // the sheet so both sides read the same way.
  const colors = [];
  const lz = back ? -SHADE_LIGHT.z : SHADE_LIGHT.z;
  const flatDot = Math.abs(SHADE_LIGHT.z);
  for (let n = 0; n < normals.length; n += 3) {
    const d = normals[n] * SHADE_LIGHT.x + normals[n + 1] * SHADE_LIGHT.y + normals[n + 2] * lz;
    const shade = Math.max(SHADE_MIN, Math.min(1, 1 - SHADE_STRENGTH * (flatDot - d)));
    colors.push(shade, shade, shade, 1);
  }

  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.colors = colors;
  return vd;
}

export class TrackSign {
  /**
   * @param {object}        feature  – feature object from the track (mutated in place)
   * @param {number}        groundY  – terrain height at (feature.x, feature.z)
   * @param {BABYLON.Scene} scene
   */
  constructor(feature, groundY, scene, shadows = null) {
    this.feature = feature;
    this._scene  = scene;
    this._shadows = shadows;
    this._disposed = false;
    this._drawRequestId = 0;

    feature.name = feature.name ?? 'Track Name';
    feature.rotation = feature.rotation ?? 0;
    feature.contentType = feature.contentType ?? 'text';
    feature.brandImage = feature.brandImage ?? 'energizer-racing.png';
    feature.logoScale = feature.logoScale ?? 1;
    feature.background = feature.background ?? 'black';
    feature.primaryColor = feature.primaryColor ?? 'red';
    feature.scale = feature.scale ?? 1;
    feature.heightOffset = feature.heightOffset ?? 0;
    feature.width = Math.max(MIN_BANNER_W, Math.min(MAX_BANNER_W, feature.width ?? BASE_BANNER_W));
    const { x, z } = feature;

    this.container = new TransformNode(`sign_${x}_${z}`, scene);
    this.container.position = new Vector3(x, groundY, z);
    this.container.rotation.y = feature.rotation;
    this.container.scaling = new Vector3(feature.scale, feature.scale, feature.scale);

    this._poleMat = new StandardMaterial(`signPoleMat_${x}_${z}`, scene);
    this._poleMat.diffuseColor = basicColors.black.diffuse;
    this._poleMat.specularColor = basicColors.black.emissive;

    const half = feature.width / 2;

    this.leftPole = MeshBuilder.CreateCylinder(`signPoleL_${x}_${z}`, {
      height: POLE_H,
      diameter: POLE_DIAM,
      tessellation: 10,
    }, scene);
    this.leftPole.parent = this.container;
    this.leftPole.position = new Vector3(-half, POLE_H / 2, 0);
    this.leftPole.material = this._poleMat;
    this.leftPole.isPickable = true;
    this._shadows?.addShadowCaster?.(this.leftPole);

    this.rightPole = MeshBuilder.CreateCylinder(`signPoleR_${x}_${z}`, {
      height: POLE_H,
      diameter: POLE_DIAM,
      tessellation: 10,
    }, scene);
    this.rightPole.parent = this.container;
    this.rightPole.position = new Vector3(half, POLE_H / 2, 0);
    this.rightPole.material = this._poleMat;
    this.rightPole.isPickable = true;
    this._shadows?.addShadowCaster?.(this.rightPole);

    // Front (printed) and back (solid colour) share one hanging-sheet surface;
    // geometry is filled in by _applyWidthVisual.
    this.banner = new Mesh(`signBanner_${x}_${z}`, scene);
    this.banner.parent = this.container;
    this.banner.position = new Vector3(0, BANNER_CENTER_Y + feature.heightOffset, 0);
    this.banner.isPickable = true;
    this._shadows?.addShadowCaster?.(this.banner);

    // Opaque back sheet so the sign is not see-through from behind.
    this.bannerBack = new Mesh(`signBannerBack_${x}_${z}`, scene);
    this.bannerBack.parent = this.container;
    this.bannerBack.position = new Vector3(0, BANNER_CENTER_Y + feature.heightOffset, 0);
    this.bannerBack.isPickable = true;
    this._shadows?.addShadowCaster?.(this.bannerBack);

    this._texture = new DynamicTexture(
      `signTex_${x}_${z}`,
      { width: TEX_W, height: TEX_H },
      scene
    );
    this._drawContent();

    this._bannerMat = new StandardMaterial(`signBannerMat_${x}_${z}`, scene);
    this._bannerMat.diffuseTexture = this._texture;
    this._bannerMat.emissiveTexture = this._texture;
    this._bannerMat.specularColor = basicColors.black.emissive;
    this._bannerMat.backFaceCulling = true;
    this.banner.material = this._bannerMat;

    this._bannerBackMat = new StandardMaterial(`signBannerBackMat_${x}_${z}`, scene);
    this._bannerBackMat.specularColor = basicColors.black.emissive;
    this._bannerBackMat.backFaceCulling = true;
    this.bannerBack.material = this._bannerBackMat;
    this._updateBackFaceColor();

      this._applyHeightOffsetVisual();
      this._applyWidthVisual();
  }

    _applyWidthVisual() {
      const width = Math.max(MIN_BANNER_W, Math.min(MAX_BANNER_W, this.feature.width ?? BASE_BANNER_W));
      const half = width / 2;
      this.leftPole.position.x = -half;
      this.rightPole.position.x = half;
      // Seeded from the original placement so moving a sign in the editor
      // doesn't reshuffle its folds.
      this._sheetSeed ??= { x: this.feature.x, z: this.feature.z };
      const { x, z } = this._sheetSeed;
      buildSheetVertexData(width, x, z, false).applyToMesh(this.banner);
      buildSheetVertexData(width, x, z, true).applyToMesh(this.bannerBack);
    }
  /**
   * World-space Y of the top of the sign (poles / banner top, whichever is
   * higher, after scaling). The editor parks its gizmo handle just above this.
   */
  get topY() {
    const h = this.feature.heightOffset ?? 0;
    // Poles grow with a positive offset; the banner top sits at POLE_H + h.
    const localTop = POLE_H + Math.max(0, h);
    return this.container.position.y + localTop * (this.feature.scale ?? 1);
  }

  _applyHeightOffsetVisual() {
    const h = this.feature.heightOffset ?? 0;
    const extraPole = Math.max(0, h);
    const poleHeight = POLE_H + extraPole;
    const poleScaleY = poleHeight / POLE_H;

    this.leftPole.scaling.y = poleScaleY;
    this.rightPole.scaling.y = poleScaleY;
    this.leftPole.position.y = poleHeight / 2;
    this.rightPole.position.y = poleHeight / 2;

    this.banner.position.y = BANNER_CENTER_Y + h;
    this.bannerBack.position.y = BANNER_CENTER_Y + h;
  }

  _updateBackFaceColor() {
    const { diffuse, emissive } = basicColors[this.feature.background] || basicColors.black;
    this._bannerBackMat.diffuseColor = diffuse;
    this._bannerBackMat.emissiveColor = emissive;
  }

  // ─── Content rendering ────────────────────────────────────────────────────

  async _drawContent() {
    if (this._disposed || !this._texture) return;

    const drawId = ++this._drawRequestId;
    const texture = this._texture;
    const ctx = texture.getContext();
    const bg = (basicColors[this.feature.background]?.diffuse ?? basicColors.black.diffuse).toHexString();

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    if (this.feature.contentType === 'brand') {
      const image = await _loadBrandImage(this.feature.brandImage);
      if (this._disposed || this._drawRequestId !== drawId || !this._texture || this._texture !== texture) return;
      if (image && image.naturalWidth > 0 && image.naturalHeight > 0) {
        const pad = 24;
        const logoScale = this.feature.logoScale ?? 1;
        const maxH = (TEX_H - pad * 2) * logoScale;
        const width = this.feature.width ?? BASE_BANNER_W;
        const tileCount = Math.max(1, Math.floor(width / 5));

        if (tileCount === 1) {
          const maxW = (TEX_W - pad * 2) * logoScale;
          const scale = Math.min(maxW / image.naturalWidth, maxH / image.naturalHeight);
          const w = image.naturalWidth * scale;
          const h = image.naturalHeight * scale;
          const x = (TEX_W - w) / 2;
          const y = (TEX_H - h) / 2;
          ctx.drawImage(image, x, y, w, h);
        } else {
          const availW = TEX_W - pad * 2;
          const slotW = availW / tileCount;
          for (let i = 0; i < tileCount; i++) {
            const targetW = slotW * 0.8 * logoScale;
            const scale = Math.min(targetW / image.naturalWidth, maxH / image.naturalHeight);
            const w = image.naturalWidth * scale;
            const h = image.naturalHeight * scale;
            const slotX = pad + i * slotW;
            const x = slotX + (slotW - w) * 0.5;
            const y = (TEX_H - h) * 0.5;
            ctx.drawImage(image, x, y, w, h);
          }
        }
      } else {
        this._drawFallbackText(ctx, 'BRAND');
      }
      this._drawBorder(ctx);
      if (!this._disposed && this._drawRequestId === drawId && this._texture && this._texture === texture) {
        texture.update();
      }
      return;
    }

    this._drawTextContent(ctx, this.feature.name ?? 'Track Name');
    this._drawBorder(ctx);
    if (!this._disposed && this._drawRequestId === drawId && this._texture && this._texture === texture) {
      texture.update();
    }
  }

  _drawBorder(ctx) {
    const primary = basicColors[this.feature.primaryColor] ?? basicColors.red;
    ctx.strokeStyle = primary.emissive.toHexString();
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, TEX_W - 8, TEX_H - 8);
  }

  _drawTextContent(ctx, text) {
    const primary = basicColors[this.feature.primaryColor] ?? basicColors.red;
    const color = primary.diffuse.toHexString();
    this._drawFittedCenteredText(ctx, text, color, 180);
  }

  _drawFallbackText(ctx, text) {
    const color = this.feature.background === 'white' ? '#202020' : '#f5f5f5';
    this._drawFittedCenteredText(ctx, text, color, 140);
  }

  _drawFittedCenteredText(ctx, text, color, startSize) {
    const maxW = TEX_W - 36;
    let fontSize = startSize;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold italic ${fontSize}px Arial`;
    while (ctx.measureText(text).width > maxW && fontSize > 16) {
      fontSize -= 4;
      ctx.font = `bold italic ${fontSize}px Arial`;
    }
    ctx.fillStyle = color;
    ctx.fillText(text, TEX_W / 2, TEX_H / 2);
  }

  // ─── Mutators ─────────────────────────────────────────────────────────────

  setName(name) {
    this.feature.name = name;
    this._drawContent();
  }

  setContentType(contentType) {
    this.feature.contentType = contentType;
    this._drawContent();
  }

  setBrandImage(filename) {
    this.feature.brandImage = filename;
    this._drawContent();
  }

  setLogoScale(logoScale) {
    this.feature.logoScale = Math.max(0.2, Math.min(2, logoScale));
    this._drawContent();
  }

  setBackground(background) {
    this.feature.background = background;
    this._updateBackFaceColor();
    this._drawContent();
  }

  setPrimaryColor(primaryColor) {
    this.feature.primaryColor = primaryColor;
    this._drawContent();
  }

  setRotation(radians) {
    this.feature.rotation = radians;
    this.container.rotation.y = radians;
  }

  moveTo(x, z, groundY) {
    this.feature.x       = x;
    this.feature.z       = z;
    this.container.position.copyFromFloats(x, groundY, z);
  }

  setScale(scale) {
    this.feature.scale = Math.max(0.2, scale);
    this.container.scaling.setAll(this.feature.scale);
  }

  setHeightOffset(heightOffset, groundY = null) {
    this.feature.heightOffset = heightOffset;
    this._applyHeightOffsetVisual();
    if (groundY == null) {
      return;
    }
    this.container.position.y = groundY;
  }

  setWidth(width) {
    this.feature.width = Math.max(MIN_BANNER_W, Math.min(MAX_BANNER_W, width));
    this._applyWidthVisual();
    this._drawContent();
  }

  containsMesh(mesh) {
    return mesh === this.banner || mesh === this.bannerBack || mesh === this.leftPole || mesh === this.rightPole;
  }

  dispose() {
    this._disposed = true;
    this._drawRequestId++;
    this._texture?.dispose();
    this._bannerMat?.dispose();
    this._bannerBackMat?.dispose();
    this._poleMat?.dispose();
    this.banner?.dispose();
    this.bannerBack?.dispose();
    this.leftPole?.dispose();
    this.rightPole?.dispose();
    this.container?.dispose();
    this._texture = null;
  }
}
