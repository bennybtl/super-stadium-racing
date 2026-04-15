import { BannerString } from "../objects/BannerString.js";
import { TerrainQuery } from "./TerrainQuery.js";

/**
 * BannerStringManager — creates and manages decorative banner string features.
 * Static decoration only; no per-frame update required.
 */
export class BannerStringManager {
  constructor(scene, track, shadows) {
    this._scene   = scene;
    this._track   = track;
    this._shadows = shadows;
    this._banners = [];
    this._terrainQuery = new TerrainQuery(scene);
  }

  createBanner(feature) {
    const groundY = this._terrainQuery.heightAt(feature.x, feature.z);
    const banner  = new BannerString(feature, groundY, this._scene, this._shadows);
    this._banners.push(banner);
    return banner;
  }

  rebuild() {
    this.dispose();
    for (const f of this._track.features) {
      if (f.type === "bannerString") this.createBanner(f);
    }
  }

  dispose() {
    for (const b of this._banners) b.dispose();
    this._banners = [];
  }
}
