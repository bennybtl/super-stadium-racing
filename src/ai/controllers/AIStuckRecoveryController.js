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
    const absFwdSpeed = Math.abs(fwdSpeed);

    // Stuck detection — control-input stalls
    // Case A: no throttle intent for too long
    // Case B: throttle held but forward speed stays very low (wall press)
    const lowSpeed = absFwdSpeed < this.wallPressMaxSpeed;
    const noThrottleIntent = !input.forward && !input.back;
    const pushingForwardButNotMoving = input.forward && fwdSpeed < this.wallPressMaxSpeed;
    const controlStall = (noThrottleIntent && lowSpeed) || pushingForwardButNotMoving;

    if (controlStall) {
      this.stuckTimer += dtMs;
      if (this.stuckTimer >= this.stuckThreshold && this.driver.truckMesh) {
        this._respawnFromStuck(targetWaypoint, currentPos, {
          reason: 'control-stall',
          input,
          fwdSpeed,
          absFwdSpeed,
          stuckTimerMs: this.stuckTimer,
          stuckThresholdMs: this.stuckThreshold,
          wallPressMaxSpeed: this.wallPressMaxSpeed,
          lowSpeed,
          noThrottleIntent,
          pushingForwardButNotMoving,
          controlStall,
        });
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
            this._respawnFromStuck(targetWaypoint, currentPos, {
              reason: 'position-stall',
              input,
              fwdSpeed,
              movedDist: moved,
              movedThreshold: this.positionStuckMinDist,
              positionStuckTimerMs: this.positionStuckTimer,
              positionStuckThresholdMs: this.positionStuckThreshold,
              positionCheckIntervalMs: this.positionCheckInterval,
            });
          }
        } else {
          this.positionStuckTimer = 0;
        }
      }
      this.lastCheckedPosition = currentPos;
    }
  }

  _respawnFromStuck(targetWaypoint, currentPos, details = {}) {
    const truckName = this.driver?.truck?.mesh?.name ?? this.driver?.truckMesh?.name ?? 'ai-truck';
    const posX = Number.isFinite(currentPos?.x) ? currentPos.x.toFixed(2) : 'n/a';
    const posZ = Number.isFinite(currentPos?.z) ? currentPos.z.toFixed(2) : 'n/a';
    const wpX = Number.isFinite(targetWaypoint?.x) ? targetWaypoint.x.toFixed(2) : 'n/a';
    const wpZ = Number.isFinite(targetWaypoint?.z) ? targetWaypoint.z.toFixed(2) : 'n/a';
    const speed = Number.isFinite(details?.fwdSpeed) ? details.fwdSpeed.toFixed(2) : 'n/a';
    const movedDist = Number.isFinite(details?.movedDist) ? details.movedDist.toFixed(3) : 'n/a';
    const inputForward = Boolean(details?.input?.forward);
    const inputBack = Boolean(details?.input?.back);
    const inputLeft = Boolean(details?.input?.left);
    const inputRight = Boolean(details?.input?.right);

    console.warn(
      `[AIStuckRecovery] respawn reason=${details?.reason ?? 'unknown'} ` +
      `truck=${truckName} pos=(${posX},${posZ}) wp=(${wpX},${wpZ}) ` +
      `speed=${speed} moved=${movedDist} ` +
      `timers(stuck=${Math.round(this.stuckTimer)}ms/${Math.round(this.stuckThreshold)}ms, ` +
      `position=${Math.round(this.positionStuckTimer)}ms/${Math.round(this.positionStuckThreshold)}ms) ` +
      `thresholds(movedMin=${this.positionStuckMinDist}, wallPressMaxSpeed=${this.wallPressMaxSpeed}) ` +
      `input(fwd=${inputForward}, back=${inputBack}, left=${inputLeft}, right=${inputRight})`
    );

    this.driver.respawnFacingTarget(targetWaypoint);
    this.stuckTimer = 0;
    this.positionStuckTimer = 0;
    this.lastCheckedPosition = currentPos;
  }
}
