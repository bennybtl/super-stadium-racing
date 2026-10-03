# Online Multiplayer — Implementation Plan

> **Read this first.** Everything below "What actually shipped" is a *future*
> plan (server-authoritative simulation) that has **not** been built. The
> multiplayer in the game today is a client-simulated relay. Don't design
> against the plan as if it were the current architecture.

## What actually shipped (as of 2026-09-24)

**Architecture: client-simulated, server-relayed.** `server/DriveRoom.js` is a
thin colyseus room, not a simulation.

- Each client runs the normal single-player physics for **its own truck only**
  (`src/modes/MultiplayerMode.js`) and sends `state` — `{x, y, z, heading}` — at
  15 Hz. The room relays it to everyone else, where it drives a visual-only
  `RemotePuppet`. `RemoteTruckCollision` pushes the local truck off puppets
  (one-sided: nobody pushes you from the server).
- Laps and finishes are **self-reported**: each client runs checkpoint/lap
  tracking locally and sends `lapCompleted` / `finished`. The room is the arbiter
  of finish order, the 45 s DNF grace after the first finisher, and the final
  `raceOver` results.
- Lobby flow: the host creates a room (track, direction, laps), players pick a
  truck/colour, the host sends `start` → room locks → everyone loads the track.
  If the host leaves, the longest-connected player becomes host (`hostChanged`).
  `GET /lobbies` (server/index.js) lists open rooms.

**Input hygiene** (`server/validate.js`, tested in `test/server-validate.test.js`):
every client value is rebuilt from type-checked fields or dropped — nothing is
relayed verbatim. `state` is whitelisted, range-checked and rate-limited (token
bucket, 30/s sustained, burst 10); names/keys are type- and length-checked;
`maxClients` clamped 2–8, laps 1–20; a lap is accepted only as the next lap, and
`finished` only after the final lap; times must be finite and sane.

**Still trusted (i.e. cheatable):** position (teleporting/speed hacks are
invisible to the server), lap *timing*, and checkpoint order — the server only
checks that laps arrive in sequence. Acceptable for friendly lobbies; the
server-authoritative plan below is the fix if that stops being true. Work on it lives on the `mp-server` branch (Phase 0 done).

**Since this plan was written:** the fixed 60 Hz sim step from Phase 2 has
landed client-side (`src/modes/fixed-step.js`, max 5 steps/frame), and the game
loop is split into sim step / render parts. The "Current state" findings below
about `dt` coming from the renderer and the loop being one interleaved closure
are therefore partly outdated; the determinism items (`Math.random`, `Date.now`
in sim paths) still stand.

---

# Future plan: server-authoritative simulation

Server-authoritative racing over WebSockets. Clients send inputs; the server runs
the real simulation and broadcasts state. Phase 0 done; Phase 1 next.

## Architecture decisions (locked)

- **Server-authoritative simulation.** The server runs the same truck physics the
  browser runs today. Clients never assert position, velocity, or game state.
- **Process per lobby.** A parent Node process spawns one child per race. Crash
  isolation (a Havok assert or NaN cascade kills one race, not the box) and tick
  isolation (Node is single-threaded — one lobby's frame spike must not become
  everyone's jitter).
- **Children own their own WebSocket server.** A client connects to the parent,
  receives `{path, token}`, and opens a websocket to `/race/<raceId>` on the
  same port, which the parent relays to the child (loopback only). No
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

**Result (2026-09-27): viable.** `node scripts/spike-headless.mjs [track] [trucks]`
— NullEngine + Havok WASM (`HavokPhysics({ wasmBinary })` from the package file)
+ real track JSON + displaced ground (MESH body, drive-surface registry, real
`TerrainQuery`) + real `new Truck(scene, null)`, 600 ticks at SIM_DT.

- Same-machine determinism: identical state hashes across runs (1 and 8 trucks,
  apple_river and cross_country), with `Math.random`/`Date.now`/`performance.now`
  shimmed to a seeded PRNG + sim clock — i.e. the Phase 2 work is required.
- Cost, 8 trucks (ground only, no walls/collision/checkpoints yet): median
  0.2–0.27 ms/tick, p99 ~1 ms, one ~10 ms outlier (JIT warm-up). 60 Hz budget is
  16.7 ms — CPU is not the constraint.
- Init: Havok 13 ms, track + ground ~400 ms, 8 trucks ~35 ms.
- Memory: ~260–285 MB RSS per process, of which ~140 MB is Node + the bundled
  Babylon before any scene exists. That's the per-child floor → ~3–4 lobbies/GB.
  A leaner server bundle (sim modules only) is the lever if density matters.
- `Truck`'s constructor builds visuals regardless (`TruckBody` canvas texture →
  needed an `OffscreenCanvas` stub; tire OBJ load fails → cylinder fallback).
  Confirms the Phase 1 `updateSim`/presentation split.
