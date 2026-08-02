import { MenuMode } from "./MenuMode.js";
import { RaceMode } from "./RaceMode.js";
import { EditorMode } from "./EditorMode.js";
import { TestMode } from "./TestMode.js";
import { PracticeMode } from "./PracticeMode.js";
import { HotLapMode } from "./HotLapMode.js";
import { incrementUpgradeLevel, getUpgradeCatalog, applyPurchase } from "../managers/UpgradeStorage.js";
import { basicColors } from "../constants.js";
import { AI_SKILL_PRESETS } from "../ai/AIDriver.js";
import { generateDriverNames } from "../ai/driverNames.js";
import { AI_COLOR_KEYS } from "../ai/setupAIDrivers.js";
import {
  createChampionship,
  loadActiveChampionship,
  saveActiveChampionship,
  clearActiveChampionship,
  applyRaceResult,
  isChampionshipComplete,
  standings,
  saveChampionshipScore,
} from "../managers/ChampionshipStorage.js";

/** Fisher-Yates shuffle; returns a new array. */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Owns the engine render loop and coordinates transitions between
 * MenuMode, RaceMode and EditorMode.
 *
 * Each mode receives a reference to this controller so it can trigger
 * transitions without importing any sibling mode directly.
 */
export class ModeController {
  constructor(engine, menuManager, trackLoader) {
    this.engine = engine;
    this.menuManager = menuManager;
    this.trackLoader = trackLoader;
    this.currentMode = null;
    // Active championship state (null outside a cup). Loaded lazily on resume.
    this.championship = null;
  }

  /**
   * Tear down the current mode, stop the render loop, instantiate the next
   * mode and start rendering its scene (if it returns one).
   */
  async switchTo(ModeClass, config = {}) {
    const modeName = ModeClass?.name ?? 'Mode';
    const loadingLabel = modeName.replace(/Mode$/, '') || 'Scene';
    this.menuManager.showLoading(`Loading ${loadingLabel}…`);
    // Nothing is rendering while the next scene builds, so menus sit on black
    // rather than the outgoing mode's stale last frame.
    this.menuManager.setLiveBackdrop(false);

    if (this.currentMode) {
      this.currentMode.teardown();
      this.currentMode = null;
    }

    this.engine.stopRenderLoop();

    const mode = new ModeClass(this);
    this.currentMode = mode;

    try {
      const scene = await mode.setup(config);

      if (scene) {
        this.engine.runRenderLoop(() => scene.render());
        this.menuManager.setLiveBackdrop(mode.hasLiveBackdrop);
      }
    } finally {
      this.menuManager.hideLoading();
    }
  }

  goToMenu() {
    return this.switchTo(MenuMode);
  }

  /** Called by any mode when the user chooses to exit back to the main menu. */
  exit() {
    return this.goToMenu();
  }

  /**
   * Purchase an upgrade and refresh the pit screen data.
   * Upgrade progress persists independently of any race.
   */
  purchaseUpgrade(upgradeId) {
    const result = incrementUpgradeLevel(upgradeId);
    if (result.ok) {
      this.menuManager._store.upgrades = getUpgradeCatalog({ balance: 0, ignoreBalance: true });
    }
  }

  showSingleRacePit() {
    const trackKey = this.menuManager.selectedTrack;
    if (!trackKey) return;

    const trackName = window.trackLoader?.getTrack(trackKey)?.name ?? trackKey;
    const vehicleName = window.vehicleLoader?.getVehicle(this.menuManager.selectedVehicle)?.name ?? this.menuManager.selectedVehicle;

    this.menuManager.showPit({
      nextTrackKey:     trackKey,
      trackName,
      laps:             this.menuManager.selectedLaps,
      aiDrivers:        this.menuManager.selectedAIDrivers,
      upgrades:         getUpgradeCatalog({ balance: 0, ignoreBalance: true }),
      vehicleName,
    });
  }

  // ── Championship (cup) orchestration ──────────────────────────────────────

  /** True while a cup is in progress (drives pit/results routing). */
  get inChampionship() {
    return this.championship != null;
  }

  /**
   * Draw a calendar of `count` distinct track keys from the loaded track list,
   * in random order. Falls back to whatever tracks exist if fewer than `count`.
   */
  _drawCalendar(count) {
    const keys = (this.menuManager._store.trackList ?? []).map(t => t.key);
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys.slice(0, Math.min(count, keys.length));
  }

  /**
   * Begin a fresh championship. Roster ids/names mirror what RaceMode assigns
   * (`player`, `ai1..aiN`) so finish-order ids map straight onto cup drivers.
   */
  startChampionship({ initials, trackCount = 5, aiCount, laps, aiVehicleKey, reverse, vehicleKey, playerColorKey }) {
    const drivers = this._buildRoster({ aiCount, vehicleKey, playerColorKey, aiVehicleKey });
    this.championship = createChampionship({
      initials,
      calendar: this._drawCalendar(trackCount),
      drivers,
      settings: { aiCount, laps, aiVehicleKey, reverse },
    });
    saveActiveChampionship(this.championship);
    return this._runChampionshipRace();
  }

