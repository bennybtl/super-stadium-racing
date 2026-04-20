/**
 * SeasonManager - Manages season state, points, and persistence.
 * Pure JS — no Babylon or Vue imports.
 */

const STORAGE_KEY = 'season_state';

/** Ordered race track keys for a season */
const SEASON_TRACKS = ['Fandango.json', 'Huevos_Grande.json', 'Sidewinder.json'];

import { AI_SKILL_PRESETS } from "../ai/AIDriver.js";

/** Championship points by finish position (index 0 = 1st place) */
const POINTS_TABLE = [10, 5, 3, 1];

/** Cash earned per championship point */
const MONEY_PER_POINT = 100;

/**
 * Available upgrades.
 * Each level purchased adds `statDelta` to the player truck's state property.
 */
export const UPGRADES = [
  {
    id: 'topSpeed',
    label: 'Top Speed',
    description: 'Raises maximum speed',
    cost: 1000,
    maxLevel: 6,
    statKey: 'maxSpeed',
    statDelta: 2,        // +2 m/s per level  (base: 25)
  },
  {
    id: 'acceleration',
    label: 'Acceleration',
    description: 'Stronger engine, faster response',
    cost: 750,
    maxLevel: 6,
    statKey: 'acceleration',
    statDelta: 2,        // +2 per level  (base: 13)
  },
  {
    id: 'tires',
    label: 'Tires',
    description: 'Better grip through corners',
    cost: 500,
    maxLevel: 6,
    statKey: 'grip',
    statDelta: 0.006,    // +0.006 per level  (base: 0.03)
  },
  {
    id: 'suspension',
    label: 'Suspension',
    description: 'Improved handling and stability',
    cost: 500,
    maxLevel: 6,
    // suspension applies two stat keys — handled specially in applyUpgradesToTruck
    statKey: 'suspension',
    statDelta: null,
  },
  {
    id: 'nitro',
    label: 'Nitro',
    description: 'Add a boost charge to your pool (max 99, carries over between races)',
    cost: 200,
    statKey: null,
    statDelta: 1,
  },
];

/** AI driver definitions with fixed skill configs */
const AI_DRIVERS = [
  {
    id: 'ai1',
    name: 'Crusher',
    isPlayer: false,
    skill: 'hard',
    skillConfig: AI_SKILL_PRESETS.good,
  },
  {
    id: 'ai2',
    name: 'Wheels',
    isPlayer: false,
    skill: 'medium',
    skillConfig: AI_SKILL_PRESETS.ok,
  },
  {
    id: 'ai3',
    name: 'Dusty',
    isPlayer: false,
    skill: 'easy',
    skillConfig: AI_SKILL_PRESETS.bad,
  },
];

