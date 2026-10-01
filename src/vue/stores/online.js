import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { lobbyApi } from '../../net/LobbyApi.js';
import { useMenuStore } from './menu.js';
import { probeServer } from '../../net/server-config.js';

const PLAYER_NAME_KEY = 'multiplayerPlayerName'; // shared with the relay lobby
const POLL_MS = 1000;

function loadPlayerName() {
  try {
    const stored = localStorage.getItem(PLAYER_NAME_KEY);
    return stored && stored.trim() ? stored : 'Player';
  } catch {
    return 'Player';
  }
}

// ─── Online (server-authoritative) race lobby store ────────────────────────
// Drives OnlineLobby.vue / OnlineRoom.vue against the lobby API
// (net/LobbyApi.js). While in a lobby it polls the lobby state once a second —
// that poll is also this player's presence. When the host starts and the race
// is up, the view carries this player's race endpoint and the store hands off
// to NetRaceMode via the menu store's startOnlineRace().
export const useOnlineStore = defineStore('online', () => {
  const playerName = ref(loadPlayerName());
  const lobbies = ref([]);
  // Keys of the tracks the server can race (built-ins + packs — not editor-only
  // tracks, which exist only in this browser).
  const raceTrackKeys = ref([]);
  const refreshing = ref(false);
  const busy = ref(false);
  const error = ref(null);
  // Multiplayer is offered only when a server is configured and answers.
  const serverAvailable = ref(false);
  async function checkServer() { serverAvailable.value = await probeServer(); }

  // This player's membership: { code, playerId, secret } (secret stays here).
  const membership = ref(null);
  const lobby = ref(null); // last polled view
  let pollTimer = null;
  let launched = false;

  const isHost = computed(() => !!lobby.value && lobby.value.hostId === lobby.value.you);

  function setPlayerName(name) {
    playerName.value = String(name ?? '').slice(0, 24);
    try { localStorage.setItem(PLAYER_NAME_KEY, playerName.value || 'Player'); } catch { /* storage off */ }
  }

  const describe = (err) => (err?.status
    ? err.message
    : "Can't reach the multiplayer server — is it running?");

  async function run(fn) {
    busy.value = true;
    error.value = null;
    try {
      return await fn();
    } catch (err) {
      console.error('[Online]', err);
      error.value = describe(err);
      return null;
    } finally {
      busy.value = false;
    }
  }

  async function refreshLobbies() {
    refreshing.value = true;
    error.value = null;
    try {
      if (!raceTrackKeys.value.length) raceTrackKeys.value = await lobbyApi.tracks();
      lobbies.value = await lobbyApi.list();
    } catch (err) {
      error.value = describe(err);
      lobbies.value = [];
    } finally {
      refreshing.value = false;
    }
  }

  async function enter(result) {
    if (!result) return false;
    membership.value = { code: result.code, playerId: result.playerId, secret: result.secret };
    launched = false;
    await poll();
    startPolling();
    return true;
  }

  /**
   * `preferredTrackKeys`: the game's tracks in menu order, selected one first.
   * The first the server can race is used (the host changes it in the room).
   */
  function createLobby({ preferredTrackKeys, laps, reverse, vehicleKey }) {
    return run(async () => {
      if (!raceTrackKeys.value.length) raceTrackKeys.value = await lobbyApi.tracks();
      const raceable = new Set(raceTrackKeys.value);
      const trackKey = preferredTrackKeys.find((k) => raceable.has(k));
      if (!trackKey) {
        error.value = "None of your tracks are on the race server.";
        return false;
      }
      return enter(await lobbyApi.create({
        name: `${playerName.value}'s Race`,
        trackKey,
        laps,
        reverse,
        player: { name: playerName.value, vehicleKey },
      }));
    });
  }

  function joinLobby(code, { vehicleKey }) {
    return run(async () => enter(await lobbyApi.join(String(code).trim().toUpperCase(), {
      name: playerName.value,
      vehicleKey,
    })));
  }

  async function poll() {
    const m = membership.value;
    if (!m) return;
    try {
      lobby.value = await lobbyApi.view(m.code, m.secret);
    } catch (err) {
      error.value = err?.status === 404 || err?.status === 401 ? 'The lobby closed.' : describe(err);
      if (err?.status === 404 || err?.status === 401) reset();
      return;
    }
    const v = lobby.value;
    if (v.status === 'failed') error.value = `The race couldn't run: ${v.failure ?? 'unknown error'}`;
    if (v.status === 'racing' && v.race && !launched) {
      launched = true;
      reset(); // the race has its own token now; the lobby closes after it
      useMenuStore().startOnlineRace({
        race: v.race,
        trackKey: v.trackKey,
        reverse: v.reverse,
        laps: v.laps,
        players: v.players,
        selfId: v.you,
      });
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(poll, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function updateSettings(partial) {
    const m = membership.value;
    if (!m) return null;
    return run(async () => { await lobbyApi.updateSettings(m.code, m.secret, partial); await poll(); });
  }

  function setVehicle(vehicleKey) {
    const m = membership.value;
    if (!m) return null;
    return run(async () => { await lobbyApi.updateMe(m.code, m.secret, { vehicleKey }); await poll(); });
  }

  function startRace() {
    const m = membership.value;
    if (!m) return null;
    return run(async () => { await lobbyApi.start(m.code, m.secret); await poll(); });
  }

  function reset() {
    stopPolling();
    membership.value = null;
    lobby.value = null;
    launched = false;
  }

  async function leaveLobby() {
    const m = membership.value;
    reset();
    if (m) await lobbyApi.leave(m.code, m.secret).catch(() => {});
  }

  return {
    serverAvailable, checkServer, playerName, lobbies, raceTrackKeys, refreshing, busy, error, lobby, isHost, membership,
    setPlayerName, refreshLobbies, createLobby, joinLobby, updateSettings, setVehicle, startRace, leaveLobby, reset,
  };
});
