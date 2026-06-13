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

## TODO Next Time

- Implement missed-checkpoint recovery in `AIPathPlanner` so AI must pass required checkpoints before continuing lap flow.
- Add planner checkpoint anchors during path build: map `checkpointNumber -> nearest path index`.
- In `findLookAheadPoint()`, detect when `currentPathIndex` has progressed past the expected checkpoint anchor without a pass event.
- Add a temporary checkpoint-recovery mode that targets an approach point before the gate, then the gate center, to force legal crossing direction.
- Exit recovery on `onCheckpointPassed(expectedCheckpoint)` and snap `currentPathIndex` near that checkpoint anchor.
- Support both authored path and telemetry path with the same recovery behavior.
- Add tuning knobs:
  - `missedCheckpointIndexBuffer`
  - `checkpointRecoveryApproachDistance`
  - `checkpointRecoveryExitDistance`
  - `checkpointRecoveryMinActiveMs`
  - `checkpointRecoveryCooldownMs`
- Add low-noise debug transitions:
  - recovery entered (expected checkpoint, current index, anchor index)
  - recovery exited (reason)

```
Detailed implementation plan (no edits yet)

Build checkpoint-to-path metadata during path build.
In calculateFullPath, compute a checkpointAnchors map: checkpointNumber -> nearest path index.
Keep this regardless of authored path vs telemetry path.
If using authored branches, still anchor each checkpoint to nearest resulting waypoint index.
Add expected checkpoint resolver in planner.
Derive expectedNext from driver.gameState.lastCheckpointPassed when available.
Fall back to currentCheckpointTarget if gameState is absent.
Normalize wrap-around with total checkpoint count from driver.checkpoints.
Add missed-checkpoint detection in findLookAheadPoint.
Compare currentPathIndex against expected checkpoint anchor.
If AI has advanced past anchor by a configurable buffer (for example 10 to 20 waypoints) and expected checkpoint has not been passed, mark checkpointRecoveryActive.
Add hysteresis/cooldown to avoid rapid in-out toggling.
Add checkpoint recovery target generation.
While recovery is active, return a target toward expected checkpoint gate instead of normal path look-ahead.
Prefer a two-step target:
Approach point slightly before the gate along negative heading.
Then gate center to force a legal crossing direction.
This avoids orbiting the checkpoint edge.
Define recovery exit conditions.
Primary: onCheckpointPassed(expectedNext) event arrives.
Secondary safety: if near gate center and moving in gate-forward direction for a short dwell, allow exit even if event is delayed.
On exit, snap currentPathIndex to nearest waypoint around that checkpoint anchor to rejoin flow smoothly.
Keep compatibility with telemetry path.
Recovery logic should run regardless of authored path or telemetry.
Telemetry path remains preferred unless missed checkpoint forces temporary recovery override.
Add planner-level debug observability.
Add optional debug logs only when state changes:
recovery entered, expected checkpoint N, current index, anchor index.
recovery exited, reason.
This keeps logs useful and low-noise.
Add tuning knobs to planner config.
missedCheckpointIndexBuffer
checkpointRecoveryApproachDistance
checkpointRecoveryExitDistance
checkpointRecoveryMinActiveMs
checkpointRecoveryCooldownMs
```