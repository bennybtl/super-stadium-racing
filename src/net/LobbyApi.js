/**
 * Client for the server-authoritative race lobbies (server/lobbies/index.js).
 *
 * Talks to the configured multiplayer server (net/server-config.js). The player's lobby secret travels in the
 * Authorization header, never in a URL.
 */

import { serverUrl } from './server-config.js';

export class LobbyApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class LobbyApi {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async _call(method, path, { body, secret } = {}) {
    const res = await fetch((this.baseUrl ?? serverUrl()) + path, {
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
