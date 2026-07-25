import { MenuMode } from "./MenuMode.js";
import { RaceMode } from "./RaceMode.js";
import { EditorMode } from "./EditorMode.js";
import { TestMode } from "./TestMode.js";
import { PracticeMode } from "./PracticeMode.js";
import { HotLapMode } from "./HotLapMode.js";
import { incrementUpgradeLevel, getUpgradeCatalog, applyPurchase } from "../managers/UpgradeStorage.js";
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
    const drivers = [{ id: 'player', name: 'Player', isPlayer: true, vehicleKey, colorKey: playerColorKey }];
    for (let i = 0; i < aiCount; i++) {
      drivers.push({ id: `ai${i + 1}`, name: `AI ${i + 1}`, isPlayer: false });
    }
    this.championship = createChampionship({
      initials,
      calendar: this._drawCalendar(trackCount),
      drivers,
      settings: { aiCount, laps, aiVehicleKey, reverse },
    });
    saveActiveChampionship(this.championship);
    return this._runChampionshipRace();
  }

  /** Restore an in-progress cup after a page refresh, if one exists. */
  resumeChampionship() {
    this.championship = loadActiveChampionship();
    return this.championship;
  }

  /** Launch the current calendar race, wired to report back to the cup. */
  _runChampionshipRace() {
    const champ = this.championship;
    const player = champ.drivers.find(d => d.isPlayer);
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
        onRaceComplete: (finishOrderIds, meta) => this._onChampionshipRaceComplete(finishOrderIds, meta),
      },
    });
  }

  /** Award the just-finished race and route to the pit or the final podium. */
  _onChampionshipRaceComplete(finishOrderIds, meta) {
    this.championship = applyRaceResult(this.championship, finishOrderIds);
    saveActiveChampionship(this.championship);
    if (isChampionshipComplete(this.championship)) {
      this._finishChampionship(meta);
    } else {
      this._showChampionshipPit(meta);
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
