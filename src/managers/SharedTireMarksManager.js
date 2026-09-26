import { TireMarks, tireMarkColorForTerrain } from "../truck/TireMarks.js";
import { TerrainQuery } from "./TerrainQuery.js";
import { loadTireMarkStreaks, saveTireMarkStreaks, TIRE_MARKS_MAX_STREAKS } from "./TireMarksStorage.js";

const SAVE_INTERVAL_MS = 15000;

/**
 * Owns the scene's one shared TireMarks ring plus its persistence.
 *
 * At construction, loads whatever streaks were saved last session (async,
 * from IndexedDB) and replays them into the ring's history region (see
 * TireMarks.appendHistory); `ready` resolves once that's done. Replay uses a
 * generic terrain-height/colour sampler since there's no real truck to ask
 * yet. During play, drawing itself is real-time and happens directly on the
 * ring (see TireMarkWriter.writeLiveNode) — this manager only hears about a
 * streak once it's *finished* (recordCompletedStreak), purely to keep an
 * in-memory FIFO (capped at TIRE_MARKS_MAX_STREAKS) and periodically save it,
 * so persistence stays current without saving on every single streak, and
 * without gating what's already on screen.
 *
 * Attach one instance to track._sharedTireMarks (see SceneBuilder.js) so
 * truck.js can reach it through the `track` reference it already receives
 * every frame.
 */
export class SharedTireMarksManager {
  constructor(scene, track, terrainManager, ringOptions = {}) {
    this._trackKey = track.id;
    this.ring = new TireMarks(scene, ringOptions);
    this._streaks = [];
    this._unsaved = false;
    this._lastSaveAt = performance.now();

    // Generic (non-truck) samplers for replaying last session's marks: the
    // surface height a truck would have sat at, and the same
    // terrain-matched colour a live mark would pick.
    const terrainQuery = new TerrainQuery(scene);
    const replaySampleY = (x, z, fromY) => terrainQuery.surfaceHeightAt(x, z, track, { fromY });
    const replayColorForPoint = (x, z) => tireMarkColorForTerrain(terrainManager?.getTerrainAt?.({ x, z })?.color);
    this.ready = loadTireMarkStreaks(this._trackKey).then((saved) => {
      for (const streak of saved) {
        // appendHistory calls sampleY(x, z, fromY + 1) — a high fromY here
        // (there's no real truck position to take one from) so the lookup
        // starts above anything on the track, including an elevated bridge
        // deck, rather than punching through it from below.
        this.ring.appendHistory(streak.points, { sampleY: replaySampleY, fromY: 499, colorForPoint: replayColorForPoint });
      }
      // Anything completed while loading is newer than the save.
      this._streaks = [...saved, ...this._streaks].slice(-TIRE_MARKS_MAX_STREAKS);
    });
  }

  /** Called by TireMarkWriter once a truck's streak ends — persistence bookkeeping only, already drawn live. */
  recordCompletedStreak(points) {
    this._streaks.push({ points });
    if (this._streaks.length > TIRE_MARKS_MAX_STREAKS) this._streaks.shift();
    this._unsaved = true;

    const now = performance.now();
    if (this._unsaved && now - this._lastSaveAt >= SAVE_INTERVAL_MS) {
      this._lastSaveAt = now;
      this._unsaved = false;
      saveTireMarkStreaks(this._trackKey, this._streaks);
    }
  }
}
