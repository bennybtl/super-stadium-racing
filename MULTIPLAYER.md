# Online Multiplayer — Implementation Plan

Server-authoritative racing over WebSockets. Clients send inputs; the server runs
the real simulation and broadcasts state. This document is the plan of record.

## Architecture decisions (locked)

- **Server-authoritative simulation.** The server runs the same truck physics the
  browser runs today. Clients never assert position, velocity, or game state.
- **Process per lobby.** A parent Node process spawns one child per race. Crash
  isolation (a Havok assert or NaN cascade kills one race, not the box) and tick
  isolation (Node is single-threaded — one lobby's frame spike must not become
  everyone's jitter).
- **Children own their own WebSocket server.** A client connects to the parent,
  receives `{host, port, token}`, and reconnects directly to the child. No
  per-tick data crosses the IPC boundary.
- **No pre-warm pool.** Accept the 1–3s spawn + Havok init + track load in the
  lobby-start path. Revisit only if it becomes a felt problem.

## Anti-cheat position

Server authority *is* the anti-cheat, and it is sufficient for the cheats that
matter: teleporting, flying, speed hacks, infinite nitro, invulnerability,
collision removal, modified `DriftTuning.js`, edited track geometry. A hacked
client only lies to itself.

What remains, and where it is handled in this plan:

| Residual risk | Mitigation | Phase |
| --- | --- | --- |
| Input flooding / future-tick inputs | Server input window + one frame per tick | 3 |
| Out-of-range analog values | Clamp on ingest | 3 |
| Respawn abuse (spam reset for a free skip) | Server owns respawn, rate-limited, checkpoint-gated | 3 |
| Lag switching for rubber-band advantage | Hard rewind cap; missing input extrapolates last input | 6 |
| Scripted/bot driving (perfect line, frame-perfect boost) | Replay archive + statistical review | 7 |

Explicitly **not** doing: client-side integrity checks, code obfuscation, WASM
attestation, devtools detection. The browser client is inspectable by design;
that effort belongs in the replay archive instead.

## Current state — what has to change

The simulation is not currently separable from rendering. Findings from the
existing code:

- **The game loop is a closure inside `RaceMode.setup()`**
  ([RaceMode.js:554](src/modes/RaceMode.js:554)), holding ~30 managers in scope
  and interleaving physics, UI, audio, particles, camera, and telemetry in one
  `onBeforeRenderObservable` callback. This is the main structural obstacle.
- **`dt` comes from the renderer.** `getClampedDeltaTime()`
  ([BaseMode.js:34](src/modes/BaseMode.js:34)) reads `engine.getDeltaTime()`.
  Server sim needs a fixed step.
- **`buildScene()` is render-heavy** ([SceneBuilder.js:56](src/modes/SceneBuilder.js:56)).
  Physics, track, terrain grid, ground geometry, walls, bridges, checkpoints and
  obstacles are needed server-side. Lights, shadow generator, materials, the
  `ground-shader.js` GLSL path, five ~2000×2000 `RawTexture` bakes, water visuals,
  decorations, track signs, surface decals and dirt scatter are not — and the
  texture bakes alone are tens of MB per lobby.
- **Truck physics is mostly custom, not Havok.** Velocity is integrated by
  `DriftPhysics` / `TerrainPhysics`, and truck-truck and truck-wall response is
  resolved by `TruckCollisionManager` / `StaticBodyCollisionManager`. Havok
  provides the ground/obstacle bodies and the truck's BOX aggregate
  ([truck.js:231](src/truck/truck.js:231)). Good news: the hot path is plain
  float math, cheap and deterministic on a given machine.
- **`TerrainPhysics` raycasts against registered drive surfaces**, so the server
  still needs real ground and bridge *geometry* (materials not required).
- **`truck.update()` mixes sim and presentation** ([truck.js:328](src/truck/truck.js:328)):
  particles, tire marks, and audio are called from inside it. `TruckBody` is
  purely visual (sprung-mass cab lean) and loads an OBJ tire model at import.
- **Browser globals in the sim graph.** `TrackLoader` fetches over HTTP;
  `AIPathPlanner` and `setupAIDrivers` touch `window`; `settingsStorage` reads
  `localStorage`; `SceneBuilder.js:217` binds a `window` event; the loop checks
  `document.hidden`.
- **Non-determinism in sim paths.** `Math.random` in `TerrainPhysics`,
  `AIPathPlanner`, `AIBoostController`, `setupAIDrivers`, `PickupManager`;
  wall-clock `Date.now()` in `Controls.js:118`, `Controls.js:179`,
  `AIBoostController.js:92`; `performance.now()` in `DriveMode.js:351`.

## Phases

Each phase should end in something runnable. Do not start the next until the
previous one is verified.

### Phase 0 — Headless spike (throwaway)

Prove the physics stack runs in Node before restructuring anything.

- Node script: `NullEngine` + `HavokPhysics()` + a `Track` loaded from disk +
  displaced ground mesh + `PhysicsAggregate` + one `Truck`.
- Step it 600 times at fixed `dt = 1/60` with a constant throttle input; print
  final position.
- Run twice, confirm byte-identical output (same-machine determinism).

Deliverable: `scripts/spike-headless.mjs`. Answers the only question that can
kill the whole approach — whether `@babylonjs/havok`'s WASM build initializes and
steps under Node — plus a first read on per-lobby memory and per-tick cost.

Fall back to `scripts/babylon-stub.mjs`-style stubbing only if `NullEngine`
proves unusable; prefer the real engine so there is one physics codebase.

### Phase 1 — Extract the simulation step

Pure refactor, no behaviour change, client still single-player.

- New `src/sim/RaceSimulation.js`: owns trucks, track, terrain, checkpoints,
  zones, collision managers, pickups, obstacles, lap/position bookkeeping.
- `step(dt, inputsById)` — the ordered sequence currently living in
  [RaceMode.js:586-700](src/modes/RaceMode.js:586): collision pre-update, truck
  updates, static-body collision, zones, OOB countdown, collision resolve,
  obstacles, pickups, checkpoints, positions.
- `getSnapshot()` — flat serializable race state.
- Split `truck.update()` into `updateSim()` and `updatePresentation()`. Particles,
  tire marks, audio, and `TruckBody` move to the presentation side.
- Split `buildScene()` into `buildSimScene()` (physics, track, terrain grid,
  ground geometry, walls, bridges, checkpoints, obstacles, drive-surface
  registry) and `buildVisuals()` (everything else). Browser path calls both.
- `RaceMode` becomes: build both, own `InputManager`/camera/UI, call
  `sim.step(dt, {local: input})` then `updatePresentation()`.

Verify: `npm run build:raw` clean, then drive a race and confirm handling,
collisions, laps, and effects are unchanged. This phase is where feel can
silently regress — bisect by reverting one extraction at a time if it does.

### Phase 2 — Fixed tick and determinism cleanup

- Fixed-step accumulator at **60 Hz** (`SIM_DT = 1/60`). 60 rather than 30
  because current typical `dt` is ~1/60 and all handling tuning is implicitly
  calibrated to it — dropping to 30 would change the feel of every truck.
- Sim reads only its `dt` argument. No `engine.getDeltaTime()`, no
  `performance.now()`, no `Date.now()` below the sim boundary. Convert the
  `noSteerUntil` / `noDriveUntil` / boost-cooldown timers from wall-clock
  deadlines to tick counts or countdown seconds.
- Seeded PRNG (`src/sim/rng.js`, e.g. mulberry32) threaded through the sim.
  Replace every `Math.random` in a sim path. The race seed is part of the join
  payload, so clients can reproduce cosmetic variation.
- Node-side `TrackLoader` variant reading from the filesystem; sim modules take
  settings as constructor arguments instead of reading `localStorage`.
- Cap catch-up (max ~5 steps per tick) so a stalled child cannot spiral.

Verify: extend the Phase 0 spike into a repeatable check script
(`scripts/check-sim-determinism.mjs`) — same seed and input log must produce the
same final state across runs. Wire it up like the existing `check:*` scripts.

### Phase 3 — Lobby child process

- `server/lobby/index.js`: the child. Argv/env carries `{trackKey, seed, players,
  raceConfig, port, tokens}`.
- Boots the headless sim, opens a `ws` server on its assigned port, authenticates
  each connection against its token, waits for all players (with a join timeout),
  runs countdown, then ticks.
- **Input ingest** — the anti-cheat surface, all of it here:
  - At most one input frame accepted per player per tick; extras dropped.
  - Reject ticks outside `[currentTick - 8, currentTick + 4]`.
  - Clamp `steer` and `throttle` to `[-1, 1]`; treat malformed frames as "no input".
  - Missing input extrapolates the last received frame; never pause a truck for
    a player who stops sending.
  - Respawn is a *request*: server-side cooldown, and it places the truck at the
    last **validated** checkpoint.
- **Snapshots** at 20 Hz to all clients: per-truck position, heading, velocity,
  and a flags byte (grounded, boosting, surface id) for client-side effects. Plus
  the tick number and the last input tick the server processed per player.
- **Events**, reliable and out-of-band from snapshots: checkpoint passed, lap
  completed, pickup taken, position change, race finished.
- Heartbeat to the parent over IPC with the current tick.
- On finish: send results and the input log up to the parent, then exit.

Wire format: start with JSON to get it working, then move snapshots to a binary
`DataView` encoding. Design the message shapes so that swap is mechanical
(fixed field order, analog `steer`/`throttle` as `i8` rather than the current
boolean left/right, so gamepads and mobile need no protocol change later).

### Phase 4 — Parent process

- `server/index.js`: HTTP + WebSocket on one public port.
- Lobby registry, matchmaking / lobby codes, track selection.
- Spawns children (`child_process.fork`), assigns a port from a configured range,
  mints per-player tokens, returns `{host, port, token}` to each client.
- Health: kills a child whose reported tick stops advancing or whose heartbeat
  lapses; reaps and cleans up the registry.
- Owns all persistence — results, leaderboards, input-log archive. **Children
  never write to storage directly**, so a killed child cannot half-commit a race
  result.

Deployment note: the child port range has to be reachable. Fine for a single
box; if that becomes a problem later, front it with a proxy that reads the lobby
registry — that change is invisible to the client, which already receives its
endpoint at runtime.

### Phase 5 — Client: remote trucks, no prediction

Get a correct race on screen before making it feel good.

- `src/net/NetClient.js`: connect, join, send input at 60 Hz, receive snapshots.
- New `NetRaceMode`: builds the full visual scene, but runs **no** local
  simulation. Every truck — including the local one — is positioned by
  interpolating between the last two snapshots, held ~100ms behind for a
  jitter buffer.
- Drive presentation from snapshot-derived state: particles, tire marks, audio,
  `TruckBody` lean, camera.

This will feel laggy on the local truck. That is expected and correct — it
proves the pipeline before prediction can hide bugs in it.

### Phase 6 — Client prediction and reconciliation

- Local truck only: run `RaceSimulation.step()` locally on the same fixed tick,
  keeping a ring buffer of `{tick, input, state}`.
- On snapshot: compare authoritative state at the acked tick against the buffered
  prediction. If the error exceeds a threshold, snap to the server state and
  replay stored inputs forward. Below threshold, smooth the correction over a few
  frames rather than snapping.
- **Prediction output never travels upward.** Inputs up, snapshots down. The
  client's local sim is a display convenience with no authority.
- Cap replay at ~200ms of ticks. A player with bad or withheld packets gets a
  worse experience, never a better one.
- Remote trucks stay on interpolation.

Watch item: prediction only converges if client and server agree on ground
height. Analytic terrain sampling is the safe path here; divergence between the
raycast and analytic paths shows up as visible snapping. This is the piece most
likely to need iteration.

### Phase 7 — Replay archive and bot detection

- The input log is nearly free: a few bytes per player per tick. The child streams
  it to the parent; the parent archives it alongside the result and the seed.
- Offline re-simulation tool: replay a race from `{seed, track, input log}` and
  confirm the recorded result. Detects both tampering and sim regressions — it
  doubles as a physics-change canary.
- Detection heuristics over the archive, for human review, never auto-ban:
  input-timing variance near zero, lap lines identical within noise, reaction
  latencies below the human floor (~150ms), boost timing too consistent.
- Existing `TelemetryRecorder` / `GhostRecorder` formats are worth reusing here
  rather than inventing a third representation.

## Protocol sketch

Client → server, per tick:

```
{ t: tick, s: steer(-1..1), g: throttle(-1..1), b: boostHeld, r: respawnRequest }
```

Server → client, 20 Hz:

```
{ t: tick, ack: {playerId: lastInputTick},
  trucks: [{ id, x, y, z, h, vx, vy, vz, flags }] }
```

Server → client, on event (reliable, unbatched):

```
{ type: 'checkpoint'|'lap'|'pickup'|'position'|'finish', ... }
```

Join response from parent:

```
{ host, port, token, trackKey, seed, players: [{id, name, vehicle, color}], raceConfig }
```

## Open questions

- **Raycast budget (server-side only).** The existing savings don't apply: cadence
  is keyed on `this.driver` ([truck.js:97](src/truck/truck.js:97)), so only AI
  trucks throttle, and the extra distance gate
  ([truck.js:372](src/truck/truck.js:372)) keys off the *player's* truck position.
  In an 8-human lobby every truck runs full-rate multi-probe sampling, and the
  distance gate has no coherent server-side meaning (each client has its own
  focus) so it has to be dropped rather than reconfigured. Clients get cheaper,
  not more expensive — 7 simulated AI trucks become 7 interpolated ghosts.
  Phase 0 should measure per-tick cost with 8 trucks.

  Caveat for Phase 6: `normalSampleInterval` and `multiProbeSurfaceSampling`
  change the sampled normal → grip → trajectory. They are physics parameters, not
  perf knobs. The local truck's sampling config **must match** between client and
  server or prediction diverges continuously and reconciliation shows as constant
  micro-snapping. So the levers are a uniform cadence for everyone (changes
  handling feel, but consistently) or the analytic height path — and whichever is
  chosen should probably become single-player's regime too, so the two handling
  models don't drift apart.
- **AI drivers in multiplayer.** Filling empty slots with AI is nearly free
  server-side (they already produce analog input), but `setupAIDrivers` touches
  `window`. Decide in Phase 2 whether to clean it up or defer AI to post-launch.
- **Lobbies per box.** Falls out of Phase 0's memory number. Expect
  100–200 MB/child; measure before sizing anything.
- **Pickups and obstacles.** Server-authoritative and seeded, so all clients see
  the same spawns. `PickupManager`'s `Math.random` has to move to the seeded RNG.
- **Reconnect.** Out of scope for now. A dropped player's truck keeps
  extrapolating last input; decide later whether to park it or allow rejoin.
