<template>
  <div v-if="store.pitData" class="fixed inset-0 bg-black/88 flex items-center justify-center z-[1100] pointer-events-auto font-sans">
    <div class="bg-slate-950/98 border-[3px] border-[#ff5722] rounded-[10px] p-7 min-w-[420px] max-w-[560px] text-center shadow-[0_12px_48px_rgba(0,0,0,0.7)]">

      <div class="text-[#ff5722] text-2xl font-bold uppercase tracking-[4px] mb-2">
        🔧 PIT LANE
        <span class="block text-sm text-slate-400 uppercase tracking-[2px] mt-1 normal-case">Race {{ store.pitData.raceNumber }} of {{ store.pitData.totalRaces }}</span>
      </div>

      <template v-if="!store.pitData.isSeasonComplete">
        <div class="text-[#ccc] text-sm mb-3">
          Next track: <strong class="text-white">{{ store.pitData.nextTrackKey }}</strong>
        </div>

        <div class="flex flex-col items-center bg-emerald-500/10 border border-emerald-500 rounded-xl px-6 py-3 my-3">
          <span class="text-slate-400 text-[11px] uppercase tracking-[2px]">Budget</span>
          <span class="text-emerald-400 text-3xl font-bold tracking-[2px]">${{ store.pitData.playerBalance.toLocaleString() }}</span>
        </div>

        <div class="flex flex-col gap-3 mb-4">
          <div
            v-for="u in store.pitData.upgrades"
            :key="u.id"
            class="rounded-xl border border-slate-700 bg-white/5 p-3 text-left flex items-center gap-3"
            :class="u.level >= u.maxLevel ? 'border-orange-500 bg-orange-500/10' : ''"
          >
            <div class="flex-1 min-w-0">
              <span class="block text-white text-sm font-semibold">{{ u.label }}</span>
              <span class="block text-slate-400 text-xs mt-1">{{ u.description }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span
                v-for="i in u.maxLevel"
                :key="i"
                class="h-2.5 w-2.5 rounded-full border border-slate-600"
                :class="i <= u.level ? 'bg-orange-500 border-orange-500' : 'bg-slate-800'"
              />
            </div>
            <button
              class="min-w-[72px] px-3 py-2 rounded-md font-bold text-sm uppercase tracking-[1px] transition duration-150 ease-in-out"
              :class="u.level >= u.maxLevel || !u.affordable ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700' : 'bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 hover:from-[#ff7043] hover:to-[#ff5722]'"
              :disabled="u.level >= u.maxLevel || !u.affordable"
              @click="store.purchaseUpgrade(u.id)"
            >
              <template v-if="u.level >= u.maxLevel">MAX</template>
              <template v-else>${{ u.cost.toLocaleString() }}</template>
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-8 py-4 text-base font-bold rounded-xl uppercase tracking-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition duration-150 ease-in-out hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.continueSeason()">
            Continue to Race {{ store.pitData.nextRaceNumber }}
          </button>
          <button class="bg-gradient-to-b from-slate-700 to-slate-900 text-white border-0 px-8 py-4 text-sm font-bold rounded-xl uppercase tracking-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition duration-150 ease-in-out hover:from-slate-600 hover:to-slate-700" @click="store.retireFromSeason()">
            Retire from Season
          </button>
        </div>
      </template>

      <template v-else>
        <div class="text-emerald-400 text-2xl font-bold mb-5 tracking-[2px]">Season complete!</div>
        <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-8 py-4 text-base font-bold rounded-xl uppercase tracking-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition duration-150 ease-in-out hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.continueSeason()">
          Final Standings →
        </button>
      </template>

    </div>
  </div>
</template>

<script setup>
import { useMenuStore } from './store.js';
const store = useMenuStore();
</script>