  /**
   * Build the cup roster with a fixed, persisted identity per driver — a
   * concrete colour and vehicle each. The player's colour defaults to the first
   * palette entry if none was picked; AI take distinct colours from the rest of
   * the palette, and a concrete vehicle (a random one per AI when the setting is
   * 'random', resolved once here so it stays constant across the series).
   */
  _buildRoster({ aiCount, vehicleKey, playerColorKey, aiVehicleKey }) {
    const playerColor = playerColorKey ?? 'red';
    // Use the same vivid AI palette single races cycle through, minus the
    // player's colour and any keys not in basicColors, shuffled so each cup's
    // field looks varied. Assigned once here and persisted with the roster.
    const aiPalette = shuffle(AI_COLOR_KEYS.filter(k => k !== playerColor && basicColors[k]));
    const vehicleKeys = window.vehicleLoader?.getVehicleList?.().map(v => v.key) ?? [vehicleKey];

    const skillKeys = Object.keys(AI_SKILL_PRESETS);
    const aiNames = generateDriverNames(aiCount);

    const drivers = [{ id: 'player', name: 'Player', isPlayer: true, vehicleKey, colorKey: playerColor }];
    for (let i = 0; i < aiCount; i++) {
      let vk = aiVehicleKey;
      if (!vk || vk === 'random') {
        vk = vehicleKeys.length ? vehicleKeys[Math.floor(Math.random() * vehicleKeys.length)] : vehicleKey;
      }
      drivers.push({
        id: `ai${i + 1}`,
        name: aiNames[i],
        isPlayer: false,
        vehicleKey: vk,
        colorKey: aiPalette[i % aiPalette.length],
        // Skill preset ('good' | 'ok' | 'bad') pinned for the whole series.
        skill: skillKeys[Math.floor(Math.random() * skillKeys.length)],
      });
    }
    return drivers;
  }

  /**
   * Restore an in-progress cup after a page refresh and drop back into the pit
   * for the current race. The saved state always represents "at the pit, ready
   * to run race[currentRaceIndex]", so this is the correct re-entry point.
   * Returns false (and clears the save) if there's nothing valid to resume.
   */
  resumeChampionship() {
    const cup = loadActiveChampionship();
    if (!cup || isChampionshipComplete(cup)) {
      clearActiveChampionship();
      return false;
    }
    this.championship = cup;
    this._showChampionshipPit(null);
    return true;
  }

  /** Launch the current calendar race, wired to report back to the cup. */
  _runChampionshipRace() {
    const champ = this.championship;
    const player = champ.drivers.find(d => d.isPlayer);
    const aiRoster = champ.drivers.filter(d => !d.isPlayer);
    // Grid order = current standings (leader on pole). First race everyone is
    // tied, so standings() keeps roster order and the player starts on pole.
    const gridSlot = new Map(standings(champ.drivers).map((d, i) => [d.id, i]));
    this.menuManager.gameStarted = true;
    this.menuManager._store.pitData = null;
    this.menuManager.hideMenu();
    return this.goToRace({
      trackKey:       champ.calendar[champ.currentRaceIndex],
      laps:           champ.settings.laps,
      aiCount:        champ.settings.aiCount,
      aiVehicleKey:   champ.settings.aiVehicleKey,
      vehicleKey:     player.vehicleKey,
      playerColorKey: player.colorKey,
      reverse:        champ.settings.reverse,
      championship: {
        playerUpgrades: player.upgrades,
        playerGridSlot: gridSlot.get(player.id),
        aiGridSlots:    aiRoster.map(d => gridSlot.get(d.id)),
        // Persisted per-AI identity so colours/vehicles stay constant across the
        // series and match the stored roster (indexed by ai1..aiN order).
        aiNames:        aiRoster.map(d => d.name),
        aiColorKeys:    aiRoster.map(d => d.colorKey),
        aiVehicleKeys:  aiRoster.map(d => d.vehicleKey),
        aiSkills:       aiRoster.map(d => d.skill),
        aiUpgrades:     aiRoster.map(d => d.upgrades),
        onRaceComplete: (finishOrderIds, meta) => this._onChampionshipRaceComplete(finishOrderIds, meta),
      },
    });
  }

  /** Award the just-finished race and route to the pit or the final podium. */
  _onChampionshipRaceComplete(finishOrderIds, meta) {
    const state = applyRaceResult(this.championship, finishOrderIds);
    // Fold in per-driver post-race adjustments:
    //  • leftover nitro carries into the next race (consumable, not a refill),
    //  • cash from money pickups is added to the spendable wallet (not winnings,
    //    which track prize money only).
    const remaining = meta?.remainingNitro ?? {};
    const collected = meta?.moneyCollected ?? {};
    state.drivers = state.drivers.map(d => {
      const next = { ...d };
      if (remaining[d.id] != null) next.upgrades = { ...d.upgrades, nitroCount: remaining[d.id] };
      if (collected[d.id]) next.money = d.money + collected[d.id];
      return next;
    });
    this.championship = state;
    if (isChampionshipComplete(this.championship)) {
      saveActiveChampionship(this.championship);
      this._finishChampionship(meta);
    } else {
      // AI shop the pit before the next race (the player shops it interactively).
      this._runAIPurchasing();
      saveActiveChampionship(this.championship);
      this._showChampionshipPit(meta);
    }
  }

