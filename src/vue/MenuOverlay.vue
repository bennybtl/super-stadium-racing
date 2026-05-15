<template>
  <div
    v-if="store.screen"
    class="fixed inset-0 z-[1000] font-sans overflow-hidden bg-black"
    :style="titleBackgroundStyle"
  >
    <div class="absolute inset-0 bg-gradient-to-b from-black/30 via-black/20 to-black/70"></div>

    <div v-if="store.screen === 'title'" class="absolute inset-x-0 bottom-0 flex justify-center pb-10">
      <button
        class="menu-button start-button pointer-events-auto px-14 py-5 text-4xl"
        @click="store.back('start')"
      >
        Start
      </button>
    </div>

    <div v-else class="absolute inset-0 flex items-center justify-center pointer-events-auto">
      <div class="menu-panel px-16 py-10 text-center" :style="panelStyle" @mousedown.stop>
      <div class="flex flex-col gap-4">

        <!-- ── Start ── -->
        <template v-if="store.screen === 'start'">
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.showPitMenu('practice')">Practice</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.showPitMenu('singleRace')">Single Race</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.showPitMenu('season')">Start Season</button>
          <hr>
          <button class="menu-button menu-button-muted pointer-events-auto px-10 py-4 text-2xl" @click="store.showEditorTrackSelect()">Track Editor</button>
          <button class="menu-button menu-button-muted pointer-events-auto px-10 py-4 text-2xl" @click="store.settings()">Settings</button>
        </template>

        <!-- ── Editor track select ── -->
        <template v-else-if="store.screen === 'editorTrackSelect'">
          <button
            v-for="t in store.trackList"
            :key="t.key"
            class="menu-button pointer-events-auto px-10 py-2 text-xl"
            @click="store.startEditor(t.key)"
          >{{ t.name }}</button>
          <button class="menu-button pointer-events-auto px-10 py-2 text-xl" @click="store.startEditor('new')">+ New Track</button>
          <hr class="my-2 opacity-60">
          <button class="menu-button pointer-events-auto mt-1 px-10 py-2 text-xl" @click="store.back('start')">Back</button>
        </template>

        <!-- ── In-game pause ── -->
        <template v-else-if="store.screen === 'pause'">
          <ul class="list-disc list-inside text-left text-[#ccc] my-2 space-y-1">
            <li><b>ESC:</b> to toggle this menu</li>
            <li><b>{{ drivingBindings['Gas'] }}:</b> Gas</li>
            <li><b>{{ drivingBindings['Brake/Reverse'] }}:</b> Brake/Reverse</li>
            <li><b>{{ drivingBindings['Steer Left'] }} / {{ drivingBindings['Steer Right'] }}:</b> Steering</li>
            <li><b>{{ drivingBindings['Use Nitro'] }}:</b> Use Nitro</li>
            <li><b>{{ drivingBindings['Reset Truck'] }}:</b> Reset to last checkpoint</li>
            <li><b>{{ drivingBindings['Cycle Camera'] }}:</b> Change camera mode</li>
          </ul>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.resume()">Resume</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.reset()">Reset</button>
          <button class="menu-button pointer-events-auto mt-1 px-10 py-4 text-2xl" @click="store.exit()">Exit</button>
        </template>

        <!-- ── Editor pause ── -->
        <template v-else-if="store.screen === 'editorPause'">
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.editorResume()">Resume Editing</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.editorSave()">Save Track</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.editorLoad()">Load Track</button>
          <button class="menu-button pointer-events-auto mt-1 px-10 py-4 text-2xl" @click="store.editorExit()">Exit to Menu</button>
        </template>

        <!-- ── Settings ── -->
        <template v-else-if="store.screen === 'settings'">
          <SettingsMenu @back="store.back('start')" />
        </template>

      </div>
    </div>
    </div>
  </div>
  <div v-if="store.pitData" 
    class="fixed inset-0 z-[1000] font-sans overflow-hidden bg-black"
    :style="titleBackgroundStyle"
  >
    <div class="absolute inset-0 bg-gradient-to-b from-black/30 via-black/20 to-black/70"></div>

    <div class="absolute inset-0 flex items-center justify-center pointer-events-auto">
        <div class="menu-panel px-16 py-10 text-center" :style="panelStyle" @mousedown.stop>

          <div class="flex flex-col gap-4">
            <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">
              <template v-if="store.pitData.isSeason">PIT LANE</template>
              <template v-else>PRE-RACE</template>
            </h2>

            <!-- <span class="block text-sm text-slate-400 uppercase tracking-[2px] mt-1">
              <template v-if="store.pitData.isSeason">
                Race {{ store.pitData.raceNumber }} of {{ store.pitData.totalRaces }}
              </template>
              <template v-else-if="store.pitData.pitMode === 'practice'">
                Practice
              </template>
              <template v-else>
                Single race · {{ store.pitData.laps }} laps
              </template>
            </span> -->
          </div>

          <template v-if="store.pitData.isSeason">
            <template v-if="!store.pitData.isSeasonComplete">
              <div class="text-[#ccc] text-sm mb-3">
                Next track: <strong class="text-white">{{ store.pitData.nextTrackKey }}</strong>
                <div class="text-slate-500 text-[11px]">This track is fixed for the season.</div>
              </div>
              <div class="flex flex-row gap-4 mb-4">
                <div>
                  <div v-if="store.pitData.isSeason && store.pitData.raceNumber === 1 && !store.pitData.isSeasonComplete" class="text-left mb-4">
                    <label class="block text-slate-400 text-xs uppercase tracking-[2px] mb-2">Laps</label>
                    <select
                      class="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-3 text-left text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      :value="store.selectedLaps"
                      @change="store.setSelectedLaps(Number($event.target.value))"
                    >
                      <option v-for="n in [1, 3, 5, 10]" :key="n" :value="n">{{ n }} Lap{{ n > 1 ? 's' : '' }}</option>
                    </select>
                  </div>
                  <div class="grid gap-4 mb-4">
                    <TruckSelection
                      :vehicles="store.vehicleList"
                      :selectedVehicle="store.selectedVehicle"
                      :colorOptions="colorOptions"
                      :selectedColor="store.pitData.selectedColorKey"
                      @update:selectedVehicle="store.selectPlayerVehicle($event)"
                      @update:selectedColor="store.selectPlayerColor($event)"
                    />
                  </div>
              </div>

              <div>
                <div class="flex flex-col items-center bg-emerald-500/10 border border-emerald-500 rounded-xl px-6 py-3 my-3">
                  <span class="text-slate-400 text-[11px] uppercase tracking-[2px]">Budget</span>
                  <span class="text-emerald-400 text-3xl font-bold tracking-[2px]">${{ store.pitData.playerBalance.toLocaleString() }}</span>
                </div>

                <div class="flex flex-col gap-3 mb-4">
                  <div
                    v-for="u in store.pitData.upgrades"
                    :key="u.id"
                    class="rounded-xl border border-slate-700 bg-white/5 p-3 text-left flex items-center gap-3"
                    :class="u.level >= u.maxLevel ? 'border-red-500 bg-red-500/10' : ''"
                  >
                    <div class="flex-1 min-w-0">
                      <span class="block text-white text-sm font-semibold">{{ u.label }}</span>
                      <span class="block text-slate-400 text-xs mt-1">{{ u.description }}</span>
                    </div>
                    <div class="flex items-center gap-2 text-red-500">
                      {{  u.level }} / {{ u.maxLevel }}
                    </div>
                    <button
                      class="min-w-[72px] px-3 py-2 rounded-md font-bold text-sm uppercase tracking-[1px] transition duration-150 ease-in-out"
                      :class="u.level >= u.maxLevel || !u.affordable ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700' : 'bg-gradient-to-b from-[#ff2222] to-[#d81515] text-white border-0 hover:from-[#ff4343] hover:to-[#ff2222]'"
                      :disabled="u.level >= u.maxLevel || !u.affordable"
                      @click="store.purchaseUpgrade(u.id)"
                    >
                      <template v-if="u.level >= u.maxLevel">MAX</template>
                      <template v-else>${{ u.cost.toLocaleString() }}</template>
                    </button>
                  </div>
                </div>
              </div>
              </div>
              <div class="flex flex-col gap-3">
                <template v-if="store.pitData.isSeason && store.pitData.raceNumber === 1 && !store.pitData.isSeasonComplete">
                  <button class="bg-gradient-to-b from-[#ff2222] to-[#d81515] text-white border-0 px-8 py-4 text-base font-bold rounded-xl uppercase tracking-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition duration-150 ease-in-out hover:from-[#ff4343] hover:to-[#ff2222]" @click="store.startSeasonMode()">
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
                  <button class="bg-gradient-to-b from-[#ff2222] to-[#d81515] text-white border-0 px-8 py-4 text-base font-bold rounded-xl uppercase tracking-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition duration-150 ease-in-out hover:from-[#ff4343] hover:to-[#ff2222]" @click="store.continueSeason()">
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
              <button class="bg-gradient-to-b from-[#ff2222] to-[#d81515] text-white border-0 px-8 py-4 text-base font-bold rounded-xl uppercase tracking-[2px] shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition duration-150 ease-in-out hover:from-[#ff4343] hover:to-[#ff2222]" @click="store.continueSeason()">
                Final Standings →
              </button>
            </template>
          </template>

          <template v-else>
            <div class="grid gap-3 text-left text-sm text-slate-300 mb-4">
              <TrackSelectionCarousel
                :tracks="store.trackList"
                :modelValue="store.selectedTrack"
                @update:modelValue="store.setSelectedTrack($event)"
              />
              <div v-if="store.pitData.pitMode !== 'practice'">
                <RaceConfig />
              </div>
            </div>

            <hr class="my-3 opacity-60">

            <div class="mb-4">
              <TruckSelection
                :vehicles="store.vehicleList"
                :selectedVehicle="store.selectedVehicle"
                :colorOptions="colorOptions"
                :selectedColor="store.pitData.selectedColorKey"
                @update:selectedVehicle="store.selectPlayerVehicle($event)"
                @update:selectedColor="store.selectPlayerColor($event)"
              />
            </div>
            <hr class="my-3 opacity-60">
            <div class="flex flex-row gap-auto">
              <button class="menu-button menu-button-muted pointer-events-auto px-10 flex-grow py-4 text-2xl" @click="store.back('start')">Back</button>
              <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" v-if="store.pitData.pitMode === 'practice'" @click="store.startPracticeMode()">
                Start Practice
              </button>
              <button class="menu-button pointer-events-auto px-10 py-4 text-2xl flex-grow " v-else @click="store.startSingleRace()">
                Start Race
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue';
import { useMenuStore } from './store.js';
import { basicColors } from '../constants.js';
import { loadControlsSettings } from '../settingsStorage.js';

import SettingsMenu from './SettingsMenu.vue';
import TrackSelectionCarousel from './TrackSelectionCarousel.vue';
import TruckSelection from './TruckSelection.vue';
import RaceConfig from './RaceConfig.vue';

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

const titleBackgroundStyle = {
  backgroundImage: `url(${new URL('../assets/title.png', import.meta.url).href})`,
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
};

const panelStyle = {
  backgroundImage: `url(${new URL('../assets/checker-black.png', import.meta.url).href})`,
  backgroundRepeat: 'repeat',
  backgroundSize: '220px 220px',
};

const drivingBindings = computed(() => loadControlsSettings().driving);

const title = computed(() => {
  switch (store.screen) {
    case 'title':
    case 'start':             return '';
    case 'editorTrackSelect': return 'Select Track to Edit';
    case 'pause':             return 'Paused';
    case 'editorPause':       return 'Track Editor';
    case 'settings':          return 'Settings';
    default:                  return '';
  }
});
</script>

<style scoped>
.start-button {
  animation: riseIn 360ms ease-out;
}

@keyframes riseIn {
  from {
    transform: translateY(36px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
</style>

