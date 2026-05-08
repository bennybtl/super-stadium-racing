<template>
  <div v-if="store.seasonFinalData" class="fixed inset-0 bg-black/90 flex items-center justify-center z-[1100] pointer-events-auto">
    <div class="bg-slate-950/95 border-3 border-amber-400 rounded-[2rem] p-10 min-w-[400px] max-w-[560px] text-center shadow-[0_16px_60px_rgba(0,0,0,0.8),0_0_60px_rgba(245,158,11,0.15)]">

      <div class="text-6xl mb-2">🏆</div>
      <h2 class="text-amber-300 uppercase tracking-[0.3em] text-2xl mb-8">Championship Final</h2>

      <div class="flex flex-col gap-3 mb-8">
        <div
          v-for="s in store.seasonFinalData.standings"
          :key="s.id"
          class="flex items-center gap-3 rounded-2xl px-4 py-3 bg-white/5 text-slate-200"
          :class="{
            'bg-amber-300/10 border border-amber-400/30 text-amber-200 text-lg': s.position === 1,
            'font-semibold': s.isPlayer,
          }"
        >
          <span class="w-7 text-xl">{{ medal(s.position) }}</span>
          <span class="w-6 font-semibold text-amber-300">{{ s.position }}.</span>
          <span class="flex-1 text-left">{{ s.name }}</span>
          <span class="min-w-[64px] text-right font-semibold text-emerald-400">{{ s.totalPoints }} pts</span>
        </div>
      </div>

      <button class="rounded-2xl bg-gradient-to-b from-red-500 to-red-700 px-10 py-3 text-lg font-bold uppercase tracking-[0.2em] text-white shadow-lg shadow-red-950/30 transition hover:from-red-400 hover:to-red-600" @click="store.exitSeason()">
        Back to Menu
      </button>
    </div>
  </div>
</template>

<script setup>
import { useMenuStore } from './store.js';

const store = useMenuStore();

function medal(pos) {
  if (pos === 1) return '🥇';
  if (pos === 2) return '🥈';
  if (pos === 3) return '🥉';
  return '  ';
}
</script>
