import { Vector3 } from "@babylonjs/core";
import { TRUCK_HALF_HEIGHT as _DEFAULT_HALF_HEIGHT } from "../constants.js";

// =============================================================================
// Tunable constants
// =============================================================================

/** Downhill terrain tracking — how the truck hugs the ground on descents. */
const DOWNHILL = {
  // --- Pass 1: terrain-following detection ---
  followMaxGap:          0.15,  // max gap above terrain to still trigger following (m)
  followMinSpeed:        2,     // minimum truck speed to check (m/s)
  followLookAhead:       1.5,   // look-ahead distance for height sample (m)
  followHeightDrop:      0.3,   // terrain must drop at least this much to trigger (m)
  followVertVelMin:     -1.5,   // must be descending faster than this (m/s)
  followFakeCompression: 0.5,   // suspension compression injected when following

  // --- Suspension compression ---
  velCompressionFactor:  0.03,  // downward velocity contribution to compression
  compressionBaseScale:  0.08,  // scale applied to base compression
  suspensionSmoothing:   0.3,   // exponential smoothing factor (0–1, higher = snappier)
  maxCompression:        0.25,  // maximum suspension compression value
  groundednessRef:       0.08,  // compression at which groundedness reaches 1.0

  // --- Pass 2: groundedness boost ---
  boostMaxGap:           0.4,   // max gap above terrain to still check boost (m)
  boostVertVelMin:      -0.5,   // must be descending faster than this (m/s)
  boostMinSpeed:         2,     // minimum truck speed to check (m/s)
  boostLookAhead:        2.0,   // look-ahead distance for boost check (m)
  boostHeightDrop:       0.3,   // terrain must drop at least this much to apply boost (m)
  boostGroundedness:     0.8,   // groundedness clamped to at least this when tracking
};

/**
 * Uphill slope deceleration.
 * The truck's velocity is XZ-only so climbing doesn't naturally slow it down.
 * We apply g·sin(θ)·scale opposing the forward direction when ascending.
 */
const UPHILL = {
  gravityScale:    0.65,  // fraction of g·sin(θ) to apply (0–1; 1 = fully realistic)
  minSlopeDeg:     2,     // slopes shallower than this are ignored (degrees)
  minGroundedness: 0.3,   // only apply when at least this grounded
  minSpeed:        1.5,   // don't apply at very low speeds (m/s)
};

/**
 * Terrain spring and slope-tunneling depenetration.
 *
 * At high speed the truck can penetrate a steep slope face by several metres before
 * the spring reacts. A pure depth threshold can't distinguish this from a fast hill
 * climb (both reach 1.2–1.9 m). Instead we check slope direction at the truck's
 * position: tunneling places it on the far side of the face, so the slope reads
 * downhill in the direction of travel.
 */
const SPRING = {
  proximityThreshold:    0.2,   // spring fires when penetration > -this (m)
  compressionNorm:       0.2,   // penetration depth that saturates base compression (m)
  maxImpulsePerFrame:    3.5,   // max vertical velocity added by spring per frame (m/s)

  // Slope-tunneling depenetration
  depenetrationMinDepth: 1.2,   // minimum penetration before running tunneling check (m)
  tunnelingSlope:       -5,     // slope below this (degrees) confirms tunneling
  depenetrationSpeed:    18,    // max Y correction speed during depenetration (m/s)
  bleedRatePerMetre:     0.10,  // horizontal speed fraction bled per metre of excess penetration
  bleedCap:              0.30,  // max horizontal speed fraction bled per frame
};

/** Visual pitch/roll smoothing when grounded or airborne. */
const ORIENTATION = {
  slopeCheckDist:        0.3,   // forward/right probe distance for slope sampling (m)
  fastSmoothingRate:     10,    // exp smoothing rate for fast transitions (s⁻¹)
  slowSmoothingRate:     1.5,   // exp smoothing rate for slow transitions (s⁻¹)
  fastGroundedness:      0.8,   // groundedness above this uses fast smoothing on descent
  groundednessThreshold: 0.3,   // minimum groundedness to run terrain orientation
};

