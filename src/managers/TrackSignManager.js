import { TrackSign } from "../objects/TrackSign.js";
import { TerrainQuery } from "./TerrainQuery.js";

/**
 * TrackSignManager — creates and renders track name signs in game/practice mode.
 * No game logic needed; signs are purely decorative.
 */
export class TrackSignManager {
  constructor(scene, track) {
    this.scene  = scene;
    this.track  = track;
    this._signs = [];
    this._terrainQuery = new TerrainQuery(scene);
  }

  createSign(feature) {
    const groundY = this._terrainQuery.heightAt(feature.x, feature.z);
    const sign = new TrackSign(feature, groundY, this.scene);
    this._signs.push(sign);
  }

  dispose() {
    for (const s of this._signs) s.dispose();
    this._signs = [];
  }
}
