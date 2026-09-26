import { Constants, RawTexture, Texture } from "@babylonjs/core";
import { Tunnel } from "../objects/Tunnel.js";
import { rasterizeBores, sampleBore } from "../world/tunnel-geometry.js";

/**
 * TunnelManager — builds a Tunnel for each `tunnel` feature and rebuilds them
 * on edits. A tunnel's portals depend on the terrain, so the editor also
 * rebuilds every tunnel after a terrain change.
 *
 * Also publishes the tunnels' open volume as `scene.metadata.tunnelBore`
 * (`{ texture, bounds, sample(x, z) }`, see rasterizeBores): the ground shader
 * discards terrain inside it, which opens the mouths, and steep-slope blockers
 * stay out of it. Empty on a track without tunnels.
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
    this._publishBore();
  }

  _publishBore() {
    this._clearBore();
    const raster = rasterizeBores(this._tunnels.map((t) => t.derived));
    if (!raster) return;
    const texture = RawTexture.CreateRGBATexture(
      raster.data, raster.width, raster.height, this.scene, false, false,
      Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
    );
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    const { minX, minZ, sizeX, sizeZ } = raster;
    this.scene.metadata.tunnelBore = {
      texture,
      bounds: { minX, minZ, sizeX, sizeZ },
      sample: (x, z) => sampleBore(raster, x, z),
    };
  }

  _clearBore() {
    this.scene.metadata ??= {};
    this.scene.metadata.tunnelBore?.texture.dispose();
    this.scene.metadata.tunnelBore = null;
  }

  dispose() {
    for (const t of this._tunnels) t.dispose();
    this._tunnels = [];
    this._clearBore();
  }
}
