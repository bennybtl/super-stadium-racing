<template>
  <div v-if="store.postRaceData" class="fixed inset-0 bg-black/90 flex items-center justify-center z-[1100] pointer-events-auto">
    <div class="bg-slate-950/95 border-3 border-orange-500 rounded-3xl p-10 min-w-[560px] max-w-[720px] shadow-[0_12px_48px_rgba(0,0,0,0.7)]">

      <h2 class="text-orange-400 uppercase tracking-[0.28em] text-sm text-center mb-4">
        Race Results — {{ store.postRaceData.trackKey }}
        <span class="block text-xs text-slate-400 tracking-[0.18em] mt-1">(Race {{ store.postRaceData.raceNumber }} of {{ store.postRaceData.totalRaces }})</span>
      </h2>

      <table class="w-full border-collapse text-sm text-slate-200">
        <thead>
          <tr class="text-slate-400 text-[11px] uppercase tracking-[0.2em]">
            <th class="py-2 px-3 text-left border-b border-slate-800">Pos</th>
            <th class="py-2 px-3 text-left border-b border-slate-800">Driver</th>
            <th class="py-2 px-3 text-left border-b border-slate-800">Race Time</th>
            <th class="py-2 px-3 text-left border-b border-slate-800">Best Lap</th>
            <th class="py-2 px-3 text-left border-b border-slate-800">Pts</th>
            <th class="py-2 px-3 text-left border-b border-slate-800">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in store.postRaceData.rows"
            :key="row.id"
            class="transition-colors"
            :class="{
              'bg-orange-500/10 text-white': row.isPlayer,
              'text-slate-500': row.dnf,
            }"
          >
            <td class="py-2 px-3 font-semibold text-orange-400">{{ row.finishPosition }}</td>
            <td class="py-2 px-3">{{ row.name }}<span v-if="row.dnf" class="ml-2 inline-flex items-center rounded-md bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-red-400">DNF</span></td>
            <td class="py-2 px-3">{{ formatTime(row.totalRaceTimeMs) }}</td>
            <td class="py-2 px-3">{{ formatTime(row.fastestLapMs) }}</td>
            <td class="py-2 px-3 font-semibold text-emerald-400">+{{ row.pointsEarned }}</td>
            <td class="py-2 px-3 font-semibold text-slate-100">{{ row.totalPoints }}</td>
          </tr>
        </tbody>
      </table>

      <div class="my-5 border-t border-slate-800"></div>

      <h2 class="text-orange-400 uppercase tracking-[0.28em] text-sm text-center mb-4">Championship Standings</h2>
      <div class="flex flex-col gap-2">
        <div
          v-for="s in store.postRaceData.standings"
          :key="s.id"
          class="flex items-center gap-3 rounded-xl px-3 py-2 bg-slate-900/70 text-slate-300"
          :class="{ 'bg-orange-500/10 text-white font-semibold': s.isPlayer }"
        >
          <span class="w-6 font-semibold text-orange-400">{{ s.position }}.</span>
          <span class="flex-1">{{ s.name }}</span>
          <span class="min-w-[60px] text-right font-semibold text-emerald-400">{{ s.totalPoints }} pts</span>
        </div>
      </div>

      <div class="my-5 border-t border-slate-800"></div>

      <div class="text-2xl font-semibold tracking-[0.12em] text-emerald-400">
        💰 +${{ store.postRaceData.playerMoneyEarned.toLocaleString() }}
        <span class="block text-xs text-slate-400 mt-1">earned this race</span>
      </div>

      <button class="mx-auto mt-6 block rounded-2xl bg-gradient-to-b from-orange-500 to-orange-700 px-10 py-3 text-lg font-bold uppercase tracking-[0.2em] text-white shadow-lg shadow-orange-950/30 transition hover:from-orange-400 hover:to-orange-600" @click="store.goToPit()">
        Head to the Pit →
      </button>
    </div>
  </div>
</template>

<script setup>
import { useMenuStore } from './store.js';

const store = useMenuStore();

function formatTime(ms) {
  if (ms == null) return '—';
  const m  = Math.floor(ms / 60000);
  const s  = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
</script>