export class SeasonManager {
  constructor() {
    /** @type {import('./types').SeasonState|null} */
    this.state = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start a new season.
   * @param {number} lapsPerRace - Number of laps per race (fixed for the whole season)
   */
  start(lapsPerRace = 3) {
    this.state = {
      tracks: SEASON_TRACKS.map(f => f.replace('.json', '')),
      currentRaceIndex: 0,
      lapsPerRace,
      drivers: [
        {
          id: 'player',
          name: 'Player',
          isPlayer: true,
          skill: null,
          skillConfig: null,
          totalPoints: 0,
          balance: 0,
          nitroCount: 5,  // persistent boost pool; starts at truck default
          upgrades: {},   // { [upgradeId]: level }
          raceResults: [],
        },
        ...AI_DRIVERS.map(d => ({ ...d, totalPoints: 0, raceResults: [] })),
      ],
    };
    this.save();
    console.log(`[SeasonManager] New season started — ${this.state.tracks.length} races, ${lapsPerRace} laps each`);
  }

  /**
   * Resume an existing season from localStorage, if one exists.
   * @returns {boolean} true if a saved season was found and loaded
   */
  resume() {
    return this.load();
  }

  /**
   * Returns true if there is a saved season available to resume.
   */
  hasSavedSeason() {
    return localStorage.getItem(STORAGE_KEY) !== null;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** The track key for the current race (e.g. 'Fandango') */
  getCurrentTrackKey() {
    this._requireState();
    return this.state.tracks[this.state.currentRaceIndex] ?? null;
  }

  /** Total number of races in the season */
  getTotalRaces() {
    this._requireState();
    return this.state.tracks.length;
  }

  /** Index of the current race (0-based) */
  getCurrentRaceIndex() {
    this._requireState();
    return this.state.currentRaceIndex;
  }

  /** Race number for display (1-based) */
  getCurrentRaceNumber() {
    return this.getCurrentRaceIndex() + 1;
  }

  /** Whether all races have been completed */
  isSeasonComplete() {
    this._requireState();
    return this.state.currentRaceIndex >= this.state.tracks.length;
  }

  /** Laps per race chosen at season start */
  getLapsPerRace() {
    this._requireState();
    return this.state.lapsPerRace;
  }

  /**
   * Current championship standings — drivers sorted descending by totalPoints.
   * @returns {Array} sorted driver objects (copies)
   */
  getStandings() {
    this._requireState();
    return [...this.state.drivers].sort((a, b) => b.totalPoints - a.totalPoints);
  }

  /**
   * Returns the AI skill configs for all AI drivers, keyed by driver id.
   * Used by ModeController when spawning AI trucks.
   * @returns {Record<string, object>}
   */
  getAISkillConfigs() {
    this._requireState();
    return Object.fromEntries(
      this.state.drivers
        .filter(d => !d.isPlayer)
        .map(d => [d.id, d.skillConfig])
    );
  }

  /** Current player cash balance */
  getPlayerBalance() {
    this._requireState();
    const player = this.state.drivers.find(d => d.isPlayer);
    return player?.balance ?? 5000;
  }

  /**
   * Returns the upgrade catalog enriched with the player's current levels.
   * @returns {Array}
   */
  getUpgrades() {
    this._requireState();
    const player = this.state.drivers.find(d => d.isPlayer);
    const purchased = player?.upgrades ?? {};
    return UPGRADES.map(u => {
      if (u.id === 'nitro') {
        const count = player?.nitroCount ?? 5;
        return {
          ...u,
          level: count,
          maxLevel: 99,
          affordable: (player?.balance ?? 0) >= u.cost && count < 99,
        };
      }
      return {
        ...u,
        level: purchased[u.id] ?? 0,
        affordable: (player?.balance ?? 0) >= u.cost,
      };
    });
  }

  /**
   * Raw purchased-upgrade map for applying to a truck.
   * @returns {{ [id: string]: number }}
   */
  getPlayerUpgrades() {
    this._requireState();
    const player = this.state.drivers.find(d => d.isPlayer);
    return {
      ...(player?.upgrades ?? {}),
      nitroCount: player?.nitroCount ?? 5,
    };
  }

  /**
   * Purchase one level of an upgrade.
   * @param {string} upgradeId
   * @returns {{ ok: boolean, reason?: string }}
   */
  purchaseUpgrade(upgradeId) {
    this._requireState();
    const upgrade = UPGRADES.find(u => u.id === upgradeId);
    if (!upgrade) return { ok: false, reason: 'Unknown upgrade' };

    const player = this.state.drivers.find(d => d.isPlayer);
    if (!player) return { ok: false, reason: 'No player driver' };

    player.upgrades = player.upgrades ?? {};

    // Nitro is a persistent pool — not a level-based upgrade
    if (upgradeId === 'nitro') {
      const current = player.nitroCount ?? 5;
      if (current >= 99) return { ok: false, reason: 'Already at maximum (99)' };
      if (player.balance < upgrade.cost) return { ok: false, reason: 'Insufficient funds' };
      player.balance -= upgrade.cost;
      player.nitroCount = current + 1;
      this.save();
      console.log(`[SeasonManager] Purchased Nitro — pool now ${player.nitroCount}. Balance: $${player.balance}`);
      return { ok: true };
    }

    const currentLevel = player.upgrades[upgradeId] ?? 0;

    if (currentLevel >= upgrade.maxLevel) return { ok: false, reason: 'Already maxed' };
    if (player.balance < upgrade.cost) return { ok: false, reason: 'Insufficient funds' };

    player.balance -= upgrade.cost;
    player.upgrades[upgradeId] = currentLevel + 1;
    this.save();

    console.log(`[SeasonManager] Purchased ${upgrade.label} (now level ${player.upgrades[upgradeId]}). Balance: $${player.balance}`);
    return { ok: true };
  }

  /**
   * Returns all AI driver definitions (id, name, skillConfig).
   * @returns {Array}
   */
  getAIDrivers() {
    this._requireState();
    return this.state.drivers.filter(d => !d.isPlayer);
  }

  // ---------------------------------------------------------------------------
  // Race result recording
  // ---------------------------------------------------------------------------

  /**
   * Record the results of the current race and advance to the next.
   *
   * @param {Array<{id: string, finishPosition: number, totalRaceTimeMs: number, fastestLapMs: number}>} resultsArray
   *   One entry per driver. Drivers absent from the array are treated as DNF
   *   and assigned last remaining finish position(s).
   */
  recordRaceResult(resultsArray) {
    this._requireState();

    const trackKey = this.getCurrentTrackKey();
    const allDriverIds = this.state.drivers.map(d => d.id);
    const reportedIds = new Set(resultsArray.map(r => r.id));

    // Determine DNF drivers — those not in the results array
    const dnfIds = allDriverIds.filter(id => !reportedIds.has(id));

    // Assign finish positions to DNFs (after all reported finishers)
    const maxReportedPos = resultsArray.reduce((m, r) => Math.max(m, r.finishPosition), 0);
    let nextDnfPos = maxReportedPos + 1;
    const dnfResults = dnfIds.map(id => ({
      id,
      finishPosition: nextDnfPos++,
      totalRaceTimeMs: null,
      fastestLapMs: null,
      dnf: true,
    }));

    const allResults = [...resultsArray, ...dnfResults];

    // Apply points and persist to each driver
    for (const result of allResults) {
      const driver = this.state.drivers.find(d => d.id === result.id);
      if (!driver) {
        console.warn(`[SeasonManager] Unknown driver id: ${result.id}`);
        continue;
      }

      const pos = result.finishPosition; // 1-based
      const pointsEarned = POINTS_TABLE[pos - 1] ?? 0;

      driver.totalPoints += pointsEarned;
      if (driver.isPlayer) {
        driver.balance = (driver.balance ?? 5000) + pointsEarned * MONEY_PER_POINT;
      }
      driver.raceResults.push({
        trackKey,
        finishPosition: pos,
        pointsEarned,
        totalRaceTimeMs: result.totalRaceTimeMs ?? null,
        fastestLapMs: result.fastestLapMs ?? null,
        dnf: result.dnf ?? false,
      });
    }

    this.state.currentRaceIndex++;
    this.save();

    console.log(`[SeasonManager] Race ${this.state.currentRaceIndex} recorded on ${trackKey}. Season complete: ${this.isSeasonComplete()}`);

    // Return enriched results for the PostRace overlay
    return this._buildPostRaceData(trackKey, allResults);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  save() {
    if (!this.state) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  /**
   * Load season state from localStorage.
   * @returns {boolean} true if state was loaded successfully
   */
  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try {
      this.state = JSON.parse(raw);
      console.log(`[SeasonManager] Loaded saved season (race ${this.state.currentRaceIndex + 1} of ${this.state.tracks.length})`);
      return true;
    } catch (e) {
      console.error('[SeasonManager] Failed to parse saved season:', e);
      return false;
    }
  }

  /** Delete the saved season from localStorage and reset state */
  clear() {
    localStorage.removeItem(STORAGE_KEY);
    this.state = null;
    console.log('[SeasonManager] Season cleared');
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the postRaceData object passed to PostRaceOverlay.
   * @private
   */
  _buildPostRaceData(trackKey, allResults) {
    const standings = this.getStandings();

    // Build a lookup of pointsEarned by driver id from allResults
    const pointsById = Object.fromEntries(
      allResults.map(r => {
        const pos = r.finishPosition;
        return [r.id, POINTS_TABLE[pos - 1] ?? 0];
      })
    );

    const rows = allResults
      .slice()
      .sort((a, b) => a.finishPosition - b.finishPosition)
      .map(r => {
        const driver = this.state.drivers.find(d => d.id === r.id);
        return {
          id: r.id,
          name: driver?.name ?? r.id,
          isPlayer: driver?.isPlayer ?? false,
          finishPosition: r.finishPosition,
          totalRaceTimeMs: r.totalRaceTimeMs,
          fastestLapMs: r.fastestLapMs,
          pointsEarned: pointsById[r.id] ?? 0,
          totalPoints: driver?.totalPoints ?? 0,
          dnf: r.dnf ?? false,
        };
      });

    const playerResult = allResults.find(r => this.state.drivers.find(d => d.id === r.id)?.isPlayer);
    const playerMoneyEarned = playerResult ? (POINTS_TABLE[playerResult.finishPosition - 1] ?? 0) * MONEY_PER_POINT : 0;
    const playerBalance = this.getPlayerBalance();

    return {
      trackKey,
      raceNumber: this.state.currentRaceIndex,      // already incremented
      totalRaces: this.getTotalRaces(),
      playerMoneyEarned,
      playerBalance,
      rows,
      standings: standings.map((d, i) => ({
        position: i + 1,
        id: d.id,
        name: d.name,
        isPlayer: d.isPlayer,
        totalPoints: d.totalPoints,
      })),
      isSeasonComplete: this.isSeasonComplete(),
    };
  }

  /** @private */
  _requireState() {
    if (!this.state) throw new Error('[SeasonManager] No active season. Call start() or load() first.');
  }
}
