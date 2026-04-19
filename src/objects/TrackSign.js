import {
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  TransformNode,
  Color3,
  Vector3,
} from "@babylonjs/core";

const BASE_BANNER_W = 10;
const BANNER_H = 2.2;
const POLE_H = 4.8;
const POLE_DIAM = 0.18;
const BANNER_TOP_MARGIN = 0.25;
const BANNER_CENTER_Y = POLE_H - BANNER_TOP_MARGIN - BANNER_H / 2;
const MIN_BANNER_W = 4;
const MAX_BANNER_W = 40;

const TEX_W = 1024;
const TEX_H = 256;

export const TRACK_SIGN_BRANDS = [
  'energizer-racing.png',
  'turbo-king.png',
  'ultra-grip.png',
];

const _brandImageCache = new Map();

function _loadBrandImage(filename) {
  const key = filename || '';
  if (_brandImageCache.has(key)) return _brandImageCache.get(key);

  const p = new Promise((resolve) => {
    if (!filename) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = new URL(`../assets/brands/${filename}`, import.meta.url).href;
  });

  _brandImageCache.set(key, p);
  return p;
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
    feature.brandImage = feature.brandImage ?? TRACK_SIGN_BRANDS[0];
    feature.background = feature.background ?? 'black';
    feature.scale = feature.scale ?? 1;
    feature.heightOffset = feature.heightOffset ?? 0;
    feature.width = Math.max(MIN_BANNER_W, Math.min(MAX_BANNER_W, feature.width ?? BASE_BANNER_W));
    const { x, z } = feature;

    this.container = new TransformNode(`sign_${x}_${z}`, scene);
    this.container.position = new Vector3(x, groundY, z);
    this.container.rotation.y = feature.rotation;
    this.container.scaling = new Vector3(feature.scale, feature.scale, feature.scale);

    this._poleMat = new StandardMaterial(`signPoleMat_${x}_${z}`, scene);
    this._poleMat.diffuseColor = new Color3(0.22, 0.22, 0.22);
    this._poleMat.specularColor = new Color3(0.08, 0.08, 0.08);

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

    this.banner = MeshBuilder.CreatePlane(`signBanner_${x}_${z}`, {
      width: BASE_BANNER_W,
      height: BANNER_H,
      sideOrientation: 2,
    }, scene);
    this.banner.parent = this.container;
    this.banner.position = new Vector3(0, BANNER_CENTER_Y + feature.heightOffset, 0);
    this.banner.isPickable = true;
    this._shadows?.addShadowCaster?.(this.banner);

    this._texture = new DynamicTexture(
      `signTex_${x}_${z}`,
      { width: TEX_W, height: TEX_H },
      scene
    );
    this._drawContent();

    this._bannerMat = new StandardMaterial(`signBannerMat_${x}_${z}`, scene);
    this._bannerMat.diffuseTexture = this._texture;
    this._bannerMat.emissiveTexture = this._texture;
    this._bannerMat.specularColor = new Color3(0.06, 0.06, 0.06);
    this._bannerMat.backFaceCulling = false;
    this.banner.material = this._bannerMat;

      this._applyHeightOffsetVisual();
      this._applyWidthVisual();
  }

    _applyWidthVisual() {
      const width = Math.max(MIN_BANNER_W, Math.min(MAX_BANNER_W, this.feature.width ?? BASE_BANNER_W));
      const half = width / 2;
      this.leftPole.position.x = -half;
      this.rightPole.position.x = half;
      this.banner.scaling.x = width / BASE_BANNER_W;
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
  }

  // ─── Content rendering ────────────────────────────────────────────────────

  async _drawContent() {
    if (this._disposed || !this._texture) return;

    const drawId = ++this._drawRequestId;
    const texture = this._texture;
    const ctx = texture.getContext();
    const bg = this.feature.background === 'white' ? '#ffffff' : '#000000';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    if (this.feature.contentType === 'brand') {
      const image = await _loadBrandImage(this.feature.brandImage);
      if (this._disposed || this._drawRequestId !== drawId || !this._texture || this._texture !== texture) return;
      if (image && image.naturalWidth > 0 && image.naturalHeight > 0) {
        const pad = 24;
        const maxH = TEX_H - pad * 2;
        const width = this.feature.width ?? BASE_BANNER_W;
        const tileCount = Math.max(1, Math.floor(width / 5));

        if (tileCount === 1) {
          const maxW = TEX_W - pad * 2;
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
            const targetW = slotW * 0.8;
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
    ctx.strokeStyle = this.feature.background === 'white' ? '#151515' : '#cc0000';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, TEX_W - 8, TEX_H - 8);
  }

  _drawTextContent(ctx, text) {
    const color = '#ff2222';
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

  setBackground(background) {
    this.feature.background = background;
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
    return mesh === this.banner || mesh === this.leftPole || mesh === this.rightPole;
  }

  dispose() {
    this._disposed = true;
    this._drawRequestId++;
    this._texture?.dispose();
    this._bannerMat?.dispose();
    this._poleMat?.dispose();
    this.banner?.dispose();
    this.leftPole?.dispose();
    this.rightPole?.dispose();
    this.container?.dispose();
    this._texture = null;
  }
}
