import { TerrainQuery } from "./TerrainQuery.js";
import { createDecoration, defForFeature, isModelFeature } from "../decorations-registry.js";

/**
 * DecorationManager — creates and manages decoration features at race time.
 *
 * Handles every feature the decoration registry recognises: plain OBJ props
 * (tent, tree, arrow sign) and controller-driven ones (flag, banner string),
 * plus legacy `type: 'tent'` / `'flag'` / `'bannerString'` features from older
 * tracks. Decorations whose controller exports `update()` are advanced each
 * frame — that's how flags bend when a truck clips them.
 */
export class DecorationManager {
  constructor(scene, track, shadows) {
    this._scene   = scene;
    this._track   = track;
    this._shadows = shadows;
    this._decorations = [];
    /** Subset with a per-frame controller, so update() stays cheap. */
    this._animated = [];
    this._terrainQuery = new TerrainQuery(scene);
  }

  createDecoration(feature) {
    const def = defForFeature(feature);
    if (!def) return null;
    const groundY = this._terrainQuery.heightAt(feature.x, feature.z);
    const deco = createDecoration(feature, def, groundY, this._scene, this._shadows);
    if (!deco) return null;
    this._decorations.push(deco);
    if (typeof def.controller?.update === 'function') this._animated.push(deco);
    return deco;
  }

  /**
   * Call every frame after trucks have moved. Only decorations with a
   * controller `update()` do any work.
   */
  update(trucks, dt) {
    if (!dt || dt <= 0) return;
    for (const deco of this._animated) {
      deco.def.controller.update(deco, { dt, trucks, scene: this._scene });
    }
  }

  reset() {
    this.dispose();
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
    this._animated = [];
  }
}
