# Roadmap — suggestions for upcoming sessions

_Review date: 2026-09-23 · last status update 2026-09-24 · branch `better-rocks`_

Complements `CLEANUP.md` (refactor plan, still valid — not repeated here).

**Health now:** `npm test` 116/116 · `npm run check` (all 9 check scripts, incl. physics) green and
enforced in the deploy workflow · app JS chunk **718 KB** (was 8.6 MB), Babylon
chunk **2.2 MB** (was 6.1 MB; curated deep imports), editor lazy-loaded.

## Status

| Item | Status |
| --- | --- |
| A1 Fix `check:terrain` | ✅ Done 2026-09-23 |
| A2 Tests + checks in CI | ✅ Done 2026-09-23 |
| A3 MP server input hygiene | ✅ Done 2026-09-24 |
| A4 MULTIPLAYER.md vs code | ✅ Done 2026-09-24 |
| A5 Strip console logs in prod | ✅ Done 2026-09-24 |
| B1 Gamepad support | ⬜ Open — deferred |
| B2 Keyboard steering smoothing | 🟨 Mostly exists already — see below |
| B3 Minimap | ✅ Done 2026-09-24 (all race modes) |
| B4 Camera juice | ✅ Done 2026-09-24 |
| B5 Shareable ghosts | ⬜ Open |
| B6 Touch controls | ⬜ Open (only if phones matter) |
| C1 Fixed-timestep sim | ✅ Done 2026-09-23 |
| C2 Bundle size | ✅ Done 2026-09-24 |
| C3 Finish CLEANUP §2.3 | ✅ Done 2026-09-24 |
| C4 Physics regression check | ✅ Done 2026-09-24 |
| C5 Server tests | ✅ Done 2026-09-24 (+ host handover fix) |

---

## A. Quick wins (≤ 1 session each)

**A1. Fix `check:terrain`. — ✅ DONE 2026-09-23.** esbuild crashed on
`BorderWall.js`'s `?url` png imports; stubbed like `check-water.mjs`. Golden
re-recorded for the 21 current tracks (it held renamed/removed tracks).

**A2. Run tests + checks in CI. — ✅ DONE 2026-09-23.** `npm run check` runs all
`check:*` scripts; `deploy-pages.yml` runs `npm test` + `npm run check` before
building. Only on pushes to `main` — a separate PR workflow is an easy add.

**A3. Multiplayer server input hygiene. — ✅ DONE 2026-09-24.** New
`server/validate.js` (pure, 10 tests in `test/server-validate.test.js`, incl.
DriveRoom driven through its handlers). Every client value is rebuilt from
whitelisted fields or dropped: `state` whitelisted + range-checked + token-bucket
rate limit (30/s, burst 10); names/keys type/length/control-char checked;
`maxClients` 2–8 and laps 1–20 clamped (maxClients was unbounded); laps accepted
only as the next lap and `finished` only after the last one (both were trusted
outright); times finite and sane. Still trusted: positions and lap timing — true
anti-cheat is the server-authoritative plan.

**A4. `docs/MULTIPLAYER.md` vs code. — ✅ DONE 2026-09-24.** Doc now opens with
"What actually shipped" (client-simulated relay, what's validated, what's still
trusted, which of its findings C1 made outdated); the rest is labelled a future
plan. AGENT.md no longer calls the server authoritative.

**A5. Strip console logs from prod. — ✅ DONE 2026-09-24.** `esbuild.pure:
["console.debug"]` in `vite.config.js`: the minifier drops all 68 `console.debug`
calls from production builds (0 left in `dist/`), dev keeps them. `console.log` /
`console.table` kept on purpose — FrameProfiler's opt-in reports and DebugManager's
log dump use them; warn/error untouched. Covers CLEANUP §3.5.

---

## B. Gameplay / feel (highest player-visible value)

