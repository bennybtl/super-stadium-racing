// ─── High-level drift handling knobs ─────────────────────────────────────────
//
// These four knobs are the *only* drift-handling interface. They expand into the
// low-level grip-model values consumed by DriftPhysics, so vehicles tune feel
// with a handful of intuitive sliders instead of a dozen interacting constants.
//
//   driftEnter    (0..1)  – how easily the truck breaks into a slide.
//   driftMaintain (0..1)  – how long a slide sustains once started.
//   lateralBias   (-1..1) – sideways/slidey (+) vs forward/planted (−).
//   driftExit     (0..1)  – how quickly grip returns and the truck straightens.
//
// All four at their neutral values (0.5 / 0.5 / 0 / 0.5) reproduce the historical
// runtime defaults closely, so an undefined `handling` block yields sane mid feel.

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clampBias = (v) => Math.max(-1, Math.min(1, v));

export const DEFAULT_HANDLING = {
  driftEnter: 0.5,
  driftMaintain: 0.5,
  lateralBias: 0.0,
  driftExit: 0.3,
};

/**
 * Expand a high-level handling block into the low-level drift-grip parameters
 * DriftPhysics reads from truck state.
 * @param {{driftEnter?:number, driftMaintain?:number, lateralBias?:number, driftExit?:number}} handling
 */
export function resolveHandling(handling = {}) {
  const enter    = clamp01(handling.driftEnter    ?? DEFAULT_HANDLING.driftEnter);
  const maintain = clamp01(handling.driftMaintain ?? DEFAULT_HANDLING.driftMaintain);
  const exit     = clamp01(handling.driftExit     ?? DEFAULT_HANDLING.driftExit);
  const bias     = clampBias(handling.lateralBias ?? DEFAULT_HANDLING.lateralBias);

  // Enter: lower slip threshold + less low-slip bite + lower entry speed all make
  // the rear break loose sooner.
  const driftThreshold     = lerp(0.32, 0.12, enter);
  let   gripZoneCorrection = lerp(0.50, 0.20, enter);
  const minDriftSpeed      = lerp(20, 9, enter);

  // Maintain: a looser, slower-decaying drift zone sustains the slide.
  const slipDropoffRate = lerp(3.5, 9.0, maintain);
  const maxDriftGrip    = lerp(0.20, 0.09, maintain);

  // Exit: authority while fully sideways, plus how soon a slide is cut off by the
  // speed thresholds. Exit raises the cutoffs (snap straight sooner); Maintain
  // lowers them (let it ride), so the two stay complementary rather than identical.
  const minSlipFactor = lerp(0.05, 0.16, exit);
  const holdBlend = clamp01(0.5 * exit + 0.5 * (1 - maintain));
  const minDriftSpeedHoldThrottle = lerp(6, 16, holdBlend);
  const minDriftSpeedHoldCoast    = lerp(1.5, 7, holdBlend);
  const minDriftSpeedHoldBrake    = lerp(8, 17, holdBlend);

  // Lateral bias scales how aggressively the grip model scrubs sideways velocity.
  //   +bias → retain more lateral momentum (drifty);  −bias → scrub it (planted).
  // A positive (sideways) bias also trims normal-cornering bite a touch so the
  // looser feel reads on the way into a corner, not just mid-slide.
  const lateralRetention = bias >= 0 ? lerp(1.0, 0.55, bias) : lerp(1.0, 1.5, -bias);
  if (bias > 0) gripZoneCorrection *= lerp(1.0, 0.85, bias);

  return {
    driftThreshold,
    gripZoneCorrection,
    minDriftSpeed,
    slipDropoffRate,
    maxDriftGrip,
    minSlipFactor,
    minDriftSpeedHoldThrottle,
    minDriftSpeedHoldCoast,
    minDriftSpeedHoldBrake,
    lateralRetention,
  };
}
