/**
 * Rubber-band catch-up: nudges each AI's effective top speed based on its race
 * progress gap to the player — behind gets a boost, ahead gets reined in.
 * Player speed is never touched. `low`/`medium`/`high` are the UI-configurable
 * strength presets; `off` (any unrecognized level) disables it entirely.
 */
export const RUBBER_BAND_LEVELS = {
  low:    { maxAdjust: 0.08, saturateLaps: 0.5 },
  medium: { maxAdjust: 0.16, saturateLaps: 0.35 },
  high:   { maxAdjust: 0.26, saturateLaps: 0.22 },
};

// Gap (in laps) below which no adjustment applies, so an AI running
// neck-and-neck with the player isn't nudged at all.
const DEADZONE_LAPS = 0.05;

// How fast the live multiplier approaches its target (per second) — smooths
// the speed change across a gap-crossing threshold instead of snapping it.
const RESPONSE_RATE = 1.5;

/**
 * Step an AI's rubber-band speed multiplier toward its target for the current
 * gap. `gapLaps` is (playerProgress - aiProgress) in laps: positive means the
 * AI trails the player (boost, multiplier > 1), negative means it leads the
 * player (rein in, multiplier < 1).
 */
export function stepRubberBandMultiplier(current, gapLaps, level, dt) {
  const cfg = RUBBER_BAND_LEVELS[level];
  if (!cfg) return 1;

  const magnitude = Math.abs(gapLaps);
  let target = 1;
  if (magnitude > DEADZONE_LAPS) {
    const eased = Math.min(1, (magnitude - DEADZONE_LAPS) / (cfg.saturateLaps - DEADZONE_LAPS));
    const adjust = eased * cfg.maxAdjust;
    target = gapLaps > 0 ? 1 + adjust : 1 - adjust;
  }

  return current + (target - current) * Math.min(1, RESPONSE_RATE * dt);
}
