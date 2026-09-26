import { Tunnel } from "../objects/Tunnel.js";

/**
 * TunnelManager — builds a Tunnel for each `tunnel` feature and rebuilds them
 * on edits. A tunnel's portals depend on the terrain, so the editor also
 * rebuilds every tunnel after a terrain change.
 */
export class TunnelManager {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this._tunnels = [];
  }

  create(feature) {
    const tunnel = new Tunnel(feature, this.track, this.scene);
    this._tunnels.push(tunnel);
    return tunnel;
  }

  /** Rebuild one feature's tunnel, or every tunnel when `targetFeature` is null. */
  rebuild(targetFeature = null) {
    this._tunnels = this._tunnels.filter((t) => {
      if (targetFeature !== null && t.feature !== targetFeature) return true;
      t.dispose();
      return false;
    });
    for (const feature of this.track.features) {
      if (feature.type !== "tunnel") continue;
      if (targetFeature === null || feature === targetFeature) this.create(feature);
    }
  }

  dispose() {
    for (const t of this._tunnels) t.dispose();
    this._tunnels = [];
  }
}
