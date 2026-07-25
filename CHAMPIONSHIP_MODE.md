# Championship Mode — Implementation Plan

A 4–8 race championship cup with a prize-money economy: race → earn → upgrade →
race. Placement pays points + purse; upgrades cost money; AI opponents earn and
spend too. Everything persists to localStorage to survive refreshes.

## Confirmed decisions
- **AI economy:** AI drivers earn purses and auto-buy upgrades between races
  (difficulty rubber-bands upward over the cup). They carry per-AI money +
  upgrade state, not just points.
- **Upgrade scope:** A championship starts **fresh** — player begins at stock
  with $0 and climbs. Championship wallet + upgrades are stored **separately**
  from the existing global single-race upgrade store (`player_upgrades`).
- **High scores:** A **new** initials-keyed championship results board storing
  final cup standings (points / winnings), separate from the per-track hot-lap
  board (`HotLapStorage`), which keeps recording best laps as it does today.

## Existing scaffolding (reuse, don't rebuild)
- `src/managers/UpgradeStorage.js` — already defines `cost` per upgrade and an
  `affordable`/`balance` model, but every call site passes
  `balance: 0, ignoreBalance: true`, so upgrades are currently free and nothing
  is deducted. Wiring a real wallet is mostly deleting that stub.
- `src/managers/HotLapStorage.js` — clean, versioned per-track localStorage
  leaderboard that bundles the truck + upgrades that set each lap. The pattern
  to mirror for championship storage and the results board.
- `src/modes/RaceMode.js` — `triggerRaceEnd()` already builds a finish-ordered
  `rows` array with `finishPosition` and hands it to
  `menuManager.showSingleRaceResults()`. Single spot to award points + purse.
- `src/modes/ModeController.js` — orchestrates modes, owns `purchaseUpgrade()`
  and the pit screen. Championship orchestration lives here; races reuse
  `RaceMode` rather than a new DriveMode.
- `src/truck/truck.js` — constructor already accepts an `upgrades` object and
  `applyUpgrades()` maps it to stats. Giving AI trucks upgrades = passing them an
  upgrades object (setup hook needed in `setupAIDrivers`).
- **Not a fit:** `TrackPackLoader` is a zip *import* tool, unrelated to cups.

## Data model — new `src/managers/ChampionshipStorage.js` (mirror HotLapStorage)
Active cup, one localStorage key (`championship_active`), versioned:
```
{ version, initials, calendar: [trackKey…], currentRaceIndex,
  drivers: [{ id, name, isPlayer, vehicleKey, colorKey,
              points, money, upgrades:{…} }] }
```
- `drivers` includes AI (they carry `money` + `upgrades` too).
- Results board (`championship_scores`): capped, initials-keyed list of finished
  cups `{ initials, points, winnings, vehicleKey, date }`, sorted — same
  shape/pattern as the hot-lap board.

## Points & purse — one pure function
`awardRace(finishPosition)` → `{ points, purse }`:

| Place | Points | Purse    |
|-------|--------|----------|
| 1st   | 10     | $10,000  |
| 2nd   | 7      | $7,000   |
| 3rd   | 4      | $4,000   |
| 4th   | 2      | $2,000   |
| 5th+  | 1      | $1,000   |

Unit-testable with a node script.

## Status (updated as built)
- ✅ **Phase 1** — `applyPurchase(upgrades, money, id)` pure economy core added to
  `UpgradeStorage.js`; `getUpgradeCatalog` now takes an optional explicit
  `upgrades` state. Non-breaking (single-race stays free). Node-tested 11/11.
- ✅ **Phase 2** — `ChampionshipStorage.js`: `awardRace`, `createChampionship`
  (+persisted `settings`), `applyRaceResult`, `standings`,
  `isChampionshipComplete`, active-cup + results-board persistence. Node-tested
  25/25.
- 🟡 **Phase 3 (backend done)** — `RaceMode` accepts `config.championship`
  (`playerUpgrades` + `onRaceComplete(finishOrderIds, meta)` hook; emits finish
  order instead of the single-race results screen). `ModeController` cup
  orchestration complete: `startChampionship`, `_runChampionshipRace`,
  `_onChampionshipRaceComplete`, `_showChampionshipPit`,
  `purchaseChampionshipUpgrade`, `continueChampionship`, `_finishChampionship`,
  `_standingsRows`, `resumeChampionship`. Builds clean.
- ✅ **Phase 3 (UI)** — Start-menu **Championship** button → setup screen
  (initials + truck/color + races/AI/laps) → `startChampionship`. Between-races
  **championship pit** branch in `MenuOverlay.vue` (standings + wallet balance +
  upgrades via `TruckSetup`, buys routed to `purchaseChampionshipUpgrade`, "Start
  Race N" → `continueChampionship`). **Podium** overlay `ChampionshipPodium.vue`
  (final standings + high-score rank). Store + MenuManager + MenuMode wired.
  Builds clean; logic suites green (11 + 25). Playable end-to-end in one session.

### Known gaps / next
- ⬜ **Refresh-resume UI** — cup state already persists (`championship_active`),
  and `resumeChampionship()` exists, but nothing offers to resume on boot yet.
  Add a "Resume Championship" start-menu button when `loadActiveChampionship()`
  is non-null → show the pit for `currentRaceIndex`.
- ⬜ **Grid order by standings** (currently player always pole).
- ⬜ **Phase 4** AI economy (per-AI upgrades + auto-buy) — AI already accrue
  points/money; they just don't spend yet.
- ⬜ **Phase 5** in-race money pickups.

## Phases
1. **Real economy (foundation).** Remove the `balance:0, ignoreBalance:true`
   stub. Thread an actual wallet balance through `getUpgradeCatalog` /
   `purchaseUpgrade`; make `incrementUpgradeLevel` **deduct `cost`**.
2. **Championship storage + award function.** The storage module + `awardRace`.
   No UI; verify via node script.
3. **Cup flow.** Championship orchestration in `ModeController`, reusing
   `RaceMode` per race via a new optional `config.onRaceComplete(rows)` hook:
   award points/purse to every driver → persist → standings screen → pit screen
   (real wallet) → next race. After the last race: podium → save to results
   board. Grid order comes from standings (`getGridSpawn` becomes
   championship-ordered; camera keeps following the player truck).
4. **AI economy.** Pass per-AI `upgrades` into `setupAIDrivers` (Truck already
   consumes them). Add a between-races AI auto-purchase heuristic.
5. **Money pickups.** Add a `money` pickup type to `PickupManager` crediting the
   collecting truck's wallet mid-race, routed back into championship state.
   (Most invasive — per-truck mid-race wallet updates — hence last.)
6. **Initials entry + results board UI.** New Vue screen for 5-char initials
   before the cup; standings / podium / high-score screens.

## Minor defaults (flip if desired)
- **Calendar:** 5 tracks drawn from available tracks at cup start, randomized.
- **Grid order:** championship leader on pole. Reverse-grid rubber-banding is a
  one-line flip.
- **AI purchase aggressiveness:** spend most of each purse, mild bias so
  difficulty climbs without running away.
