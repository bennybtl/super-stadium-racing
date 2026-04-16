import { Bridge } from "../objects/Bridge.js";

/**
 * BridgeManager — creates and manages bridge objects on the track.
 */
export class BridgeManager {
  constructor(scene, track, shadows, driveSurfaceManager = null) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;
    this.driveSurfaceManager = driveSurfaceManager;
    this._bridges = [];
  }

  // ─── Creation ────────────────────────────────────────────────────────────

  createBridge(feature) {
    const terrainY = this.track.getHeightAt(feature.centerX, feature.centerZ);
    const bridge = new Bridge(
      feature,
      terrainY,
      this.scene,
      this.shadows,
      this.driveSurfaceManager
    );
    this._bridges.push(bridge);
    return bridge;
  }

  getBridges() {
    return this._bridges;
  }

  /**
   * Rebuild a specific bridge feature in-place, or all bridges when null.
   * @param {object|null} targetFeature
   */
  rebuildBridge(targetFeature = null) {
    this._bridges = this._bridges.filter(bridge => {
      if (targetFeature === null || bridge.feature === targetFeature) {
        bridge.dispose?.();
        return false;
      }
      return true;
    });

    for (const feature of this.track.features) {
      if (feature.type !== "bridge") continue;
      if (targetFeature === null || feature === targetFeature) {
        this.createBridge(feature);
      }
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  rebuild() {
    this.dispose();
    for (const feature of this.track.features) {
      if (feature.type === "bridge") this.createBridge(feature);
    }
  }

  dispose() {
    for (const bridge of this._bridges) bridge.dispose();
    this._bridges = [];
  }
}
