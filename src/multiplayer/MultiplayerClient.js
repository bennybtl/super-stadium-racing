import { Client } from "colyseus.js";

const ROOM_NAME = "drive";
const DEFAULT_PORT = 2567;

/**
 * Default Colyseus server URL: same host the page was loaded from, on the
 * server's port. Works unmodified for LAN play — every device connects to
 * whichever machine served the page — as long as that machine is also
 * running `npm run server`.
 */
function defaultServerUrl() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.hostname}:${DEFAULT_PORT}`;
}

/** ws(s):// -> http(s):// for the plain REST lobby-list endpoint (see server/index.js). */
function toHttpUrl(wsUrl) {
  if (wsUrl.startsWith("wss://")) return `https://${wsUrl.slice(6)}`;
  if (wsUrl.startsWith("ws://")) return `http://${wsUrl.slice(5)}`;
  return wsUrl;
}

/**
 * Thin wrapper around colyseus.js for lobby listing/creation/joining and
 * relaying per-truck state. Not authoritative — see server/DriveRoom.js.
 */
export class MultiplayerClient {
  constructor(serverUrl = defaultServerUrl()) {
    this.serverUrl = serverUrl;
    this.client = new Client(serverUrl);
    this.room = null;
    this.selfId = null;
    this.hostId = null;
    // Host-editable pre-start room settings (track choice, direction).
    this.settings = { trackKey: null, reverse: false };
    // sessionId -> { id, name, colorKey, vehicleKey, x, y, z, heading, vx, vy, vz }
    this.players = new Map();
    this._listeners = { init: [], join: [], leave: [], state: [], start: [], settings: [], update: [] };
  }

  on(event, cb) {
    this._listeners[event]?.push(cb);
  }

  off(event, cb) {
    const list = this._listeners[event];
    if (!list) return;
    const i = list.indexOf(cb);
    if (i !== -1) list.splice(i, 1);
  }

  _emit(event, payload) {
    for (const cb of this._listeners[event] ?? []) cb(payload);
  }

  get connected() {
    return !!this.room;
  }

  get isHost() {
    return this.selfId != null && this.selfId === this.hostId;
  }

  /** List currently open lobbies (rooms of type "drive"), via the server's
   *  plain REST endpoint — this colyseus.js version has no client-side
   *  room-listing method (see server/index.js's /lobbies route). */
  async listLobbies() {
    const res = await fetch(`${toHttpUrl(this.serverUrl)}/lobbies`);
    if (!res.ok) throw new Error(`lobby list request failed: ${res.status}`);
    const rooms = await res.json();
    return rooms.map((r) => ({
      roomId: r.roomId,
      name: r.metadata?.name ?? "Lobby",
      trackKey: r.metadata?.trackKey ?? null,
      hostName: r.metadata?.hostName ?? "Host",
      clients: r.clients,
      maxClients: r.maxClients,
    }));
  }

  async createLobby({ name, trackKey, maxClients = 8, playerName, colorKey, vehicleKey }) {
    this.room = await this.client.create(ROOM_NAME, {
      name, trackKey, maxClients,
      hostName: playerName, playerName, colorKey, vehicleKey,
    });
    this._wireRoom();
    return this.room;
  }

  async joinLobby(roomId, { playerName, colorKey, vehicleKey }) {
    this.room = await this.client.joinById(roomId, { playerName, colorKey, vehicleKey });
    this._wireRoom();
    return this.room;
  }

  _wireRoom() {
    const room = this.room;

    room.onMessage("init", (data) => {
      this.selfId = data.selfId;
      this.hostId = data.hostId ?? null;
      this.settings = data.settings ?? { trackKey: null, reverse: false };
      this.players.clear();
      for (const p of data.players ?? []) this.players.set(p.id, p);
      this._emit("init", data);
    });

    // Sent by the server once the host starts the race — see startRace().
    room.onMessage("start", (data) => {
      this._emit("start", data);
    });

    // Host changed track/direction — see updateSettings().
    room.onMessage("settings", (data) => {
      this.settings = data;
      this._emit("settings", data);
    });

    room.onMessage("playerJoined", (player) => {
      this.players.set(player.id, player);
      this._emit("join", player);
    });

    // A player (possibly this one) changed their truck/color — see updateProfile().
    room.onMessage("playerUpdated", (player) => {
      this.players.set(player.id, player);
      this._emit("update", player);
    });

    room.onMessage("playerLeft", ({ id }) => {
      this.players.delete(id);
      this._emit("leave", id);
    });

    room.onMessage("state", (data) => {
      const player = this.players.get(data.id);
      if (player) Object.assign(player, data);
      this._emit("state", data);
    });

    room.onError((code, message) => {
      console.error("[Multiplayer] room error", code, message);
    });

    room.onLeave(() => {
      this.room = null;
      this.selfId = null;
      this.hostId = null;
      this.settings = { trackKey: null, reverse: false };
      this.players.clear();
    });
  }

  /** Throttle calls on the caller's side — this sends immediately. */
  sendState(state) {
    this.room?.send("state", state);
  }

  /** Host-only, pre-start — server silently ignores this otherwise. */
  updateSettings(partial) {
    this.room?.send("updateSettings", partial);
  }

  /** Any player may update their own truck/color while waiting. */
  updateProfile(partial) {
    this.room?.send("updateProfile", partial);
  }

  /** Host-only: tell the server to lock the room and broadcast "start" to
   *  everyone (including this client) — see DriveRoom's "start" handler. */
  startRace() {
    this.room?.send("start");
  }

  leave() {
    this.room?.leave();
    this.room = null;
    this.selfId = null;
    this.hostId = null;
    this.settings = { trackKey: null, reverse: false };
    this.players.clear();
  }
}

export const multiplayerClient = new MultiplayerClient();
