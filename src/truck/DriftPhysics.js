import { Vector3 } from "@babylonjs/core";
import { tangentBasis } from "./surface-math.js";
import { smoothstep } from "../math-utils.js";

// ─── Grip / drift ────────────────────────────────────────────────────────────
//
// The per-vehicle drift-grip values — driftThreshold, gripZoneCorrection,
// maxDriftGrip, slipDropoffRate, minSlipFactor, driftFadeLowSpeed and
// driftFadeHighSpeed — are NOT defined here. They are derived from the
// four high-level handling knobs in DriftTuning.js (resolveHandling) and written
// onto truck state, which is their single source of truth. This file reads them
// straight off `this.state`. The constants below are the ones DriftTuning does not
// own — global feel rules that apply to every vehicle.

/** Multiplier applied to reverse-direction grip so reversing corrects quickly. */
const REVERSE_GRIP_BOOST = 15;

/** How far throttle power-break lowers the drift threshold (0..1). Dropping the
 *  threshold under power lets the rear tip into the low-grip drift zone at a much
 *  smaller slip angle, so flooring it from low speed actually breaks loose
 *  instead of just letting an existing slide decay slower. */
const THROTTLE_BREAK_THRESHOLD_DROP = 0.6;

/** How fast lateral velocity bleeds out (s⁻¹) at parking speeds, where the
 *  slip-angle grip model is faded out entirely (see the drift-speed fade in
 *  applyGripAndDrift). ~5 ≈ a slide is gone in a third of a second. */
const LOW_SPEED_LATERAL_DAMP = 5;
/** The same damp expressed as a per-1/60s-step removed fraction, so it can blend
 *  directly with the grip curve's per-step scrub. */
const LOW_SPEED_DAMP_PER_STEP = 1 - Math.exp(-LOW_SPEED_LATERAL_DAMP / 60);

/** Half-width of the grip curve's C¹ blend window around driftThreshold, as a
 *  fraction of the threshold. Inside the window the (unclamped) grip-zone taper
 *  and drift-zone decay cross-fade; outside it the curve is exactly the pure
 *  regimes, so existing tuning is preserved away from the boundary. */
const GRIP_CURVE_BLEND_WIDTH = 0.5;

/** Slip angle (radians) above which the truck is considered spinning out. */
const SPINOUT_SLIP_THRESHOLD = 0.6;

/** Grip multiplier below which a spin-out is confirmed (car has lost meaningful traction). */
const SPINOUT_GRIP_THRESHOLD = 0.01;

// ─── Drag ────────────────────────────────────────────────────────────────────

/** Speed below which drag is not applied. */
const MIN_DRAG_SPEED = 0.1;

/** Drag coefficient while accelerating (throttle held). */
const DRAG_ACCELERATING = 0.3;

/** Drag coefficient while coasting (no throttle, no brake). */
const DRAG_COASTING = 0.45;

/** Drag coefficient while braking (brake held). */
const DRAG_BRAKING = 0.8;

/** Drag coefficient while airborne (minimal air resistance). */
const DRAG_AIRBORNE = 0.02;

/**
 * Handles drift physics, grip, drag, and velocity management
 */
export class DriftPhysics {
  constructor(state) {
    this.state = state;
    this._surfaceForward = new Vector3();
    this._surfaceNormal = new Vector3(0, 1, 0);
    this._surfaceRight = new Vector3(1, 0, 0);
  }

