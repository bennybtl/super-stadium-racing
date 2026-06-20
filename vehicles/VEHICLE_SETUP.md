# Vehicle Setup

Vehicle definitions live in `vehicles/*.json`. The `params` block is merged into the truck runtime state, so every field below is optional. If a field is omitted, the game falls back to the runtime default.

Suggested tuning ranges below are pragmatic starting points for arcade/off-road vehicles in this project, not hard validation limits.

## Handling Knobs (drift feel)

Drift behaviour is tuned through a `handling` block — **four** high-level knobs that
expand into the low-level grip-model values at load time (see `src/truck/DriftTuning.js`).
The old granular drift params (`driftThreshold`, `maxDriftGrip`, `slipDropoffRate`,
`minSlipFactor`, `gripZoneCorrection`, `minDriftSpeed`, and the `minDriftSpeedHold*`
speeds) are **no longer set directly** — they are derived from these knobs.

| Knob | Range | Default | Higher / + value means… |
| --- | ---: | ---: | --- |
| `driftEnter` | 0–1 | 0.5 | Breaks into a slide more easily (lower slip threshold, less low-slip bite, lower entry speed). |
| `driftMaintain` | 0–1 | 0.5 | Slides sustain longer once started (looser, slower-decaying drift zone). |
| `lateralBias` | −1–1 | 0.0 | Sideways/slidey at +, forward/planted at − (scales how hard lateral velocity is scrubbed). |
| `driftExit` | 0–1 | 0.5 | Grip returns and the truck straightens sooner (more sideways authority, earlier speed cutoff). |

All knobs at their neutral values (`0.5 / 0.5 / 0 / 0.5`) reproduce the historical
runtime defaults closely, so a vehicle that omits `handling` gets sane mid handling.

```json
{
  "handling": {
    "driftEnter": 0.55,
    "driftMaintain": 0.45,
    "lateralBias": 0.0,
    "driftExit": 0.45
  }
}
```

## Params Reference

| Param | Suggested Min | Runtime Default | Suggested Max | Notes |
| --- | ---: | ---: | ---: | --- |
| `springStrength` | 80 | 150 | 220 | Higher gives a stiffer, more planted suspension. |
| `damping` | 2 | 7 | 12 | Higher settles suspension oscillation faster. |
| `maxSpeed` | 18 | 26 | 34 | Soft top speed. Throttle pulls hard up to here, then crawls slowly to a hard ceiling at +20% (maxSpeed × 1.2). |
| `maxReverseSpeed` | -16 | -10 | -6 | More negative is faster reverse. |
| `acceleration` | 10 | 18 | 28 | Gear 1 acceleration. Halves each gear, so raising it speeds up the whole curve. |
| `gearCount` | 3 | 4 | 6 | Number of gears between 0 and maxSpeed; accel halves each gear so the top gear takes the longest. More gears = slower, more drawn-out top end. |
| `braking` | 1.0 | 1.5 | 2.4 | Higher slows harder and can make brake-rotation more aggressive. |
| `drag` | 0.8 | 3.0 | 4.5 | Terrain drag multiplier. Higher bleeds speed faster on the ground. |
| `turnSpeed` | 2.6 | 3.6 | 4.8 | Steering authority. |
| `grip` | 0.06 | 0.12 | 0.24 | Base cornering traction (grip zone only). Drift-zone grip is governed by the `handling` knobs. |
| `dragCoasting` | 0.2 | 0.45 | 0.8 | Extra drag while off throttle and not braking. |
| `weightTransfer` | 0.7 | 1.35 | 1.6 | Higher increases throttle understeer and brake oversteer feel. |
| `stationarySpinRate` | 0.0 | 0.6 | 0.8 | Fraction of turn speed allowed while nearly stopped. |
| `boostCount` | 0 | 5 | 9 | Starting nitro count. |
| `maxBoosts` | 0 | 9 | 12 | Maximum nitro capacity. |
| `boostDuration` | 0.8 | 1.6 | 2.5 | How long each boost lasts. |
| `boostAccelMult` | 1.2 | 2.0 | 2.6 | Acceleration multiplier during boost. |
| `boostSpeedMult` | 1.1 | 1.5 | 1.9 | Top-speed multiplier during boost. |

## Existing Vehicle Baselines

Current shipped vehicles use these values as rough archetypes:

| Vehicle | Grip | Enter / Maintain / Bias / Exit | Weight Transfer | Drag | Turn Speed |
| --- | ---: | :--- | ---: | ---: | ---: |
| `default_truck` | 0.12 | 0.55 / 0.45 / 0.0 / 0.45 | 1.35 | 3.0 | 3.6 |
| `default_buggy` | 0.08 | 0.30 / 0.70 / +0.25 / 0.35 | 1.1 | 3.5 | 4.0 |
| `rally_cross` | 0.15 | 0.70 / 0.55 / +0.20 / 0.40 | 1.35 | 3.0 | 3.9 |
| `monster_truck` | 0.28 | 0.50 / 0.45 / −0.10 / 0.50 | 1.65 | 6.0 | 3.3 |

## Recommended Starting Points

Use these `handling` knob sets as a fast way to build a new archetype:

| Archetype | driftEnter | driftMaintain | lateralBias | driftExit |
| --- | ---: | ---: | ---: | ---: |
| Stable truck | 0.45–0.60 | 0.40–0.50 | −0.1–0.1 | 0.45–0.55 |
| Loose buggy | 0.25–0.40 | 0.65–0.80 | +0.2–0.4 | 0.30–0.40 |
| Rally cross | 0.65–0.80 | 0.50–0.65 | +0.1–0.3 | 0.35–0.45 |

## Example Vehicle Block

```json
{
	"handling": {
		"driftEnter": 0.55,
		"driftMaintain": 0.5,
		"lateralBias": 0.1,
		"driftExit": 0.45
	},
	"params": {
		"springStrength": 120,
		"damping": 5,
		"maxSpeed": 28,
		"maxReverseSpeed": -10,
		"acceleration": 18,
		"braking": 1.6,
		"drag": 1.8,
		"turnSpeed": 3.5,
		"grip": 0.18,
		"dragCoasting": 0.45,
		"weightTransfer": 1.2,
		"stationarySpinRate": 0.6,
		"boostCount": 5,
		"maxBoosts": 9,
		"boostDuration": 1.8,
		"boostAccelMult": 2.1,
		"boostSpeedMult": 1.6
	}
}
```

## Notes

- `turnSpeed`, `grip`, and the `handling` knobs do most of the work for the overall handling personality.
- `weightTransfer` is one of the highest-value `params` knobs for making a vehicle feel truck-like vs rally-like.
- The four `handling` knobs replace the old per-vehicle drift params; tune drift feel there, not in `params`.
- `drag` and `dragCoasting` are complementary: use `drag` for overall pace and `dragCoasting` for off-throttle settle behavior.