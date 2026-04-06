# Season Mode — Design & Implementation Plan

## Overview

A "season" is an ordered series of races across all tracks. The player and three AI drivers accumulate championship points across every round. After each race a **Post-Race Screen** shows lap times, race times, and points gained, then the player lands in the **Pit Screen** before moving on to the next race.

---

## 1. Data Model

### SeasonState (plain JS object, persisted to `localStorage`)

```js
{
  tracks: ['Fandango', 'HuevosGrande'],   // ordered track keys for this season
  currentRaceIndex: 0,                     // which track is next
  lapsPerRace: 3,                          // chosen at season start

  drivers: [
    { id: 'player', name: 'Player',  isPlayer: true,  totalPoints: 0, raceResults: [] },
    { id: 'ai1',    name: 'Crusher', isPlayer: false, totalPoints: 0, raceResults: [], skill: 'hard'   },
    { id: 'ai2',    name: 'Wheels',  isPlayer: false, totalPoints: 0, raceResults: [], skill: 'medium' },
    { id: 'ai3',    name: 'Dusty',   isPlayer: false, totalPoints: 0, raceResults: [], skill: 'easy'   },
  ],
}
```

Each entry in `raceResults[]`:
```js
{
  trackKey: 'Fandango',
  finishPosition: 1,          // 1-4
  pointsEarned: 10,
  totalRaceTimeMs: 123456,
  fastestLapMs: 38210,
}
```

### Points Table
| Position | Points |
|----------|--------|
| 1st      | 10     |
| 2nd      | 5      |
| 3rd      | 3      |
| 4th      | 1      |

---

## 2. New Class: `SeasonManager`  (`src/managers/SeasonManager.js`)

Responsible for all season state — no Babylon or Vue imports.

```
SeasonManager
  ├── start(lapsPerRace)               — initialises drivers with fixed track order, saves to localStorage
  ├── getCurrentTrackKey()              — tracks[currentRaceIndex]
  ├── getTotalRaces()                   — tracks.length
  ├── isSeasonComplete()                — currentRaceIndex >= tracks.length
  ├── recordRaceResult(resultsArray)    — [{ id, finishPosition, totalRaceTimeMs, fastestLapMs }]
  │     assigns points, pushes to raceResults, increments currentRaceIndex, auto-saves
  ├── getStandings()                    — drivers sorted descending by totalPoints
  ├── save() / load()                   — JSON via localStorage key 'season_state'
  └── clear()                           — deletes localStorage entry
```

`recordRaceResult` assigns points by finish position. DNF (did not finish before the timeout) is treated as last place among remaining drivers.

**AI Skill configs** (passed to `AIDriver` constructor as `skillConfig`):
| Driver  | Skill  | `lookAheadDistance` | `maxSpeed` | `steeringPrecision` |
|---------|--------|---------------------|------------|---------------------|
| Crusher | hard   | 20                  | 0.8        | 1.0                 |
| Wheels  | medium | 15                  | 0.65       | 0.85                |
| Dusty   | easy   | 12                  | 0.5        | 0.7                 |

**Track order** is hardcoded in `SeasonManager` as an ordered array of all available track keys (e.g. `['Fandango', 'HuevosGrande']`). No player selection needed.

**Laps per race** is chosen once at season setup and fixed for all races in the season.

---

## 3. Flow Changes

### 3a. Menu additions (`MenuManager` + `MenuOverlay.vue`)

New screen states needed:
| `store.screen` value  | Purpose |
|-----------------------|---------|
| `'seasonSetup'`       | Choose laps per race (fixed for the whole season) before starting |
| `'postRace'`          | Results table after a race finishes |
| `'pit'`               | Pit screen — continue / retire from season |

New start-menu button: **"Season"** → `'seasonSetup'`

### 3b. RaceMode — season-aware finish

When all `totalLaps` are completed by all drivers (or a 2× fastest-driver timeout fires for stragglers):

1. Collect finish data from each truck's `GameState`
2. Call `seasonManager.recordRaceResult(results)`
3. Call `menuManager.showPostRace(postRaceData)` — does NOT tear down the scene immediately; trucks freeze in place

### 3c. PostRace screen

Displayed as a full-screen overlay (new Vue component `PostRaceOverlay.vue`).  
The scene stays rendered underneath (trucks visible, frozen).

