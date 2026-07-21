import { ModelDecoration } from "../objects/ModelDecoration.js";
import { TerrainQuery } from "./TerrainQuery.js";
import { defForFeature, isModelFeature } from "../decorations-registry.js";

/**
 * DecorationManager — creates and manages model-decoration features at race
 * time. Static decorations only; no per-frame update required.
 *
 * Replaces the former bespoke TentManager: it handles every feature the
 * decoration registry recognises (tent, tree, and anything else dropped into
 * /decorations/), plus legacy `type: 'tent'` features from older tracks.
 */
export class DecorationManager {
  constructor(scene, track, shadows) {
    this._scene   = scene;
    this._track   = track;
    this._shadows = shadows;
    this._decorations = [];
    this._terrainQuery = new TerrainQuery(scene);
  }

  createDecoration(feature) {
    const def = defForFeature(feature);
    if (!def) return null;
    const groundY = this._terrainQuery.heightAt(feature.x, feature.z);
    const deco = new ModelDecoration(feature, def, groundY, this._scene, this._shadows);
    this._decorations.push(deco);
    return deco;
  }

  rebuild() {
    this.dispose();
    for (const f of this._track.features) {
      if (isModelFeature(f)) this.createDecoration(f);
    }
  }

  dispose() {
    for (const d of this._decorations) d.dispose();
    this._decorations = [];
  }
}
