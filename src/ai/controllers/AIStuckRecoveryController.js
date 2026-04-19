export const DEFAULT_STUCK_CONFIG = {
  stuckThreshold: 3000,
  positionCheckInterval: 1000,
  positionStuckThreshold: 3000,
  positionStuckMinDist: 1.0,
  wallPressMaxSpeed: 2.5,
};

/**
 * AIStuckRecoveryController
 *
 * Tracks no-progress conditions and triggers respawn recovery.
 */
export class AIStuckRecoveryController {
  constructor(driver, config = {}) {
    this.driver = driver;

    this.stuckThreshold = config.stuckThreshold ?? DEFAULT_STUCK_CONFIG.stuckThreshold;
    this.positionCheckInterval = config.positionCheckInterval ?? DEFAULT_STUCK_CONFIG.positionCheckInterval;
    this.positionStuckThreshold = config.positionStuckThreshold ?? DEFAULT_STUCK_CONFIG.positionStuckThreshold;
    this.positionStuckMinDist = config.positionStuckMinDist ?? DEFAULT_STUCK_CONFIG.positionStuckMinDist;
    this.wallPressMaxSpeed = config.wallPressMaxSpeed ?? DEFAULT_STUCK_CONFIG.wallPressMaxSpeed;

    this.stuckTimer = 0;
    this.positionCheckTimer = 0;
    this.lastCheckedPosition = null;
    this.positionStuckTimer = 0;
  }

  reset() {
    this.stuckTimer = 0;
    this.positionCheckTimer = 0;
    this.positionStuckTimer = 0;
    this.lastCheckedPosition = null;
  }

  update({ dt, input, fwdSpeed, currentPos, targetWaypoint }) {
    const dtMs = dt * 1000;

    // Stuck detection — control-input stalls
    // Case A: no throttle intent for too long
    // Case B: throttle held but forward speed stays very low (wall press)
    const controlStall = (!input.forward && !input.back) ||
      (input.forward && fwdSpeed < this.wallPressMaxSpeed);

    if (controlStall) {
      this.stuckTimer += dtMs;
      if (this.stuckTimer >= this.stuckThreshold && this.driver.truckMesh) {
        this._respawnFromStuck(targetWaypoint, currentPos);
      }
    } else {
      this.stuckTimer = 0;
    }

    // Stuck detection — position hasn't changed in N ms
    this.positionCheckTimer += dtMs;
    if (this.positionCheckTimer >= this.positionCheckInterval) {
      this.positionCheckTimer = 0;
      if (this.lastCheckedPosition) {
        const dx = currentPos.x - this.lastCheckedPosition.x;
        const dz = currentPos.z - this.lastCheckedPosition.z;
        const moved = Math.sqrt(dx * dx + dz * dz);
        if (moved < this.positionStuckMinDist) {
          this.positionStuckTimer += this.positionCheckInterval;
          if (this.positionStuckTimer >= this.positionStuckThreshold && this.driver.truckMesh) {
            this._respawnFromStuck(targetWaypoint, currentPos);
          }
        } else {
          this.positionStuckTimer = 0;
        }
      }
      this.lastCheckedPosition = currentPos;
    }
  }

  _respawnFromStuck(targetWaypoint, currentPos) {
    this.driver.respawnFacingTarget(targetWaypoint);
    this.stuckTimer = 0;
    this.positionStuckTimer = 0;
    this.lastCheckedPosition = currentPos;
  }
}
