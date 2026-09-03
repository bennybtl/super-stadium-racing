import { defineStore } from 'pinia';
import { ref } from 'vue';
import { multiplayerClient } from '../../multiplayer/MultiplayerClient.js';

const PLAYER_NAME_KEY = 'multiplayerPlayerName';

function loadPlayerName() {
  const stored = localStorage.getItem(PLAYER_NAME_KEY);
  return stored && stored.trim() ? stored : 'Player';
}

// ─── Multiplayer lobby store ───────────────────────────────────────────────
// Owns the lobby-browser UI state (list/create/join). The actual connection
// lives in multiplayer/MultiplayerClient.js; this store just drives its async
// calls and surfaces loading/error state to MultiplayerLobby.vue. Once a
// lobby is created or joined, the caller is responsible for navigating into
// MultiplayerMode via the menu store's startMultiplayer() — this store
// doesn't know about game modes.
export const useMultiplayerStore = defineStore('multiplayer', () => {
  const playerName = ref(loadPlayerName());
  const lobbies = ref([]);
  const refreshing = ref(false);
  const busy = ref(false); // true while creating/joining
  const error = ref(null);

  // Waiting-room state — reflects multiplayerClient's roster once
  // created/joined. Kept in sync via the client's event emitter rather than
  // read on demand, since its `players` map isn't itself reactive.
  const roomPlayers = ref([]);
  const isHost = ref(false);
  const settings = ref({ trackKey: null, reverse: false, laps: 3 });

  function syncRoom() {
    roomPlayers.value = Array.from(multiplayerClient.players.values());
    isHost.value = multiplayerClient.isHost;
    settings.value = { ...multiplayerClient.settings };
  }
  multiplayerClient.on('init', syncRoom);
  multiplayerClient.on('join', syncRoom);
  multiplayerClient.on('leave', syncRoom);
  multiplayerClient.on('settings', syncRoom);
  multiplayerClient.on('update', syncRoom);

  function setPlayerName(name) {
    const trimmed = String(name ?? '').slice(0, 24);
    playerName.value = trimmed;
    localStorage.setItem(PLAYER_NAME_KEY, trimmed || 'Player');
  }

  async function refreshLobbies() {
    refreshing.value = true;
    error.value = null;
    try {
      lobbies.value = await multiplayerClient.listLobbies();
    } catch (err) {
      console.error('[Multiplayer] failed to list lobbies', err);
      error.value = "Can't reach the multiplayer server — is it running?";
      lobbies.value = [];
    } finally {
      refreshing.value = false;
    }
  }

  /** @returns {Promise<boolean>} true on success */
  async function createLobby({ name, trackKey, maxClients, vehicleKey, colorKey, laps }) {
    busy.value = true;
    error.value = null;
    try {
      await multiplayerClient.createLobby({
        name: name?.trim() || `${playerName.value}'s Lobby`,
        trackKey,
        maxClients,
        laps,
        playerName: playerName.value,
        colorKey,
        vehicleKey,
      });
      return true;
    } catch (err) {
      console.error('[Multiplayer] failed to create lobby', err);
      error.value = "Couldn't create the lobby — is the multiplayer server running?";
      return false;
    } finally {
      busy.value = false;
    }
  }

  /** @returns {Promise<boolean>} true on success */
  async function joinLobby(roomId, { vehicleKey, colorKey }) {
    busy.value = true;
    error.value = null;
    try {
      await multiplayerClient.joinLobby(roomId, {
        playerName: playerName.value,
        colorKey,
        vehicleKey,
      });
      return true;
    } catch (err) {
      console.error('[Multiplayer] failed to join lobby', err);
      error.value = "Couldn't join that lobby — it may have closed.";
      return false;
    } finally {
      busy.value = false;
    }
  }

  function startRace() {
    multiplayerClient.startRace();
  }

  /** Host-only, pre-start — server silently ignores this otherwise. */
  function updateSettings(partial) {
    multiplayerClient.updateSettings(partial);
  }

  /** Any player may update their own truck/color while waiting. */
  function updateProfile(partial) {
    multiplayerClient.updateProfile(partial);
  }

  function leaveRoom() {
    multiplayerClient.leave();
    roomPlayers.value = [];
    isHost.value = false;
    settings.value = { trackKey: null, reverse: false, laps: 3 };
  }

  return {
    playerName, lobbies, refreshing, busy, error,
    roomPlayers, isHost, settings,
    setPlayerName, refreshLobbies, createLobby, joinLobby,
    startRace, updateSettings, updateProfile, leaveRoom,
  };
});
