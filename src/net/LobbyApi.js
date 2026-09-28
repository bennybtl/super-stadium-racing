/**
 * Client for the server-authoritative race lobbies (server/lobbies/index.js).
 *
 * Same host the page came from, on the multiplayer server's port — the same
 * convention as the colyseus client (multiplayer/MultiplayerClient.js), so LAN
 * play works unmodified. The player's lobby secret travels in the
 * Authorization header, never in a URL.
 */

const DEFAULT_PORT = 2567;

function defaultBaseUrl() {
  return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_PORT}`;
}

export class LobbyApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class LobbyApi {
  constructor(baseUrl = defaultBaseUrl()) {
    this.baseUrl = baseUrl;
  }

  async _call(method, path, { body, secret } = {}) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new LobbyApiError(res.status, data?.error ?? `HTTP ${res.status}`);
    return data;
  }

  /** Keys of the tracks the server can race (built-ins + packs). */
  tracks() {
    return this._call('GET', '/race-tracks');
  }

  /** Open lobbies: [{ code, name, trackKey, laps, players, maxPlayers }] */
  list() {
    return this._call('GET', '/race-lobbies');
  }

  /** → { code, playerId, secret } */
  create({ name, trackKey, laps, reverse, maxPlayers, player }) {
    return this._call('POST', '/race-lobbies', { body: { name, trackKey, laps, reverse, maxPlayers, player } });
  }

  /** → { code, playerId, secret } */
  join(code, player) {
    return this._call('POST', `/race-lobbies/${encodeURIComponent(code)}/join`, { body: { player } });
  }

  /** Lobby state; with `secret` it's also this player's presence ping. */
  view(code, secret) {
    return this._call('GET', `/race-lobbies/${encodeURIComponent(code)}`, { secret });
  }

  leave(code, secret) {
    return this._call('POST', `/race-lobbies/${encodeURIComponent(code)}/leave`, { secret });
  }

  /** Host only: { name, trackKey, laps, reverse, maxPlayers } */
  updateSettings(code, secret, settings) {
    return this._call('PATCH', `/race-lobbies/${encodeURIComponent(code)}`, { secret, body: settings });
  }

  /** { name, vehicleKey } */
  updateMe(code, secret, fields) {
    return this._call('PATCH', `/race-lobbies/${encodeURIComponent(code)}/me`, { secret, body: fields });
  }

  start(code, secret) {
    return this._call('POST', `/race-lobbies/${encodeURIComponent(code)}/start`, { secret });
  }
}

export const lobbyApi = new LobbyApi();
