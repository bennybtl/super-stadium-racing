import { fork } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Runs each race in its own child process (server/lobby/index.js) — crash and
 * tick isolation, docs/MULTIPLAYER.md Phase 4.
 *
 * Owns the race-port pool and the health watchdog: a child is killed when its
 * heartbeat lapses, or when its tick stops advancing once the race is running
 * (a hung sim still heartbeats from the timer, but its tick freezes). Every
 * way a child ends — result, error, crash, kill — releases its port and ends in
 * exactly one of `onFinished` / `onFailed`.
 */

const CHILD_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "lobby", "index.js");
const READY_TIMEOUT_MS = 30_000;     // boot: Havok + track + trucks
const HEARTBEAT_TIMEOUT_MS = 5_000;
const STALL_TIMEOUT_MS = 5_000;      // tick unchanged this long while running
const WATCHDOG_INTERVAL_MS = 1_000;
// Phases (from the child's heartbeat) in which its tick must keep advancing.
const TICKING_PHASES = new Set(["countdown", "racing"]);

export class RaceSupervisor {
  /**
   * @param {object} o
   * @param {number} o.portMin  first port in the race range (inclusive)
   * @param {number} o.portMax  last port (inclusive)
   * @param {(raceId: string, port: number) => void} o.onReady
   * @param {(raceId: string, result: object) => void} o.onFinished  result = the child's IPC 'result' message
   * @param {(raceId: string, reason: string) => void} o.onFailed
   * @param {object} [o.childEnv]  extra env for children (e.g. LOBBY_MAX_RACE_MS in tests)
   * @param {string} [o.childScript]
   */
  constructor({ portMin, portMax, onReady, onFinished, onFailed, childEnv = {}, childScript = CHILD_SCRIPT }) {
    this._freePorts = [];
    for (let p = portMin; p <= portMax; p++) this._freePorts.push(p);
    this._onReady = onReady;
    this._onFinished = onFinished;
    this._onFailed = onFailed;
    this._childEnv = childEnv;
    this._childScript = childScript;
    this._races = new Map(); // raceId → { child, port, startedAt, readyAt, heartbeatAt, tick, tickAt, phase, done }
    this._watchdog = setInterval(() => this._checkHealth(), WATCHDOG_INTERVAL_MS);
    this._watchdog.unref();
  }

  /** Fork a race. Throws when no race port is free. */
  spawn({ raceId, trackKey, reverse, laps, seed, players }, { maxRaceMs, joinTimeoutMs } = {}) {
    const port = this._freePorts.shift();
    if (port === undefined) throw new Error("no free race port");
    const config = { lobbyId: raceId, trackKey, reverse, laps, seed, port, players, maxRaceMs, joinTimeoutMs };
    const child = fork(this._childScript, [], {
      env: { ...process.env, ...this._childEnv, LOBBY_CONFIG: JSON.stringify(config) },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const now = Date.now();
    const race = { child, port, startedAt: now, readyAt: null, heartbeatAt: now, tick: 0, tickAt: now, phase: null, done: false };
    this._races.set(raceId, race);

    child.on("message", (msg) => this._onMessage(raceId, race, msg));
    child.on("exit", (code, signal) => {
      this._release(raceId, race);
      if (!race.done) this._fail(raceId, race, `race process exited (${signal ?? code})`);
    });
    child.on("error", (err) => this._fail(raceId, race, `race process error: ${err.message}`));
  }

  /** Loopback port of a live race that has reported ready, else null. */
  portFor(raceId) {
    const race = this._races.get(raceId);
    return race?.readyAt && !race.done ? race.port : null;
  }

  get activeCount() {
    return this._races.size;
  }

  /** Stop every race (server shutdown). */
  stopAll() {
    clearInterval(this._watchdog);
    for (const [raceId, race] of this._races) this._fail(raceId, race, "server shutting down");
  }

  _onMessage(raceId, race, msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ready") {
      race.readyAt = Date.now();
      race.heartbeatAt = race.readyAt;
      this._onReady(raceId, race.port);
    } else if (msg.type === "heartbeat") {
      const now = Date.now();
      race.heartbeatAt = now;
      if (TICKING_PHASES.has(msg.phase) && !TICKING_PHASES.has(race.phase)) race.tickAt = now;
      race.phase = msg.phase;
      if (msg.tick !== race.tick) {
        race.tick = msg.tick;
        race.tickAt = now;
      }
    } else if (msg.type === "result") {
      if (race.done) return;
      race.done = true;
      this._onFinished(raceId, msg);
    } else if (msg.type === "error") {
      this._fail(raceId, race, msg.message ?? "race process error");
    }
  }

  _checkHealth() {
    const now = Date.now();
    for (const [raceId, race] of this._races) {
      if (race.done) continue;
      if (!race.readyAt) {
        if (now - race.startedAt > READY_TIMEOUT_MS) this._fail(raceId, race, "race process never became ready");
      } else if (now - race.heartbeatAt > HEARTBEAT_TIMEOUT_MS) {
        this._fail(raceId, race, "race process stopped heartbeating");
      } else if (TICKING_PHASES.has(race.phase) && now - race.tickAt > STALL_TIMEOUT_MS) {
        this._fail(raceId, race, "race process stalled");
      }
    }
  }

  /** Report failure once and make sure the child is gone. */
  _fail(raceId, race, reason) {
    if (!race.done) {
      race.done = true;
      console.warn(`[race-supervisor] ${raceId}: ${reason}`);
      this._onFailed(raceId, reason);
    }
    if (race.child.exitCode === null && race.child.signalCode === null) race.child.kill("SIGKILL");
  }

  _release(raceId, race) {
    if (!this._races.has(raceId)) return;
    this._races.delete(raceId);
    this._freePorts.push(race.port);
  }
}