**B1. Gamepad support.** There is none (`InputManager` is keyboard-only). For a
racing game this is the single biggest gap. Poll `navigator.getGamepads()` in
`InputManager`, map left stick → **analog steer**, triggers → analog throttle/brake,
buttons → boost/reset/camera. The truck already accepts analog `input.steer`
(the AI uses it — see AI proportional steering), so the physics side is ready.
Add a Gamepad row to the Controls settings panel; rumble via
`gamepad.vibrationActuator` on collisions/landings is a cheap bonus (the camera
shake's impact detection in `CameraController._updateMotion` is a ready trigger).

**B2. Keyboard steering smoothing. — 🟨 mostly exists already** (found 2026-09-24;
the original review missed it). `Controls.updateSteering` already eases keyboard
steer (STEER_RAMP_UP 4/s, STEER_RAMP_DOWN 7/s, per-vehicle `steerRampScale`) and
`calculateSpeedFactors` has a speed-based authority curve. Only left: tuning by
feel if it's still twitchy — `check:physics` (turn/slalom) will show the effect.

**B3. Minimap. — ✅ DONE 2026-09-24.** `managers/Minimap.js`: north-up overview,
bottom-right, AI racing line as the road + walls + gates + start/finish, a dot per
truck. Static layer drawn once; per frame only dots. Hidden in photo mode; Display
setting "Minimap" (live). In Race, HotLap, Practice and Multiplayer (remote players
as dots, joins/leaves live) via `DriveMode.setupMinimap` / `updateMinimap`.

**B4. Camera juice. — ✅ DONE 2026-09-24.** In `CameraController` (tuning
constants at top of file): impact shake (trauma from frame-to-frame velocity Δ,
ignores respawns and the MP finish stop), look-ahead along travel (overhead modes,
≤ 7 m), ~8% speed pull-back. Display setting "Camera Shake". Unit-tested in
`test/camera-motion.test.js`. Menu demo camera left plain.

**B5. Hot-lap ghosts as shareable files.** `GhostRecorder`/`HotLapStorage` exist;
export/import a ghost (JSON + fflate, already a dep) the same way track packs
work. Gives asynchronous competition without servers. Now fair across machines:
hot-lap time is summed fixed-step sim time (C1).

**B6. Touch / mobile controls** (0 touch handlers today). Only if the Pages build
is meant for phones — virtual steer/gas/boost buttons + a perf tier default.

---

## C. Engine / architecture

**C1. Fixed-timestep truck simulation. — ✅ DONE 2026-09-23.** `modes/fixed-step.js`:
60 Hz `FixedStepLoop` (max 5 steps/frame) + truck-mesh render interpolation in all
six driving loops; each loop is split into a sim step and a per-frame render part.
Gotcha found on the way: Havok syncs the truck body back onto its mesh after every
physics step (float32), so "was the mesh moved?" checks must use a tolerance.
_Follow-ups:_
- ~~Race lap times on `Date.now()`~~ — done 2026-09-24: RaceMode times laps, the
  race, the HUD timer and the 45 s DNF grace on a sim-time race clock (pausing
  used to add the paused time to your lap, and the DNF `setTimeout` fired behind
  the pause menu). Multiplayer keeps wall-clock time on purpose — the shared race
  runs in real time and finish order is real arrival (commented in the code).
- Tire marks / particles emit at the sim pose, up to one step (~0.5 m at top
  speed) ahead of the rendered truck — hasn't been noticeable so far.

**C2. Bundle size. — 🟨 (a)+(b) DONE 2026-09-24.**
- (a) Vendor chunks: babylon 6.1 MB, colyseus 118 KB, vue 79 KB, havok 34 KB.
- Found: the vehicle/obstacle/decoration loaders inlined every OBJ as a raw string
  (1.1 MB, and shipped again as the `.obj` asset). Now `fetchMeshDefaultColors`
  (`utils/mtl-parser.js`) fetches the model URL; Babylon's later load hits cache.
- (b) Editor (`EditorMode` → `EditorController` + sub-editors, 255 KB) and its 21
  Vue panels load on first open.
- (c) **Done 2026-09-24** — without touching the 98 importing files: the bare
  `"@babylonjs/core"` specifier is aliased (vite.config.js) to `src/babylon.js`,
  which re-exports the 40 symbols the game uses from their deep paths plus the
  side-effect imports (thin instances, instancing, picking, shadow / clustered /
  particle / prepass scene components, physics component, loading screen,
  screenshots). Babylon chunk 6.1 MB → 2.2 MB (gzip ~1.3 → 0.5 MB). A missing
  symbol fails the build; a missing side effect fails at runtime — add it there.

**C3. Finish CLEANUP §2.3. — ✅ DONE 2026-09-24.** `RaceMode.setup()` (a ~780-line
closure) now builds the scene managers + race state into `this._race` and hands off
to methods: `_createTrucks`, `_createRaceUi`, `_wireInputAndMenus`, `_wirePickups`;
loop = `_stepRace` / `_updateLaps` / `_renderRace`; `_startCountdown`, `_resetGame`,
`_triggerRaceEnd`, `_handleDNF`. Results rows are a pure `buildRaceResultRows`
(`modes/race-results.js`, tested). Found + fixed: trucks timed out by the DNF grace
showed as finishers (no DNF badge, podium-eligible). MultiplayerMode.setup() is
still one closure — same treatment if it's next touched.

**C4. Physics regression check. — ✅ DONE 2026-09-24.** `scripts/check-physics.mjs`
(`npm run check:physics`, part of `npm run check` / CI). Runs the real
`Truck.update()` (visual subsystems stubbed) at SIM_DT through 9 scenarios on
synthetic tracks — accel, brake, coast, sustained turn, slalom, nitro, asphalt,
loose dirt, jump (airtime / apex / speed through landing) — against
`scripts/physics-golden.json`, plus invariants (finite state, never below ground,
under the nitro × soft-cap speed limit). Seeded `Math.random`, sim-time `Date.now`.
Verified sensitive: STEER_RAMP_UP 4 → 4.5 fails turn + slalom only. Not covered:
wall/truck collisions (walls are in `check:walls`), AI driving, bridges.

**C5. Server tests. — ✅ DONE 2026-09-24.** `test/drive-room.test.js` (10 tests,
shared harness `test/helpers/drive-room.js`): finish order, DNF after the 45 s
grace (fake timers), raceOver fires exactly once, a finisher who disconnects keeps
their result, a leaver who never finished isn't waited for, solo races. **Found a
bug:** there was no host migration — a host leaving the lobby stranded everyone
(only the host can change settings or start). Fixed: the longest-connected player
takes over (`hostChanged` message → client/store re-sync `isHost`, lobby list
host name updated); 3 of the tests fail without the fix.

---

## D. Content / polish ideas (pick by taste)

- Weather/time-of-day presets building on night-race (dusk, dust storm fog,
  wet surface → lower grip multiplier on `TERRAIN_TYPES`).
- Per-vehicle handling identity: 5 vehicles — expose DriftTuning knobs per
  `vehicles/*.json` so they differ in feel, not just stats/looks.
- Track editor: "test drive from here" (spawn at the camera/selected point)
  — shortens the edit→drive loop a lot.
- Replay camera for the finish: `TelemetryRecorder/Player` already exist;
  a post-race TV-cam replay of the last lap is mostly camera work.
- Track sign breeze: the new hanging-sheet banner is static; a slow sway using the
  same fold functions would bring it to life.

---

## Also done (not on the original list)

- **Track signs** (2026-09-23, `objects/TrackSign.js`): flat planes → hanging
  fabric sheet — taut top edge, sag and fanning folds deepening toward a looser
  bottom, seeded per sign, fold shading baked into vertex colours.
- **Stadium light base** (2026-09-24, `objects/TrackLight.js`): concrete footing at
  the pole foot, with round-post collision (polyline collider, radial push-out). New
  `landOnTop: false` collider option in `StaticBodyCollisionManager` so a boosted hit
  can't pop a truck onto short colliders. Covered by 3 cases in `check:walls`.
- **Display settings**: "Minimap" and "Camera Shake" toggles, applied live.

---

## Suggested order (remaining)

1. B1 gamepad when un-deferred (B2 steering easing already exists).
2. Same setup() breakup for MultiplayerMode when it's next touched.
3. D-list polish ideas (sign breeze, per-vehicle handling, test-drive-from-here…).
