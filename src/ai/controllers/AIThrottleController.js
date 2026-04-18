export const DEFAULT_THROTTLE_CONFIG = {
  speedTolerance: 0.5,
  telemetryLookWaypoints: 3,
  pathLookWaypoints: 12,
};

/**
 * AIThrottleController
 *
 * Computes forward/back intent from upcoming waypoint speed targets.
 */
export class AIThrottleController {
  constructor(driver, config = {}) {
    this.driver = driver;
    this.speedTolerance = config.speedTolerance ?? DEFAULT_THROTTLE_CONFIG.speedTolerance;
    this.telemetryLookWaypoints = config.telemetryLookWaypoints ?? DEFAULT_THROTTLE_CONFIG.telemetryLookWaypoints;
    this.pathLookWaypoints = config.pathLookWaypoints ?? DEFAULT_THROTTLE_CONFIG.pathLookWaypoints;
  }

  compute({ fwdSpeed }) {
    let shouldMoveForward = true;
    let shouldReverse = false;

    if (this.driver._usingTelemetry) {
      let targetSpeed = Infinity;
      for (
        let wi = this.driver.currentPathIndex;
        wi < Math.min(this.driver.currentPathIndex + this.telemetryLookWaypoints, this.driver.path.length);
        wi++
      ) {
        const wp = this.driver.path[wi];
        if (wp.speed !== undefined && wp.speed < targetSpeed) targetSpeed = wp.speed;
      }

      if (targetSpeed !== Infinity) {
        const recordedGrip = this.driver.path[this.driver.currentPathIndex]?.grip ?? 1;
        if (recordedGrip > 0 && this.driver.truck?._lastTerrainGrip) {
          targetSpeed *= Math.min(1, this.driver.truck._lastTerrainGrip / recordedGrip);
        }
        shouldMoveForward = fwdSpeed < targetSpeed + this.speedTolerance;
        shouldReverse = false;
      }
    } else {
      let targetSpeed = Infinity;
      for (
        let wi = this.driver.currentPathIndex;
        wi < Math.min(this.driver.currentPathIndex + this.pathLookWaypoints, this.driver.path.length);
        wi++
      ) {
        const wp = this.driver.path[wi];
        if (wp.speed !== undefined && wp.speed < targetSpeed) targetSpeed = wp.speed;
      }

      if (targetSpeed !== Infinity) {
        shouldMoveForward = fwdSpeed < targetSpeed + this.speedTolerance;
        shouldReverse = false;
      }
    }

    return { shouldMoveForward, shouldReverse };
  }
}
