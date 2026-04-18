import { Vector3 } from "@babylonjs/core";

export const DEFAULT_STEERING_CONFIG = {
  avoidanceRadius: 10,
  avoidanceMaxPush: 6,
  avoidanceIgnoreBehind: 3,
  steeringSmooth: 0.18,
  steeringThreshold: 0.05,
};

/**
 * AISteeringController
 *
 * Computes steering intent from heading + look-ahead target, including
 * nearby-vehicle avoidance and spin-recovery damping.
 */
export class AISteeringController {
  constructor(driver, config = {}) {
    this.driver = driver;
    this.avoidanceRadius = config.avoidanceRadius ?? DEFAULT_STEERING_CONFIG.avoidanceRadius;
    this.avoidanceMaxPush = config.avoidanceMaxPush ?? DEFAULT_STEERING_CONFIG.avoidanceMaxPush;
    this.avoidanceIgnoreBehind = config.avoidanceIgnoreBehind ?? DEFAULT_STEERING_CONFIG.avoidanceIgnoreBehind;
    this.steeringSmooth = config.steeringSmooth ?? DEFAULT_STEERING_CONFIG.steeringSmooth;
    this.steeringThreshold = config.steeringThreshold ?? DEFAULT_STEERING_CONFIG.steeringThreshold;

    this._smoothedTurn = 0;

    this._fwd = new Vector3(0, 0, 1);
    this._right = new Vector3(1, 0, 0);
    this._toVirt = new Vector3(0, 0, 1);
  }

  reset() {
    this._smoothedTurn = 0;
  }

  compute({ position, heading, targetWaypoint }) {
    // Current heading vector (scratch — no allocation)
    this._fwd.copyFromFloats(Math.sin(heading), 0, Math.cos(heading));
    const forward = this._fwd;

    // Right vector — XZ perpendicular to heading
    this._right.copyFromFloats(forward.z, 0, -forward.x);
    const rightVec = this._right;

    // Vehicle avoidance: nudge virtual target laterally away from nearby trucks.
    let lateralOffset = 0;
    for (const other of this.driver.otherTrucks) {
      if (!other?.mesh) continue;
      const odx = other.mesh.position.x - position.x;
      const odz = other.mesh.position.z - position.z;
      const distSq = odx * odx + odz * odz;
      if (distSq < 0.25 || distSq > this.avoidanceRadius * this.avoidanceRadius) continue;
      const dist = Math.sqrt(distSq);

      const fwdDist = odx * forward.x + odz * forward.z;
      if (fwdDist < -this.avoidanceIgnoreBehind) continue;

      const latDist = odx * rightVec.x + odz * rightVec.z;
      const weight = Math.pow(1 - dist / this.avoidanceRadius, 2);
      lateralOffset -= Math.sign(latDist) * weight * this.avoidanceMaxPush;
    }

    lateralOffset = Math.max(-this.avoidanceMaxPush, Math.min(this.avoidanceMaxPush, lateralOffset));

    const virtualTarget = {
      x: targetWaypoint.x + rightVec.x * lateralOffset,
      z: targetWaypoint.z + rightVec.z * lateralOffset,
    };

    // Recompute toTarget toward avoidance-adjusted virtual target.
    this._toVirt.copyFromFloats(virtualTarget.x - position.x, 0, virtualTarget.z - position.z);
    this._toVirt.normalize();
    const toVirtual = this._toVirt;

    let turnStrength = Vector3.Cross(forward, toVirtual).y;

    // Spin recovery damping.
    if (this.driver.truck) {
      const fwd = Math.abs(this.driver.truck.state.velocity.dot(forward));
      const lat = Math.abs(this.driver.truck.state.velocity.dot(rightVec));
      if (lat > fwd * 1.5 && lat > 5) {
        const spinFactor = Math.max(0.15, fwd / lat);
        turnStrength *= spinFactor;
      }
    }

    this._smoothedTurn += (turnStrength - this._smoothedTurn) * this.steeringSmooth;
    turnStrength = this._smoothedTurn;

    return { forward, rightVec, turnStrength };
  }
}
