import { BridgeMesh } from "../objects/BridgeMesh.js";
import { DriveBox } from "../objects/DriveBox.js";

/**
 * BridgeMeshManager — creates and manages BridgeMesh objects from track features.
 */
export class BridgeMeshManager {
  constructor(scene, track, shadows = null, driveSurfaceManager = null, terrainBlendConfig = null) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;
    this.driveSurfaceManager = driveSurfaceManager;
    this.terrainBlendConfig = terrainBlendConfig;
    this._meshes = [];
  }

  create(feature) {
    const Ctor = feature.type === 'driveBox' ? DriveBox : BridgeMesh;
    const bm = new Ctor(
      feature,
      this.track,
      this.scene,
      this.shadows,
      this.driveSurfaceManager,
      this.terrainBlendConfig
    );
    this._meshes.push(bm);
    return bm;
  }

  /**
   * Rebuild a specific feature in-place, or all bridgeMesh features when null.
   * @param {object[]} allFeatures  Full features array from the track.
   * @param {object|null} targetFeature
   */
  rebuild(allFeatures, targetFeature = null) {
    this._meshes = this._meshes.filter(bm => {
      if (targetFeature === null || bm.feature === targetFeature) {
        bm.dispose();
        return false;
      }
      return true;
    });

    for (const feature of allFeatures) {
      if (feature.type !== 'bridgeMesh' && feature.type !== 'driveBox') continue;
      if (targetFeature === null || feature === targetFeature) {
        this.create(feature);
      }
    }
  }

  dispose() {
    for (const bm of this._meshes) bm.dispose();
    this._meshes = [];
  }
}