- Shared `Math.random` couples trucks: truck 0 ends somewhere different in an
  8-truck run than alone. Per-truck RNG streams in Phase 2 would decouple them.

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

**Progress (2026-09-27):**
- ✅ `Truck.update()` = `updateSim()` + `updatePresentation()` (+ `getDebugInfo()`).
  Physics golden and spike hash unchanged.
- ✅ `src/sim/race-rules.js`: zones, out-of-bounds tracker (sim-time grace, was
  `performance.now`), respawn — pure; DriveMode/BaseMode methods delegate.
- ✅ `src/sim/RaceSimulation.js`: race state + `step(dt, inputsById)` + events;
  RaceMode drives it (`test/race-simulation.test.js`). Truck presentation now runs
  after the whole sim step instead of interleaved per truck. Other modes
  (HotLap/Practice/Multiplayer/Menu) still call `truck.update()` directly.
- ✅ Scene split: `src/sim/sim-scene.js` — `enableSimPhysics`, `buildSimTerrain`
  (terrain grid, ground geometry + MESH body, drive surfaces), `buildSimFeatures`
  (walls, border, outskirts, checkpoints, obstacles, pickups, tunnels, steep-slope
  blockers, bridges), `buildSimScene` (both, headless). `buildScene` interleaves
  them with its visuals (lights/shadows → terrain textures → sim features with
  visual hooks → signs, lights, decorations, decals, tire marks, water, scatter).
  Sim managers still make meshes/materials (fine under NullEngine); visual args
  (`shadows`, bridge blend textures, outskirts material) are optional.
  `scripts/spike-headless.mjs` now builds the real sim scene + `updateSim()`:
  deterministic on apple_river / quarry_run (tunnel) / the_road, ~0.6–0.9 s build.
  Headless needs `window.obstacleLoader` stubbed — a Phase 2 browser-global item.

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

**Progress (2026-09-27):**
- ✅ Fixed 60 Hz step + catch-up cap — landed earlier (C1, `modes/fixed-step.js`).
- ✅ `src/sim/rng.js`: mulberry32 + `rngStream(seed, label)`, one stream per
  consumer so trucks don't couple. Seeded: roughness bumps
  (`TerrainPhysics.random`, stream `truck:<id>`), pickup spawns
  (`PickupManager.random`, `pickups`), AI line choice + boost rolls
  (`AIDriver.random`, `ai:<i>`, set by `makeAIDriverFactory({ seed })` before the
  grid-time path bake), AI random vehicle pick (`setupAIDrivers({ random })`,
  `grid`). Each defaults to Math.random; RaceMode draws a race seed and passes
  it to both the AI factory and `RaceSimulation({ seed })`.
- ✅ Wall clock out of the sim: head-on lockouts are countdown seconds
  (`state.noDriveTimer`/`noSteerTimer`, counted down in `updateSim`); the AI boost
  controller runs on `AIDriver.clockMs`; PolyWall's scuff repaint moved from the
  contact callback to a render hook.
- ✅ Injectable definitions: `setObstacleLoader()` (falls back to
  `window.obstacleLoader`); obstacles without a `modelUrl` are physics-only.
  `setupAIDrivers({ vehicleLoader })`.