/** Vertical/visual jitter impulses over rough terrain. */
const ROUGHNESS = {
  minGroundedness:  0.3,   // minimum groundedness to apply bumps
  bumpInterval:     0.25,  // base time between bumps (s); divided by roughness
  vertImpulseScale: 3.6,   // max vertical velocity impulse per bump (m/s)
  pitchJitter:      0.22,  // max pitch jitter per bump (radians × roughness)
  rollJitter:       0.20,  // max roll jitter per bump (radians × roughness)
};

/** Steep slope blocking — prevents climbing impassable walls. */
const STEEP_SLOPE = {
  maxAngle:       Math.PI / 3,  // slopes steeper than this block movement (~60°)
  airborneGap:    0.2,          // truck bottom above terrain by this → treat as airborne (m)
  forwardProbe:   4,            // forward distance to test if slope is below trajectory (m)
  velocityAbsorb: 0.9,          // fraction of into-slope velocity removed on contact
};

/**
 * Handles terrain-related physics: gravity, suspension, and slope collision.
 */
export class TerrainPhysics {
  constructor(state, halfHeight = _DEFAULT_HALF_HEIGHT) {
    this.state = state;
    this.halfHeight = halfHeight;
    this.gravity = -30;
    this._bumpAccumulator = 0;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  update(mesh, deltaTime, track) {
    this.state.verticalVelocity += this.gravity * deltaTime;

    const terrainHeight = track ? track.getHeightAt(mesh.position.x, mesh.position.z) : 0;
    const truckBottomY  = terrainHeight + this.halfHeight;
    const penetration   = truckBottomY - mesh.position.y;

    this._applySpring(mesh, deltaTime, track, penetration, truckBottomY);

    mesh.position.y += this.state.verticalVelocity * deltaTime;

    const groundedness = this._updateSuspension(mesh, track, penetration);

    if (groundedness > ORIENTATION.groundednessThreshold && track) {
      this.updateTerrainOrientation(mesh, track, deltaTime, groundedness);
    } else {
      // Airborne: hold whatever orientation the truck had when it left the ground.
      // terrainRoll is applied by DriftPhysics; just keep rotation.x in sync.
      mesh.rotation.x = -this.state.terrainPitch;
    }

    return { groundedness, penetration };
  }

  updateTerrainOrientation(mesh, track, deltaTime, groundedness = 1) {
    const forward = this._forwardVector();
    const right   = new Vector3(Math.cos(this.state.heading), 0, -Math.sin(this.state.heading));
    const d = ORIENTATION.slopeCheckDist;
    const x = mesh.position.x;
    const z = mesh.position.z;

    const targetPitch = Math.atan2(
      track.getHeightAt(x + forward.x * d, z + forward.z * d) -
      track.getHeightAt(x - forward.x * d, z - forward.z * d),
      d * 2
    );
    const targetRoll = Math.atan2(
      track.getHeightAt(x + right.x * d, z + right.z * d) -
      track.getHeightAt(x - right.x * d, z - right.z * d),
      d * 2
    );

    // Asymmetric smoothing: increasing pitch (climbing) is always fast.
    // Decreasing pitch uses slow smoothing unless firmly grounded on landing.
    const fastFactor  = 1 - Math.exp(-ORIENTATION.fastSmoothingRate * deltaTime);
    const slowFactor  = 1 - Math.exp(-ORIENTATION.slowSmoothingRate * deltaTime);
    const pitchDiff   = targetPitch - this.state.terrainPitch;
    const pitchFactor = pitchDiff > 0
      ? fastFactor
      : (groundedness > ORIENTATION.fastGroundedness ? fastFactor : slowFactor);

    this.state.terrainPitch += pitchDiff * pitchFactor;
    this.state.terrainRoll  += (targetRoll - this.state.terrainRoll) * fastFactor;
    mesh.rotation.x = -this.state.terrainPitch;
  }

  /**
   * Apply vertical/visual jitter impulses when driving over rough terrain.
   * @param {number} roughness    - terrain roughness 0–1
   * @param {number} speed        - current horizontal speed (m/s)
   * @param {number} groundedness
   * @param {number} deltaTime
   */
  applyRoughnessBumps(roughness, speed, groundedness, deltaTime) {
    if (roughness <= 0 || groundedness < ROUGHNESS.minGroundedness) {
      this._bumpAccumulator = 0;
      return;
    }

    this._bumpAccumulator += deltaTime;

    const interval = ROUGHNESS.bumpInterval / roughness;
    if (this._bumpAccumulator < interval) return;

    this._bumpAccumulator -= interval;
    this.state.verticalVelocity += roughness * ROUGHNESS.vertImpulseScale * (0.5 + Math.random() * 0.5);
    this.state.terrainPitch     += (Math.random() - 0.5) * roughness * ROUGHNESS.pitchJitter;
    this.state.terrainRoll      += (Math.random() - 0.5) * roughness * ROUGHNESS.rollJitter;
  }

  /**
   * Decelerate the truck when climbing a slope via g·sin(θ)·scale.
   * Call after acceleration so uphill gravity has full effect.
   * @param {Mesh}   mesh
   * @param {number} deltaTime
   * @param {Track}  track
   * @param {number} groundedness - 0–1 from update()
   */
  applyUphillGravity(mesh, deltaTime, track, groundedness) {
    if (!track || groundedness < UPHILL.minGroundedness) return;

    const speed = this.state.velocity.length();
    if (speed < UPHILL.minSpeed) return;

    const slopeDeg = track.getTerrainSlopeAt(
      mesh.position.x, mesh.position.z, this._moveDirHeading(), 1, 3
    );
    if (slopeDeg <= UPHILL.minSlopeDeg) return;

    const decel    = Math.abs(this.gravity) * Math.sin(slopeDeg * Math.PI / 180) * UPHILL.gravityScale;
    const newSpeed = Math.max(0, speed - decel * deltaTime);
    this.state.velocity.scaleInPlace(newSpeed / speed);
  }

  /**
   * Block movement into impassable steep slopes.
   * @returns {Vector3} candidate next position after slope constraint applied
   */
  checkSteepSlope(mesh, deltaTime, track) {
    if (!track || this.state.velocity.length() <= 0.1) {
      return mesh.position.add(this.state.velocity.scale(deltaTime));
    }

    const truckBottom = mesh.position.y - this.halfHeight;
    const terrainHere = track.getHeightAt(mesh.position.x, mesh.position.z);

    // Skip when airborne — slope is below the truck's trajectory.
    if (truckBottom > terrainHere + STEEP_SLOPE.airborneGap) {
      return mesh.position.add(this.state.velocity.scale(deltaTime));
    }

    const moveDir  = this.state.velocity.clone().normalize();
    const slopeDeg = track.getTerrainSlopeAt(
      mesh.position.x, mesh.position.z, Math.atan2(moveDir.x, moveDir.z), 1, 3
    );

    if (slopeDeg > 0 && slopeDeg * Math.PI / 180 > STEEP_SLOPE.maxAngle) {
      const terrainAhead = track.getHeightAt(
        mesh.position.x + moveDir.x * STEEP_SLOPE.forwardProbe,
        mesh.position.z + moveDir.z * STEEP_SLOPE.forwardProbe
      );
      // Skip if terrain ahead is below the truck — we're cresting, not climbing a wall.
      if (terrainAhead >= truckBottom) {
        const velocityIntoSlope = this.state.velocity.dot(moveDir);
        if (velocityIntoSlope > 0) {
          this.state.velocity.subtractInPlace(moveDir.scale(velocityIntoSlope * STEEP_SLOPE.velocityAbsorb));
        }
      }
    }

    return mesh.position.add(this.state.velocity.scale(deltaTime));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Unit vector pointing in the truck's current heading direction. */
  _forwardVector() {
    return new Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading));
  }

