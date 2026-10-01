<template>
  <div class="w-full max-w-xl self-center">
    <h2 class="text-lg uppercase italic tracking-[0.2em] text-[#ffe066] mb-1 text-center">Online Race</h2>
    <p class="text-xs text-slate-400 mb-4 text-center">Beta — the server runs the race. Your truck will feel a little laggy for now.</p>

    <div class="flex flex-row items-center gap-3 mb-4 justify-center">
      <label class="text-xs uppercase italic tracking-[0.14em] text-slate-400">Your Name</label>
      <input
        class="w-40 rounded-[10px] border-2 border-[#444] bg-[#101010] px-3 py-2 text-center text-white focus:border-white focus:outline-none pointer-events-auto"
        :value="online.playerName"
        maxlength="24"
        @input="online.setPlayerName($event.target.value)"
      />
    </div>

    <div v-if="online.error" class="mb-3 rounded-[10px] border-2 border-[#ff6b6b] bg-[#2a1010] px-4 py-2 text-sm text-[#ff9b9b] text-center">
      {{ online.error }}
    </div>

    <div class="rounded-[10px] border-2 border-[#444] bg-[#101010]/80 p-3 mb-4">
      <h3 class="text-xs uppercase italic tracking-[0.14em] text-slate-400 mb-2 text-left">Join by Code</h3>
      <div class="flex flex-row gap-2">
        <input
          v-model="code"
          class="flex-grow rounded-[8px] border-2 border-[#444] bg-[#181818] px-3 py-2 text-center uppercase tracking-[0.3em] text-white focus:border-white focus:outline-none pointer-events-auto"
          maxlength="5"
          placeholder="ABCDE"
          @keydown.enter="handleJoin(code)"
        />
        <button
          class="menu-button pointer-events-auto px-6 py-2 text-lg disabled:opacity-40"
          :disabled="online.busy || code.trim().length !== 5"
          @click="handleJoin(code)"
        >
          Join
        </button>
      </div>
    </div>

    <div class="rounded-[10px] border-2 border-[#444] bg-[#101010]/80 p-3 mb-4">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs uppercase italic tracking-[0.14em] text-slate-400">Open Races</h3>
        <button
          class="text-xs uppercase italic tracking-[0.14em] text-slate-300 hover:text-white pointer-events-auto disabled:opacity-40"
          :disabled="online.refreshing"
          @click="online.refreshLobbies()"
        >
          <i class="bi bi-arrow-clockwise"></i> Refresh
        </button>
      </div>
      <div v-if="online.lobbies.length === 0" class="text-center text-sm text-slate-500 py-4">No open races — create one below.</div>
      <ul v-else class="max-h-52 overflow-y-auto flex flex-col gap-2">
        <li
          v-for="l in online.lobbies"
          :key="l.code"
          class="flex items-center justify-between rounded-[8px] border border-[#333] bg-[#181818] px-3 py-2"
        >
          <div class="text-left">
            <div class="text-sm font-semibold text-white">{{ l.name }} <span class="text-xs tracking-[0.2em] text-slate-400">{{ l.code }}</span></div>
            <div class="text-xs text-slate-400">{{ trackName(l.trackKey) }} · {{ l.laps }} laps · {{ l.players }}/{{ l.maxPlayers }}</div>
          </div>
          <button class="menu-button pointer-events-auto px-4 py-2 text-sm disabled:opacity-40" :disabled="online.busy" @click="handleJoin(l.code)">Join</button>
        </li>
      </ul>
    </div>

    <button
      class="menu-button pointer-events-auto px-10 py-3 text-xl w-full mb-2 disabled:opacity-40"
      :disabled="online.busy"
      @click="handleCreate"
    >
      {{ online.busy ? 'Working…' : 'Create Race' }}
    </button>
    <button class="menu-button menu-button-muted pointer-events-auto px-10 py-3 text-xl w-full" @click="store.back('start')">Back</button>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useMenuStore, useOnlineStore } from './store.js';

const store = useMenuStore();
const online = useOnlineStore();
const code = ref('');

function trackName(key) {
  return store.trackList.find((t) => t.key === key)?.name ?? key;
}

async function handleJoin(c) {
  if (await online.joinLobby(c, { vehicleKey: store.selectedVehicle })) store.showOnlineRoom();
}

async function handleCreate() {
  // Starting defaults — the host changes track / laps in the room. The store
  // picks the first of these the server can race (not editor-only tracks).
  const preferredTrackKeys = [store.selectedTrack, ...store.trackList.map((t) => t.key)].filter(Boolean);
  const ok = await online.createLobby({ preferredTrackKeys, laps: 3, reverse: false, vehicleKey: store.selectedVehicle });
  if (ok) store.showOnlineRoom();
}

let refreshTimer = null;
onMounted(() => {
  online.refreshLobbies();
  refreshTimer = setInterval(() => online.refreshLobbies(), 5000);
});
onUnmounted(() => clearInterval(refreshTimer));
</script>