**Content:**
```
───────────────────────────────────────────────
  RACE RESULTS — Fandango  (Race 1 of 2)
───────────────────────────────────────────────
  Pos  Driver    Race Time   Best Lap   Pts  Total
   1   Player    1:43.21     0:33.80    +10    10
   2   Crusher   1:45.00     0:34.12    + 5     5
   3   Wheels    1:48.33     0:35.01    + 3     3
   4   Dusty     1:55.10     0:37.44    + 1     1
───────────────────────────────────────────────
          CHAMPIONSHIP STANDINGS
  1. Player   10 pts
  2. Crusher   5 pts
  3. Wheels    3 pts
  4. Dusty     1 pt
───────────────────────────────────────────────
           [ Head to the Pit → ]
───────────────────────────────────────────────
```

### 3d. Pit screen

Simple full-screen Vue component `PitOverlay.vue`.  
For now: track name, race number, and a **"Continue to Race N"** button.  
Placeholder sections for future upgrades (greyed out).

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔧 PIT LANE  — Race 2 of 2
  Next track: HuevosGrande
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [ Upgrades ]  (coming soon)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [ Continue to Race 2 ]
  [ Retire from Season  ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**"Continue"** → tears down the race scene → `ModeController.goToRace({ trackKey, laps, season: true })`  
**"Retire"** → clears season state → back to main menu

### 3e. Season complete screen

After the final race's Pit screen the "Continue" button is replaced with  
**"Final Standings"** — shows the full championship table and a trophy for 1st place.

---

## 4. AI Finish Detection

Currently AI trucks stop moving when `gameState.raceFinished` is set. We need finish positions to be recorded in order.

Add a `finishOrder` array to RaceMode that trucks are pushed into as they cross the line.

**DNF rule:** once the first driver starts their final lap, a 15-second countdown begins. Any driver who hasn't finished when it expires is DNF'd and assigned the next available finish position (last place among remaining).

```js
const finishOrder = [];    // filled in lap-completion logic
let dnfTimer = null;       // set when the first driver begins their last lap
const DNF_GRACE_MS = 15_000;
```

---

## 5. Files to Create

| File | Purpose |
|------|---------|
| `src/managers/SeasonManager.js` | Season state, points, persistence |
| `src/vue/PostRaceOverlay.vue` | Post-race results + standings table |
| `src/vue/PitOverlay.vue` | Pit screen between races |
| `src/vue/SeasonFinalOverlay.vue` | Final championship standings |

## 6. Files to Modify

| File | Changes |
|------|---------|
| `src/vue/store.js` | Add `useSeasonStore` with `postRace`, `pit`, `seasonFinal` state; new screen values |
| `src/vue/MenuOverlay.vue` | Add `'seasonSetup'` screen template; new "Season" button on start screen |
| `src/vue/AppShell.vue` | Mount `PostRaceOverlay`, `PitOverlay`, `SeasonFinalOverlay` |
| `src/managers/MenuManager.js` | `showSeasonSetup()`, `showPostRace(data)`, `showPit(data)`, `showSeasonFinal(data)` |
| `src/modes/RaceMode.js` | `finishOrder` tracking, DNF timeout, season-aware exit callbacks |
| `src/modes/ModeController.js` | Hold `SeasonManager` reference; `startSeason(lapsPerRace)` method; auto-save season on exit |

---

## 7. Implementation Order

1. **`SeasonManager`** — pure data, no UI, write tests manually against console
2. **`ModeController`** — add `seasonManager` property, `startSeason()` method
3. **`MenuManager` + `store.js` + `MenuOverlay.vue`** — `'seasonSetup'` screen, "Season" button
4. **`RaceMode`** — `finishOrder` + DNF timeout + `recordRaceResult` call on race end
5. **`PostRaceOverlay.vue` + store wiring** — display results, "Head to Pit" button
6. **`PitOverlay.vue` + store wiring** — "Continue" / "Retire" logic
7. **`SeasonFinalOverlay.vue`** — final standings after last race
8. **Polish** — animations, highlight player row, trophy icon for 1st

---

## 8. Resolved Decisions

| Question | Decision |
|----------|---------|
| Track order | Hardcoded in `SeasonManager` (all available tracks in a fixed sequence) |
| Driver names | Crusher, Wheels, Dusty (stored on driver objects) |
| AI skill | Fixed per driver: Crusher = hard, Wheels = medium, Dusty = easy |
| DNF rule | 15 s grace period starting when the first driver **begins** their last lap; stragglers DNF in order |
| Save on exit | Yes — `SeasonManager.save()` is called automatically on race exit and between screens |
| Laps per race | Chosen once at season setup; fixed for all races in that season |

