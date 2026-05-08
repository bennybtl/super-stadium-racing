<template>
  <div v-if="store.singleRaceData" class="fixed inset-0 bg-black/90 flex items-center justify-center z-[1100] pointer-events-auto">
    <div class="bg-slate-950/95 border-3 border-red-500 rounded-3xl p-10 min-w-[480px] max-w-[640px] shadow-[0_12px_48px_rgba(0,0,0,0.7)]">

      <h2 class="text-red-400 uppercase tracking-[0.28em] text-sm text-center mb-2">Race Results</h2>
      <p class="text-center text-xs text-slate-400 tracking-[0.18em] mb-6">{{ store.singleRaceData.trackKey }}</p>

      <table class="w-full border-collapse text-sm text-slate-200 mb-7">
        <thead>
          <tr class="text-slate-400 text-[11px] uppercase tracking-[0.2em]">
            <th class="py-2 px-3 text-left border-b border-slate-800">Pos</th>
            <th class="py-2 px-3 text-left border-b border-slate-800">Driver</th>
            <th class="py-2 px-3 text-left border-b border-slate-800">Race Time</th>
            <th class="py-2 px-3 text-left border-b border-slate-800">Best Lap</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in store.singleRaceData.rows"
            :key="row.id"
            class="transition-colors"
            :class="{
              'bg-red-500/10 text-white': row.isPlayer,
              'text-slate-500': row.dnf,
            }"
          >
            <td class="py-2 px-3 font-semibold text-red-400">{{ row.finishPosition }}</td>
            <td class="py-2 px-3">{{ row.name }}<span v-if="row.dnf" class="ml-2 inline-flex items-center rounded-md bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-red-400">DNF</span></td>
            <td class="py-2 px-3">{{ formatTime(row.totalRaceTimeMs) }}</td>
            <td class="py-2 px-3">{{ formatTime(row.fastestLapMs) }}</td>
          </tr>
        </tbody>
      </table>

      <button class="mx-auto block rounded-2xl bg-gradient-to-b from-red-500 to-red-700 px-10 py-3 text-lg font-bold uppercase tracking-[0.2em] text-white shadow-lg shadow-red-950/30 transition hover:from-red-400 hover:to-red-600" @click="store.singleRaceExit()">
        Back to Menu
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
