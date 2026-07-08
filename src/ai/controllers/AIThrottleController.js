export const DEFAULT_THROTTLE_CONFIG = {
  speedTolerance: 0.5,
  telemetryLookWaypoints: 3,
  pathLookWaypoints: 12,
  // How far over the upcoming target speed (world units/s) the AI must be before
  // it brakes instead of just coasting. Coasting can't shed enough speed for a
  // sharp turn, so braking is what lets the AI actually hit the path's corner
  // speeds.
  brakeMargin: 3,
};

/**
 * AIThrottleController
 *
 * Computes forward/back intent from upcoming waypoint speed targets. The path's
 * corner speeds already anticipate turns (lowered by curvature + a backward
 * braking-distance pass), so here we brake toward them rather than only coast.
 */
export class AIThrottleController {
  constructor(driver, config = {}) {
    this.driver = driver;
    this.speedTolerance = config.speedTolerance ?? DEFAULT_THROTTLE_CONFIG.speedTolerance;
    this.telemetryLookWaypoints = config.telemetryLookWaypoints ?? DEFAULT_THROTTLE_CONFIG.telemetryLookWaypoints;
    this.pathLookWaypoints = config.pathLookWaypoints ?? DEFAULT_THROTTLE_CONFIG.pathLookWaypoints;
    this.brakeMargin = config.brakeMargin ?? DEFAULT_THROTTLE_CONFIG.brakeMargin;
  }

  compute({ fwdSpeed }) {
    const look = this.driver._usingTelemetry ? this.telemetryLookWaypoints : this.pathLookWaypoints;

    // Slowest target speed over the upcoming waypoints — brake for the tightest
    // point ahead, not just the one underfoot.
    let targetSpeed = Infinity;
    const end = Math.min(this.driver.currentPathIndex + look, this.driver.path.length);
    for (let wi = this.driver.currentPathIndex; wi < end; wi++) {
      const wp = this.driver.path[wi];
      if (wp.speed !== undefined && wp.speed < targetSpeed) targetSpeed = wp.speed;
    }

    if (targetSpeed === Infinity) {
      return { shouldMoveForward: true, shouldReverse: false };
    }

    // Telemetry speeds were recorded on specific terrain grip; scale to current.
    if (this.driver._usingTelemetry) {
      const recordedGrip = this.driver.path[this.driver.currentPathIndex]?.grip ?? 1;
      if (recordedGrip > 0 && this.driver.truck?._lastTerrainGrip) {
        targetSpeed *= Math.min(1, this.driver.truck._lastTerrainGrip / recordedGrip);
      }
    }

    // Well over the target → brake into the corner. Within the tolerance band →
    // coast. Below target → accelerate.
    if (fwdSpeed - targetSpeed > this.brakeMargin) {
      return { shouldMoveForward: false, shouldReverse: true };
    }
    return {
      shouldMoveForward: fwdSpeed < targetSpeed + this.speedTolerance,
      shouldReverse: false,
    };
  }
}
