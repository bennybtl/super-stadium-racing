# Roadmap — suggestions for upcoming sessions

_Review date: 2026-09-23 · last status update 2026-09-24 · branch `better-rocks`_

Complements `CLEANUP.md` (refactor plan, still valid — not repeated here).

**Health now:** `npm test` 102/102 · `npm run check` (all 9 check scripts, incl. physics) green and
enforced in the deploy workflow · app JS chunk **707 KB** (was 8.6 MB), Babylon in
its own 6.1 MB vendor chunk, editor lazy-loaded.

## Status

| Item | Status |
| --- | --- |
| A1 Fix `check:terrain` | ✅ Done 2026-09-23 |
| A2 Tests + checks in CI | ✅ Done 2026-09-23 |
| A3 MP server input hygiene | ✅ Done 2026-09-24 |
| A4 MULTIPLAYER.md vs code | ✅ Done 2026-09-24 |
| A5 Strip console logs in prod | ⬜ Open |
| B1 Gamepad support | ⬜ Open — deferred |
| B2 Keyboard steering smoothing | 🟨 Mostly exists already — see below |
| B3 Minimap | ✅ Done 2026-09-24 (races only) |
| B4 Camera juice | ✅ Done 2026-09-24 |
| B5 Shareable ghosts | ⬜ Open |
| B6 Touch controls | ⬜ Open (only if phones matter) |
| C1 Fixed-timestep sim | ✅ Done 2026-09-23 |
| C2 Bundle size | 🟨 (a)+(b) done 2026-09-24, (c) open |
| C3 Finish CLEANUP §2.3 | ⬜ Open |
| C4 Physics regression check | ✅ Done 2026-09-24 |
| C5 Server tests | ⬜ Open |

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

**A5. Strip `console.debug`/`log` from prod** (69 call sites) via
`esbuild.drop`/`pure` in `vite.config.js`. One line (CLEANUP 3.5 alternative).

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
setting "Minimap". _Follow-up:_ wired into RaceMode only — MP / HotLap / Practice
are a few lines each.

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
- Race / Multiplayer lap times still use `Date.now()` (HotLap already sums sim dt).
- Tire marks / particles emit at the sim pose, up to one step (~0.5 m at top
  speed) ahead of the rendered truck — hasn't been noticeable so far.

**C2. Bundle size. — 🟨 (a)+(b) DONE 2026-09-24.**
- (a) Vendor chunks: babylon 6.1 MB, colyseus 118 KB, vue 79 KB, havok 34 KB.
- Found: the vehicle/obstacle/decoration loaders inlined every OBJ as a raw string
  (1.1 MB, and shipped again as the `.obj` asset). Now `fetchMeshDefaultColors`
  (`utils/mtl-parser.js`) fetches the model URL; Babylon's later load hits cache.
- (b) Editor (`EditorMode` → `EditorController` + sub-editors, 255 KB) and its 21
  Vue panels load on first open.
- **Open — (c):** deep Babylon imports (`@babylonjs/core/Meshes/...`) instead of the
  barrel (97 files) to tree-shake the 6.1 MB vendor chunk. Biggest remaining win,
  big churn; script it, one commit, after the CLEANUP dir moves.

**C3. Finish CLEANUP §2.3** — `RaceMode.setup()` is still one ~650-line closure
(`RaceFinishTracker` extraction). Still the riskiest file to edit; C1/B3/B4 each
had to thread new code through it.

**C4. Physics regression check. — ✅ DONE 2026-09-24.** `scripts/check-physics.mjs`
(`npm run check:physics`, part of `npm run check` / CI). Runs the real
`Truck.update()` (visual subsystems stubbed) at SIM_DT through 9 scenarios on
synthetic tracks — accel, brake, coast, sustained turn, slalom, nitro, asphalt,
loose dirt, jump (airtime / apex / speed through landing) — against
`scripts/physics-golden.json`, plus invariants (finite state, never below ground,
under the nitro × soft-cap speed limit). Seeded `Math.random`, sim-time `Date.now`.
Verified sensitive: STEER_RAMP_UP 4 → 4.5 fails turn + slalom only. Not covered:
wall/truck collisions (walls are in `check:walls`), AI driving, bridges.

**C5. Server tests.** `server/DriveRoom.js` has finish-order / DNF-grace logic
with zero tests. Colyseus rooms are plain classes — a vitest with a fake client
list covers `_nextFinishPosition`, host migration on leave, DNF timer.

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

1. Minimap in HotLap / Practice / MP; Race/MP lap times on sim time (C1 follow-up).
2. A5 strip console logs in prod (one line).
3. B1 gamepad when un-deferred (B2 steering easing already exists).
4. C5 remaining server tests (host migration, DNF timer) — the harness in
   `test/server-validate.test.js` makes these quick.
5. C3 when RaceMode is next touched; C2(c) after the CLEANUP dir moves.
