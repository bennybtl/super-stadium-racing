<template>
  <div v-if="store.screen" class="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000] pointer-events-auto font-sans">
    <div class="bg-[#141414]/95 px-16 py-10 rounded-[10px] border-[3px] border-[#ff5722] shadow-[0_10px_40px_rgba(0,0,0,0.5)] text-center" @mousedown.stop>
      <h1 class="text-[#ff5722] mb-8 text-4xl uppercase tracking-[4px] drop-shadow-[0_0_10px_rgba(255,87,34,0.5)]">{{ title }}</h1>
      <div class="flex flex-col gap-4">

        <!-- ── Start ── -->
        <template v-if="store.screen === 'start'">
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.showPracticeTrackSelect()">Practice</button>
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.showTrackSelect()">Single Race</button>
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.showSeasonSetup()">Start Season</button>
          <hr>
          <button class="bg-gradient-to-b from-[#999999] to-[#555555] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#bbbbbb] hover:to-[#777777]" @click="store.showEditorTrackSelect()">Track Editor</button>
          <button class="bg-gradient-to-b from-[#999999] to-[#555555] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#bbbbbb] hover:to-[#777777]" @click="store.settings()">Settings</button>
        </template>

        <!-- ── Track select ── -->
        <template v-else-if="store.screen === 'trackSelect'">
          <button
            v-for="t in store.trackList"
            :key="t.key"
            class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]"
            @click="store.selectTrack(t.key)"
          >{{ t.name }}</button>
          <button class="bg-gradient-to-b from-slate-700 to-slate-900 text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-slate-600 hover:to-slate-700 mt-1" @click="store.back('start')">Back</button>
        </template>

        <!-- ── Lap select ── -->
        <template v-else-if="store.screen === 'lapSelect'">
          <button
            v-for="n in [1, 3, 5, 10]"
            :key="n"
            class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]"
            @click="store.startGame(n)"
          >{{ n }} Lap{{ n > 1 ? 's' : '' }}</button>
          <button class="bg-gradient-to-b from-slate-700 to-slate-900 text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-slate-600 hover:to-slate-700 mt-1" @click="store.back('trackSelect')">Back</button>
        </template>

        <!-- ── Vehicle select ── -->
        <template v-else-if="store.screen === 'vehicleSelect'">
          <div class="flex flex-wrap justify-center gap-5 mb-5">
            <button
              v-for="v in store.vehicleList"
              :key="v.key"
              class="bg-gradient-to-b from-[#444] to-[#222] border-[3px] border-transparent rounded-[12px] p-4 cursor-pointer transition-all duration-200 flex flex-col items-center w-[180px] shadow-[0_5px_15px_rgba(0,0,0,0.4)] hover:bg-[#555] hover:border-[#ff5722] hover:-translate-y-1 hover:shadow-[0_8px_25px_rgba(255,87,34,0.3)]"
              @click="store.selectVehicle(v.key)"
            >
              <img v-if="v.imageUrl" :src="v.imageUrl" :alt="v.name" class="w-[140px] h-[100px] object-contain mb-4 drop-shadow-[0_4px_6px_rgba(0,0,0,0.5)]" />
              <span class="text-white text-[18px] font-bold uppercase tracking-[1px]">{{ v.name }}</span>
            </button>
          </div>
          <button class="bg-gradient-to-b from-slate-700 to-slate-900 text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-slate-600 hover:to-slate-700 mt-1" @click="store.vehicleSelectBack()">Back</button>
        </template>

        <!-- ── Practice track select ── -->
        <template v-else-if="store.screen === 'practiceTrackSelect'">
          <button
            v-for="t in store.trackList"
            :key="t.key"
            class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]"
            @click="store.startPractice(t.key)"
          >{{ t.name }}</button>
          <button class="bg-gradient-to-b from-slate-700 to-slate-900 text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-slate-600 hover:to-slate-700 mt-1" @click="store.back('start')">Back</button>
        </template>

        <!-- ── Editor track select ── -->
        <template v-else-if="store.screen === 'editorTrackSelect'">
          <button
            v-for="t in store.trackList"
            :key="t.key"
            class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]"
            @click="store.startEditor(t.key)"
          >{{ t.name }}</button>
          <button class="bg-gradient-to-b from-[#4caf50] to-[#388e3c] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#66bb6a] hover:to-[#4caf50]" @click="store.startEditor('new')">+ New Track</button>
          <button class="bg-gradient-to-b from-slate-700 to-slate-900 text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-slate-600 hover:to-slate-700 mt-1" @click="store.back('start')">Back</button>
        </template>

        <!-- ── In-game pause ── -->
        <template v-else-if="store.screen === 'pause'">
          <ul class="list-disc list-inside text-left text-[#ccc] my-2 space-y-1">
            <li><b>ESC:</b> to toggle this menu</li>
            <li><b>W:</b> Gas</li>
            <li><b>S/Left Shift:</b> Brake/Reverse</li>
            <li><b>A,D:</b> Steering</li>
            <li><b>Q:</b> Use Nitro</li>
          </ul>
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.resume()">Resume</button>
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.reset()">Reset</button>
          <button class="bg-gradient-to-b from-slate-700 to-slate-900 text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-slate-600 hover:to-slate-700 mt-1" @click="store.exit()">Exit</button>
        </template>

        <!-- ── Editor pause ── -->
        <template v-else-if="store.screen === 'editorPause'">
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.editorResume()">Resume Editing</button>
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.editorSave()">Save Track</button>
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.editorLoad()">Load Track</button>
          <button class="bg-gradient-to-b from-slate-700 to-slate-900 text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-slate-600 hover:to-slate-700 mt-1" @click="store.editorExit()">Exit to Menu</button>
        </template>

        <!-- ── Settings ── -->
        <template v-else-if="store.screen === 'settings'">
          <button class="bg-gradient-to-b from-slate-700 to-slate-900 text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-slate-600 hover:to-slate-700 mt-1" @click="store.back('start')">Back</button>
        </template>

        <!-- ── Season setup ── -->
        <template v-else-if="store.screen === 'seasonSetup'">
          <p class="text-[#ccc] text-sm mb-2 leading-6">Race on every track. Points awarded each round.<br>Choose laps per race:</p>
          <button
            v-for="n in [1, 3, 5]"
            :key="n"
            class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]"
            @click="store.startSeason(n)"
          >{{ n }} Lap{{ n > 1 ? 's' : '' }}</button>
          <button class="bg-gradient-to-b from-slate-700 to-slate-900 text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-slate-600 hover:to-slate-700 mt-1" @click="store.back('start')">Back</button>
        </template>

      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useMenuStore } from './store.js';

const store = useMenuStore();

const title = computed(() => {
  switch (store.screen) {
    case 'start':             return 'OPEN Off-Road!';
    case 'trackSelect':       return 'Select Track';
    case 'lapSelect':         return 'Select Laps';
    case 'vehicleSelect':     return 'Select Vehicle';
    case 'editorTrackSelect': return 'Select Track to Edit';
    case 'seasonSetup':       return 'Season Mode';
    case 'pause':             return 'Paused';
    case 'editorPause':       return 'Track Editor';
    case 'settings':          return 'Settings';
    default:                  return '';
  }
});
</script>

