import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { LobbyRegistry, LobbyError } from "./LobbyRegistry.js";
import { RaceSupervisor } from "./RaceSupervisor.js";
import { ResultStore } from "./ResultStore.js";
import { takeToken } from "../validate.js";

/**
 * Server-authoritative race lobbies over HTTP (docs/MULTIPLAYER.md, Phase 4),
 * mounted beside the colyseus relay on the same port.
 *
 *   GET    /race-lobbies                 open lobbies
 *   POST   /race-lobbies                 create  { name, trackKey, laps, reverse, maxPlayers, player: { name, vehicleKey } }
 *                                        → { code, playerId, secret }
 *   GET    /race-lobbies/:code           lobby state; with the player's secret
 *                                        it is also their presence ping, and
 *                                        once racing carries `race: { host, port, token }`
 *   POST   /race-lobbies/:code/join      { player } → { code, playerId, secret }
 *   POST   /race-lobbies/:code/leave
 *   PATCH  /race-lobbies/:code           host: { name, trackKey, laps, reverse, maxPlayers }
 *   PATCH  /race-lobbies/:code/me        { name, vehicleKey }
 *   POST   /race-lobbies/:code/start     host
 *   GET    /races  ·  GET /races/:raceId  stored results (no input logs)
 *
 * The secret travels as `Authorization: Bearer <secret>` — never in a URL.
 * Players connect to their race at ws://<host>:<port> and send
 * `{ type: 'hello', token }` (server/lobby/index.js).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SWEEP_MS = 5_000;
// Lobby create/join per client IP: ~10 a minute, bursts of 5.
const JOIN_RATE = 10 / 60;
const JOIN_BURST = 5;

const catalog = (dir) => new Set(
  readdirSync(join(root, "src", dir)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)),
);

/**
 * @param {import('express').Express} app
 * @param {object} [o]
 * @param {string} [o.dataDir]     where race results are stored
 * @param {number} [o.portMin]     race port range (each race gets one)
 * @param {number} [o.portMax]
 * @param {string} [o.publicHost]  host clients should connect races to; defaults
 *                                 to the hostname they reached this server on
 * @param {object} [o.raceOptions] `{ maxRaceMs, joinTimeoutMs }` for every race (tests)
 */
export function mountRaceLobbies(app, {
  dataDir = join(root, "server", "data", "races"),
  portMin = 22000,
  portMax = 22099,
  publicHost = null,
  raceOptions = {},
} = {}) {
  const tracks = catalog("tracks");
  const vehicles = catalog("vehicles");
  const store = new ResultStore(dataDir);

  let registry = null;
  const supervisor = new RaceSupervisor({
    portMin,
    portMax,
    onReady: (raceId, port) => registry.raceReady(raceId, port),
    onFinished: (raceId, result) => {
      try {
        store.save(raceId, result);
      } catch (err) {
        console.error(`[race-lobbies] could not store ${raceId}:`, err);
      }
      registry.raceFinished(raceId, { raceId, reason: result.reason, rows: result.rows });
    },
    onFailed: (raceId, reason) => registry.raceFailed(raceId, reason),
  });
  registry = new LobbyRegistry({
    spawnRace: (race) => supervisor.spawn(race, raceOptions),
    isTrack: (k) => tracks.has(k),
    isVehicle: (k) => vehicles.has(k),
  });
  const sweeper = setInterval(() => registry.sweep(), SWEEP_MS);
  sweeper.unref();

  const buckets = new Map();
  const rateLimited = (req) => !takeToken(
    buckets.get(req.ip) ?? buckets.set(req.ip, {}).get(req.ip), Date.now(), JOIN_RATE, JOIN_BURST,
  );
  setInterval(() => buckets.clear(), 10 * 60_000).unref();

  const secretOf = (req) => {
    const m = /^Bearer\s+(\S+)$/.exec(req.get("authorization") ?? "");
    return m ? m[1] : null;
  };
  const withRaceHost = (req, view) => (view.race
    ? { ...view, race: { host: publicHost ?? req.hostname, ...view.race } }
    : view);

  // Wrap a handler: LobbyErrors become their status, anything else a 500.
  const handle = (fn) => (req, res) => {
    try {
      const out = fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      if (err instanceof LobbyError) res.status(err.status).json({ error: err.message });
      else {
        console.error("[race-lobbies]", err);
        res.status(500).json({ error: "internal error" });
      }
    }
  };

  const router = express.Router();
  router.get("/race-lobbies", handle(() => registry.list()));
  router.post("/race-lobbies", handle((req, res) => {
    if (rateLimited(req)) throw new LobbyError(429, "slow down");
    res.status(201);
    return registry.create(req.body ?? {});
  }));
  router.get("/race-lobbies/:code", handle((req) => withRaceHost(req, registry.view(req.params.code, secretOf(req)))));
  router.post("/race-lobbies/:code/join", handle((req) => {
    if (rateLimited(req)) throw new LobbyError(429, "slow down");
    return registry.join(req.params.code, req.body?.player ?? {});
  }));
  router.post("/race-lobbies/:code/leave", handle((req) => registry.leave(req.params.code, secretOf(req))));
  router.patch("/race-lobbies/:code", handle((req) => registry.updateSettings(req.params.code, secretOf(req), req.body ?? {})));
  router.patch("/race-lobbies/:code/me", handle((req) => registry.updatePlayer(req.params.code, secretOf(req), req.body ?? {})));
  router.post("/race-lobbies/:code/start", handle((req) => registry.start(req.params.code, secretOf(req))));
  router.get("/races", handle(() => store.recent()));
  router.get("/races/:raceId", handle((req) => {
    const race = store.get(req.params.raceId);
    if (!race) throw new LobbyError(404, "no such race");
    return race;
  }));
  app.use(router);

  return {
    registry,
    supervisor,
    store,
    stop() {
      clearInterval(sweeper);
      supervisor.stopAll();
    },
  };
}