- ✅ `RaceSimulation.step` takes input for any number of human trucks (AI =
  trucks with a `driver`).
- ✅ `npm run check:determinism` (`scripts/check-sim-determinism.mjs`): 4 human
  trucks × 15 s on apple_river / quarry_run / the_road, twice per seed →
  identical; `Math.random`, `Date.now` and `performance.now` throw during steps.
- ⬜ AI headless: `AIDriver` imports the Vue debug store (`useDebugStore`), so it
  doesn't construct in Node. Needed only if lobbies get AI fillers.
- ⬜ `Truck` still builds its visual body at construction (needs a canvas and a
  `window` stub headless). A `{ headless }` option, or moving `TruckBody` out of
  the constructor, would drop both stubs.
- Not needed: a Node `TrackLoader` — `Track.fromJSON(readFileSync(...))` is it.
  Settings already arrive as arguments (`rubberBandLevel`, upgrades).

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

**Progress (2026-09-27): built, JSON wire format.**
- `server/lobby/index.js` — the child. Config via `LOBBY_CONFIG` env (JSON:
  `trackKey, reverse, laps, seed, port, players[{id,name,vehicleKey,token}],
  joinTimeoutMs, maxRaceMs`) — env, not argv, so tokens stay out of `ps`.
  Token auth by first message (`hello`, constant-time compare; never in the URL);
  a reconnect with the same token replaces the old socket. Countdown when all
  joined or on join timeout; 60 Hz drift-corrected loop, ≤5 catch-up steps then
  drop time; snapshots every 3 ticks; sim events forwarded as `event` messages;
  `results` to clients and `{ result, inputLog, seed, … }` to the parent, then
  exit. Heartbeat `{ tick, phase }` over IPC each second; exits if the parent goes.
  Ends on race end, `maxRaceMs`, SIGTERM, or everyone disconnecting.
- `server/lobby/inputs.js` — ingest (unit-tested): sanitise/clamp, window
  `[tick, tick + 4]` (late frames dropped — no rewind, so the plan's `- 8` is
  moot), one frame per tick, extrapolate last frame, boost/respawn on rising
  edge. Per-connection token bucket (120 msg/s) on top.
- Sim side: `RaceSimulation.requestBoost` / `requestRespawn` (3 s cooldown on
  the server, last *validated* checkpoint) / `getSnapshot()`;
  `src/sim/headless-race.js` `createRace()` (shared with check:determinism);
  `new Truck(…, { headless: true })` skips all visuals.
- Node runs a bundle of the sim: `npm run build:server-sim` →
  `server/build/sim.mjs` (git-ignored). `server/lobby/headless-env.js` stubs
  `OffscreenCanvas` (checkpoint decals still draw into one).
- Input log: `[tick, playerIndex, s, g, b, r]` whenever a player's applied frame
  changes — hold-until-next replays it exactly.
- `npm run check:lobby` (`scripts/lobby-smoke.mjs`, in CI via `npm run check`):
  forks a real child, two ws clients + a bad-token one, checks welcome,
  countdown, 20 Hz snapshots, acks, extrapolation, results, IPC, clean exit.

Open for later phases:
- ~~**Input lead window.**~~ Widened to `+8` in Phase 5; clients stamp inputs
  one-way latency + 2 ahead.
- **Grid** is behind the start/finish gate in join order; a track's
  `startPosition` marker isn't applied headless yet.
- ~~**Deployment**~~ (done in Phase 4): the Dockerfile copied only `server/` and omitted dev deps, but
  the child needs `src/tracks|vehicles|obstacles` and a built bundle (esbuild is
  a dev dep) — a build stage is Phase 4 work.
- Binary snapshots; surface id in `flags`; reconnect/rejoin semantics.

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

Deployment note: only the one server port is exposed. Races listen on
loopback (`RACE_PORT_MIN..MAX`) and `server/lobbies/raceProxy.js` relays
`/race/<raceId>` upgrades to them.

