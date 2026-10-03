import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cleanText, cleanKey, cleanLobbyName, cleanMaxClients, cleanLaps } from "../validate.js";

/**
 * Lobby registry for server-authoritative races (docs/MULTIPLAYER.md, Phase 4).
 *
 * A lobby is a short code players share, a host who picks the settings, and a
 * list of players. The host starts it: the registry asks `spawnRace` for a race
 * process, mints a per-player token, and — once the race reports ready — hands
 * each player `{ port, token }` to connect to it directly. Results come back
 * through `raceFinished` and the lobby closes.
 *
 * Pure state + an injected spawner, so it runs without processes in tests
 * (test/lobby-registry.test.js); RaceSupervisor is the real spawner.
 *
 * Every player gets a `secret` on create/join: their credential for this lobby
 * (leave, settings, start, fetching their race token). Players who stop
 * polling are dropped while the lobby is still waiting.
 *
 * Lobby status: waiting → starting → racing → finished | failed.
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
const CODE_LENGTH = 5;
export const MAX_PLAYERS = 8;
const PLAYER_IDLE_MS = 30_000;       // waiting-lobby players must poll within this
const LOBBY_IDLE_MS = 30 * 60_000;   // a waiting lobby with no activity expires
const CLOSED_KEEP_MS = 10 * 60_000;  // finished/failed lobbies stay readable this long

export class LobbyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class LobbyRegistry {
  /**
   * @param {object} o
   * @param {(race: object) => void} o.spawnRace  start a race process for
   *   `{ raceId, trackKey, reverse, laps, seed, players: [{ id, name, vehicleKey, token }] }`;
   *   it must later call raceReady / raceFinished / raceFailed with the raceId
   * @param {(key: string) => boolean} o.isTrack
   * @param {(key: string) => boolean} o.isVehicle
   * @param {() => number} [o.now]
   */
  constructor({ spawnRace, isTrack, isVehicle, now = Date.now }) {
    this._spawnRace = spawnRace;
    this._isTrack = isTrack;
    this._isVehicle = isVehicle;
    this._now = now;
    this._lobbies = new Map();   // code → lobby
    this._byRace = new Map();    // raceId → lobby
  }

  // ── Player-facing operations ───────────────────────────────────────────────

  create({ name, trackKey, laps, reverse, maxPlayers, player }) {
    const track = cleanKey(trackKey);
    if (!track || !this._isTrack(track)) throw new LobbyError(400, "unknown track");
    const code = this._newCode();
    const lobby = {
      code,
      name: cleanLobbyName(name),
      trackKey: track,
      laps: cleanLaps(laps, 3),
      reverse: reverse === true,
      maxPlayers: cleanMaxClients(maxPlayers, MAX_PLAYERS),
      status: "waiting",
      hostId: null,
      players: [],
      raceId: null,
      port: null,
      results: null,
      failure: null,
      nextPlayerNum: 1,
      touchedAt: this._now(),
      closedAt: null,
    };
    this._lobbies.set(code, lobby);
    const joined = this._addPlayer(lobby, player);
    lobby.hostId = joined.playerId;
    return { code, ...joined };
  }

  join(code, player) {
    const lobby = this._get(code);
    if (lobby.status !== "waiting") throw new LobbyError(409, "race already started");
    if (lobby.players.length >= lobby.maxPlayers) throw new LobbyError(409, "lobby full");
    return { code: lobby.code, ...this._addPlayer(lobby, player) };
  }

  leave(code, secret) {
    const lobby = this._get(code);
    const p = this._auth(lobby, secret);
    this._removePlayer(lobby, p.id);
  }

  /** Host only, while waiting: track / laps / reverse / maxPlayers / name. */
  updateSettings(code, secret, settings) {
    const lobby = this._get(code);
    const p = this._auth(lobby, secret);
    if (p.id !== lobby.hostId) throw new LobbyError(403, "host only");
    if (lobby.status !== "waiting") throw new LobbyError(409, "race already started");
    if (settings.trackKey !== undefined) {
      const track = cleanKey(settings.trackKey);
      if (!track || !this._isTrack(track)) throw new LobbyError(400, "unknown track");
      lobby.trackKey = track;
    }
    if (settings.laps !== undefined) lobby.laps = cleanLaps(settings.laps, lobby.laps);
    if (settings.reverse !== undefined) lobby.reverse = settings.reverse === true;
    if (settings.name !== undefined) lobby.name = cleanLobbyName(settings.name);
    if (settings.maxPlayers !== undefined) {
      lobby.maxPlayers = Math.max(lobby.players.length, cleanMaxClients(settings.maxPlayers, lobby.maxPlayers));
    }
    lobby.touchedAt = this._now();
  }

  /** A player's own vehicle choice, while waiting. */
  updatePlayer(code, secret, { name, vehicleKey }) {
    const lobby = this._get(code);
    const p = this._auth(lobby, secret);
    if (lobby.status !== "waiting") throw new LobbyError(409, "race already started");
    if (name !== undefined) p.name = cleanText(name, p.name);
    if (vehicleKey !== undefined) p.vehicleKey = this._vehicle(vehicleKey);
    lobby.touchedAt = this._now();
  }

  /** Host only: spawn the race. Players then poll `view` for their endpoint. */
  start(code, secret) {
    const lobby = this._get(code);
    const p = this._auth(lobby, secret);
    if (p.id !== lobby.hostId) throw new LobbyError(403, "host only");
    if (lobby.status !== "waiting") throw new LobbyError(409, "race already started");
    lobby.status = "starting";
    lobby.raceId = `${lobby.code}-${this._now().toString(36)}`;
    this._byRace.set(lobby.raceId, lobby);
    for (const pl of lobby.players) pl.token = randomBytes(24).toString("hex");
    lobby.touchedAt = this._now();
    try {
      this._spawnRace({
        raceId: lobby.raceId,
        trackKey: lobby.trackKey,
        reverse: lobby.reverse,
        laps: lobby.laps,
        seed: randomInt(0, 2 ** 32),
        players: lobby.players.map(({ id, name, vehicleKey, token }) => ({ id, name, vehicleKey, token })),
      });
    } catch (err) {
      // No capacity (e.g. every race port in use): back to waiting, retryable.
      this._byRace.delete(lobby.raceId);
      lobby.status = "waiting";
      lobby.raceId = null;
      for (const pl of lobby.players) pl.token = null;
      throw new LobbyError(503, err.message || "no race capacity");
    }
  }

  /**
   * The lobby as one player sees it. With their secret: it also counts as
   * presence, and once the race is up it carries their own `race` endpoint
   * (never anyone else's token).
   */
  view(code, secret = null) {
    const lobby = this._get(code);
    let me = null;
    if (secret) {
      me = this._auth(lobby, secret);
      me.seenAt = this._now();
    }
    return {
      code: lobby.code,
      name: lobby.name,
      trackKey: lobby.trackKey,
      laps: lobby.laps,
      reverse: lobby.reverse,
      maxPlayers: lobby.maxPlayers,
      status: lobby.status,
      hostId: lobby.hostId,
      players: lobby.players.map(({ id, name, vehicleKey }) => ({ id, name, vehicleKey })),
      you: me?.id ?? null,
      race: me && lobby.status === "racing" ? { path: `/race/${lobby.raceId}`, token: me.token } : null,
      results: lobby.results,
      failure: lobby.failure,
    };
  }

  /** Open lobbies for a browser: waiting and not full. */
  list() {
    return [...this._lobbies.values()]
      .filter((l) => l.status === "waiting" && l.players.length < l.maxPlayers)
      .map((l) => ({
        code: l.code, name: l.name, trackKey: l.trackKey, laps: l.laps,
        players: l.players.length, maxPlayers: l.maxPlayers,
      }));
  }

  // ── Race-process callbacks (RaceSupervisor) ────────────────────────────────

  raceReady(raceId, port) {
    const lobby = this._byRace.get(raceId);
    if (!lobby || lobby.status !== "starting") return;
    lobby.status = "racing";
    lobby.port = port;
  }

  raceFinished(raceId, results) {
    const lobby = this._byRace.get(raceId);
    if (!lobby) return;
    lobby.status = "finished";
    lobby.results = results;
    this._close(lobby);
  }

  raceFailed(raceId, reason) {
    const lobby = this._byRace.get(raceId);
    if (!lobby || lobby.status === "finished") return;
    lobby.status = "failed";
    lobby.failure = reason;
    this._close(lobby);
  }

  /** Drop idle players and expire stale lobbies. Call periodically. */
  sweep() {
    const now = this._now();
    for (const lobby of [...this._lobbies.values()]) {
      if (lobby.closedAt !== null) {
        if (now - lobby.closedAt > CLOSED_KEEP_MS) this._delete(lobby);
        continue;
      }
      if (lobby.status !== "waiting") continue;
      for (const p of [...lobby.players]) {
        if (now - p.seenAt > PLAYER_IDLE_MS) this._removePlayer(lobby, p.id);
      }
      if (this._lobbies.has(lobby.code) && now - lobby.touchedAt > LOBBY_IDLE_MS) this._delete(lobby);
    }
  }

  get size() {
    return this._lobbies.size;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _get(code) {
    const lobby = typeof code === "string" ? this._lobbies.get(code.toUpperCase()) : null;
    if (!lobby) throw new LobbyError(404, "no such lobby");
    return lobby;
  }

  _auth(lobby, secret) {
    const given = Buffer.from(String(secret ?? ""));
    const p = lobby.players.find((pl) => pl.secret.length === given.length && timingSafeEqual(pl.secret, given));
    if (!p) throw new LobbyError(401, "not in this lobby");
    return p;
  }

  _vehicle(key) {
    const k = cleanKey(key);
    return k && this._isVehicle(k) ? k : null;
  }

  _addPlayer(lobby, player = {}) {
    const id = `p${lobby.nextPlayerNum++}`;
    const secret = randomBytes(24).toString("hex");
    lobby.players.push({
      id,
      name: cleanText(player.name, `Player ${lobby.players.length + 1}`),
      vehicleKey: this._vehicle(player.vehicleKey),
      secret: Buffer.from(secret),
      token: null,
      seenAt: this._now(),
    });
    lobby.touchedAt = this._now();
    return { playerId: id, secret };
  }

  _removePlayer(lobby, id) {
    lobby.players = lobby.players.filter((p) => p.id !== id);
    lobby.touchedAt = this._now();
    if (lobby.status !== "waiting") return; // mid-race leavers are the race's business
    if (lobby.players.length === 0) {
      this._delete(lobby);
      return;
    }
    // Host handover: the longest-joined player left takes over.
    if (lobby.hostId === id) lobby.hostId = lobby.players[0].id;
  }

  _close(lobby) {
    lobby.closedAt = this._now();
    for (const p of lobby.players) p.token = null;
  }

  _delete(lobby) {
    this._lobbies.delete(lobby.code);
    if (lobby.raceId) this._byRace.delete(lobby.raceId);
  }

  _newCode() {
    for (;;) {
      let code = "";
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this._lobbies.has(code)) return code;
    }
  }
}
