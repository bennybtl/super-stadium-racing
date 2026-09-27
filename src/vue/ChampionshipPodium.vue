<template>
  <Transition name="menu-fade">
    <!-- Full-screen podium stage behind the results -->
    <div v-if="store.championshipData" class="fixed inset-0 z-[1100] bg-black pointer-events-auto">
      <RacePodium3D class="absolute inset-0" :entries="podiumEntries" />
    </div>
  </Transition>

  <Transition name="menu-slide">
    <div
      v-if="store.championshipData"
      class="fixed inset-0 z-[1101] flex flex-col items-center justify-between overflow-hidden py-8 font-sans pointer-events-none"
    >
      <div class="text-center">
        <h2 class="menu-text text-5xl tracking-[0.14em] text-[#ffe066]">Championship Complete</h2>
        <p class="menu-text mt-1 text-lg tracking-[0.18em] text-slate-200">
          {{ store.championshipData.initials }}
        </p>
        <p
          v-if="store.championshipData.scoreRank >= 0"
          class="menu-text mt-1 text-lg tracking-[0.18em] text-[#ffe066]"
        >
          ★ New High Score — #{{ store.championshipData.scoreRank + 1 }}
        </p>
        <p
          v-if="store.championshipData.unlock"
          class="mt-1 text-center text-sm uppercase italic tracking-[0.18em] text-[#4ade80]"
        >
          🔓 Unlocked: {{ unlockMessage }}
        </p>

      <div class="menu-panel max-h-[44vh] px-8 py-5 pointer-events-auto" :style="panelStyle" @mousedown.stop>
        <ResultsTable :columns="columns" :rows="tableRows" />

        <button
          class="menu-button pointer-events-auto mx-auto mt-4 block px-12 py-2 text-3xl"
          @click="store.championshipExit()"
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
import RacePodium3D from './RacePodium3D.vue';
import ResultsTable from './ResultsTable.vue';

const store = useMenuStore();

const panelStyle = {
  backgroundImage: `url(${new URL('../assets/checker-black.png', import.meta.url).href})`,
  backgroundRepeat: 'repeat',
  backgroundSize: '220px 220px',
};

const columns = [
  { key: 'points', label: 'Points', align: 'right' },
  { key: 'winnings', label: 'Winnings', align: 'right' },
];

const tableRows = computed(() => (store.championshipData?.podium ?? []).map((r) => ({
  id: r.id,
  position: r.rank,
  name: r.name,
  isPlayer: r.isPlayer,
  dnf: false,
  values: {
    points: String(r.points),
    winnings: `$${r.winnings.toLocaleString()}`,
  },
})));

// Top 3 of the final championship standings.
const podiumEntries = computed(() => {
  const rows = store.championshipData?.podium ?? [];
  return rows.slice(0, 3).map((r) => ({
    position: r.rank,
    name: r.name,
    vehicleKey: r.vehicleKey ?? null,
    color: r.color ?? null,
  }));
});

const unlockMessage = computed(() => {
  const unlock = store.championshipData?.unlock;
  if (!unlock) return '';
  const parts = [unlock.truckName, unlock.packName].filter(Boolean);
  return parts.join(' + ');
});

function medalClass(rank) {
  if (rank === 1) return 'text-[#ffd24a]';
  if (rank === 2) return 'text-slate-300';
  if (rank === 3) return 'text-[#d08a4a]';
  return 'text-[#ff6b6b]';
}
</script>
