import { Vector3 } from "@babylonjs/core";
import { BaseMode } from "./BaseMode.js";
import { buildScene } from "./SceneBuilder.js";

/**
 * DriveMode - shared utilities for drivable gameplay modes.
 *
 * Captures common logic used by TestMode, PracticeMode and RaceMode:
 * - start/finish checkpoint discovery
 * - spawn helpers
 * - slow-zone lookup and per-frame clamping
 */
export class DriveMode extends BaseMode {
  /**
   * Build a driving scene for this mode from the selected track.
   */
  async buildDriveScene(trackKey) {
    const { engine, trackLoader } = this.controller;
    return buildScene(engine, trackLoader, trackKey);
  }

  teardown() {
    if (!this.inputManager) {
      this.inputManager.dispose();
      this.inputManager = null;
    }
    this.inputManager.dispose();
    this.inputManager = null;

    if (!this.debugManager) {
      this.debugManager.hide();
      this.debugManager = null;
    }
    super.teardown();
  }

  /**
   * Get ordered checkpoint features and the start/finish checkpoint.
   * Start/finish is defined as the checkpoint with the highest checkpointNumber.
   */
  getStartFinishInfo(track) {
    const checkpointFeatures = track.features.filter(
      f => f.type === "checkpoint" && f.checkpointNumber != null
    );
    const maxCheckpointNumber = checkpointFeatures.reduce(
      (m, f) => Math.max(m, f.checkpointNumber),
      0
    );
    const startFinishCp = checkpointFeatures.find(
      f => f.checkpointNumber === maxCheckpointNumber
    ) || null;

    return { checkpointFeatures, maxCheckpointNumber, startFinishCp };
  }

  /**
   * Spawn just behind a checkpoint heading by `backOffset` world units.
   */
  getSpawnBehindCheckpoint(track, checkpoint, truckHeight, backOffset = 6) {
    if (!checkpoint) {
      return {
        pos: new Vector3(0, truckHeight, 0),
        heading: 0,
      };
    }

    const h = checkpoint.heading;
    const x = checkpoint.centerX + Math.sin(h) * -backOffset;
    const z = checkpoint.centerZ + Math.cos(h) * -backOffset;
    return {
      pos: new Vector3(x, track.getHeightAt(x, z) + truckHeight, z),
      heading: h,
    };
  }

  /**
   * Resolve all slow-zone action zones from track features.
   */
  getSlowZones(track) {
    return track.features.filter(
      f => f.type === "actionZone" && f.zoneType === "slowZone"
    );
  }

  /**
   * Clamp speed for trucks inside any slow zone.
   * `trucks` accepts either Truck instances or truckData objects with `.truck`.
   */
  applySlowZones(trucks, slowZones) {
    if (!slowZones || slowZones.length === 0) return;

    for (const truckOrData of trucks) {
      const truck = truckOrData?.truck ?? truckOrData;
      if (!truck?.mesh || !truck?.state) continue;

      const pos = truck.mesh.position;
      const inSlow = slowZones.some(z => {
        const dx = pos.x - z.x;
        const dz = pos.z - z.z;
        return (dx * dx + dz * dz) < z.radius * z.radius;
      });

      truck.state.slowZoneActive = inSlow;
      if (!inSlow) continue;

      const limit = truck.state.slowZoneMaxSpeed;
      if (truck.state.velocity.length() > limit) {
        truck.state.velocity.normalize().scaleInPlace(limit);
      }
    }
  }
}