**Progress (2026-09-27): built.** Lives beside the colyseus relay (unchanged)
on the same port, mounted by `server/index.js` via `server/lobbies/index.js`.
- **HTTP API** (not a WebSocket — lobby state is polled, ~1 s is plenty):
  `GET/POST /race-lobbies`, `GET /race-lobbies/:code`, `POST …/join`,
  `…/leave`, `…/start`, `PATCH …` (host settings), `PATCH …/me` (name/vehicle),
  `GET /races`, `GET /races/:raceId`. Each player's `secret` goes in
  `Authorization: Bearer` — never a URL. Polling with it is also presence; once
  racing, the view carries that player's own `race: { path, token }`.
  Create/join rate-limited per IP.
- `LobbyRegistry` — pure state machine (waiting → starting → racing →
  finished | failed), 5-char codes without 0/O/1/I, host-only settings/start,
  host handover, idle players dropped after 30 s, idle lobbies expire after
  30 min, closed ones readable 10 min. A spawn failure (no free port) puts the
  lobby back to waiting with a 503. 9 unit tests.
- `RaceSupervisor` — forks `server/lobby/index.js` per race, port pool
  (`RACE_PORT_MIN..MAX`, default 22000–22099), kills on: no ready in 30 s,
  heartbeat lapse > 5 s, tick frozen > 5 s during countdown/racing. Every exit
  path releases the port and reports once. 5 tests against a fake race process
  (`test/fixtures/fake-race.mjs`). The child now sends `ready` only once its
  WebSocket is listening.
- `ResultStore` — one JSON per race (`RACE_DATA_DIR`, default
  `server/data/races`, git-ignored): rows, seed, track, reason and the input
  log; temp-file + rename writes. The API never serves input logs.
- **Docker** — `server/Dockerfile` is multi-stage: a build stage bundles the sim
  (esbuild is a dev dep); the runtime copies the bundle plus the track/vehicle/
  obstacle JSON. Build from the repo root: `docker build -f server/Dockerfile .`.
  Publish 2567 only (races are proxied through it). `/data` is a volume for results.
- `npm run check:lobbies` (`scripts/lobbies-smoke.mjs`, in CI): the whole flow
  against the real server — create, join, vehicle pick, host-only start, forged
  secret refused, per-player tokens, two ws clients race, stored result. Also
  run against the Docker image (`LOBBIES_URL=http://127.0.0.1:<port>`): passes.

Not done / later: leaderboards (results are stored; nothing aggregates them
yet); `/races` reads every file per call (fine until there are many); lobbies
live in memory, so a server restart drops open lobbies and running races; only
`src/tracks` tracks are raceable (not track packs).

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

**Progress (2026-09-27): built — dev-only "Online (beta)" on the start menu,
beside the colyseus Multiplayer (unchanged).**
- `src/net/LobbyApi.js` — REST client (same host as the page, port 2567).
- `src/net/NetClient.js` — race socket. `ServerClock` (ping/pong every 1 s,
  lowest-RTT sample, NTP-style), `InputStamper` (one frame per tick, stamped
  one-way latency + 2 ahead, skips stale ticks after a stall),
  `SnapshotBuffer` (interpolation, short-way heading, ≤6-tick extrapolation).
  Draws at *server clock − one-way latency − 6 ticks* — the jitter buffer sits
  behind the newest state that can have arrived; measured to stay interpolating
  (≥ ~2 ticks margin at p5) at 0, 50±20 and 100±30 ms one-way.