  /** Heading angle derived from the current horizontal velocity vector. */
  _moveDirHeading() {
    return Math.atan2(this.state.velocity.x, this.state.velocity.z);
  }

  /**
   * Apply terrain spring force and slope-tunneling depenetration.
   * Mutates verticalVelocity and mesh.position.y.
   */
  _applySpring(mesh, deltaTime, track, penetration, truckBottomY) {
    if (penetration <= -SPRING.proximityThreshold) return;

    let effectivePenetration = penetration;

    if (penetration > SPRING.depenetrationMinDepth && track) {
      effectivePenetration = this._applyDepenetration(mesh, deltaTime, track, penetration, truckBottomY);
    }

    const springForce   = Math.max(0, effectivePenetration) * this.state.springStrength;
    const dampingForce  = -this.state.verticalVelocity * this.state.damping;
    const springImpulse = Math.min(springForce * deltaTime, SPRING.maxImpulsePerFrame);

    this.state.verticalVelocity += springImpulse + dampingForce * deltaTime;
  }

  /**
   * Detect and smoothly correct slope-face tunneling.
   * Returns the effective penetration remaining after the position correction.
   */
  _applyDepenetration(mesh, deltaTime, track, penetration, truckBottomY) {
    const slopeAtPos  = track.getTerrainSlopeAt(
      mesh.position.x, mesh.position.z, this._moveDirHeading(), 1, 3
    );
    if (slopeAtPos >= SPRING.tunnelingSlope) return penetration; // legitimate hill climb

    // Move toward the surface at a capped speed — avoids a single-frame jump.
    const frameCorrection = Math.min(penetration, SPRING.depenetrationSpeed * deltaTime);
    mesh.position.y += frameCorrection;
    const remaining = Math.max(0, truckBottomY - mesh.position.y);

    // Bleed horizontal velocity: slope face resists forward motion.
    const excess      = penetration - SPRING.depenetrationMinDepth;
    const bleedFactor = Math.min(SPRING.bleedCap, excess * SPRING.bleedRatePerMetre);
    this.state.velocity.scaleInPlace(1 - bleedFactor);

    if (this.state.verticalVelocity < 0) this.state.verticalVelocity = 0;

    return remaining;
  }

