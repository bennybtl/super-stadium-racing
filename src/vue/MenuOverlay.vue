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
            <li><b>W:</b> Gas</li>
            <li><b>S/Left Shift:</b> Brake/Reverse</li>
            <li><b>A,D:</b> Steering</li>
            <li><b>Q:</b> Use Nitro</li>
            <li><b>R:</b> Reset to last checkpoint</li>
            <li><b>C:</b> Change camera mode</li>
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
</template>

<script setup>
import { computed } from 'vue';
import { useMenuStore } from './store.js';
import SettingsMenu from './SettingsMenu.vue';

const store = useMenuStore();
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

