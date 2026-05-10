import { MeshBuilder, StandardMaterial, Texture, Color3, Vector3, Engine } from "@babylonjs/core";

// Vite glob import — all PNGs in src/assets/decals/ keyed by relative path
const _decalModules = import.meta.glob('../assets/decals/*.png', { eager: true, query: '?url', import: 'default' });
const _decalUrls = {};
for (const [path, url] of Object.entries(_decalModules)) {
  const filename = path.split('/').at(-1);
  _decalUrls[filename] = url;
}

/**
 * SurfaceDecalManager — places static wear-and-tear decals (tire marks, gouges,
 * rough patches, holes) onto the ground mesh using Babylon's CreateDecal.
 *
 * Decals are PNGs with alpha from src/assets/decals/. The material uses
 * Engine.ALPHA_COMBINE so texture alpha masks transparency while dark pixels
 * tint the terrain colour beneath.
 *
 * Feature format (stored in track JSON):
 * {
 *   type:    "surfaceDecal",
 *   centerX: number,       // world X
 *   centerZ: number,       // world Z
 *   image:   string,       // filename, e.g. "tire_straight_long.png"
 *   width:   number,       // world units
 *   depth:   number,       // world units
 *   angle:   number,       // degrees, rotation around Y (up) axis
 *   opacity: number,       // 0–1, default 0.8
 * }
 */
export class SurfaceDecalManager {
  constructor(scene, track, ground) {
    this._scene  = scene;
    this._track  = track;
    this._ground = ground;
    this._decals = [];
    // Shared materials keyed by "filename:opacity" to avoid redundant GPU objects
    this._matCache = new Map();
  }

  createDecal(feature) {
    const {
      centerX, centerZ,
      image,
      width  = 4,
      depth  = 4,
      angle  = 0,
      opacity = 0.5,
    } = feature;

    const url = _decalUrls[image];
    if (!url) {
      console.warn(`[SurfaceDecalManager] unknown decal image: "${image}". Available: ${Object.keys(_decalUrls).join(', ')}`);
      return null;
    }

    const terrainY = this._track.getHeightAt(centerX, centerZ);
    const position = new Vector3(centerX, terrainY, centerZ);

    const decal = MeshBuilder.CreateDecal(`surfaceDecal_${centerX}_${centerZ}`, this._ground, {
      position,
      normal:  Vector3.Up(),
      // size.x = width, size.y = depth on ground plane, size.z = projection depth along normal
      size:  new Vector3(width, depth, 10),
      angle: (angle * Math.PI) / 180,
    });

    decal.material = this._getMaterial(url, image, opacity);
    decal.isPickable = false;

    this._decals.push(decal);
    return decal;
  }

  createDecalsForTrack() {
    for (const feature of this._track.features) {
      if (feature.type === 'surfaceDecal') this.createDecal(feature);
    }
  }

  _getMaterial(url, filename, opacity) {
    const key = `${filename}:${opacity}`;
    if (this._matCache.has(key)) return this._matCache.get(key);

    const tex = new Texture(url, this._scene);
    tex.hasAlpha = true;

    const mat = new StandardMaterial(`surfaceDecalMat_${key}`, this._scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.alphaMode = Engine.ALPHA_COMBINE;
    mat.alpha           = opacity;
    mat.backFaceCulling = false;
    mat.zOffset         = -2;

    this._matCache.set(key, mat);
    return mat;
  }

  dispose() {
    for (const d of this._decals) d.dispose();
    this._decals = [];
    for (const mat of this._matCache.values()) {
      mat.diffuseTexture?.dispose();
      mat.dispose();
    }
    this._matCache.clear();
  }
}
