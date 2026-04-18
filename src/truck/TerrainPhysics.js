import { Vector3 } from "@babylonjs/core";
import { TRUCK_HALF_HEIGHT as _DEFAULT_HALF_HEIGHT } from "../constants.js";

const GRAVITY    = -30;           // m/s²
const DEG_TO_RAD = Math.PI / 180;
const RAY_OFFSET = 0.1;           // vertical offset above truck centre for raycasts (m)
const UP         = new Vector3(0, 1, 0);  // world-up — reused to avoid per-frame allocation

// =============================================================================
// Tunable constants
// =============================================================================

/** Pass 1: detect downhill descent and inject fake compression to stay grounded. */
const DOWNHILL_FOLLOW = {
  maxGap:          0.15,  // max gap above terrain to still trigger following (m)
  minSpeed:        2,     // minimum truck speed to check (m/s)
  lookAhead:       1.5,   // look-ahead distance for height sample (m)
  heightDrop:      0.3,   // terrain must drop at least this much to trigger (m)
  vertVelMin:     -1.5,   // must be descending faster than this (m/s)
  fakeCompression: 0.5,   // suspension compression injected when following
};

/** Suspension compression: converts penetration depth + velocity into a 0–1 value. */
const SUSPENSION = {
  velCompressionFactor: 0.03,  // downward velocity contribution to compression
  compressionBaseScale: 0.08,  // scale applied to base compression
  smoothing:            0.5,   // exponential smoothing factor (0–1, higher = snappier)
  maxCompression:       0.25,  // maximum suspension compression value
  groundednessRef:      0.08,  // compression at which groundedness reaches 1.0
};

