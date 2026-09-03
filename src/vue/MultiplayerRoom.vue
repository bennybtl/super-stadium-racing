<template>
  <div class="w-full max-w-xl">
    <h2 class="text-lg uppercase italic tracking-[0.2em] text-[#ffe066] mb-4 text-center">Lobby</h2>

    <div class="rounded-[10px] border-2 border-[#444] bg-[#101010]/80 p-3 mb-4">
      <h3 class="text-xs uppercase italic tracking-[0.14em] text-slate-400 mb-2 text-left">Track</h3>
      <template v-if="mp.isHost">
        <div class="flex flex-row gap-2">
          <select
            :value="mp.settings.trackKey"
            class="flex-grow rounded-[8px] border-2 border-[#444] bg-[#181818] px-3 py-2 text-white pointer-events-auto"
            @change="mp.updateSettings({ trackKey: $event.target.value })"
          >
            <option v-for="t in store.trackList" :key="t.key" :value="t.key">{{ t.name }}</option>
          </select>
          <button
            class="rounded-[8px] border-2 bg-[#181818] px-3 text-sm font-bold uppercase italic tracking-[0.1em] text-white pointer-events-auto"
            :class="mp.settings.reverse ? 'border-[#ffe066] text-[#ffe066]' : 'border-[#444]'"
            @click="mp.updateSettings({ reverse: !mp.settings.reverse })"
          >
            <i class="bi mr-1" :class="mp.settings.reverse ? 'bi-check-square-fill' : 'bi-square-fill'"></i> Reverse
          </button>
          <select
            :value="mp.settings.laps"
            class="rounded-[8px] border-2 border-[#444] bg-[#181818] px-3 py-2 text-white pointer-events-auto"
            @change="mp.updateSettings({ laps: Number($event.target.value) })"
          >
            <option v-for="n in [1, 3, 5, 10]" :key="n" :value="n">{{ n }} Lap{{ n > 1 ? 's' : '' }}</option>
          </select>
        </div>
      </template>
      <template v-else>
        <div class="text-sm text-white">
          {{ trackName }}<span v-if="mp.settings.reverse"> (Reverse)</span> · {{ mp.settings.laps }} Lap{{ mp.settings.laps > 1 ? 's' : '' }}
        </div>
      </template>
    </div>

    <div class="rounded-[10px] border-2 border-[#444] bg-[#101010]/80 p-3 mb-4">
      <TruckSelection
        :vehicles="store.vehicleList"
        :selectedVehicle="store.selectedVehicle"
        :colorOptions="colorOptions"
        :selectedColor="store.selectedPlayerColor"
        @update:selectedVehicle="onVehicleChange"
        @update:selectedColor="onColorChange"
      />
    </div>

    <div class="rounded-[10px] border-2 border-[#444] bg-[#101010]/80 p-3 mb-4">
      <h3 class="text-xs uppercase italic tracking-[0.14em] text-slate-400 mb-2 text-left">
        Players ({{ mp.roomPlayers.length }})
      </h3>
      <ul class="flex flex-col gap-1">
        <li
          v-for="p in mp.roomPlayers"
          :key="p.id"
          class="flex items-center justify-between rounded-[8px] border border-[#333] bg-[#181818] px-3 py-2"
        >
          <span class="text-sm text-white">{{ p.name }}</span>
          <span v-if="p.id === hostId" class="text-xs uppercase italic tracking-[0.14em] text-[#ffe066]">Host</span>
        </li>
      </ul>
    </div>

    <button
      v-if="mp.isHost"
      class="menu-button pointer-events-auto px-10 py-3 text-xl w-full mb-2"
      @click="mp.startRace()"
    >
      Start Race
    </button>
    <div v-else class="text-center text-sm text-slate-400 mb-4">Waiting for host to start…</div>

    <button class="menu-button menu-button-muted pointer-events-auto px-10 py-3 text-xl w-full" @click="handleLeave">
      Leave Lobby
    </button>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue';
import { useMenuStore, useMultiplayerStore } from './store.js';
import { multiplayerClient } from '../multiplayer/MultiplayerClient.js';
import { basicColors } from '../constants.js';
import TruckSelection from './TruckSelection.vue';

const store = useMenuStore();
const mp = useMultiplayerStore();

const colorOptions = Object.entries(basicColors).map(([key, value]) => ({ key, value }));

const hostId = computed(() => multiplayerClient.hostId);
const trackName = computed(() =>
  store.trackList.find(t => t.key === mp.settings.trackKey)?.name ?? mp.settings.trackKey
);

function onVehicleChange(key) {
  store.selectPlayerVehicle(key);
  mp.updateProfile({ vehicleKey: key });
}

function onColorChange(key) {
  store.selectPlayerColor(key);
  mp.updateProfile({ colorKey: key });
}

// Fires for every client in the room once the host starts — including the
// host itself, so there's a single code path into MultiplayerMode regardless
// of who triggered it.
function onRaceStart({ trackKey, reverse, laps }) {
  store.startMultiplayer({
    trackKey,
    vehicleKey: store.selectedVehicle,
    playerColorKey: store.selectedPlayerColor,
    reverse: !!reverse,
    laps: laps ?? 3,
  });
}

function handleLeave() {
  mp.leaveRoom();
  store.showMultiplayerLobby();
}

onMounted(() => multiplayerClient.on('start', onRaceStart));
onUnmounted(() => multiplayerClient.off('start', onRaceStart));
</script>
