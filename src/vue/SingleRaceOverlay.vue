<template>
  <Transition name="menu-fade">
    <!-- Full-screen podium stage behind the results -->
    <div v-if="store.singleRaceData" class="fixed inset-0 z-[1100] bg-black pointer-events-auto">
      <RacePodium3D class="absolute inset-0" :entries="podiumEntries" />
    </div>
  </Transition>

  <Transition name="menu-slide">
    <div
      v-if="store.singleRaceData"
      class="fixed inset-0 z-[1101] flex flex-col items-center justify-between overflow-hidden py-8 font-sans pointer-events-none"
    >
      <h2 class="menu-text text-5xl tracking-[0.14em] text-[#ffe066]">Race Results</h2>

      <div class="menu-panel max-h-[44vh] px-8 py-5 pointer-events-auto" :style="panelStyle" @mousedown.stop>
        <ResultsTable :columns="columns" :rows="tableRows" />

        <button
          class="menu-button pointer-events-auto mx-auto mt-4 block px-12 py-2 text-3xl"
          @click="store.singleRaceExit()"
        >
          Back to Menu
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { computed } from 'vue';
import { useMenuStore } from './store.js';
import { formatLapTime as formatTime } from './formatTime.js';
import RacePodium3D from './RacePodium3D.vue';
import ResultsTable from './ResultsTable.vue';

const store = useMenuStore();

const panelStyle = {
  backgroundImage: `url(${new URL('../assets/checker-black.png', import.meta.url).href})`,
  backgroundRepeat: 'repeat',
  backgroundSize: '220px 220px',
};

const columns = [
  { key: 'time', label: 'Race Time', align: 'right' },
  { key: 'gap', label: 'Gap', align: 'right' },
  { key: 'best', label: 'Best Lap', align: 'right' },
];

// Behind the winner: "+4.37" under a minute, "+1:04.37" beyond.
function formatGap(ms) {
  if (ms == null) return '—';
  if (ms <= 0) return 'Leader';
  return `+${ms < 60000 ? (ms / 1000).toFixed(2) : formatTime(ms)}`;
}

const tableRows = computed(() => {
  const rows = store.singleRaceData?.rows ?? [];
  const winnerMs = rows.find((r) => !r.dnf && r.totalRaceTimeMs != null)?.totalRaceTimeMs ?? null;
  return rows.map((r) => ({
    id: r.id,
    position: r.finishPosition,
    name: r.name,
    isPlayer: r.isPlayer,
    dnf: r.dnf,
    values: {
      time: formatTime(r.totalRaceTimeMs),
      gap: r.dnf || winnerMs == null || r.totalRaceTimeMs == null ? '—' : formatGap(r.totalRaceTimeMs - winnerMs),
      best: formatTime(r.fastestLapMs),
    },
  }));
});

// Top 3 finishers for the podium — real finishers first; only fall back to the
// raw order if the whole field DNF'd.
const podiumEntries = computed(() => {
  const rows = store.singleRaceData?.rows ?? [];
  const finishers = rows.filter((r) => !r.dnf);
  const source = finishers.length ? finishers : rows;
  return source.slice(0, 3).map((r) => ({
    position: r.finishPosition,
    name: r.name,
    vehicleKey: r.vehicleKey ?? null,
    color: r.color ?? null,
  }));
});
</script>
