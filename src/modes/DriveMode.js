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
  constructor(controller) {
    super(controller);
    this._oobStateByTruckId = new Map();
    this.cameraController = null;
    this._photoModeActive = false;
  }

  /**
   * Build a driving scene for this mode from the selected track.
   */
  async buildDriveScene(trackKey) {
    const { engine, trackLoader } = this.controller;
    return buildScene(engine, trackLoader, trackKey);
  }

  togglePhotoMode() {
    if (!this.cameraController) return;
    this._photoModeActive = !this._photoModeActive;
    this.cameraController.toggleFreeMode();
    console.log(
      `[DriveMode] Screenshot camera ${this._photoModeActive ? 'enabled' : 'disabled'} - WASD to move, +/- to zoom, P to toggle`
    );
  }

  teardown() {
    if (this.inputManager) {
      this.inputManager.dispose();
      this.inputManager = null;
    }

    if (this.cameraController && this._photoModeActive) {
      this.cameraController.toggleFreeMode();
      this._photoModeActive = false;
    }
    this.cameraController = null;

    if (this.debugManager) {
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

  /** Resolve all out-of-bounds action zones from track features. */
  getOutOfBoundsZones(track) {
    return track.features.filter(
      f => f.type === "actionZone" && f.zoneType === "outOfBounds"
    );
  }

  _isPointInPolygon(x, z, points) {
    if (!points || points.length < 3) return false;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x;
      const zi = points[i].z;
      const xj = points[j].x;
      const zj = points[j].z;

      const intersects = ((zi > z) !== (zj > z))
        && (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-8) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  isPointInActionZone(x, z, zone) {
    if (!zone) return false;

    if (zone.shape === 'polygon' && Array.isArray(zone.points)) {
      return this._isPointInPolygon(x, z, zone.points);
    }

    const cx = zone.x ?? 0;
    const cz = zone.z ?? 0;
    const r = Math.max(0, zone.radius ?? 0);
    const dx = x - cx;
    const dz = z - cz;
    return (dx * dx + dz * dz) < r * r;
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
      const inSlow = slowZones.some(z => this.isPointInActionZone(pos.x, pos.z, z));

      truck.state.slowZoneActive = inSlow;
      if (!inSlow) continue;

      const limit = truck.state.slowZoneMaxSpeed;
      if (truck.state.velocity.length() > limit) {
        truck.state.velocity.normalize().scaleInPlace(limit);
      }
    }
  }

  _isPointOutsideTrackBounds(x, z, track) {
    if (!track) return false;
    const halfWidth = (track.width ?? 0) / 2;
    const halfDepth = (track.depth ?? 0) / 2;
    return Math.abs(x) > halfWidth || Math.abs(z) > halfDepth;
  }

  /**
   * Shared out-of-bounds countdown/respawn logic.
   * Returns remaining seconds (float) while active, or null when inactive.
   */
  updateOutOfBoundsCountdown({
    truckId,
    truck,
    outOfBoundsZones,
    track,
    dt,
    durationSec = 5,
    graceSecAfterRespawn = 1.5,
    onTimeout,
  }) {
    if (!truck?.mesh) return null;
    if (!outOfBoundsZones?.length && !track) return null;

    const nowMs = performance.now();
    let state = this._oobStateByTruckId.get(truckId);

    const logOobUpdate = () => {
      const shouldLog = state.lastLoggedInZone !== state.inZone
        || Math.abs(state.remainingSec - state.lastLoggedRemainingSec) >= 0.5
        || state.remainingSec <= 0;
      if (!shouldLog) return;

      state.lastLoggedInZone = state.inZone;
      state.lastLoggedRemainingSec = state.remainingSec;
    };
    if (!state) {
      state = {
        remainingSec: durationSec,
        inZone: false,
        immuneUntilMs: 0,
        lastLoggedRemainingSec: durationSec,
        lastLoggedInZone: false,
      };
      this._oobStateByTruckId.set(truckId, state);
    }

    const pos = truck.mesh.position;
    const inExplicitZone = outOfBoundsZones?.some(z => this.isPointInActionZone(pos.x, pos.z, z));
    const inTrackDeadSpace = this._isPointOutsideTrackBounds(pos.x, pos.z, track);
    const inZoneNow = inExplicitZone || inTrackDeadSpace;

    if (nowMs < state.immuneUntilMs) {
      state.inZone = false;
      state.remainingSec = durationSec;
      return null;
    }

    if (!inZoneNow) {
      state.inZone = false;
      state.remainingSec = durationSec;
      logOobUpdate();
      return null;
    }

    state.inZone = true;
    state.remainingSec = Math.max(0, state.remainingSec - dt);
    logOobUpdate();

    if (state.remainingSec <= 0) {
      onTimeout?.();
      state.remainingSec = durationSec;
      state.inZone = false;
      state.immuneUntilMs = nowMs + graceSecAfterRespawn * 1000;
      return null;
    }

    return state.remainingSec;
  }
}
