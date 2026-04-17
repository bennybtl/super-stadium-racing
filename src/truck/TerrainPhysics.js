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
  suspensionSmoothing:   0.5,   // exponential smoothing factor (0–1, higher = snappier)
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
  speedBleedStartDeg: 36, // progressive extra speed bleed starts here (degrees)
  speedBleedMaxDeg:   60, // reaches full bleed at this slope (degrees)
  speedBleedScale:    1.5, // fraction of speed shed per second at full bleed
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
  rideHeight:            0.08,  // keep chassis slightly above sampled floor (m)

  // Slope-tunneling depenetration
  depenetrationMinDepth: 1.2,   // minimum penetration before running tunneling check (m)
  tunnelingSlope:       -5,     // slope below this (degrees) confirms tunneling
  depenetrationSpeed:    18,    // max Y correction speed during depenetration (m/s)
  bleedRatePerMetre:     0.10,  // horizontal speed fraction bled per metre of excess penetration
  bleedCap:              0.30,  // max horizontal speed fraction bled per frame
};

/** Visual pitch/roll smoothing when grounded or airborne. */
const ORIENTATION = {
  slopeCheckDist:        1.0,   // forward/right probe distance for slope sampling (m) — wider = smoother over sharp edges
  fastSmoothingRate:     10,     // exp smoothing rate for fast transitions (s⁻¹)
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

/**
 * Handles terrain-related physics: gravity, suspension, and slope collision.
 */
export class TerrainPhysics {
  constructor(state, halfHeight = _DEFAULT_HALF_HEIGHT, terrainQuery = null) {
    this.state = state;
    this.halfHeight = halfHeight;
    this.gravity = -30;
    this._bumpAccumulator = 0;
    this._terrainQuery    = terrainQuery;
    // Cached results from the most recent castDown — used by updateTerrainOrientation
    // so the normal is available without a second raycast.
    this._lastFloorNormal = new Vector3(0, 1, 0);
    // Last resolved floor Y — exposed so Truck can feed it to TruckBody.
    this.lastFloorY = 0;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Most-recently resolved terrain surface normal (world space, unit length). */
  get floorNormal() { return this._lastFloorNormal; }

  update(mesh, deltaTime, track) {
    this.state.verticalVelocity += this.gravity * deltaTime;

    // Single downward raycast from just above the truck centre.
    // Firing from the truck's current Y means the ray naturally selects the right surface:
    //   • on bridge deck  → origin is above the deck → hits the deck
    //   • under bridge    → origin is below the deck → hits the ground
    //   • open terrain    → hits the ground mesh
    // Falls back to the analytical path when no TerrainQuery is available.
    let effectiveFloor;
    if (this._terrainQuery) {
      const hit = this._terrainQuery.castDown(
        mesh.position.x, mesh.position.z, mesh.position.y + 0.1
      );
      effectiveFloor        = hit ? hit.y : 0;
      this._lastFloorNormal = hit?.normal ?? new Vector3(0, 1, 0);
    } else {
      effectiveFloor        = this._sampleFloorYAt(
        mesh.position.x,
        mesh.position.z,
        mesh.position.y + 0.1,
        track,
        0
      );
      this._lastFloorNormal = new Vector3(0, 1, 0);
    }
    this.lastFloorY = effectiveFloor;

    const truckBottomY = effectiveFloor + this.halfHeight + SPRING.rideHeight;
    const penetration  = truckBottomY - mesh.position.y;

    this._applySpring(mesh, deltaTime, track, penetration, truckBottomY);

    mesh.position.y += this.state.verticalVelocity * deltaTime;

    const groundedness = this._updateSuspension(mesh, track, penetration);
    if (groundedness > ORIENTATION.groundednessThreshold && track) {
      this.updateTerrainOrientation(mesh, deltaTime, groundedness);
    } else {
      // Airborne: hold whatever orientation the truck had when it left the ground.
      // terrainRoll is applied by DriftPhysics; just keep rotation.x in sync.
      mesh.rotation.x = -this.state.terrainPitch;
    }

    return { groundedness, penetration };
  }

  updateTerrainOrientation(mesh, deltaTime, groundedness = 1) {
    const forward = this._forwardVector();
    const right   = new Vector3(Math.cos(this.state.heading), 0, -Math.sin(this.state.heading));

    // Derive pitch and roll directly from the surface normal captured by the floor
    // raycast in update() — one operation replaces four getHeightAt probe calls.
    // atan2(-n·forward, n.y) gives the slope angle in the forward direction:
    //   rising slope ahead  → normal tilts backward → positive targetPitch (nose up)
    //   rising slope right  → normal tilts left      → positive targetRoll
    const normal = this._lastFloorNormal;

    // Guard: a surface normal with ny < 0.25 (> ~76° tilt) almost certainly came
    // from a bad ray hit — back-face, mesh edge, or penetration artifact.  Skip
    // this frame's orientation update rather than chasing a garbage target.
    if (normal.y < 0.25) return;

    // Clamp to ±45° so a single corrupt normal can't cause a violent lurch even
    // if it slips past the guard above.
    const MAX_TILT = Math.PI / 4;
    const targetPitch = Math.max(-MAX_TILT, Math.min(MAX_TILT,
      Math.atan2(-normal.dot(forward), normal.y)
    ));
    const targetRoll  = Math.max(-MAX_TILT, Math.min(MAX_TILT,
      Math.atan2(-normal.dot(right),   normal.y)
    ));

    const fastFactor  = 1 - Math.exp(-ORIENTATION.fastSmoothingRate * deltaTime);
    const slowFactor  = 1 - Math.exp(-ORIENTATION.slowSmoothingRate * deltaTime);
    const pitchDiff   = targetPitch - this.state.terrainPitch;
    // Pitch-up (climbing) tracks slope quickly so the body matches the hill.
    // Pitch-down (descending or landing) uses slow smoothing unless firmly grounded.
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
    if ((!track && !this._terrainQuery) || groundedness < UPHILL.minGroundedness) return;

    const speed = this.state.velocity.length();
    if (speed < UPHILL.minSpeed) return;

    const slopeDeg = this._sampleSlopeDegAt(
      mesh.position.x,
      mesh.position.z,
      this._moveDirHeading(),
      1,
      3,
      mesh.position.y + 0.1,
      track
    );
    if (slopeDeg <= UPHILL.minSlopeDeg) return;

    const decel = Math.abs(this.gravity) * Math.sin(slopeDeg * Math.PI / 180) * UPHILL.gravityScale;
    let newSpeed = Math.max(0, speed - decel * deltaTime);

    // Extra traction-loss bleed on very steep climbs.
    if (slopeDeg > UPHILL.speedBleedStartDeg) {
      const bleedFraction = Math.min(
        1,
        (slopeDeg - UPHILL.speedBleedStartDeg) /
        Math.max(0.001, (UPHILL.speedBleedMaxDeg - UPHILL.speedBleedStartDeg))
      );
      newSpeed *= Math.max(0, 1 - bleedFraction * UPHILL.speedBleedScale * deltaTime);
    }

    this.state.velocity.scaleInPlace(newSpeed / speed);
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
   * Public surface sampler for systems that need drivable floor height
   * (e.g. visual wheel placement).
   */
  sampleSurfaceYAt(x, z, fromY, track, fallback = 0) {
    return this._sampleFloorYAt(x, z, fromY, track, fallback);
  }

  /**
   * Resolve drivable floor height at XZ using TerrainQuery when available.
   * Falls back to analytical terrain + bridge-floor logic.
   */
  _sampleFloorYAt(x, z, fromY, track, fallback = 0) {
    if (this._terrainQuery) {
      return this._terrainQuery.castDown(x, z, fromY)?.y ?? fallback;
    }

    if (!track) return fallback;
    return track.getHeightAt(x, z);
  }

  /**
   * Sample signed slope angle in the given heading direction from floor probes.
   */
  _sampleSlopeDegAt(x, z, heading, fwdSlopeDist, offset, fromY, track) {
    const ox  = x + Math.sin(heading) * offset;
    const oz  = z + Math.cos(heading) * offset;
    const hx  = ox + Math.sin(heading) * fwdSlopeDist;
    const hz  = oz + Math.cos(heading) * fwdSlopeDist;
    const hbx = ox - Math.sin(heading) * fwdSlopeDist;
    const hbz = oz - Math.cos(heading) * fwdSlopeDist;

    const hAhead = this._sampleFloorYAt(hx,  hz,  fromY, track, 0);
    const hBack  = this._sampleFloorYAt(hbx, hbz, fromY, track, 0);

    const slopeRad = Math.atan2(hAhead - hBack, fwdSlopeDist * 2);
    return slopeRad * 180 / Math.PI;
  }

  /**
   * Apply terrain spring force and slope-tunneling depenetration.
   * Mutates verticalVelocity and mesh.position.y.
   */
  _applySpring(mesh, deltaTime, track, penetration, truckBottomY) {
    if (penetration <= -SPRING.proximityThreshold) return;

    let effectivePenetration = penetration;

    if (penetration > SPRING.depenetrationMinDepth && (track || this._terrainQuery)) {
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
    const slopeAtPos  = this._sampleSlopeDegAt(
      mesh.position.x,
      mesh.position.z,
      this._moveDirHeading(),
      1,
      3,
      mesh.position.y + 0.1,
      track
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
    const hasSurfaceSampling = !!this._terrainQuery || !!track;

    // Base compression from current overlap depth.
    let baseCompression = Math.max(0, Math.min(1, penetration / SPRING.compressionNorm));

    // Pass 1: slightly above terrain but moving downhill — inject fake compression
    // so the truck stays "grounded" through the descent.
    if (
      hasSurfaceSampling &&
      penetration < 0 &&
      penetration > -DOWNHILL.followMaxGap &&
      this.state.velocity.length() > DOWNHILL.followMinSpeed
    ) {
      const forward     = this._forwardVector();
      const heightHere  = this._sampleFloorYAt(
        mesh.position.x,
        mesh.position.z,
        mesh.position.y + 0.1,
        track,
        0
      );
      const heightAhead = this._sampleFloorYAt(
        mesh.position.x + forward.x * DOWNHILL.followLookAhead,
        mesh.position.z + forward.z * DOWNHILL.followLookAhead,
        mesh.position.y + 0.1,
        track,
        heightHere
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
      hasSurfaceSampling &&
      this.state.velocity.length() > DOWNHILL.boostMinSpeed
    ) {
      const forward     = this._forwardVector();
      const heightHere  = this._sampleFloorYAt(
        mesh.position.x,
        mesh.position.z,
        mesh.position.y + 0.1,
        track,
        0
      );
      const heightAhead = this._sampleFloorYAt(
        mesh.position.x + forward.x * DOWNHILL.boostLookAhead,
        mesh.position.z + forward.z * DOWNHILL.boostLookAhead,
        mesh.position.y + 0.1,
        track,
        heightHere
      );
      if (heightAhead < heightHere - DOWNHILL.boostHeightDrop) {
        groundedness = Math.max(groundedness, DOWNHILL.boostGroundedness);
      }
    }

    return groundedness;
  }
}
