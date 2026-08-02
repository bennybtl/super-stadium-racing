<template>
  <!-- Backdrop and content are siblings rather than nested so each runs its own
       transition: the backdrop cross-fades in place while the screen on top of
       it slides. -->
  <Transition name="menu-fade">
    <div
      v-if="store.screen"
      class="fixed inset-0 z-[1000] font-sans overflow-hidden pointer-events-none"
      :class="store.liveBackdrop ? '' : 'bg-black'"
    >
      <div class="absolute inset-0 bg-gradient-to-b from-black/45 via-black/25 to-black/70"></div>
    </div>
  </Transition>

  <Transition :name="slideName" appear @after-enter="clearNavDirection" @after-leave="clearNavDirection">
  <div
    v-if="store.screen"
    :key="store.screen"
    class="fixed inset-0 z-[1001] font-sans overflow-hidden pointer-events-none"
  >
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
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-6">
        <img
          :src="logoSrc"
          alt="Super Stadium Racing"
          class="w-[min(70vw,615px)] max-w-full drop-shadow-[0_10px_30px_rgba(0,0,0,0.8)] select-none"
        />
      </div>
      <div class="absolute inset-x-0 bottom-0 flex justify-center pb-10">
        <button
          class="menu-button pointer-events-auto px-14 py-5 text-4xl"
          @click="store.showStartMenu()"
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
          <template v-if="store.hasActiveChampionship">
            <button class="menu-button pointer-events-auto px-10 py-4 text-2xl text-[#ffe066]" @click="store.resumeChampionship()">Resume Championship</button>
            <hr class="my-2 opacity-60">
          </template>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.showPitMenu('practice')">Practice</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.showPitMenu('hotLap')">Hot Lap</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.showPitMenu('singleRace')">Single Race</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.showChampionshipSetup()">Championship</button>
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
          <button v-if="store.mode === 'championship'" class="menu-button pointer-events-auto px-10 py-4 text-2xl text-[#ff6b6b]" @click="showRetireConfirm = true">Retire Championship</button>
          <hr class="my-2 opacity-60">
          <button class="menu-button menu-button-muted pointer-events-auto mt-1 px-10 py-4 text-2xl" @click="store.exit()">Exit</button>
          <ConfirmDialog
            v-if="showRetireConfirm"
            title="RETIRE CHAMPIONSHIP?"
            @confirm="confirmRetire"
            @cancel="showRetireConfirm = false"
          >
            This ends your championship and <b>erases its saved progress</b>. This can't be undone. Retire anyway?
          </ConfirmDialog>
        </template>

        <!-- ── Editor pause ── -->
        <template v-else-if="store.screen === 'editorPause'">
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.editorResume()">Resume Editing</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="tryEditorSave">Save Track</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="store.editorLoad()">Load Track</button>
          <hr class="my-2 opacity-60">
          <button class="menu-button menu-button-muted pointer-events-auto mt-1 px-10 py-4 text-2xl" @click="store.editorExit()">Exit to Menu</button>
          <ConfirmDialog
            v-if="showSaveOverwriteConfirm"
            title="OVERWRITE TRACK?"
            @confirm="confirmEditorSave"
            @cancel="showSaveOverwriteConfirm = false"
          >
            A track named <b>{{ saveConflictName }}</b> already exists. Overwrite it?
          </ConfirmDialog>
        </template>

        <!-- ── Settings ── -->
        <template v-else-if="store.screen === 'settings'">
          <SettingsMenu @back="store.back('start')" />
        </template>

        <!-- ── Championship setup ── -->
        <template v-else-if="store.screen === 'championshipSetup'">
          <h2 class="text-lg uppercase italic tracking-[0.2em] text-[#ffe066]">Championship</h2>
          <div class="flex flex-col items-center gap-1">
            <h3 class="mb-2 text-xs uppercase italic tracking-[0.14em] text-white">Driver Registration</h3>
            <div class="flex flex-row items-center gap-4">
              <input
                class="w-40 rounded-[10px] border-2 border-[#444] bg-[#101010] px-3 py-2 text-center text-2xl font-bold uppercase italic tracking-[0.3em] text-white focus:border-white focus:outline-none"
                :value="store.champInitials"
                maxlength="5"
                placeholder="AAA"
                @input="store.setChampInitials($event.target.value)"
              />
              <div class="text-[10px] text-left uppercase italic tracking-[0.14em] text-slate-400 max-w-32">Enter your initials to track progress</div>
            </div>
          </div>
          <TruckSelection
            :vehicles="store.vehicleList"
            :selectedVehicle="store.selectedVehicle"
            :colorOptions="colorOptions"
            :selectedColor="store.selectedPlayerColor"
            @update:selectedVehicle="store.selectPlayerVehicle($event)"
            @update:selectedColor="store.selectPlayerColor($event)"
          />
          <RaceConfig :show-race-count="true" :show-reverse="false" />
          <div class="flex flex-row gap-2">
            <button class="menu-button menu-button-muted pointer-events-auto px-10 flex-grow py-4 text-2xl" @click="store.back('start')">Back</button>
            <button class="menu-button pointer-events-auto px-10 py-4 text-2xl flex-grow" @click="store.startChampionship()">Start Cup</button>
          </div>
        </template>

      </div>
    </div>
    </div>
  </div>
  </Transition>

  <Transition name="menu-fade">
    <div
      v-if="store.pitData"
      class="fixed inset-0 z-[1000] font-sans overflow-hidden pointer-events-none"
      :class="store.liveBackdrop ? '' : 'bg-black'"
    >
      <div class="absolute inset-0 bg-gradient-to-b from-black/45 via-black/25 to-black/70"></div>
    </div>
  </Transition>

  <Transition :name="slideName" @after-enter="clearNavDirection" @after-leave="clearNavDirection">
  <div
    v-if="store.pitData"
    :key="pitScreenKey"
    class="fixed inset-0 z-[1001] font-sans overflow-hidden pointer-events-none"
  >
    <div class="absolute inset-0 flex items-center justify-center pointer-events-auto">
      <div class="menu-panel px-16 py-10 text-center" :style="panelStyle" @mousedown.stop>

        <!-- ── Championship pit (between races) ── -->
        <template v-if="store.pitData.pitMode === 'championship'">
          <div class="mb-3 flex items-baseline justify-between">
            <h2 class="text-lg uppercase italic tracking-[0.2em] text-[#ffe066]">
              Race {{ store.pitData.raceNumber }} / {{ store.pitData.totalRaces }}
            </h2>
            <div class="text-sm uppercase italic tracking-[0.14em] text-slate-300">
              Next Track: <span class="text-white">{{ store.pitData.trackName }}</span>
            </div>
          </div>

          <div class="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
            <!-- Standings -->
            <div class="rounded-[10px] border-2 border-[#444] bg-[#101010]/80 p-3">
              <h3 class="mb-2 text-xs uppercase italic tracking-[0.14em] text-slate-400">Standings</h3>
              <table class="w-full border-collapse text-left text-xs text-slate-200">
                <thead>
                  <tr class="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    <th class="py-1 pr-2">#</th>
                    <th class="py-1 pr-2">Driver</th>
                    <th class="py-1 pr-2 text-right">Pts</th>
                    <th class="py-1 text-right">Winnings</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in store.pitData.standings"
                    :key="row.id"
                    :class="{ 'text-[#ffe066]': row.isPlayer }"
                  >
                    <td class="py-1 pr-2 font-semibold">{{ row.rank }}</td>
                    <td class="py-1 pr-2">{{ row.name }}</td>
                    <td class="py-1 pr-2 text-right">{{ row.points }}</td>
                    <td class="py-1 text-right">${{ row.winnings.toLocaleString() }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Wallet + upgrades -->
            <div>
              <TruckSetup />
              <div class="mb-2 flex items-baseline justify-between">
                <h2 class="text-lg uppercase italic tracking-[0.2em] text-[#4ade80] flex-1 text-right mr-4">Wallet</h2>
                <div class="text-lg font-bold uppercase italic tracking-[0.1em] text-[#4ade80]">
                  ${{ (store.pitData.balance ?? 0).toLocaleString() }}
                </div>
              </div>
            </div>
          </div>

          <button class="menu-button pointer-events-auto w-full px-10 py-4 text-2xl" @click="store.continueChampionship()">
            Start Race {{ store.pitData.raceNumber }}
          </button>
        </template>

        <template v-else>
        <div class="grid gap-3 text-left text-sm text-slate-300 mb-1" v-if="setupStep == 'selectTrack'">
          <TrackSelectionCarousel
            :tracks="store.trackList"
            :modelValue="store.selectedTrack"
            @update:modelValue="store.setSelectedTrack($event)"
          />
          <div class="flex justify-center mb-6">
            <TrackLapRecords :trackKey="store.selectedTrack" />
          </div>
          <div v-if="store.pitData.pitMode === 'singleRace'">
            <RaceConfig />
          </div>
          <div v-else-if="store.pitData.pitMode === 'hotLap' || store.pitData.pitMode === 'practice'" class="flex justify-center">
            <ReverseToggle />
          </div>
        </div>
        <template v-if="setupStep == 'selectTruck'">
          <div class="mb-8">
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
        </template>
        
        <div class="flex flex-row gap-auto" v-if="setupStep === 'selectTruck'">
          <button class="menu-button menu-button-muted pointer-events-auto px-10 flex-grow py-4 text-2xl" @click="store.back('start')">Back</button>

          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl flex-grow" @click="setupStep = 'selectTrack'">
            Select Track
          </button>
        </div>
        <div class="flex flex-row gap-auto" v-if="setupStep === 'selectTrack'">
          <button class="menu-button menu-button-muted pointer-events-auto px-10 flex-grow py-4 text-2xl" @click="store.setNavDirection('back'); setupStep = 'selectTruck'">Back</button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl flex-grow" v-if="store.pitData.pitMode === 'practice'" @click="store.startPracticeMode()">
            Start Practice
          </button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl flex-grow" v-else-if="store.pitData.pitMode === 'hotLap'" @click="store.startHotLapMode()">
            Start Hot Lap
          </button>
          <button class="menu-button pointer-events-auto px-10 py-4 text-2xl flex-grow" v-else @click="store.startSingleRace()">
            Start Race
          </button>
        </div>
        </template>
      </div>
    </div>
  </div>
  </Transition>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useMenuStore } from './store.js';
