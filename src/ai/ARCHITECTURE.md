# AI Driver Architecture

`AIDriver` is now an orchestrator that delegates most behavior to focused controllers.

## Controllers

- `AIPathPlanner`
  - Checkpoint extraction
  - Authored/checkpoint path build
  - Telemetry path load
  - Look-ahead target selection
  - Path curvature scan

- `AISteeringController`
  - Heading-to-target steering
  - Nearby truck avoidance bias
  - Spin recovery damping
  - Steering smoothing and thresholding support

- `AIThrottleController`
  - Forward/back decisions from speed targets
  - Telemetry vs authored-path lookahead handling

- `AIBoostController`
  - Nitro usage decisions
  - Straight/clear checks
  - Behind/stock weighted boost probability

- `AIStuckRecoveryController`
  - Control-stall detection
  - Position-no-progress detection
  - Respawn triggering

- `AISpawnRecoveryController`
  - Respawn location calculation
  - Path index re-snap after teleport
  - Clear-position radial fallback

- `AIDebugRenderer`
  - Path debug markers
  - Target marker updates
  - Per-frame throttled debug refresh

## Data ownership

- `AIDriver` still owns shared runtime references:
  - `track`, `wallManager`, `truck`, `otherTrucks`, `gameState`, `scene`
- Controllers read/write through the `driver` reference to avoid large DTO plumbing.

## Skill/personality config

`AIDriver` constructor still accepts `skillConfig`, now including domains:

- Base handling:
  - `lookAheadDistance`, `maxSpeed`, `steeringPrecision`
- Steering:
  - `avoidanceRadius`, `avoidanceMaxPush`, `avoidanceIgnoreBehind`, `steeringSmooth`, `steeringThreshold`
- Throttle:
  - `speedTolerance`, `telemetryLookWaypoints`, `pathLookWaypoints`
- Boost:
  - `boostMinSpeed`, `boostStraightMaxAngle`, `boostClearAheadDist`, `boostClearLateralDist`,
    `boostDecisionCooldownMs`, `boostBaseChance`, `boostBehindWeight`, `boostStockWeight`,
    `boostMaxChance`, `boostStockRef`
- Stuck recovery:
  - `stuckThreshold`, `positionCheckInterval`, `positionStuckThreshold`, `positionStuckMinDist`, `wallPressMaxSpeed`
- Spawn recovery:
  - `pathAdvance`

## External API compatibility

Existing external calls remain on `AIDriver`:

- `calculateFullPath()`
- `loadTelemetry()`
- `onCheckpointPassed()`
- `setTruck()` / `setOtherTrucks()` / `setGameState()` / `setRaceContext()`
- `setStaticBodyCollisionManager()`
- `getInput()` / `reset()`

This preserves race mode integration while allowing further modularization.