  /**
   * Compute suspension compression and groundedness from the current penetration.
   * Handles both downhill terrain-following passes.
   * @returns {number} groundedness (0–1)
   */
  _updateSuspension(mesh, track, penetration) {
    // Base compression from current overlap depth.
    let baseCompression = Math.max(0, Math.min(1, penetration / SPRING.compressionNorm));

    // Pass 1: slightly above terrain but moving downhill — inject fake compression
    // so the truck stays "grounded" through the descent.
    if (
      track &&
      penetration < 0 &&
      penetration > -DOWNHILL.followMaxGap &&
      this.state.velocity.length() > DOWNHILL.followMinSpeed
    ) {
      const forward     = this._forwardVector();
      const heightHere  = track.getHeightAt(mesh.position.x, mesh.position.z);
      const heightAhead = track.getHeightAt(
        mesh.position.x + forward.x * DOWNHILL.followLookAhead,
        mesh.position.z + forward.z * DOWNHILL.followLookAhead
      );
      if (
        heightAhead < heightHere - DOWNHILL.followHeightDrop &&
        this.state.verticalVelocity < DOWNHILL.followVertVelMin
      ) {
        baseCompression = DOWNHILL.followFakeCompression;
      }
    }

    const targetCompression = baseCompression > 0
      ? baseCompression * DOWNHILL.compressionBaseScale +
        Math.max(0, -this.state.verticalVelocity * DOWNHILL.velCompressionFactor)
      : 0;

    this.state.suspensionCompression +=
      (targetCompression - this.state.suspensionCompression) * DOWNHILL.suspensionSmoothing;
    this.state.suspensionCompression =
      Math.max(0, Math.min(DOWNHILL.maxCompression, this.state.suspensionCompression));

    let groundedness = Math.min(1, this.state.suspensionCompression / DOWNHILL.groundednessRef);

    // Pass 2: boost groundedness when clearly tracking a descending slope.
    if (
      groundedness < DOWNHILL.boostGroundedness &&
      penetration > -DOWNHILL.boostMaxGap &&
      this.state.verticalVelocity < DOWNHILL.boostVertVelMin &&
      track &&
      this.state.velocity.length() > DOWNHILL.boostMinSpeed
    ) {
      const forward     = this._forwardVector();
      const heightHere  = track.getHeightAt(mesh.position.x, mesh.position.z);
      const heightAhead = track.getHeightAt(
        mesh.position.x + forward.x * DOWNHILL.boostLookAhead,
        mesh.position.z + forward.z * DOWNHILL.boostLookAhead
      );
      if (heightAhead < heightHere - DOWNHILL.boostHeightDrop) {
        groundedness = Math.max(groundedness, DOWNHILL.boostGroundedness);
      }
    }

    return groundedness;
  }
}
