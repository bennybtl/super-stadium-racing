<template>
  <div class="w-full max-w-xl">
    <h2 class="text-lg uppercase italic tracking-[0.2em] text-[#ffe066] mb-4 text-center">Multiplayer</h2>

    <div class="flex flex-row items-center gap-3 mb-4 justify-center">
      <label class="text-xs uppercase italic tracking-[0.14em] text-slate-400">Your Name</label>
      <input
        class="w-40 rounded-[10px] border-2 border-[#444] bg-[#101010] px-3 py-2 text-center text-white focus:border-white focus:outline-none pointer-events-auto"
        :value="mp.playerName"
        maxlength="24"
        @input="mp.setPlayerName($event.target.value)"
      />
    </div>

    <div v-if="mp.error" class="mb-3 rounded-[10px] border-2 border-[#ff6b6b] bg-[#2a1010] px-4 py-2 text-sm text-[#ff9b9b] text-center">
      {{ mp.error }}
    </div>

    <div class="rounded-[10px] border-2 border-[#444] bg-[#101010]/80 p-3 mb-4">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs uppercase italic tracking-[0.14em] text-slate-400">Active Lobbies</h3>
        <button
          class="text-xs uppercase italic tracking-[0.14em] text-slate-300 hover:text-white pointer-events-auto disabled:opacity-40"
          :disabled="mp.refreshing"
          @click="mp.refreshLobbies()"
        >
          <i class="bi bi-arrow-clockwise"></i> Refresh
        </button>
      </div>

      <div v-if="mp.refreshing && mp.lobbies.length === 0" class="text-center text-sm text-slate-400 py-4">Loading…</div>
      <div v-else-if="mp.lobbies.length === 0" class="text-center text-sm text-slate-500 py-4">No lobbies yet — start one below.</div>
      <ul v-else class="max-h-52 overflow-y-auto flex flex-col gap-2">
        <li
          v-for="lobby in mp.lobbies"
          :key="lobby.roomId"
          class="flex items-center justify-between rounded-[8px] border border-[#333] bg-[#181818] px-3 py-2"
        >
          <div class="text-left">
            <div class="text-sm font-semibold text-white">{{ lobby.name }}</div>
            <div class="text-xs text-slate-400">{{ trackName(lobby.trackKey) }} · Host: {{ lobby.hostName }} · {{ lobby.clients }}/{{ lobby.maxClients }}</div>
          </div>
          <button
            class="menu-button pointer-events-auto px-4 py-2 text-sm disabled:opacity-40"
            :disabled="mp.busy || lobby.clients >= lobby.maxClients"
            @click="handleJoin(lobby)"
          >
            {{ lobby.clients >= lobby.maxClients ? 'Full' : 'Join' }}
          </button>
        </li>
      </ul>
    </div>

    <div class="rounded-[10px] border-2 border-[#444] bg-[#101010]/80 p-3 mb-4">
      <h3 class="text-xs uppercase italic tracking-[0.14em] text-slate-400 mb-2 text-left">Create a Lobby</h3>
      <div class="flex flex-col gap-2">
        <input
          v-model="lobbyName"
          class="rounded-[8px] border-2 border-[#444] bg-[#181818] px-3 py-2 text-white focus:border-white focus:outline-none pointer-events-auto"
          maxlength="32"
          :placeholder="`${mp.playerName}'s Lobby`"
        />
        <div class="flex flex-row gap-2">
          <select
            v-model="createTrackKey"
            class="flex-grow rounded-[8px] border-2 border-[#444] bg-[#181818] px-3 py-2 text-white pointer-events-auto"
          >
            <option v-for="t in store.trackList" :key="t.key" :value="t.key">{{ t.name }}</option>
          </select>
          <select
            v-model.number="maxClients"
            class="rounded-[8px] border-2 border-[#444] bg-[#181818] px-3 py-2 text-white pointer-events-auto"
          >
            <option :value="2">2 players</option>
            <option :value="4">4 players</option>
            <option :value="6">6 players</option>
            <option :value="8">8 players</option>
          </select>
        </div>
        <button
          class="menu-button pointer-events-auto px-10 py-3 text-xl disabled:opacity-40"
          :disabled="mp.busy || !createTrackKey"
          @click="handleCreate"
        >
          {{ mp.busy ? 'Creating…' : 'Create Lobby' }}
        </button>
      </div>
    </div>

    <button class="menu-button menu-button-muted pointer-events-auto px-10 py-3 text-xl w-full" @click="store.back('start')">Back</button>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useMenuStore, useMultiplayerStore } from './store.js';

const store = useMenuStore();
const mp = useMultiplayerStore();

const lobbyName = ref('');
const createTrackKey = ref(store.selectedTrack);
const maxClients = ref(8);

function trackName(key) {
  return store.trackList.find(t => t.key === key)?.name ?? key ?? 'Unknown Track';
}

async function handleJoin(lobby) {
  const ok = await mp.joinLobby(lobby.roomId, {
    vehicleKey: store.selectedVehicle,
    colorKey: store.selectedPlayerColor,
  });
  if (ok) store.showMultiplayerRoom();
}

async function handleCreate() {
  if (!createTrackKey.value) return;
  const ok = await mp.createLobby({
    name: lobbyName.value,
    trackKey: createTrackKey.value,
    maxClients: maxClients.value,
    vehicleKey: store.selectedVehicle,
    colorKey: store.selectedPlayerColor,
  });
  if (ok) store.showMultiplayerRoom();
}

let refreshTimer = null;
onMounted(() => {
  if (!createTrackKey.value && store.trackList.length > 0) {
    createTrackKey.value = store.trackList[0].key;
  }
  mp.refreshLobbies();
  refreshTimer = setInterval(() => mp.refreshLobbies(), 5000);
});
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>