import { basicColors } from '../constants.js';
import { loadControlsSettings } from '../settingsStorage.js';
import { isSafari } from '../browserSupport.js';

import ConfirmDialog from './ConfirmDialog.vue';
import SettingsMenu from './SettingsMenu.vue';
import rebuild from '../editor/editor-rebuild.js';
import TrackSelectionCarousel from './TrackSelectionCarousel.vue';
import TruckSelection from './TruckSelection.vue';
import RaceConfig from './RaceConfig.vue';
import ReverseToggle from './ReverseToggle.vue';
import TrackLapRecords from './TrackLapRecords.vue';
import TruckSetup from './TruckSetup.vue';

const store = useMenuStore();
const showSafariWarning = isSafari();
const setupStep = ref('selectTruck');
// The pit overlay is a single panel with two setup steps; keying the slide on
// the step makes stepping between them read like any other menu change.
const pitScreenKey = computed(() =>
  store.pitData?.pitMode === 'championship' ? 'championshipPit' : setupStep.value
);

const slideName = computed(() =>
  store.navDirection === 'back' ? 'menu-slide-back' : 'menu-slide'
);

// Transition classes are applied to the element imperatively when the enter or
// leave begins, so resetting the direction here can't disturb a slide that is
// still in flight — it only affects the next one.
function clearNavDirection() { store.setNavDirection('forward'); }
const showSaveOverwriteConfirm = ref(false);
const saveConflictName = ref('');
const showRetireConfirm = ref(false);

