import { Vector3 } from "@babylonjs/core";
import { BaseMode } from "./BaseMode.js";
import { buildScene } from "./SceneBuilder.js";
import { FrameProfiler, shouldEnableFrameProfiler } from "../managers/FrameProfiler.js";

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
    this.frameProfiler = null;
  }

  /**
   * Create and bind a per-mode frame profiler.
   */
  initFrameProfiler(name) {
    if (this.frameProfiler) {
      this.frameProfiler.dispose();
    }
    const enabled = shouldEnableFrameProfiler();
    this.frameProfiler = new FrameProfiler(name, {
      enabled,
      autoReport: enabled,
      reportEveryMs: 3000,
      maxHistoryFrames: 300,
    });
    this.frameProfiler.bindWindowApi(window, "gameLoopProfiler");
    return this.frameProfiler;
  }

  /**
   * Build a driving scene for this mode from the selected track.
   */
  async buildDriveScene(trackKey) {
    const { engine, trackLoader } = this.controller;
    const built = await buildScene(engine, trackLoader, trackKey);
    this._setupBorderWallFade(built.scene);
    return built;
  }

  /**
   * Fade a perimeter border wall out when the camera passes to its outside.
   * The chase camera can clip through the track edge on tight turns, and the
   * tall grey border wall then fills the screen instead of the truck. Physics
   * is untouched (the truck can't reach the outside) — only the visual
   * crossfades to transparent while the camera is beyond the wall, then back
   * once it returns. Applies to every drive mode; the editor builds its scene
   * via buildScene() directly, so its overhead camera is unaffected.
   */
  _setupBorderWallFade(scene) {
    const walls = ['borderNorth', 'borderSouth', 'borderEast', 'borderWest']
      .map(n => scene.getMeshByName(n))
      .filter(Boolean)
      .map(mesh => {
        // Outward normal: from track center toward the wall along its dominant
        // (thin, axis-aligned) axis. Camera is "outside" when it lies past the
        // wall along this normal.
        const { x: cx, z: cz } = mesh.position;
        const nx = Math.abs(cx) >= Math.abs(cz) ? Math.sign(cx) : 0;
        const nz = Math.abs(cz) >  Math.abs(cx) ? Math.sign(cz) : 0;
        return { mesh, cx, cz, nx, nz };
      });
    if (walls.length === 0) return;

    const FADE_RATE = 12; // per-second crossfade speed
    scene.onBeforeRenderObservable.add(() => {
      const cam = scene.activeCamera;
      if (!cam) return;
      const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      const p = cam.position;
      for (const w of walls) {
        const outside = (p.x - w.cx) * w.nx + (p.z - w.cz) * w.nz > 0;
        const target = outside ? 0 : 1;
        w.mesh.visibility += (target - w.mesh.visibility) * Math.min(1, dt * FADE_RATE);
      }
    });
  }

  togglePhotoMode() {
    if (!this.cameraController) return;
    this._photoModeActive = !this._photoModeActive;
    this.cameraController.toggleFreeMode();
    console.debug(
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
    if (this.frameProfiler) {
      this.frameProfiler.dispose(window, "gameLoopProfiler");
      this.frameProfiler = null;
    }
    super.teardown();
  }

  /**
   * Get ordered checkpoint features and the start/finish checkpoint.
   * Start/finish is defined by checkpoint feature order; the last checkpoint is the finish.
   */
  getStartFinishInfo(track) {
    const checkpointFeatures = track.features.filter(f => f.type === "checkpoint");
    // Steps, not gate count: consecutive `alternative` gates share a step.
    let maxCheckpointNumber = 0;
    checkpointFeatures.forEach((f, i) => {
      if (i === 0 || !f.alternative) maxCheckpointNumber += 1;
    });
    const startFinishCp = checkpointFeatures[checkpointFeatures.length - 1] || null;

    return { checkpointFeatures, maxCheckpointNumber, startFinishCp };
  }

  /**
   * Resolve the start/finish gate from a (possibly reversed) CheckpointManager.
   * The gate with the highest checkpointNumber is the finish; its heading already
   * reflects the traversal direction (reverse rebuilds flip it), so spawning
   * behind it works for both forward and reverse. Returns null if unnumbered.
   */
  getStartFinishCheckpoint(checkpointManager) {
    const numbered = checkpointManager.checkpointMeshes
      .map(cp => cp.feature)
      .filter(f => f.checkpointNumber != null);
    if (numbered.length === 0) return null;
    return numbered.reduce(
      (max, f) => (f.checkpointNumber > max.checkpointNumber ? f : max),
      numbered[0],
    );
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

  /** Resolve all speed-boost action zones from track features. */
  getSpeedBoostZones(track) {
    return track.features.filter(
      f => f.type === "actionZone" && f.zoneType === "speedBoost"
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
      const zone = slowZones.find(z => this.isPointInActionZone(pos.x, pos.z, z));

      truck.state.slowZoneActive = zone;
      if (!zone) continue;

      const limit = truck.state.slowZoneMaxSpeed * ((zone.slowStrength ?? 3) / 10);

      if (truck.state.velocity.length() > limit) {
        truck.state.velocity.normalize().scaleInPlace(limit);
      }
    }
  }

  /**
   * Arm a timed speed boost on any truck inside a speed-boost zone. The boost
   * re-arms each frame while inside, then lingers for `boostDuration` seconds
   * after the truck leaves (a boost-pad feel). Strength scales top speed and
   * acceleration. `trucks` accepts Truck instances or truckData with `.truck`.
   */
  applySpeedBoostZones(trucks, boostZones) {
    if (!boostZones || boostZones.length === 0) return;

    for (const truckOrData of trucks) {
      const truck = truckOrData?.truck ?? truckOrData;
      if (!truck?.mesh || !truck?.state) continue;

      const pos = truck.mesh.position;
      const zone = boostZones.find(z => this.isPointInActionZone(pos.x, pos.z, z));
      if (!zone) continue;

      const strength = Math.max(1, zone.boostStrength ?? 1.5);
      truck.state.speedBoostActive = true;
      truck.state.speedBoostTimer = Math.max(0.05, zone.boostDuration ?? 1.5);
      truck.state.speedBoostSpeedMult = strength;
      // Acceleration gets a slightly punchier multiplier so the truck actually
      // reaches the raised top speed within the boost window.
      truck.state.speedBoostAccelMult = 1 + (strength - 1) * 1.5;
    }
  }

  /**
   * Shared out-of-bounds countdown/respawn logic.
   * Returns remaining seconds (float) while active, or null when inactive.
   */
  updateOutOfBoundsCountdown({
    truckId,
    truck,
    outOfBoundsZones,
    dt,
    durationSec = 5,
    graceSecAfterRespawn = 1.5,
    onTimeout,
  }) {
    if (!truck?.mesh) return null;
    if (!outOfBoundsZones?.length) return null;

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
    // Out of bounds is driven solely by explicit out-of-bounds action zones;
    // simply leaving the track perimeter no longer counts.
    const inZoneNow = outOfBoundsZones?.some(z => this.isPointInActionZone(pos.x, pos.z, z)) ?? false;

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
