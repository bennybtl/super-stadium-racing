<template>
  <Transition name="menu-fade">
    <div v-if="store.championshipData" class="fixed inset-0 bg-black/90 z-[1100] pointer-events-auto"></div>
  </Transition>
  <Transition name="menu-slide">
  <div v-if="store.championshipData" class="fixed inset-0 overflow-hidden flex items-center justify-center z-[1101] pointer-events-none">
    <div class="bg-slate-950/95 border-3 border-amber-400 rounded-3xl p-10 min-w-[480px] max-w-[640px] shadow-[0_12px_48px_rgba(0,0,0,0.7)] pointer-events-auto">

      <h2 class="text-amber-300 uppercase tracking-[0.28em] text-sm text-center mb-1">Championship Complete</h2>
      <p class="text-center text-xs text-slate-400 tracking-[0.18em] mb-2">{{ store.championshipData.initials }}</p>
      <p
        v-if="store.championshipData.scoreRank >= 0"
        class="text-center text-xs uppercase tracking-[0.18em] text-[#ffe066] mb-6"
      >
        ★ New High Score — #{{ store.championshipData.scoreRank + 1 }}
      </p>
      <div v-else class="mb-6"></div>

      <table class="w-full border-collapse text-sm text-slate-200 mb-7">
        <thead>
          <tr class="text-slate-400 text-[11px] uppercase tracking-[0.2em]">
            <th class="py-2 px-3 text-left border-b border-slate-800">Pos</th>
            <th class="py-2 px-3 text-left border-b border-slate-800">Driver</th>
            <th class="py-2 px-3 text-right border-b border-slate-800">Points</th>
            <th class="py-2 px-3 text-right border-b border-slate-800">Winnings</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in store.championshipData.podium"
            :key="row.id"
            class="transition-colors"
            :class="{ 'bg-amber-400/10 text-white': row.isPlayer }"
          >
            <td class="py-2 px-3 font-semibold" :class="medalClass(row.rank)">{{ row.rank }}</td>
            <td class="py-2 px-3">{{ row.name }}</td>
            <td class="py-2 px-3 text-right">{{ row.points }}</td>
            <td class="py-2 px-3 text-right">${{ row.winnings.toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>

      <button class="mx-auto block rounded-2xl bg-gradient-to-b from-amber-400 to-amber-600 px-10 py-3 text-lg font-bold uppercase tracking-[0.2em] text-slate-950 shadow-lg shadow-amber-950/30 transition hover:from-amber-300 hover:to-amber-500" @click="store.championshipExit()">
        Back to Menu
      </button>
    </div>
  </div>
  </Transition>
</template>

<script setup>
import { useMenuStore } from './store.js';

const store = useMenuStore();

function medalClass(rank) {
  if (rank === 1) return 'text-amber-300';
  if (rank === 2) return 'text-slate-300';
  if (rank === 3) return 'text-orange-400';
  return 'text-slate-500';
}
</script>