function confirmRetire() {
  showRetireConfirm.value = false;
  store.retireChampionship();
}

function getSaveKey() {
  const selectedTrack = window.menuManager?.selectedTrack;
  if (selectedTrack && selectedTrack !== 'new' && selectedTrack !== '__editor_live__') {
    return selectedTrack;
  }
  const track = rebuild.currentTrack;
  return track?.id || 'custom';
}

function tryEditorSave() {
  const saveKey = getSaveKey();
  const selectedTrack = window.menuManager?.selectedTrack;
  const isRenamingOrNew = !selectedTrack || selectedTrack === 'new' || selectedTrack === '__editor_live__' || saveKey !== selectedTrack;
  const existsInStorage = localStorage.getItem(`track_${saveKey}`) !== null;

  const existsAlready = existsInStorage || window.trackLoader?.builtinKeys.has(saveKey);
  if (isRenamingOrNew && existsAlready) {
    const existing = window.trackLoader?.tracks.get(saveKey);
    saveConflictName.value = existing?.name ?? saveKey;
    showSaveOverwriteConfirm.value = true;
    return;
  }
  store.editorSave();
}

function confirmEditorSave() {
  showSaveOverwriteConfirm.value = false;
  store.editorSave();
}

const colorOptions = Object.entries(basicColors).map(([key, value]) => ({ key, value }));
function handleKeyDown(event) {
  // Don't let ESC bail out of the between-races championship pit — that would
  // strand the active cup. The cup only exits via the final podium.
  if (event.code === 'Escape' && store.pitData && store.pitData.pitMode !== 'championship') {
    store.back('start');
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

const logoSrc = new URL('../assets/ssr-logo.png', import.meta.url).href;

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