  applyGripAndDrift(forward, effectiveGrip, rearTractionFactor = 1.0, deltaTime = 1 / 60, throttleBreak = 0) {
    const surfaceForward = this._surfaceForward;
    const surfaceNormal = this._surfaceNormal;
    const surfaceRight = this._surfaceRight;

    // Orthonormal basis on the terrain tangent plane (normal, forward, right).
    if (this.state.surfaceNormal) surfaceNormal.copyFrom(this.state.surfaceNormal);
    else surfaceNormal.set(0, 1, 0);
    tangentBasis(surfaceNormal, forward, surfaceNormal, surfaceForward, surfaceRight);

    const forwardVelocity = this.state.velocity.dot(surfaceForward);
    const lateralSpeed = this.state.velocity.dot(surfaceRight);
    const normalVelocity = this.state.velocity.dot(surfaceNormal);
    // Speed in the surface plane. Both the speed gates and the slip angle use
    // this, never the horizontal or 3D speed: mixing frames let the off-plane
    // velocity component fake slip at crests/dips (grip snapped ~5× for a few
    // frames), and let slopes shift the gates with no change in actual motion.
    const tangentSpeed = Math.hypot(forwardVelocity, lateralSpeed);

    // No traction correction while airborne — effectiveGrip reaches 0 when groundedness = 0
    if (effectiveGrip <= 0) return;

    if (tangentSpeed <= 1e-4) {
      this.state.slipAngle = 0;
      this.state.isDrifting = false;
      this.state.isSpinningOut = false;
      return;
    }

    // Drift-speed fade: 0 at/below driftFadeLowSpeed (slip-angle model fully off,
    // slides die at the fixed low-speed damp), 1 at/above driftFadeHighSpeed
    // (grip curve fully in charge), smoothstepped in between. This one fade
    // replaces the old hard min-speed gates, their throttle/brake/coast hold
    // variants, and the isDrifting hysteresis that fed back into gate selection.
    // throttleBreak drops the band so power-oversteer can slide from low speed.
    const bandScale = 1 - throttleBreak;
    const fadeLow = this.state.driftFadeLowSpeed * bandScale;
    const fadeHigh = Math.max(this.state.driftFadeHighSpeed * bandScale, fadeLow + 0.1);
    const driftability = smoothstep(fadeLow, fadeHigh, tangentSpeed);

    const isReversing = forwardVelocity < 0;

    // Slip angle: angle between the in-plane velocity and heading (flipped when
    // reversing so a reversing truck reads slip relative to its travel direction).
    const alongTravel = isReversing ? -forwardVelocity : forwardVelocity;
    const slipAngle = Math.atan2(Math.abs(lateralSpeed), alongTravel);

    // driftGrip caps drift-zone traction so any truck can break loose; power
    // oversteer drops the slip threshold so the rear lets go at a smaller angle.
    const driftGrip = Math.min(effectiveGrip, this.state.maxDriftGrip);
    const driftThresh = this.state.driftThreshold * (1 - throttleBreak * THROTTLE_BREAK_THRESHOLD_DROP);
    const gripFactor = this._gripFactorForSlip(slipAngle, driftThresh, driftGrip);

    const reverseGripBoost = isReversing ? REVERSE_GRIP_BOOST : 1;
    // lateralRetention (Lateral Bias knob): <1 keeps more lateral momentum (slidey),
    // >1 grips harder. throttleBreak bleeds the correction so the rear steps out.
    const lateralRetention = this.state.lateralRetention ?? 1;
    const gripMultiplier = gripFactor * reverseGripBoost * rearTractionFactor * lateralRetention * (1 - throttleBreak);

    // Apply grip as lateral-only damping (longitudinal speed untouched), blending
    // the slip-angle curve in over the fade band. The per-step fraction is raised
    // to the (dt·60) power to stay framerate-independent; at driftability 0 this
    // reproduces the old below-gate exp(-LOW_SPEED_LATERAL_DAMP·dt) exactly.
    const perStepCurve = Math.min(1, Math.max(0, gripMultiplier));
    const perStep = LOW_SPEED_DAMP_PER_STEP + (perStepCurve - LOW_SPEED_DAMP_PER_STEP) * driftability;
    const retained = Math.pow(1 - perStep, deltaTime * 60);
    this._setSurfaceVelocity(surfaceForward, forwardVelocity, surfaceRight, lateralSpeed * retained, surfaceNormal, normalVelocity);

    // Publish slip faded by the band: VFX/audio key off (slipAngle − threshold),
    // so smoke/sound and the flags all ease off toward low speed instead of the
    // old hard state flips. The flags are read-only outputs now — nothing in the
    // physics feeds back on them.
    const effectiveSlip = slipAngle * driftability;
    this.state.slipAngle = effectiveSlip;
    this.state.isDrifting = effectiveSlip > driftThresh;
    this.state.isSpinningOut = effectiveSlip > SPINOUT_SLIP_THRESHOLD && gripMultiplier < SPINOUT_GRIP_THRESHOLD;
  }

