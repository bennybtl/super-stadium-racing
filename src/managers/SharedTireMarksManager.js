import { TireMarks, tireMarkColorForTerrain } from "../truck/TireMarks.js";
import { TerrainQuery } from "./TerrainQuery.js";
import { loadTireMarkStreaks, saveTireMarkStreaks, TIRE_MARKS_MAX_STREAKS } from "./TireMarksStorage.js";

const SAVE_INTERVAL_MS = 15000;

/**
 * Owns the scene's one shared TireMarks ring plus its persistence.
 *
 * At construction, replays whatever streaks were saved last session straight
 * into the ring (via the same appendStreak every live truck streak goes
 * through), using a generic terrain-height/colour sampler since there's no
 * real truck to ask yet. During play, every truck's TireMarkWriter calls
 * appendStreak here (not on the ring directly) — this keeps the completed
 * streak in an in-memory FIFO (capped at TIRE_MARKS_MAX_STREAKS) and
 * periodically saves it, so persistence stays current without saving on
 * every single streak.
 *
 * Attach one instance to track._sharedTireMarks (see SceneBuilder.js) so
 * truck.js can reach it through the `track` reference it already receives
 * every frame.
 */
export class SharedTireMarksManager {
  constructor(scene, trackKey, terrainManager, { capacity } = {}) {
    this._trackKey = trackKey;
    this.ring = new TireMarks(scene, { capacity });
    this._streaks = loadTireMarkStreaks(trackKey);
    this._unsaved = false;
    this._lastSaveAt = performance.now();

    // Generic (non-truck) samplers for replaying last session's marks: the
    // analytic/raycast height a truck would have sat at, and the same
    // terrain-matched colour a live mark would pick.
    const terrainQuery = new TerrainQuery(scene);
    const replaySampleY = (x, z, fromY) => terrainQuery.heightAt(x, z, fromY);
    const replayColorForPoint = (x, z) => tireMarkColorForTerrain(terrainManager?.getTerrainAt?.({ x, z })?.color);
    for (const streak of this._streaks) {
      // appendStreak calls sampleY(x, z, fromY + 1) — a high fromY here (there's
      // no real truck position to take one from) so the raycast starts above
      // anything on the track, including an elevated bridge deck, rather than
      // punching through it from below.
      this.ring.appendStreak(streak.points, { sampleY: replaySampleY, fromY: 499, colorForPoint: replayColorForPoint });
    }
  }

  /** Called by TireMarkWriter when a truck's streak completes. */
  appendStreak(points, opts) {
    this.ring.appendStreak(points, opts);
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
