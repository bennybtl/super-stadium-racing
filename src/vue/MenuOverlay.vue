<template>
  <div v-if="store.screen" class="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000] pointer-events-auto font-sans">
    <div class="bg-[#141414]/95 px-16 py-10 rounded-[10px] border-[3px] border-[#ff5722] shadow-[0_10px_40px_rgba(0,0,0,0.5)] text-center" @mousedown.stop>
      <h1 class="text-[#ff5722] mb-8 text-4xl uppercase tracking-[4px] drop-shadow-[0_0_10px_rgba(255,87,34,0.5)]">{{ title }}</h1>
      <div class="flex flex-col gap-4">

        <!-- ── Start ── -->
        <template v-if="store.screen === 'start'">
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.showPitMenu('practice')">Practice</button>
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.showPitMenu()">Single Race</button>
          <button class="bg-gradient-to-b from-[#ff5722] to-[#d84315] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#ff7043] hover:to-[#ff5722]" @click="store.showPitMenu('season')">Start Season</button>
          <hr>
          <button class="bg-gradient-to-b from-[#999999] to-[#555555] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#bbbbbb] hover:to-[#777777]" @click="store.showEditorTrackSelect()">Track Editor</button>
          <button class="bg-gradient-to-b from-[#999999] to-[#555555] text-white border-0 px-10 py-4 text-xl font-bold rounded-md uppercase tracking-[2px] transition duration-150 ease-in-out shadow-lg pointer-events-auto hover:from-[#bbbbbb] hover:to-[#777777]" @click="store.settings()">Settings</button>
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
            <li><b>R:</b> Reset to last checkpoint</li>
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
    case 'editorTrackSelect': return 'Select Track to Edit';
    case 'pause':             return 'Paused';
    case 'editorPause':       return 'Track Editor';
    case 'settings':          return 'Settings';
    default:                  return '';
  }
});
</script>

