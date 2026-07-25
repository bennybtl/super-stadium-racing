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

// Retuned July 2026 after the Plan A continuity pass: the old defaults relied on
// noise (3D-inflated slip readings over bumps, groundedness flicker) to tip the
// truck past the drift threshold. With honest slip, full-steer at dirt cruising
// speed sat right AT the old threshold (~0.237 vs 0.24 rad). These values give
// deliberate entry margin so the base truck breaks loose on commitment
// (full lock, brake tap, or power-over) without noise assistance.
export const DEFAULT_HANDLING = {
  driftEnter: 0.55,
  driftMaintain: 0.5,
  lateralBias: 0.25,
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

  // Enter: lower slip threshold + less low-slip bite + a lower fade-band top all
  // make the rear break loose sooner. driftFadeHighSpeed is the speed at which
  // the slip-angle model reaches full strength (see DriftPhysics drift-speed fade).
  const driftThreshold     = lerp(0.32, 0.12, enter);
  let   gripZoneCorrection = lerp(0.50, 0.20, enter);
  const driftFadeHighSpeed = lerp(20, 9, enter);

  // Maintain: a looser, slower-decaying drift zone sustains the slide.
  const slipDropoffRate = lerp(3.5, 9.0, maintain);
  const maxDriftGrip    = lerp(0.20, 0.09, maintain);

  // Exit: authority while fully sideways, plus where the fade band bottoms out.
  // Exit raises driftFadeLowSpeed (slides bleed out sooner as speed drops);
  // Maintain lowers it (let it ride), so the two stay complementary.
  const minSlipFactor = lerp(0.05, 0.16, exit);
  const holdBlend = clamp01(0.5 * exit + 0.5 * (1 - maintain));
  const driftFadeLowSpeed = lerp(1.5, 7, holdBlend);

  // Lateral bias scales how aggressively the grip model scrubs sideways velocity.
  //   +bias → retain more lateral momentum (drifty);  −bias → scrub it (planted).
  // A positive (sideways) bias also trims normal-cornering bite a touch so the
  // looser feel reads on the way into a corner, not just mid-slide.
  const lateralRetention = bias >= 0 ? lerp(1.0, 0.55, bias) : lerp(1.0, 1.5, -bias);
  if (bias > 0) gripZoneCorrection *= lerp(1.0, 0.85, bias);

  return {
    driftThreshold,
    gripZoneCorrection,
    driftFadeHighSpeed,
    driftFadeLowSpeed,
    slipDropoffRate,
    maxDriftGrip,
    minSlipFactor,
    lateralRetention,
  };
}
