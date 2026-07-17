import { Tent } from "../objects/Tent.js";
import { TerrainQuery } from "./TerrainQuery.js";

/**
 * TentManager — creates and manages tent decoration features at race time.
 * Static decoration only; no per-frame update required.
 */
export class TentManager {
  constructor(scene, track, shadows) {
    this._scene   = scene;
    this._track   = track;
    this._shadows = shadows;
    this._tents   = [];
    this._terrainQuery = new TerrainQuery(scene);
  }

  createTent(feature) {
    const groundY = this._terrainQuery.heightAt(feature.x, feature.z);
    const tent = new Tent(feature, groundY, this._scene, this._shadows);
    this._tents.push(tent);
    return tent;
  }

  rebuild() {
    this.dispose();
    for (const f of this._track.features) {
      if (f.type === "tent") this.createTent(f);
    }
  }

  dispose() {
    for (const t of this._tents) t.dispose();
    this._tents = [];
  }
}
