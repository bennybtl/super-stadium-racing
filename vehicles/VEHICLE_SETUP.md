# Vehicle Setup

Vehicle definitions live in `vehicles/*.json`. The `params` block is merged into the truck runtime state, so every field below is optional. If a field is omitted, the game falls back to the runtime default.

Suggested tuning ranges below are pragmatic starting points for arcade/off-road vehicles in this project, not hard validation limits.

## Params Reference

| Param | Suggested Min | Runtime Default | Suggested Max | Notes |
| --- | ---: | ---: | ---: | --- |
| `springStrength` | 80 | 150 | 220 | Higher gives a stiffer, more planted suspension. |
| `damping` | 2 | 7 | 12 | Higher settles suspension oscillation faster. |
| `maxSpeed` | 18 | 26 | 34 | Forward top speed on flat ground before drag and terrain effects. |
| `maxReverseSpeed` | -16 | -10 | -6 | More negative is faster reverse. |
| `acceleration` | 10 | 18 | 28 | Controls how hard the vehicle builds speed under throttle. |
| `braking` | 1.0 | 1.5 | 2.4 | Higher slows harder and can make brake-rotation more aggressive. |
| `drag` | 0.8 | 3.0 | 4.5 | Terrain drag multiplier. Higher bleeds speed faster on the ground. |
| `turnSpeed` | 2.6 | 3.6 | 4.8 | Steering authority. |
| `grip` | 0.06 | 0.12 | 0.24 | Base traction before terrain and drift logic. |
| `driftThreshold` | 0.12 | 0.16 | 0.34 | Slip angle threshold before the vehicle is considered drifting. |
| `minDriftSpeed` | 8 | 15 | 22 | Minimum speed to enter drift when not already drifting. |
| `minDriftSpeedHoldThrottle` | 6 | 10 | 18 | Minimum speed to keep drift alive while on throttle. |
| `minDriftSpeedHoldCoast` | 1 | 3 | 8 | Minimum speed to keep drift alive while coasting. |
| `minDriftSpeedHoldBrake` | 8 | 12 | 18 | Minimum speed to keep drift alive while braking. |
| `slipDropoffRate` | 3 | 6 | 10 | Higher makes drift grip fall off faster after threshold. |
| `gripZoneCorrection` | 0.18 | 0.35 | 0.55 | Low-slip correction strength for normal cornering response. |
| `minSlipFactor` | 0.04 | 0.09 | 0.18 | Minimum steering/grip authority while heavily sideways. |
| `maxDriftGrip` | 0.08 | 0.13 | 0.22 | Caps available grip once in the drift zone. |
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

| Vehicle | Grip | Drift Threshold | Weight Transfer | Drag | Turn Speed |
| --- | ---: | ---: | ---: | ---: | ---: |
| `default_truck` | 0.12 | 0.16 | 1.35 | 3.0 | 3.6 |
| `default_buggy` | 0.08 | 0.28 | 1.1 | 3.5 | 4.0 |
| `rally_cross` | 0.21 | 0.24 | 1.2 | 1.0 | 3.4 |

## Recommended Starting Points

Use these as a fast way to build a new handling archetype:

| Archetype | Grip | Drift Threshold | Max Drift Grip | Grip Zone Correction | Slip Dropoff Rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Stable truck | 0.12-0.18 | 0.14-0.20 | 0.10-0.13 | 0.34-0.45 | 6-8 |
| Loose buggy | 0.07-0.12 | 0.24-0.32 | 0.08-0.12 | 0.22-0.34 | 4-6 |
| Rally cross | 0.16-0.22 | 0.20-0.28 | 0.12-0.17 | 0.30-0.42 | 5-7 |

## Example Params Block

```json
{
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
		"driftThreshold": 0.24,
		"minDriftSpeed": 15,
		"minDriftSpeedHoldThrottle": 10,
		"minDriftSpeedHoldCoast": 3,
		"minDriftSpeedHoldBrake": 12,
		"slipDropoffRate": 6,
		"gripZoneCorrection": 0.35,
		"minSlipFactor": 0.09,
		"maxDriftGrip": 0.13,
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

- `turnSpeed`, `grip`, and `driftThreshold` do most of the work for the overall handling personality.
- `weightTransfer` is one of the highest-value knobs for making a vehicle feel truck-like vs rally-like.
- The drift hold speeds mainly affect how the vehicle exits a slide under throttle, coast, and braking.
- `drag` and `dragCoasting` are complementary: use `drag` for overall pace and `dragCoasting` for off-throttle settle behavior.