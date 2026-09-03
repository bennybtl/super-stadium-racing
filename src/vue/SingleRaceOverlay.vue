<template>
  <Transition name="menu-fade">
    <div v-if="store.singleRaceData" class="fixed inset-0 z-[1100] bg-black pointer-events-auto">
      <div class="absolute inset-0 bg-gradient-to-b from-black/25 via-black/5 to-black/50"></div>
    </div>
  </Transition>

  <Transition name="menu-slide">
    <div
      v-if="store.singleRaceData"
      class="fixed inset-0 z-[1101] flex items-center justify-center overflow-hidden font-sans pointer-events-none"
    >
      <div class="menu-panel px-10 py-8 pointer-events-auto" :style="panelStyle" @mousedown.stop>
        <h2 class="text-lg uppercase italic tracking-[0.2em] text-[#ffe066] mb-2 text-center">Race Results</h2>

        <div class="mx-auto h-[36vh] max-h-[560px] min-h-[340px] w-full">
          <RacePodium3D :entries="podiumEntries" />
        </div>

        <table class="mx-auto mt-4 mb-6 w-full max-w-[760px] border-collapse text-sm text-slate-200">
          <thead>
            <tr class="text-[11px] uppercase italic tracking-[0.2em] text-slate-400">
              <th class="border-b border-white/10 px-3 py-2 text-left">Pos</th>
              <th class="border-b border-white/10 px-3 py-2 text-left">Driver</th>
              <th class="border-b border-white/10 px-3 py-2 text-left">Race Time</th>
              <th class="border-b border-white/10 px-3 py-2 text-left">Best Lap</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in store.singleRaceData.rows"
              :key="row.id"
              :class="{
                'bg-[#ffe066]/10 text-white': row.isPlayer,
                'text-slate-500': row.dnf,
              }"
            >
              <td class="px-3 py-2 font-bold italic" :class="medalClass(row.finishPosition, row.dnf)">
                {{ row.finishPosition }}
              </td>
              <td class="px-3 py-2">
                {{ row.name }}
                <span
                  v-if="row.dnf"
                  class="ml-2 inline-flex items-center rounded-md bg-black/50 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[#ff6b6b]"
                >DNF</span>
              </td>
              <td class="px-3 py-2">{{ formatTime(row.totalRaceTimeMs) }}</td>
              <td class="px-3 py-2">{{ formatTime(row.fastestLapMs) }}</td>
            </tr>
          </tbody>
        </table>

        <button
          class="menu-button pointer-events-auto mx-auto block px-12 py-3 text-2xl"
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

const store = useMenuStore();

const panelStyle = {
  backgroundImage: `url(${new URL('../assets/checker-black.png', import.meta.url).href})`,
  backgroundRepeat: 'repeat',
  backgroundSize: '220px 220px',
};

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

function medalClass(pos, dnf) {
  if (dnf) return 'text-slate-500';
  if (pos === 1) return 'text-[#ffd24a]';
  if (pos === 2) return 'text-slate-300';
  if (pos === 3) return 'text-[#d08a4a]';
  return 'text-[#ff6b6b]';
}
</script>