- Server additions: `ping`/`pong`; snapshots also carry lap, checkpoint, nitros
  left, chassis pitch/roll, slip, throttle, steer, speed-pad flag (what a client
  needs to *present* a truck it doesn't simulate); `startLine` event; input
  window `+8`.
- `Truck.applyNetState(sample)` poses a truck from a snapshot and fills its sim
  frame so the normal `updatePresentation()` runs (body, dust, marks, wake,
  audio).
- `NetRaceMode` — full visual scene, no local sim: every truck (own included)
  from snapshots; HUD, checkpoint highlight, timer, laps and results from server
  events; countdown aligned to the server's GO tick; nitro / R reset as short
  held flags (one rising edge server-side). Pausing sends *neutral* input — the
  server repeats the last frame, so a held throttle would keep driving.
- UI: `OnlineLobby.vue` (join by code, open races, create), `OnlineRoom.vue`
  (code, host track/laps/reverse, vehicle pick, players, start),
  `stores/online.js` (polls the lobby at 1 Hz; hands off to NetRaceMode when
  the view carries the race endpoint).
- `check:lobby` now also runs the game's real `NetClient` over a 50 ms ± 20 ms
  socket: clock sync, inputs landing on their ticks (p95 0 behind),
  interpolation margin.

- Pickups and obstacles are mirrored. `RaceSimulation` owns pickup collection
  (grants the nitro; `onPickupSpawn` / `onPickup` events — RaceMode keeps only its
  UI part); the child forwards them as `pickupSpawn` / `pickup` events and the
  client shows copies (`PickupManager.addMirrored` / `removeMirrored` / `animate`,
  never collects). Knocked-loose obstacles ride in snapshots as `obs` (by build
  index — identical on every client); the client drops its own obstacle physics
  and interpolates the pose (`Obstacle.setNetPose`). check:determinism now hashes
  obstacle poses too: Havok is deterministic across fresh instances.
- Fixed on first real use: a pickup spawning mid-race crashed the race process
  (model import is empty server-side); a sim error now ends the race with
  reason "server error" instead of dropping everyone. Track packs are raceable
  (`server/tracks.js`, `GET /race-tracks`); editor-only tracks aren't.

Still: truck colours are by join order; a locally edited copy of a built-in
track is drawn but the server races the original file.

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

**Progress (2026-09-27): built.**
- `src/net/Prediction.js` — the player's truck simulates each tick it sends
  input for: the per-truck part of `RaceSimulation.step` (updateSim, wall
  collisions, slow / speed-pad zones, nitro on the rising edge, grid handbrake
  until GO), recording `Truck.captureSimState()` per tick. A snapshot for tick t
  is compared with the record for t (1 cm / 0.002 rad / 0.05 m/s / nitro count);
  on a mismatch the truck is restored to t, given the server's pose, velocity,
  pitch/roll, timers and suspension, and the stored inputs replayed (≤ 30 ticks).
  Corrections glide out over ~0.1 s (a > 3 m jump — a respawn — cuts). Rendered
  between the last two predicted ticks, like FixedStepLoop.
- Shared so client and server can't drift: `src/sim/input-frame.js` (frame →
  truck controls) and `src/sim/snapshot-wire.js` (snapshot short keys). The
  truck's own roughness RNG stream is seeded identically and is rewindable
  (`getState` / `setState`). Snapshots gained `bt sbt nd ns sc`.
- `Truck.captureSimState` / `restoreSimState` (`src/sim/sim-state.js`): pose,
  `state`, terrain/controls/drift internals, the surface-continuity lock, the
  terrain query's last surface, RNG position. Verified complete: after a
  respawn correction the full state diff between server and client is empty.
- **Found and fixed:** Havok wrote each truck's body back onto its mesh after
  every physics step, float32-rounded — the server and client step Havok on
  different schedules, so that alone broke exact prediction. Truck bodies now
  have `disableSync` (the mesh is the sole authority; affects single-player only
  by removing that rounding).
- `npm run check:prediction`: server race + predicting client side by side —
  exact match tick for tick (1200 ticks on apple_river, until an out-of-bounds
  respawn elsewhere); late snapshots need no correction beyond ≤ 2 per server
  respawn; a knocked-off prediction recovers (last 3 s: p90 ≤ 6 mm).
- NetRaceMode logs `rtt · corrections · resets` to the console every 5 s.

Not predicted (the snapshot corrects them): other trucks, obstacle hits,
pickups, out-of-bounds and requested respawns. A snapshot only carries the
pose, not the truck's internal smoothing, so after a real misprediction the
internals can differ slightly and a landing may need one more small correction.

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
