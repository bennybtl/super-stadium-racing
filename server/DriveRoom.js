import { Room } from "@colyseus/core";

const DEFAULT_MAX_CLIENTS = 8;

/**
 * DriveRoom — a thin relay, not an authoritative simulation.
 *
 * Each client runs the same client-side physics the single-player game
 * already uses (see truck/truck.js) and just broadcasts its own truck's
 * position/heading a few times a second. This room's only job is to hand
 * new joiners the current roster and relay each player's state to everyone
 * else — there is no server-side truck state to simulate or reconcile.
 */
export class DriveRoom extends Room {
  onCreate(options = {}) {
    this.maxClients = options.maxClients ?? DEFAULT_MAX_CLIENTS;
    this.autoDispose = true;
    // The first client to join is the room's creator — Colyseus fires onJoin
    // for them like any other client, so "host" isn't known until then.
    this.hostId = null;
    this.started = false;
    // Host-editable, pre-start only. metadata.trackKey is kept in sync with
    // this so the lobby list (server/index.js's /lobbies) reflects live changes.
    this.settings = {
      trackKey: options.trackKey || null,
      reverse: !!options.reverse,
      laps: Number.isFinite(options.laps) ? options.laps : 3,
    };
    // Race progress — only exists once started. Each client tracks its own
    // checkpoint/lap progress locally (same client-side logic as RaceMode)
    // and self-reports lap/finish events here; this room is the single
    // arbiter of finish order and the "everyone's done" results trigger.
    // sessionId -> { lap, finished, totalTimeMs, fastestLapMs }
    this.race = null;

    this.setMetadata({
      name: options.name || "Lobby",
      trackKey: this.settings.trackKey,
      hostName: options.hostName || "Host",
    });

    // sessionId -> { id, name, colorKey, vehicleKey, x, y, z, heading, vx, vy, vz }
    this.players = new Map();

    this.onMessage("state", (client, data) => {
      const player = this.players.get(client.sessionId);
      if (!player || !data) return;
      player.x = data.x;
      player.y = data.y;
      player.z = data.z;
      player.heading = data.heading;
      player.vx = data.vx ?? 0;
      player.vy = data.vy ?? 0;
      player.vz = data.vz ?? 0;
      this.broadcast("state", { id: client.sessionId, ...data }, { except: client });
    });

    // Host-only, pre-start: track choice and direction. Rebroadcast (not
    // schema-synced) so already-connected clients see the live change.
    this.onMessage("updateSettings", (client, data) => {
      if (this.started || client.sessionId !== this.hostId || !data) return;
      if (typeof data.trackKey === "string") this.settings.trackKey = data.trackKey;
      if (typeof data.reverse === "boolean") this.settings.reverse = data.reverse;
      if (Number.isFinite(data.laps)) this.settings.laps = data.laps;
      this.setMetadata({ ...this.metadata, trackKey: this.settings.trackKey });
      this.broadcast("settings", this.settings);
    });

    // Any player may update their own truck/color while waiting (no upgrades yet).
    this.onMessage("updateProfile", (client, data) => {
      const player = this.players.get(client.sessionId);
      if (!player || !data) return;
      if (typeof data.vehicleKey === "string") player.vehicleKey = data.vehicleKey;
      if ("colorKey" in data) player.colorKey = data.colorKey;
      this.broadcast("playerUpdated", player);
    });

    // Only the host may start the race, and only once. Locking (rather than
    // disposing/recreating the room) keeps the same room relaying state for
    // the whole drive — see truck state relay above.
    this.onMessage("start", (client) => {
      if (this.started || client.sessionId !== this.hostId) return;
      this.started = true;
      this.lock();
      this.race = new Map();
      for (const id of this.players.keys()) {
        this.race.set(id, { lap: 0, finished: false, totalTimeMs: null, fastestLapMs: null });
      }
      this.broadcast("start", {
        trackKey: this.settings.trackKey,
        reverse: this.settings.reverse,
        laps: this.settings.laps,
      });
    });

    // Self-reported by each client as its own local checkpoint/lap tracking
    // (same logic RaceMode uses) completes a lap. Relayed so everyone can show
    // a shared standings HUD; this room never runs checkpoint geometry itself.
    this.onMessage("lapCompleted", (client, data) => {
      const progress = this.race?.get(client.sessionId);
      if (!progress || progress.finished || !data) return;
      progress.lap = data.lap;
      this.broadcast("raceProgress", { id: client.sessionId, lap: data.lap }, { except: client });
    });

    this.onMessage("finished", (client, data) => {
      const progress = this.race?.get(client.sessionId);
      if (!progress || progress.finished) return;
      progress.finished = true;
      progress.totalTimeMs = data?.totalTimeMs ?? null;
      progress.fastestLapMs = data?.fastestLapMs ?? null;
      progress.finishPosition = this._nextFinishPosition();
      this.broadcast("playerFinished", {
        id: client.sessionId,
        finishPosition: progress.finishPosition,
        totalTimeMs: progress.totalTimeMs,
        fastestLapMs: progress.fastestLapMs,
      });
      this._checkRaceOver();
    });
  }

  _nextFinishPosition() {
    let count = 0;
    for (const p of this.race.values()) if (p.finished) count++;
    return count;
  }

  /** Fire "raceOver" once every currently-connected player has finished. A
   *  player who leaves mid-race is dropped from `this.players` (see onLeave),
   *  so they stop counting toward "everyone" without blocking the rest. */
  _checkRaceOver() {
    if (!this.race) return;
    for (const id of this.players.keys()) {
      if (!this.race.get(id)?.finished) return;
    }
    const rows = Array.from(this.race.entries())
      .filter(([id]) => this.players.has(id))
      .sort((a, b) => a[1].finishPosition - b[1].finishPosition)
      .map(([id, progress]) => ({
        id,
        name: this.players.get(id)?.name ?? "Racer",
        finishPosition: progress.finishPosition,
        totalTimeMs: progress.totalTimeMs,
        fastestLapMs: progress.fastestLapMs,
      }));
    this.broadcast("raceOver", { rows });
  }

  onJoin(client, options = {}) {
    if (this.hostId == null) this.hostId = client.sessionId;

    const player = {
      id: client.sessionId,
      name: (options.playerName || "Racer").slice(0, 24),
      colorKey: options.colorKey || null,
      vehicleKey: options.vehicleKey || "baja",
      x: 0, y: 0, z: 0, heading: 0,
      vx: 0, vy: 0, vz: 0,
    };
    this.players.set(client.sessionId, player);

    client.send("init", {
      selfId: client.sessionId,
      hostId: this.hostId,
      settings: this.settings,
      players: Array.from(this.players.values()),
    });

    this.broadcast("playerJoined", player, { except: client });
  }

  onLeave(client) {
    this.players.delete(client.sessionId);
    this.broadcast("playerLeft", { id: client.sessionId });
    // The player who left may have been the only one still racing.
    if (this.race) this._checkRaceOver();
  }

  onDispose() {
    this.players.clear();
  }
}
