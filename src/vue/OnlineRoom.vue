<template>
  <div v-if="lobby" class="w-full max-w-xl self-center">
    <h2 class="text-lg uppercase italic tracking-[0.2em] text-[#ffe066] mb-1 text-center">{{ lobby.name }}</h2>
    <p class="mb-4 text-center text-sm text-slate-300">
      Code <span class="ml-1 select-all text-2xl font-bold tracking-[0.3em] text-white">{{ lobby.code }}</span>
    </p>

    <div v-if="online.error" class="mb-3 rounded-[10px] border-2 border-[#ff6b6b] bg-[#2a1010] px-4 py-2 text-sm text-[#ff9b9b] text-center">
      {{ online.error }}
    </div>

    <div class="rounded-[10px] border-2 border-[#444] bg-[#101010]/80 p-3 mb-4">
      <h3 class="text-xs uppercase italic tracking-[0.14em] text-slate-400 mb-2 text-left">Track</h3>
      <div v-if="online.isHost && waiting" class="flex flex-row gap-2">
        <select
          :value="lobby.trackKey"
          class="flex-grow rounded-[8px] border-2 border-[#444] bg-[#181818] px-3 py-2 text-white pointer-events-auto"
          @change="online.updateSettings({ trackKey: $event.target.value })"
        >
          <option v-for="t in raceTracks" :key="t.key" :value="t.key">{{ t.name }}</option>
        </select>
        <button
          class="rounded-[8px] border-2 bg-[#181818] px-3 text-sm font-bold uppercase italic tracking-[0.1em] text-white pointer-events-auto"
          :class="lobby.reverse ? 'border-[#ffe066] text-[#ffe066]' : 'border-[#444]'"
          @click="online.updateSettings({ reverse: !lobby.reverse })"
        >
          <i class="bi mr-1" :class="lobby.reverse ? 'bi-check-square-fill' : 'bi-square-fill'"></i> Reverse
        </button>
        <select
          :value="lobby.laps"
          class="rounded-[8px] border-2 border-[#444] bg-[#181818] px-3 py-2 text-white pointer-events-auto"
          @change="online.updateSettings({ laps: Number($event.target.value) })"
        >
          <option v-for="n in [1, 3, 5, 10]" :key="n" :value="n">{{ n }} Lap{{ n > 1 ? 's' : '' }}</option>
        </select>
      </div>
      <div v-else class="text-sm text-white">
        {{ trackName }}<span v-if="lobby.reverse"> (Reverse)</span> · {{ lobby.laps }} Lap{{ lobby.laps > 1 ? 's' : '' }}
      </div>
    </div>

    <div class="rounded-[10px] border-2 border-[#444] bg-[#101010]/80 p-3 mb-4">
      <h3 class="text-xs uppercase italic tracking-[0.14em] text-slate-400 mb-2 text-left">Your Truck</h3>
      <select
        :value="me?.vehicleKey ?? ''"
        :disabled="!waiting"
        class="w-full rounded-[8px] border-2 border-[#444] bg-[#181818] px-3 py-2 text-white pointer-events-auto"
        @change="onVehicle($event.target.value)"
      >
        <option v-for="v in store.vehicleList" :key="v.key" :value="v.key">{{ v.name }}</option>
      </select>
    </div>

    <div class="rounded-[10px] border-2 border-[#444] bg-[#101010]/80 p-3 mb-4">
      <h3 class="text-xs uppercase italic tracking-[0.14em] text-slate-400 mb-2 text-left">
        Players ({{ lobby.players.length }}/{{ lobby.maxPlayers }})
      </h3>
      <ul class="flex flex-col gap-1">
        <li
          v-for="p in lobby.players"
          :key="p.id"
          class="flex items-center justify-between rounded-[8px] border border-[#333] bg-[#181818] px-3 py-2"
        >
          <span class="text-sm text-white">{{ p.name }}<span v-if="p.id === lobby.you" class="text-slate-400"> (you)</span></span>
          <span class="text-xs text-slate-400">
            {{ vehicleName(p.vehicleKey) }}
            <span v-if="p.id === lobby.hostId" class="ml-2 uppercase italic tracking-[0.14em] text-[#ffe066]">Host</span>
          </span>
        </li>
      </ul>
    </div>

    <template v-if="waiting">
      <button
        v-if="online.isHost"
        class="menu-button pointer-events-auto px-10 py-3 text-xl w-full mb-2 disabled:opacity-40"
        :disabled="online.busy"
        @click="online.startRace()"
      >
        Start Race
      </button>
      <div v-else class="text-center text-sm text-slate-400 mb-4">Waiting for the host to start…</div>
    </template>
    <div v-else-if="lobby.status === 'starting'" class="text-center text-sm text-[#ffe066] mb-4">Starting the race server…</div>

    <button class="menu-button menu-button-muted pointer-events-auto px-10 py-3 text-xl w-full" @click="handleLeave">Leave</button>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useMenuStore, useOnlineStore } from './store.js';

const store = useMenuStore();
const online = useOnlineStore();

const lobby = computed(() => online.lobby);
const waiting = computed(() => lobby.value?.status === 'waiting');
const me = computed(() => lobby.value?.players.find((p) => p.id === lobby.value.you) ?? null);
// The game's tracks that the server can race.
const raceTracks = computed(() => {
  const raceable = new Set(online.raceTrackKeys);
  return store.trackList.filter((t) => raceable.has(t.key));
});
const trackName = computed(() => store.trackList.find((t) => t.key === lobby.value?.trackKey)?.name ?? lobby.value?.trackKey);

function vehicleName(key) {
  return store.vehicleList.find((v) => v.key === key)?.name ?? 'Default truck';
}

function onVehicle(key) {
  store.selectPlayerVehicle(key);
  online.setVehicle(key);
}

async function handleLeave() {
  await online.leaveLobby();
  store.showOnlineLobby();
}
</script>