  /** Two-regime grip curve, C¹-continuous. Grip zone (slip ≲ thresh): linear
   *  taper from gripZoneCorrection → driftGrip for tight, responsive cornering.
   *  Drift zone (slip ≳ thresh): exponential drop-off so lateral momentum
   *  carries, floored at minSlipFactor·driftGrip. Both regimes pass through
   *  driftGrip at the threshold, and are cross-faded (unclamped) over the blend
   *  window, so the curve keeps its value AND slope smooth through the drift
   *  boundary — the old piecewise version had a derivative kink exactly there,
   *  a felt "corner" right where slides begin and end. */
  _gripFactorForSlip(slipAngle, driftThresh, driftGrip) {
    const lo = driftThresh * (1 - GRIP_CURVE_BLEND_WIDTH);
    const hi = driftThresh * (1 + GRIP_CURVE_BLEND_WIDTH);

    let g;
    if (slipAngle >= hi) {
      g = driftGrip * Math.exp(-(slipAngle - driftThresh) * this.state.slipDropoffRate);
    } else {
      // Grip-zone taper, unclamped (pure below the window, faded out across it).
      g = this.state.gripZoneCorrection + (driftGrip - this.state.gripZoneCorrection) * (slipAngle / driftThresh);
      if (slipAngle > lo) {
        const w = smoothstep(lo, hi, slipAngle);
        const decay = driftGrip * Math.exp(-(slipAngle - driftThresh) * this.state.slipDropoffRate);
        g += (decay - g) * w;
      }
    }
    return Math.max(this.state.minSlipFactor * driftGrip, g);
  }

  /** Recompose velocity from its tangent-plane components (forward · normal · right). */
  _setSurfaceVelocity(fwd, fScalar, right, rScalar, normal, nScalar) {
    this.state.velocity.set(
      fwd.x * fScalar + right.x * rScalar + normal.x * nScalar,
      fwd.y * fScalar + right.y * rScalar + normal.y * nScalar,
      fwd.z * fScalar + right.z * rScalar + normal.z * nScalar
    );
  }

  applyDrag(speed, input, deltaTime, terrainDragMultiplier, groundedness = 1) {
    if (speed > MIN_DRAG_SPEED) {
      // Minimal air resistance when airborne, full drag when grounded.
      // Three distinct ground states so releasing the brake actually matters:
      //   accelerating → light drag
      //   coasting (no input) → medium drag
      //   braking (back held) → heavy drag
      const airborne = groundedness <= 0;
      const dragCoasting = this.state.dragCoasting ?? DRAG_COASTING;
      let coastingMultiplier;
      if (airborne)           coastingMultiplier = DRAG_AIRBORNE;
      else if (input.forward) coastingMultiplier = DRAG_ACCELERATING;
      else if (input.back)    coastingMultiplier = DRAG_BRAKING;
      else                    coastingMultiplier = dragCoasting;
      const drag = airborne ? 1.0 : terrainDragMultiplier;
      const dragFactor = coastingMultiplier * drag * deltaTime;
      this.state.velocity.x -= this.state.velocity.x * dragFactor;
      this.state.velocity.z -= this.state.velocity.z * dragFactor;
    }
  }

  /**
   * Apply the chassis's terrain-following orientation to the physics box.
   * TerrainPhysics computes the contributions — state.flightPitch (velocity /
   * slope pitch, including the airborne launch angle) and state.terrainRoll
   * (slope roll). Body-relative lean and dive/squat are handled separately by
   * TruckBody's acceleration-driven sprung-mass model, so they are NOT added
   * here. (Heading/rotation.y is applied separately by Truck.)
   */
  updateRoll(mesh) {
    mesh.rotation.x = -(this.state.flightPitch ?? 0);
    mesh.rotation.z = (this.state.terrainRoll || 0);
  }
}
