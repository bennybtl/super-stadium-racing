# Roadmap — suggestions for upcoming sessions

_Review date: 2026-09-23 · branch `better-rocks` · ~60k lines JS/Vue_

Complements `CLEANUP.md` (refactor plan, still valid — not repeated here).
Health snapshot: `npm test` 79/79 green; `check:water/surface/walls/panels/rocks/cactus/eztree`
green; `check:terrain` crashed (fixed, A1). Main JS bundle is **8.6 MB**, `dist/` 142 MB.

---

## A. Quick wins (≤ 1 session each)

**A1. Fix `check:terrain`. — DONE 2026-09-23** (png loader stub + golden re-recorded for 21 current tracks). It dies in esbuild before running:
`BorderWall.js:12` imports `concrete_2.texture.png?url` and the script's esbuild
config has no loader for it. `check-water.mjs:55` already stubs `?url` imports —
copy that plugin into `check-terrain.mjs`'s `esbuild.build`, then
re-bless `terrain-golden.json` if it's stale. Has been broken since at least 2026-09-03.

**A2. Run tests + checks in CI. — DONE 2026-09-23** (`npm run check` aggregate; deploy workflow runs `npm test` + `npm run check` before build). `deploy-pages.yml` only does `npm ci && npm run build`.
Add `npm test` and the `check:*` scripts before the build so a broken check blocks
deploy instead of rotting silently (which is how A1 happened).

**A3. Multiplayer server input hygiene.** `DriveRoom` `"state"` handler relays
`{ ...data }` verbatim to every client — any client can inject arbitrary fields
or NaN/huge numbers. Whitelist + `Number.isFinite` the 7 fields and broadcast
only those; add a per-client message rate cap. ~20 lines.

**A4. `docs/MULTIPLAYER.md` contradicts the code.** Doc says server-authoritative
sim with per-lobby child processes; `DriveRoom.js` is (by its own comment) a thin
relay with client-reported laps/finishes. Mark the doc as a future plan and add a
short "what actually shipped" section, so a future session doesn't design against it.

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
`gamepad.vibrationActuator` on collisions/landings is a cheap bonus.

**B2. Keyboard steering smoothing.** Related: with digital keys the player gets
binary steer while AI gets proportional. A short steer ramp (attack/release,
faster return-to-centre, speed-scaled max lock) usually makes keyboard driving
feel much less twitchy. Tunable like the DriftTuning knobs.

**B3. Minimap / track overview in the HUD.** Nothing exists. The AI path polyline
+ checkpoint positions are already on hand; render to a small 2D canvas in
`RaceHUD.vue` with truck dots. Helps on the isometric camera where upcoming
turns are often off-screen.

**B4. Camera juice.** Landing/impact shake (2 mentions total, not wired to
collisions), subtle speed-based FOV/zoom-out, and look-ahead offset in the
direction of travel. All in `CameraController`, all small.

**B5. Hot-lap ghosts as shareable files.** `GhostRecorder`/`HotLapStorage` exist;
export/import a ghost (JSON + fflate, already a dep) the same way track packs
work. Gives asynchronous competition without servers.

**B6. Touch / mobile controls** (0 touch handlers today). Only if the Pages build
is meant for phones — virtual steer/gas/boost buttons + a perf tier default.

---

## C. Engine / architecture

**C1. Fixed-timestep truck simulation. — DONE 2026-09-23** (`src/modes/fixed-step.js`:
60 Hz `FixedStepLoop` + truck-mesh render interpolation in all six driving loops;
each loop split into step (sim) and render (camera/HUD/decorations/puppets/ghost)).
Follow-ups: RaceMode/MultiplayerMode lap times still use `Date.now()` (HotLap already
sums sim dt); tire marks/particles emit at the sim pose, up to one step ahead of
the rendered truck. Original note: Truck/AI physics integrate a variable
`dt` clamped at 50 ms (`BaseMode.getClampedDeltaTime`). Consequences: handling
differs subtly between 60/120/144 Hz displays; below 20 fps the game runs in
slow-motion; hot-lap times and ghosts aren't comparable across machines;
multiplayer clients (each simulating themselves) aren't on equal footing; and
the headless repro harness can't replay a frame sequence exactly. Standard fix:
accumulator with fixed 1/120 s steps for `truck.update` + AI, render interpolates
the visual transform between the last two states. Medium effort, touches the
frame envelope in `DriveMode.installRaceFrameLoop()` (one place now, thanks to
CLEANUP 2.4). Do before B5 and before any MP work.

**C2. Bundle size (8.6 MB main chunk).** 97 files import from the
`@babylonjs/core` barrel, which defeats tree-shaking. Options in order of payoff:
(a) `manualChunks` to split Babylon/Havok/Vue into cacheable vendor chunks —
trivial, faster reloads after deploys; (b) lazy-load the editor (`EditorMode` +
`src/editor/` + editor panels) since players rarely open it — `import()` in
`ModeController.switchTo`; (c) deep imports (`@babylonjs/core/Meshes/...`) —
biggest win but big churn; script it, one commit, after the CLEANUP dir moves.

**C3. Finish CLEANUP §2.3** — `RaceMode.setup()` is still one ~640-line closure
(`RaceFinishTracker` extraction). Still the riskiest file to edit; B3/B5 will
both want to touch it.

**C4. Test the headless physics harness into a regression test.** The esbuild
Node harness from the airborne-momentum bug is valuable; promote one or two
scenarios (e.g. jump landing Δv, wall scrape) into `check:physics` with golden
tolerances so drift tuning changes show numeric diffs. Pairs well with C1
(determinism makes goldens exact).

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

---

## Suggested order

1. A1 + A2 (restore + enforce the safety net) — one short session
2. B1 + B2 (gamepad + analog feel) — biggest player-facing win
3. A3/A4 before anyone plays MP with strangers
4. C1 fixed timestep (+ C4 physics goldens) — foundation for fair times/ghosts/MP
5. C2(a,b) bundle split — cheap load-time win
6. B3/B4 HUD + camera juice, then C3 when next editing RaceMode
