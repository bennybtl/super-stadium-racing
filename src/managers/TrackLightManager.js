import { TrackLight } from "../objects/TrackLight.js";
import { TerrainQuery } from "./TerrainQuery.js";

/**
 * TrackLightManager — creates floodlight poles from `trackLight` features in
 * game/practice mode. Purely visual; the SpotLights illuminate night tracks.
 */
export class TrackLightManager {
  constructor(scene, track, shadows = null) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;
    this._lights = [];
    this._terrainQuery = new TerrainQuery(scene);
  }

  createLight(feature) {
    const groundY = this._terrainQuery.heightAt(feature.x, feature.z);
    const light = new TrackLight(feature, groundY, this.scene, this.shadows);
    this._lights.push(light);
    return light;
  }

  dispose() {
    for (const l of this._lights) l.dispose();
    this._lights = [];
  }
}
