<template>
  <div
    v-if="store.screen"
    class="fixed inset-0 z-[1000] font-sans overflow-hidden bg-black"
    :style="titleBackgroundStyle"
  >
    <div class="absolute inset-0 bg-gradient-to-b from-black/30 via-black/20 to-black/70"></div>

    <template v-if="store.screen === 'title'">
      <div v-if="showSafariWarning" class="absolute inset-x-0 top-0 flex justify-center p-4">
        <div class="pointer-events-auto max-w-xl rounded-lg border-2 border-amber-400 bg-black/85 px-5 py-3 text-center shadow-[0_6px_24px_rgba(0,0,0,0.6)]">
          <div class="text-lg font-bold text-amber-300">⚠ Safari detected</div>
          <div class="mt-1 text-sm text-amber-100">
            This game runs on WebGL, which performs poorly in Safari.
            For smoother gameplay, please switch to <b>Chrome</b>, <b>Edge</b>, or <b>Firefox</b>.
          </div>
        </div>
      </div>
      <div class="absolute inset-x-0 bottom-0 flex justify-center pb-10">
        <button
          class="menu-button start-button pointer-events-auto px-14 py-5 text-4xl"
          @click="store.back('start')"
        >
          Start
        </button>
      </div>
    </template>

    <div v-else class="absolute inset-0 flex items-center justify-center pointer-events-auto">
      <div class="menu-panel px-16 py-10 text-center" :style="panelStyle" @mousedown.stop>
      <div class="flex flex-col gap-4">

        <!-- ── Start ── -->
        <template v-if="store.screen === 'start'">
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.showPitMenu('practice')">Practice</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.showPitMenu('hotLap')">Hot Lap</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.showPitMenu('singleRace')">Single Race</button>
          <hr class="my-2 opacity-60">
          <button class="menu-button menu-button-muted pointer-events-auto px-10 py-4 text-2xl" @click="store.showEditorTrackSelect()">Track Editor</button>
          <button class="menu-button menu-button-muted pointer-events-auto px-10 py-4 text-2xl" @click="store.settings()">Settings</button>
        </template>

        <!-- ── Editor track select ── -->
        <template v-else-if="store.screen === 'editorTrackSelect'">
          <TrackSelectionCarousel
            :tracks="store.trackList"
            :modelValue="store.selectedTrack"
            :show-hidden="true"
            @update:modelValue="store.setSelectedTrack($event)"
          />
          <div class="grid grid-cols-2 gap-2">
            <button class="menu-button pointer-events-auto px-10 py-2 text-xl" @click="store.startEditor('new')">
              <i class="bi bi-plus"></i> New Track</button>
            <button class="menu-button pointer-events-auto px-10 py-2 text-xl" @click="store.startEditor(store.selectedTrack)">Edit Selected</button>
          </div>
          <hr class="my-2 opacity-60">
          <button class="menu-button menu-button-muted pointer-events-auto mt-1 px-10 py-2 text-xl" @click="store.back('start')">Back</button>
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
          <hr class="my-2 opacity-60">
          <button class="menu-button menu-button-muted pointer-events-auto mt-1 px-10 py-4 text-2xl" @click="store.exit()">Exit</button>
        </template>

        <!-- ── Editor pause ── -->
        <template v-else-if="store.screen === 'editorPause'">
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.editorResume()">Resume Editing</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.editorSave()">Save Track</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.editorLoad()">Load Track</button>
          <hr class="my-2 opacity-60">
          <button class="menu-button menu-button-muted pointer-events-auto mt-1 px-10 py-4 text-2xl" @click="store.editorExit()">Exit to Menu</button>
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

          <div class="grid gap-3 text-left text-sm text-slate-300 mb-4">
            <TrackSelectionCarousel
              :tracks="store.trackList"
              :modelValue="store.selectedTrack"
              @update:modelValue="store.setSelectedTrack($event)"
            />
            <div v-if="store.pitData.pitMode === 'singleRace'">
              <RaceConfig />
            </div>
            <div v-else-if="store.pitData.pitMode === 'hotLap'" class="flex justify-center">
              <ReverseToggle />
            </div>
          </div>

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
          <div class="mb-4">
            <TruckSetup />
          </div>

          <div class="flex flex-row gap-auto">
            <button class="menu-button menu-button-muted pointer-events-auto px-10 flex-grow py-4 text-2xl" @click="store.back('start')">Back</button>
            <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" v-if="store.pitData.pitMode === 'practice'" @click="store.startPracticeMode()">
              Start Practice
            </button>
            <button class="menu-button pointer-events-auto px-10 py-4 text-2xl flex-grow" v-else-if="store.pitData.pitMode === 'hotLap'" @click="store.startHotLapMode()">
              Start Hot Lap
            </button>
            <button class="menu-button pointer-events-auto px-10 py-4 text-2xl flex-grow" v-else @click="store.startSingleRace()">
              Start Race
            </button>
          </div>
        </div>
      </div>
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue';
import { useMenuStore } from './store.js';
import { basicColors } from '../constants.js';
import { loadControlsSettings } from '../settingsStorage.js';
import { isSafari } from '../browserSupport.js';

import SettingsMenu from './SettingsMenu.vue';
import TrackSelectionCarousel from './TrackSelectionCarousel.vue';
import TruckSelection from './TruckSelection.vue';
import RaceConfig from './RaceConfig.vue';
import ReverseToggle from './ReverseToggle.vue';
import TruckSetup from './TruckSetup.vue';

const store = useMenuStore();
const showSafariWarning = isSafari();
const colorOptions = Object.entries(basicColors).map(([key, value]) => ({ key, value }));
function handleKeyDown(event) {
  if (event.code === 'Escape' && store.pitData) {
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