/** Pass 2: boost groundedness when clearly tracking a descending slope. */
const DOWNHILL_BOOST = {
  maxGap:       0.4,   // max gap above terrain to still check boost (m)
  vertVelMin:  -0.5,   // must be descending faster than this (m/s)
  minSpeed:     2,     // minimum truck speed to check (m/s)
  lookAhead:    2.0,   // look-ahead distance for boost check (m)
  heightDrop:   0.3,   // terrain must drop at least this much to apply boost (m)
  groundedness: 0.8,   // groundedness clamped to at least this when tracking
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

/** Visual roll smoothing when grounded or airborne. */
const ORIENTATION = {
  fastSmoothingRate:     6,     // exp smoothing rate for roll transitions (s⁻¹)
  groundednessThreshold: 0.3,   // minimum groundedness to run terrain orientation
};

/**
 * Pitch derived from the truck's velocity vector (vertical vs horizontal).
 * atan2(verticalVelocity, horizontalSpeed) gives the physical flight angle.
 */
const PITCH = {
  smoothingRate:         8,     // exp smoothing rate when grounded (s⁻¹)
  airborneSmoothingRate: 1.5,   // much slower rate when airborne — holds launch angle through the arc
  maxAngle:              1.10,  // clamp to ±63° — above the steepest climbable slope (speedBleedMaxDeg=60°)
  minPitchSpeed:         2,     // below this hSpeed (m/s), pitch effect fades to zero
  pitchSpeedRamp:        6,     // hSpeed at which pitch reaches full effect
};

/** Vertical/visual jitter impulses over rough terrain. */
const ROUGHNESS = {
  minGroundedness:  0.3,   // minimum groundedness to apply bumps
  bumpInterval:     0.25,  // base time between bumps (s); divided by roughness
  vertImpulseScale: 3.6,   // max vertical velocity impulse per bump (m/s)
  rollJitter:       0.20,  // max roll jitter per bump (radians × roughness)
};

/**
 * Handles terrain-related physics: gravity, suspension, and slope collision.
 */
export class TerrainPhysics {
  constructor(state, halfHeight = _DEFAULT_HALF_HEIGHT, terrainQuery = null) {
    this.state = state;
    this.halfHeight = halfHeight;
    this.gravity = GRAVITY;
    this._bumpAccumulator = 0;
    this._terrainQuery    = terrainQuery;
    // Cached results from the most recent castDown — used by updateTerrainOrientation
    // so the normal is available without a second raycast.
    this._lastFloorNormal = UP.clone();
    // Last resolved floor Y — exposed so Truck can feed it to TruckBody.
    this.lastFloorY = 0;
    // Smoothed visual pitch derived from velocity vector.
    this._smoothedPitch = 0;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Most-recently resolved terrain surface normal (world space, unit length). */
  get floorNormal() { return this._lastFloorNormal; }

  update(mesh, deltaTime, track) {
    this.state.velocity.y += this.gravity * deltaTime;

    // Single downward raycast from just above the truck centre.
    // Firing from the truck's current Y means the ray naturally selects the right surface:
    //   • on bridge deck  → origin is above the deck → hits the deck
    //   • under bridge    → origin is below the deck → hits the ground
    //   • open terrain    → hits the ground mesh
    // Falls back to the analytical path when no TerrainQuery is available.
    let effectiveFloor;
    if (this._terrainQuery) {
      const hit = this._terrainQuery.castDown(
        mesh.position.x, mesh.position.z, mesh.position.y + RAY_OFFSET
      );
      effectiveFloor        = hit ? hit.y : 0;
      this._lastFloorNormal = hit?.normal ?? UP;
    } else {
      effectiveFloor        = this._sampleFloorYAt(
        mesh.position.x,
        mesh.position.z,
        mesh.position.y + RAY_OFFSET,
        track,
        0
      );
      this._lastFloorNormal = UP;
    }
    this.lastFloorY = effectiveFloor;

    const truckBottomY = effectiveFloor + this.halfHeight + SPRING.rideHeight;
    const penetration  = truckBottomY - mesh.position.y;

    this._applySpring(mesh, deltaTime, track, penetration, truckBottomY);

    // Compute forward vector and horizontal speed once — reused by _updateSuspension and pitch.
    const hSpeed = Math.sqrt(
      this.state.velocity.x * this.state.velocity.x +
      this.state.velocity.z * this.state.velocity.z
    );
    const forward = this._forwardVector();

    const groundedness = this._updateSuspension(mesh, track, penetration, forward, hSpeed);
    if (groundedness > ORIENTATION.groundednessThreshold && track) {
      this.updateTerrainOrientation(mesh, deltaTime);
    }

    // Keep state.surfaceNormal in sync so other systems (e.g. Controls) can project onto the slope.
    this.state.surfaceNormal.copyFrom(this._lastFloorNormal);

    const isGrounded = groundedness > ORIENTATION.groundednessThreshold;

    // While grounded, project velocity onto the surface tangent plane.
    // This strips the into-surface component, naturally giving the correct velocity.y
    // for any slope angle — and draining excess as the slope flattens.
    // At liftoff the velocity is already correct; no special crest handling needed.
    if (isGrounded) {
      const normal = this._lastFloorNormal;
      const vIntoSurface = this.state.velocity.dot(normal);
      if (vIntoSurface < 0) {
        // Truck is moving into the surface — remove that component
        this.state.velocity.x -= normal.x * vIntoSurface;
        this.state.velocity.y -= normal.y * vIntoSurface;
        this.state.velocity.z -= normal.z * vIntoSurface;
      }
    }

    this._updatePitch(mesh, deltaTime, groundedness, forward, hSpeed);

    return { groundedness, penetration };
  }

  updateTerrainOrientation(mesh, deltaTime) {
    const right = new Vector3(Math.cos(this.state.heading), 0, -Math.sin(this.state.heading));
    const normal = this._lastFloorNormal;

    // Guard: a surface normal with ny < 0.25 (> ~76° tilt) is likely a bad ray hit.
    if (normal.y < 0.25) return;

    const MAX_TILT = Math.PI / 4;
    const targetRoll = Math.max(-MAX_TILT, Math.min(MAX_TILT,
      Math.atan2(-normal.dot(right), normal.y)
    ));

    const factor = 1 - Math.exp(-ORIENTATION.fastSmoothingRate * deltaTime);
    this.state.terrainRoll += (targetRoll - this.state.terrainRoll) * factor;
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
    this.state.velocity.y      += roughness * ROUGHNESS.vertImpulseScale * (0.5 + Math.random() * 0.5);
    this.state.terrainRoll      += (Math.random() - 0.5) * roughness * ROUGHNESS.rollJitter;
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
   * Fast height-only surface sampler for high-frequency visual systems.
   */
  sampleSurfaceYFastAt(x, z, fromY, track, fallback = 0) {
    if (this._terrainQuery?.heightAtFast) {
      return this._terrainQuery.heightAtFast(x, z, fromY, fallback);
    }
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
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    const ox  = x + sinH * offset;
    const oz  = z + cosH * offset;
    const hx  = ox + sinH * fwdSlopeDist;
    const hz  = oz + cosH * fwdSlopeDist;
    const hbx = ox - sinH * fwdSlopeDist;
    const hbz = oz - cosH * fwdSlopeDist;

    const hAhead = this._sampleFloorYAt(hx,  hz,  fromY, track, 0);
    const hBack  = this._sampleFloorYAt(hbx, hbz, fromY, track, 0);

    const slopeRad = Math.atan2(hAhead - hBack, fwdSlopeDist * 2);
    return slopeRad / DEG_TO_RAD;
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

    // Spring pushes up only when penetrating.
    const springForce   = Math.max(0, effectivePenetration) * this.state.springStrength;
    const springImpulse = Math.min(springForce * deltaTime, SPRING.maxImpulsePerFrame);
    this.state.velocity.y += springImpulse;

    // Damping: apply across the full proximity zone to kill oscillation.
    // When penetrating: damp in both directions (standard spring damping).
    // When in proximity but NOT penetrating: only damp downward velocity
    // (velocity.y < 0) so the truck isn't dragged back when cresting.
    if (effectivePenetration > 0 || this.state.velocity.y < 0) {
      this.state.velocity.y += -this.state.velocity.y * this.state.damping * deltaTime;
    }
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
      mesh.position.y + RAY_OFFSET,
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

    if (this.state.velocity.y < 0) this.state.velocity.y = 0;

    return remaining;
  }

  /**
   * Update visual pitch from the velocity vector's vertical-vs-horizontal angle.
   * Nose-up on launch, nose-down on descent, level on flat ground.
   * Flipped when reversing so it reads correctly relative to direction of travel.
   */
  _updatePitch(mesh, deltaTime, groundedness, forward, hSpeed) {
    let targetPitch;

    if (groundedness > ORIENTATION.groundednessThreshold) {
      // Grounded: derive pitch from the terrain normal's forward component.
      // This mirrors how roll is derived, and correctly reads the hill slope
      // even when verticalVelocity is near-zero due to spring clamping.
      const normal = this._lastFloorNormal;
      if (normal.y >= 0.25) {
        const MAX_TILT = PITCH.maxAngle;
        targetPitch = Math.max(-MAX_TILT, Math.min(MAX_TILT,
          Math.atan2(-normal.dot(forward), normal.y)
        ));
      } else {
        targetPitch = 0;
      }
    } else {
      // Airborne: derive pitch from velocity vector's vertical-vs-horizontal angle.
      // Nose-up on launch, nose-down on descent. Flipped when reversing.
      const fwdSign = this.state.velocity.dot(forward) >= 0 ? 1 : -1;
      const rawPitch = Math.atan2(this.state.velocity.y, Math.max(hSpeed, 0.1)) * fwdSign;
      // Fade pitch out at low horizontal speeds — prevents violent lurches when the
      // truck drops vertically onto the track with near-zero forward velocity.
      const pitchWeight = Math.max(0, Math.min(1,
        (hSpeed - PITCH.minPitchSpeed) / (PITCH.pitchSpeedRamp - PITCH.minPitchSpeed)
      ));
      targetPitch = Math.max(-PITCH.maxAngle, Math.min(PITCH.maxAngle, rawPitch * pitchWeight));
    }

    // Grounded: snap pitch quickly so it tracks the slope.
    // Airborne: slow rate holds the launch angle through the arc rather than
    // immediately pitching down as gravity flips verticalVelocity negative.
    const rate = groundedness > ORIENTATION.groundednessThreshold
      ? PITCH.smoothingRate
      : PITCH.airborneSmoothingRate;
    const pitchFactor = 1 - Math.exp(-rate * deltaTime);
    this._smoothedPitch += (targetPitch - this._smoothedPitch) * pitchFactor;
    mesh.rotation.x = -this._smoothedPitch;
  }

  /**
   * Compute suspension compression and groundedness from the current penetration.
   * Handles both downhill terrain-following passes.
   * @returns {number} groundedness (0–1)
   */
  _updateSuspension(mesh, track, penetration, forward, speed) {
    const hasSurfaceSampling = !!this._terrainQuery || !!track;

    // Base compression from current overlap depth.
    let baseCompression = Math.max(0, Math.min(1, penetration / SPRING.compressionNorm));

    // Pass 1: slightly above terrain but moving downhill — inject fake compression
    // so the truck stays "grounded" through the descent.
    if (
      hasSurfaceSampling &&
      penetration < 0 &&
      penetration > -DOWNHILL_FOLLOW.maxGap &&
      speed > DOWNHILL_FOLLOW.minSpeed
    ) {
      const heightHere  = this._sampleFloorYAt(
        mesh.position.x,
        mesh.position.z,
        mesh.position.y + RAY_OFFSET,
        track,
        0
      );
      const heightAhead = this._sampleFloorYAt(
        mesh.position.x + forward.x * DOWNHILL_FOLLOW.lookAhead,
        mesh.position.z + forward.z * DOWNHILL_FOLLOW.lookAhead,
        mesh.position.y + RAY_OFFSET,
        track,
        heightHere
      );
      if (
        heightAhead < heightHere - DOWNHILL_FOLLOW.heightDrop &&
        this.state.velocity.y < DOWNHILL_FOLLOW.vertVelMin
      ) {
        baseCompression = DOWNHILL_FOLLOW.fakeCompression;
      }
    }

    const targetCompression = baseCompression > 0
      ? baseCompression * SUSPENSION.compressionBaseScale +
        Math.max(0, -this.state.velocity.y * SUSPENSION.velCompressionFactor)
      : 0;

    this.state.suspensionCompression +=
      (targetCompression - this.state.suspensionCompression) * SUSPENSION.smoothing;
    this.state.suspensionCompression =
      Math.max(0, Math.min(SUSPENSION.maxCompression, this.state.suspensionCompression));

    let groundedness = Math.min(1, this.state.suspensionCompression / SUSPENSION.groundednessRef);

    // Pass 2: boost groundedness when clearly tracking a descending slope.
    if (
      groundedness < DOWNHILL_BOOST.groundedness &&
      penetration > -DOWNHILL_BOOST.maxGap &&
      this.state.velocity.y < DOWNHILL_BOOST.vertVelMin &&
      hasSurfaceSampling &&
      speed > DOWNHILL_BOOST.minSpeed
    ) {
      const heightHere  = this._sampleFloorYAt(
        mesh.position.x,
        mesh.position.z,
        mesh.position.y + RAY_OFFSET,
        track,
        0
      );
      const heightAhead = this._sampleFloorYAt(
        mesh.position.x + forward.x * DOWNHILL_BOOST.lookAhead,
        mesh.position.z + forward.z * DOWNHILL_BOOST.lookAhead,
        mesh.position.y + RAY_OFFSET,
        track,
        heightHere
      );
      if (heightAhead < heightHere - DOWNHILL_BOOST.heightDrop) {
        groundedness = Math.max(groundedness, DOWNHILL_BOOST.groundedness);
      }
    }

    return groundedness;
  }
}