  /**
   * Between-races AI spending. Rule: top nitro back up to 5 first, then spend
   * whatever's left on random affordable stat upgrades until nothing else is
   * affordable — so AI gradually improve as their winnings allow.
   */
  _runAIPurchasing() {
    const NITRO_TARGET = 5;
    for (const d of this.championship.drivers) {
      if (d.isPlayer) continue;

      // 1. Refill nitro to the target (never sells down a pickup stockpile > 5).
      while ((d.upgrades.nitroCount ?? 0) < NITRO_TARGET) {
        const res = applyPurchase(d.upgrades, d.money, 'nitro');
        if (!res.ok) break;
        d.upgrades = res.upgrades;
        d.money = res.money;
      }

      // 2. Spend the remainder on random affordable, non-nitro upgrades.
      let affordable = getUpgradeCatalog({ balance: d.money, upgrades: d.upgrades })
        .filter(u => u.id !== 'nitro' && u.affordable);
      while (affordable.length > 0) {
        const pick = affordable[Math.floor(Math.random() * affordable.length)];
        const res = applyPurchase(d.upgrades, d.money, pick.id);
        if (!res.ok) break;
        d.upgrades = res.upgrades;
        d.money = res.money;
        affordable = getUpgradeCatalog({ balance: d.money, upgrades: d.upgrades })
          .filter(u => u.id !== 'nitro' && u.affordable);
      }
    }
  }

  /** Between-races pit: standings + a real wallet to spend on upgrades. */
  _showChampionshipPit(meta) {
    const champ = this.championship;
    const player = champ.drivers.find(d => d.isPlayer);
    const nextTrackKey = champ.calendar[champ.currentRaceIndex];
    const trackName = window.trackLoader?.getTrack(nextTrackKey)?.name ?? nextTrackKey;
    this.menuManager.showPit({
      pitMode:      'championship',
      nextTrackKey,
      trackName,
      raceNumber:   champ.currentRaceIndex + 1,
      totalRaces:   champ.calendar.length,
      balance:      player.money,
      standings:    this._standingsRows(),
      lastResults:  meta?.rows ?? null,
      upgrades:     getUpgradeCatalog({ balance: player.money, upgrades: player.upgrades }),
    });
  }

  /** Buy one upgrade level against the player's cup wallet; refresh the pit. */
  purchaseChampionshipUpgrade(upgradeId) {
    const player = this.championship?.drivers.find(d => d.isPlayer);
    if (!player) return;
    const res = applyPurchase(player.upgrades, player.money, upgradeId);
    if (!res.ok) return;
    player.upgrades = res.upgrades;
    player.money = res.money;
    saveActiveChampionship(this.championship);
    this.menuManager._store.upgrades = getUpgradeCatalog({ balance: player.money, upgrades: player.upgrades });
    this.menuManager._store.pitData = { ...this.menuManager._store.pitData, balance: player.money };
  }

  /** Pit "Next Race" button → run the next calendar race. */
  continueChampionship() {
    if (this.championship) return this._runChampionshipRace();
  }

  /** Abandon the active cup and wipe its saved state (no results recorded). */
  retireChampionship() {
    clearActiveChampionship();
    this.championship = null;
  }

  /** Final race done: record the result, clear the cup, show the podium. */
  _finishChampionship(_meta) {
    const champ = this.championship;
    const player = champ.drivers.find(d => d.isPlayer);
    const { rank } = saveChampionshipScore({
      initials:   champ.initials,
      points:     player.points,
      winnings:   player.winnings,
      vehicleKey: player.vehicleKey,
      date:       Date.now(),
    });
    const podium = this._standingsRows();
    clearActiveChampionship();
    this.championship = null;
    this.menuManager.showChampionshipPodium({
      initials:     champ.initials,
      podium,
      scoreRank:    rank,
    });
  }

  /** Standings as display rows (rank, name, points, winnings, isPlayer). */
  _standingsRows() {
    return standings(this.championship.drivers).map((d, i) => ({
      rank:     i + 1,
      id:       d.id,
      name:     d.name,
      isPlayer: d.isPlayer,
      points:   d.points,
      winnings: d.winnings,
    }));
  }

  goToRace(config) {
    return this.switchTo(RaceMode, config);
  }

  goToPractice(config) {
    return this.switchTo(PracticeMode, config);
  }

  goToEditor(config) {
    return this.switchTo(EditorMode, config);
  }

  goToHotLap(config) {
    return this.switchTo(HotLapMode, config);
  }

  goToTest(config) {
    return this.switchTo(TestMode, config);
  }

  switchToMode(modeName) {
    if (modeName === 'menu') return this.goToMenu();
    if (modeName === 'race') return this.goToRace();
    if (modeName === 'practice') return this.goToPractice();
    if (modeName === 'editor') return this.goToEditor();
    if (modeName === 'test') return this.goToTest();
    return this.goToMenu();
  }
}
