<template>
  <div v-if="store.pitData" class="fixed inset-0 bg-black/88 flex items-center justify-center z-[1100] pointer-events-auto font-sans">
    <div class="bg-slate-950/98 border-[3px] border-[#ff5722] rounded-[10px] p-7 min-w-[420px] max-w-[840px] text-center shadow-[0_12px_48px_rgba(0,0,0,0.7)]">

      <div class="text-[#ff5722] text-2xl font-bold uppercase tracking-[4px] mb-2">
        <template v-if="store.pitData.isSeason">🔧 PIT LANE</template>
        <template v-else>🏁 PRE-RACE</template>
        <span class="block text-sm text-slate-400 uppercase tracking-[2px] mt-1">
          <template v-if="store.pitData.isSeason">
            Race {{ store.pitData.raceNumber }} of {{ store.pitData.totalRaces }}
          </template>
          <template v-else-if="store.pitData.pitMode === 'practice'">
            Practice
          </template>
          <template v-else>
            Single race · {{ store.pitData.laps }} laps
          </template>
        </span>
      </div>

      <template v-if="store.pitData.isSeason">
        <template v-if="!store.pitData.isSeasonComplete">
          <div class="text-[#ccc] text-sm mb-3">
            Next track: <strong class="text-white">{{ store.pitData.nextTrackKey }}</strong>
            <div class="text-slate-500 text-[11px]">This track is fixed for the season.</div>
          </div>

          <div v-if="store.pitData.isSeason && store.pitData.raceNumber === 1 && !store.pitData.isSeasonComplete" class="text-left mb-4">
            <label class="block text-slate-400 text-xs uppercase tracking-[2px] mb-2">Laps</label>
            <select
              class="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-3 text-left text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              :value="store.selectedLaps"
              @change="store.setSelectedLaps(Number($event.target.value))"
            >
              <option v-for="n in [1, 3, 5, 10]" :key="n" :value="n">{{ n }} Lap{{ n > 1 ? 's' : '' }}</option>
            </select>
          </div>

          <div class="grid gap-4 mb-4">
            <div class="text-left">
              <div class="text-slate-300 text-xs uppercase tracking-[2px] mb-3">Choose your truck</div>
              <div class="grid grid-cols-2 gap-3">
                <button
                  v-for="v in store.vehicleList"
                  :key="v.key"
                  type="button"
                  @click="store.selectPlayerVehicle(v.key)"
                  :class="v.key === store.selectedVehicle ? 'ring-2 ring-amber-400' : 'ring-1 ring-slate-700'
                    + ' rounded-xl p-3 bg-slate-900 text-left transition duration-150 hover:bg-slate-800'"
                >
                  <div class="text-sm text-slate-400 uppercase tracking-[2px] mb-2">Vehicle</div>
                  <div class="text-white text-lg font-semibold">{{ v.name }}</div>
                </button>
              </div>
            </div>

            <div class="text-left">
              <div class="text-slate-300 text-xs uppercase tracking-[2px] mb-3">Choose your truck color</div>
              <div class="grid grid-cols-6 gap-2">
                <button
                  v-for="option in colorOptions"
                  :key="option.key"
                  type="button"
                  @click="store.selectPlayerColor(option.key)"
                  :class="option.key === store.pitData.selectedColorKey ? 'ring-2 ring-amber-400' : 'ring-1 ring-slate-700'
                    + ' rounded-lg h-12 w-12 transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-400'"
                  :style="{ backgroundColor: option.value.diffuse.toHexString() }"
                ></button>
              </div>
            </div>
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
            <template v-if="store.pitData.isSeason && store.pitData.raceNumber === 1 && !store.pitData.isSeasonComplete">
              <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-8 py-4 text-base font-bold rounded-xl uppercase tracking-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition duration-150 ease-in-out hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.startSeasonMode()">
                Start Season
              </button>
              <button
                class="bg-slate-700 text-white border-0 px-8 py-4 text-base font-bold rounded-xl uppercase tracking-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition duration-150 ease-in-out hover:bg-slate-600"
                @click="store.back('start')"
              >
                Back to Menu
              </button>
            </template>
            <template v-else>
              <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-8 py-4 text-base font-bold rounded-xl uppercase tracking-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition duration-150 ease-in-out hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.continueSeason()">
                Continue to Race {{ store.pitData.nextRaceNumber }}
              </button>
              <button class="bg-gradient-to-b from-slate-700 to-slate-900 text-white border-0 px-8 py-4 text-sm font-bold rounded-xl uppercase tracking-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition duration-150 ease-in-out hover:from-slate-600 hover:to-slate-700" @click="store.retireFromSeason()">
                Retire from Season
              </button>
            </template>
          </div>
        </template>

        <template v-else>
          <div class="text-emerald-400 text-2xl font-bold mb-5 tracking-[2px]">Season complete!</div>
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-8 py-4 text-base font-bold rounded-xl uppercase tracking-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition duration-150 ease-in-out hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.continueSeason()">
            Final Standings →
          </button>
        </template>
      </template>

      <template v-else>
        <div class="grid gap-3 text-left text-sm text-slate-300 mb-4">
          <TrackSelectionCarousel
            class="rounded-3xl border border-slate-700 bg-slate-950/80 p-3"
            :tracks="store.trackList"
            :modelValue="store.selectedTrack"
            @update:modelValue="store.setSelectedTrack($event)"
          />
          <div v-if="store.pitData.pitMode !== 'practice'">
            <label class="block text-slate-400 text-xs uppercase tracking-[2px] mb-2">Laps</label>
            <select
              class="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-3 text-left text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              :value="store.selectedLaps"
              @change="store.setSelectedLaps(Number($event.target.value))"
            >
              <option v-for="n in [1, 3, 5, 10]" :key="n" :value="n">{{ n }} Lap{{ n > 1 ? 's' : '' }}</option>
            </select>
          </div>
        </div>

          <div class="grid gap-4 mb-4">
            <div class="text-left">
              <div class="text-slate-300 text-xs uppercase tracking-[2px] mb-3">Choose your truck</div>
              <div class="grid grid-cols-2 gap-3">
                <button
                  v-for="v in store.vehicleList"
                  :key="v.key"
                  type="button"
                  @click="store.selectPlayerVehicle(v.key)"
                  class="rounded-lg transition border-2 "
                  :class="v.key === store.selectedVehicle ? 'border-amber-400 bg-slate-800' : 'border-slate-700  bg-slate-900'"
                >
                  <div class="text-sm text-slate-400 uppercase tracking-[2px] mb-2">Vehicle</div>
                  <div class="text-white text-lg font-semibold">{{ v.name }}</div>
                </button>
              </div>
            </div>

            <div class="text-left">
              <div class="text-slate-300 text-xs uppercase tracking-[2px] mb-3">Choose your truck color</div>
              <div class="grid grid-cols-12 gap-2">
                <button
                  v-for="option in colorOptions"
                  :key="option.key"
                  type="button"
                  @click="store.selectPlayerColor(option.key)"
                  class="rounded-lg h-12 w-12 transition border-2"
                  :class="option.key === store.pitData.selectedColorKey ? 'border-amber-400' : 'border-slate-700'"
                  :style="{ backgroundColor: option.value.diffuse.toHexString() }"
                ></button>
              </div>
            </div>
          </div>

        <div class="flex flex-col gap-3">
          <button
            class="bg-slate-700 text-white border-0 px-8 py-4 text-base font-bold rounded-xl uppercase tracking-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition duration-150 ease-in-out hover:bg-slate-600"
            @click="store.back('start')"
          >
            Back to Menu
          </button>
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-8 py-4 text-base font-bold rounded-xl uppercase tracking-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition duration-150 ease-in-out hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.pitData.pitMode === 'practice' ? store.startPracticeMode() : store.startSingleRace()">
            <template v-if="store.pitData.pitMode === 'practice'">Start Practice</template>
            <template v-else>Start Race</template>
          </button>

        </div>
      </template>

    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue';
import { useMenuStore } from './store.js';
import { basicColors } from '../constants.js';
import TrackSelectionCarousel from './TrackSelectionCarousel.vue';

const store = useMenuStore();
const colorOptions = Object.entries(basicColors).map(([key, value]) => ({ key, value }));
function handleKeyDown(event) {
  if (event.code === 'Escape' && store.pitData && !store.pitData.isSeason) {
    store.back('start');
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

