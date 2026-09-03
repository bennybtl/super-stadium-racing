<template>
  <Transition name="menu-fade">
    <div v-if="store.championshipData" class="fixed inset-0 z-[1100] bg-black pointer-events-auto">
      <div class="absolute inset-0 bg-gradient-to-b from-black/25 via-black/5 to-black/50"></div>
    </div>
  </Transition>

  <Transition name="menu-slide">
    <div
      v-if="store.championshipData"
      class="fixed inset-0 z-[1101] flex items-center justify-center overflow-hidden font-sans pointer-events-none"
    >
      <div class="menu-panel px-10 py-8 pointer-events-auto" :style="panelStyle" @mousedown.stop>
        <h2 class="text-lg uppercase italic tracking-[0.2em] text-[#ffe066] text-center">Championship Complete</h2>
        <p class="text-center text-xs uppercase italic tracking-[0.18em] text-slate-400">
          {{ store.championshipData.initials }}
        </p>
        <p
          v-if="store.championshipData.scoreRank >= 0"
          class="mt-1 text-center text-xs uppercase italic tracking-[0.18em] text-[#ffe066]"
        >
          ★ New High Score — #{{ store.championshipData.scoreRank + 1 }}
        </p>

        <div class="mx-auto mt-3 h-[36vh] max-h-[560px] min-h-[340px] w-full">
          <RacePodium3D :entries="podiumEntries" />
        </div>

        <table class="mx-auto mt-4 mb-6 w-full max-w-[760px] border-collapse text-sm text-slate-200">
          <thead>
            <tr class="text-[11px] uppercase italic tracking-[0.2em] text-slate-400">
              <th class="border-b border-white/10 px-3 py-2 text-left">Pos</th>
              <th class="border-b border-white/10 px-3 py-2 text-left">Driver</th>
              <th class="border-b border-white/10 px-3 py-2 text-right">Points</th>
              <th class="border-b border-white/10 px-3 py-2 text-right">Winnings</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in store.championshipData.podium"
              :key="row.id"
              :class="{ 'bg-[#ffe066]/10 text-white': row.isPlayer }"
            >
              <td class="px-3 py-2 font-bold italic" :class="medalClass(row.rank)">{{ row.rank }}</td>
              <td class="px-3 py-2">{{ row.name }}</td>
              <td class="px-3 py-2 text-right">{{ row.points }}</td>
              <td class="px-3 py-2 text-right">${{ row.winnings.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>

        <button
          class="menu-button pointer-events-auto mx-auto block px-12 py-3 text-2xl"
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

const store = useMenuStore();

const panelStyle = {
  backgroundImage: `url(${new URL('../assets/checker-black.png', import.meta.url).href})`,
  backgroundRepeat: 'repeat',
  backgroundSize: '220px 220px',
};

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

function medalClass(rank) {
  if (rank === 1) return 'text-[#ffd24a]';
  if (rank === 2) return 'text-slate-300';
  if (rank === 3) return 'text-[#d08a4a]';
  return 'text-[#ff6b6b]';
}
</script>
