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
  // How much the AI steers by its trajectory (velocity) vs its nose (heading).
  // 1 = pure trajectory: over-rotates to drag a drift back onto the line and
  // scrubs speed, but wags/over-rotates everywhere. 0 = pure nose: plows wide in
  // a slide (aims the nose at the apex but ignores where it's actually going).
  // Between: rotate-and-scrub without the over-rotation.
  //
  // This is the over-rotation knob, and it is self-targeting: with no slip the
  // velocity direction IS the heading, so the blend collapses to `forward` and
  // the value is inert. It only bites once the truck is already sideways, where
  // it asks for extra yaw on top of the slip angle to point the *velocity* at
  // the target — which is where the AI was rotating past its line. Lowering it
  // softens sliding corners without touching grippy turn-in.
  trajectorySteer: 0.45,
  // Low-pass on the raw turn signal (0..1, higher = snappier). The AI only
  // re-decides steering every ~100ms, so a heavy filter here reads as late
  // turn-in and the truck washes wide through corners. Keep it responsive
  // enough to commit as soon as the look-ahead target swings.
  steeringSmooth: 0.3,
  // Proportional-steer gain: analog steer = clamp(headingError * gain, -1, 1).
  // Higher reaches full lock at a smaller error (sharper turn-in); lower is
  // gentler. Sharp corners saturate to full lock; straights stay near zero.
  steerGain: 2.5,
  // Deadband on the heading error below which the AI holds dead straight. This
  // is what stops the full-lock micro-corrections that used to saw the truck
  // left/right on straights.
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
    this.collisionProbeStart = Math.max(1, config.collisionProbeStart ?? DEFAULT_STEERING_CONFIG.collisionProbeStart);
    this.collisionProbeEnd = Math.max(this.collisionProbeStart + 1, config.collisionProbeEnd ?? DEFAULT_STEERING_CONFIG.collisionProbeEnd);
    this.collisionProbeStep = Math.max(0.5, config.collisionProbeStep ?? DEFAULT_STEERING_CONFIG.collisionProbeStep);
    this.collisionProbeLateral = Math.max(0.5, config.collisionProbeLateral ?? DEFAULT_STEERING_CONFIG.collisionProbeLateral);
    this.collisionAvoidanceMaxPush = Math.max(0, config.collisionAvoidanceMaxPush ?? DEFAULT_STEERING_CONFIG.collisionAvoidanceMaxPush);
    this.steeringSmooth = config.steeringSmooth ?? DEFAULT_STEERING_CONFIG.steeringSmooth;
    this.steerGain = config.steerGain ?? DEFAULT_STEERING_CONFIG.steerGain;
    this.trajectorySteer = config.trajectorySteer ?? DEFAULT_STEERING_CONFIG.trajectorySteer;
    this.steeringThreshold = config.steeringThreshold ?? DEFAULT_STEERING_CONFIG.steeringThreshold;

    this._smoothedTurn = 0;

    this._fwd = new Vector3(0, 0, 1);
    this._right = new Vector3(1, 0, 0);
    this._toVirt = new Vector3(0, 0, 1);
    this._velDir = new Vector3(0, 0, 1);
  }

  reset() {
    this._smoothedTurn = 0;
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

    // Steer the trajectory, not just the nose: aim a basis blended between the
    // heading and the truck's *velocity* vector at the target. Leaning on the
    // velocity makes the AI over-rotate to drag a slide back onto the line and
    // scrub speed; blending the nose back in (trajectorySteer < 1) damps that so
    // it rotates and scrubs without wagging. It's also inherently anti-spin (in a
    // spin the velocity still points roughly at the target), which is why the old
    // lateral-velocity spin damping is gone. Falls back to the nose only when
    // nearly stopped, where velocity direction is just noise.
    let steerBasis = forward;
    if (this.driver.truck) {
      const vel = this.driver.truck.state.velocity;
      const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      if (speed > 0.5) {
        const k = this.trajectorySteer;
        const bx = forward.x * (1 - k) + (vel.x / speed) * k;
        const bz = forward.z * (1 - k) + (vel.z / speed) * k;
        const bl = Math.sqrt(bx * bx + bz * bz) || 1;
        this._velDir.copyFromFloats(bx / bl, 0, bz / bl);
        steerBasis = this._velDir;
      }
    }
    let turnStrength = Vector3.Cross(steerBasis, toVirtual).y;

    const safeDt = Math.max(dt, 1 / 240);
    const smoothAlpha = 1 - Math.pow(1 - this.steeringSmooth, safeDt / (1 / 60));
    this._smoothedTurn += (turnStrength - this._smoothedTurn) * smoothAlpha;
    const headingError = this._smoothedTurn;

    // Proportional steer: the command scales with the heading error instead of
    // snapping to full lock, so small errors get small corrections and the
    // truck holds the line. Inside the deadband it drives dead straight.
    const steer = Math.abs(headingError) < this.steeringThreshold
      ? 0
      : Math.max(-1, Math.min(1, headingError * this.steerGain));

    return { forward, rightVec, steer };
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
