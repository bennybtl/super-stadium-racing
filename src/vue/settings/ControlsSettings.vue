<template>
  <div class="text-center">
    <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Controls</h2>

    <div class="flex items-center justify-center gap-4">
      <button
        class="menu-button px-8 py-3 text-xl"
        :class="activeMode === 'driving' ? '' : 'menu-button-muted'"
        @click="activeMode = 'driving'"
      >
        Driving
      </button>
      <button
        class="menu-button px-8 py-3 text-xl"
        :class="activeMode === 'editor' ? '' : 'menu-button-muted'"
        @click="activeMode = 'editor'"
      >
        Editor
      </button>
    </div>

    <div class="my-8">
      <div v-for="(binding, action) in visibleBindings" :key="action" class="flex items-center justify-center mb-5">
        <div class="w-1/2 pr-4 text-right font-bold text-white uppercase italic tracking-wider">{{ action }}</div>
        <div class="w-1/2 flex items-center">
          <button class="text-lg py-2 px-6 rounded-md bg-[#222] text-white cursor-pointer border-0" @click="startRemap(action)">
            {{ remappingAction === action ? 'Press a key...' : binding }}
          </button>
        </div>
      </div>
    </div>

    <hr class="my-3 opacity-60">

    <div class="flex flex-col items-center gap-2 mt-4">
      <button class="menu-button menu-button-muted px-8 py-3 text-xl" @click="resetToDefaults()">Reset to Defaults</button>
      <button class="menu-button menu-button-muted px-8 py-3 text-xl" @click="$emit('back')">Back</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  getDefaultControlsSettings,
  loadControlsSettings,
  saveControlsSettings,
} from '../../settingsStorage.js';

function cloneDefaults() {
  return getDefaultControlsSettings();
}

const activeMode = ref('driving');
const keyBindings = ref(loadControlsSettings());
const remappingAction = ref(null);

const visibleBindings = computed(() => {
  return activeMode.value === 'editor' ? keyBindings.value.editor : keyBindings.value.driving;
});

function persistBindings() {
  saveControlsSettings(keyBindings.value);
}

function startRemap(action) {
  remappingAction.value = action;
}

function onRemapKeyDown(e) {
  if (!remappingAction.value) return;

  e.preventDefault();
  e.stopPropagation();

  if (e.code === 'Escape') {
    remappingAction.value = null;
    return;
  }

  const code = e.code;
  if (!code) return;

  const modeKey = activeMode.value;
  keyBindings.value[modeKey][remappingAction.value] = code;
  remappingAction.value = null;
  persistBindings();
}

onMounted(() => {
  window.addEventListener('keydown', onRemapKeyDown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onRemapKeyDown, true);
});

function resetToDefaults() {
  keyBindings.value = cloneDefaults();
  persistBindings();
}
</script>


