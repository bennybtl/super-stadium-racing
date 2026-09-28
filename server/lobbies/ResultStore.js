import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";

/**
 * The only place race outcomes are persisted — race processes never write
 * storage themselves, so a killed race can't half-commit a result
 * (docs/MULTIPLAYER.md, Phase 4).
 *
 * One JSON file per race: `{ raceId, finishedAt, trackKey, laps, seed, reason,
 * rows, inputLog }`. The seed + input log is enough to re-simulate the race
 * (Phase 7). Writes go to a temp file then rename, so a crash mid-write never
 * leaves a truncated record.
 */
const RACE_ID_RE = /^[A-Z0-9]+-[a-z0-9]+$/;

export class ResultStore {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  save(raceId, result) {
    if (!RACE_ID_RE.test(raceId)) throw new Error(`bad raceId ${raceId}`);
    const record = {
      raceId,
      finishedAt: new Date().toISOString(),
      trackKey: result.trackKey,
      laps: result.laps,
      seed: result.seed,
      reason: result.reason,
      rows: result.rows,
      inputLog: result.inputLog,
    };
    const file = join(this.dir, `${raceId}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(record));
    renameSync(`${file}.tmp`, file);
    return record;
  }

  /** A stored race without its input log, or null. */
  get(raceId) {
    if (!RACE_ID_RE.test(raceId)) return null;
    const file = join(this.dir, `${raceId}.json`);
    if (!existsSync(file)) return null;
    const { inputLog, ...summary } = JSON.parse(readFileSync(file, "utf8"));
    return { ...summary, inputEntries: inputLog?.length ?? 0 };
  }

  /** Most recent race summaries, newest first. */
  recent(limit = 20) {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.get(f.slice(0, -5)))
      .filter(Boolean)
      .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
      .slice(0, limit);
  }
}
