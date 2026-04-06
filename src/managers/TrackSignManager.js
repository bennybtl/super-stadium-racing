import { TrackSign } from "../objects/TrackSign.js";

/**
 * TrackSignManager — creates and renders track name signs in game/practice mode.
 * No game logic needed; signs are purely decorative.
 */
export class TrackSignManager {
  constructor(scene, track) {
    this.scene  = scene;
    this.track  = track;
    this._signs = [];
  }

  createSign(feature) {
    const groundY = this.track.getHeightAt(feature.x, feature.z);
    const sign = new TrackSign(feature, groundY, this.scene);
    this._signs.push(sign);
  }

  dispose() {
    for (const s of this._signs) s.dispose();
    this._signs = [];
  }
}
