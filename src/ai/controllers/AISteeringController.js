import { Vector3 } from "@babylonjs/core";

export const DEFAULT_STEERING_CONFIG = {
  avoidanceRadius: 10,
  avoidanceMaxPush: 6,
  avoidanceIgnoreBehind: 3,
  collisionProbeStart: 3,
  collisionProbeEnd: 20,
  collisionProbeStep: 2,
  collisionProbeLateral: 3.5,
  collisionAvoidanceMaxPush: 6,
  steeringSmooth: 0.12,
  steeringThreshold: 0.05,
  steeringHysteresis: 0.2,
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
    this.collisionProbeStart = Math.max(1, config.collisionProbeStart ?? DEFAULT_STEERING_CONFIG.collisionProbeStart);
    this.collisionProbeEnd = Math.max(this.collisionProbeStart + 1, config.collisionProbeEnd ?? DEFAULT_STEERING_CONFIG.collisionProbeEnd);
    this.collisionProbeStep = Math.max(0.5, config.collisionProbeStep ?? DEFAULT_STEERING_CONFIG.collisionProbeStep);
    this.collisionProbeLateral = Math.max(0.5, config.collisionProbeLateral ?? DEFAULT_STEERING_CONFIG.collisionProbeLateral);
    this.collisionAvoidanceMaxPush = Math.max(0, config.collisionAvoidanceMaxPush ?? DEFAULT_STEERING_CONFIG.collisionAvoidanceMaxPush);
    this.steeringSmooth = config.steeringSmooth ?? DEFAULT_STEERING_CONFIG.steeringSmooth;
    this.steeringThreshold = config.steeringThreshold ?? DEFAULT_STEERING_CONFIG.steeringThreshold;
    this.steeringHysteresis = config.steeringHysteresis ?? DEFAULT_STEERING_CONFIG.steeringHysteresis;

    this._smoothedTurn = 0;
    this._lastSteerDir = 0; // -1 left, 0 center, 1 right

    this._fwd = new Vector3(0, 0, 1);
    this._right = new Vector3(1, 0, 0);
    this._toVirt = new Vector3(0, 0, 1);
  }

  reset() {
    this._smoothedTurn = 0;
    this._lastSteerDir = 0;
  }

  compute({ position, heading, targetWaypoint, dt = 1 / 60 }) {
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

    // Collision-body avoidance: probe blocked cells ahead and nudge the virtual
    // target away from nearby wall/curb/collider lanes before impact.
    const collisionOffset = this._computeCollisionAvoidanceOffset(position, forward, rightVec);
    lateralOffset += collisionOffset;

    const maxTotalOffset = this.avoidanceMaxPush + this.collisionAvoidanceMaxPush;
    lateralOffset = Math.max(-maxTotalOffset, Math.min(maxTotalOffset, lateralOffset));

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

    const safeDt = Math.max(dt, 1 / 240);
    const smoothAlpha = 1 - Math.pow(1 - this.steeringSmooth, safeDt / (1 / 60));
    this._smoothedTurn += (turnStrength - this._smoothedTurn) * smoothAlpha;
    turnStrength = this._smoothedTurn;

    // Hysteresis: require a larger threshold to reverse steering direction
    let steerDir = 0;
    if (this._lastSteerDir === 0) {
      if (turnStrength < -this.steeringThreshold) steerDir = -1;
      else if (turnStrength > this.steeringThreshold) steerDir = 1;
    } else if (this._lastSteerDir < 0) {
      if (turnStrength > this.steeringHysteresis) steerDir = 1;
      else if (turnStrength < -this.steeringThreshold) steerDir = -1;
    } else {
      if (turnStrength < -this.steeringHysteresis) steerDir = -1;
      else if (turnStrength > this.steeringThreshold) steerDir = 1;
    }
    this._lastSteerDir = steerDir;

    return { forward, rightVec, turnStrength, steerDir };
  }

  _computeCollisionAvoidanceOffset(position, forward, rightVec) {
    const driver = this.driver;
    if (!driver?.worldToGrid || !driver?.isBlocked || this.collisionAvoidanceMaxPush <= 0) {
      return 0;
    }

    const isBlockedAt = (dist, lateral = 0) => {
      const sampleX = position.x + forward.x * dist + rightVec.x * lateral;
      const sampleZ = position.z + forward.z * dist + rightVec.z * lateral;
      const cell = driver.worldToGrid(sampleX, sampleZ);
      return driver.isBlocked(cell.x, cell.z);
    };

    const start = this.collisionProbeStart;
    const end = this.collisionProbeEnd;
    const step = this.collisionProbeStep;
    const lateral = this.collisionProbeLateral;
    const farLateral = lateral * 1.8;
    const span = Math.max(1e-6, end - start);

    let push = 0;
    let samples = 0;

    for (let dist = start; dist <= end; dist += step) {
      const proximity = 1 - (dist - start) / span;

      const centerBlocked = isBlockedAt(dist, 0);
      const rightNearBlocked = isBlockedAt(dist, lateral);
      const leftNearBlocked = isBlockedAt(dist, -lateral);
      const rightFarBlocked = isBlockedAt(dist, farLateral);
      const leftFarBlocked = isBlockedAt(dist, -farLateral);

      if (rightNearBlocked) push -= proximity * 1.0;
      if (leftNearBlocked) push += proximity * 1.0;
      if (rightFarBlocked) push -= proximity * 0.6;
      if (leftFarBlocked) push += proximity * 0.6;

      if (centerBlocked) {
        if (leftNearBlocked !== rightNearBlocked) {
          push += (leftNearBlocked ? 1.2 : -1.2) * proximity;
        } else if (leftFarBlocked !== rightFarBlocked) {
          push += (leftFarBlocked ? 0.8 : -0.8) * proximity;
        }
      }

      samples += 1;
    }

    if (samples <= 0) return 0;

    const normalized = push / samples;
    const offset = normalized * this.collisionAvoidanceMaxPush;
    return Math.max(-this.collisionAvoidanceMaxPush, Math.min(this.collisionAvoidanceMaxPush, offset));
  }
}
