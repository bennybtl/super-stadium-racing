<template>
  <div class="w-[min(90vw,480px)] mx-auto px-12 py-10 text-center">
    <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Display</h2>

    <div class="flex flex-col gap-7 items-stretch mb-8">
      <div class="flex items-center gap-6">
        <div class="grow min-w-[140px] text-right text-xl font-bold italic uppercase text-white pr-4">Shadow Detail</div>
        <select v-model="shadow" class="w-[180px] shrink-0 px-6 py-2 rounded-md border border-[#333] bg-[#222] text-white text-lg font-bold uppercase italic tracking-wider outline-none transition-colors focus:border-[#ffd400]">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <div class="flex items-center gap-6">
        <div class="grow min-w-[140px] text-right text-xl font-bold italic uppercase text-white pr-4">Stadium Lights</div>
        <select v-model.number="lights" class="w-[180px] shrink-0 px-6 py-2 rounded-md border border-[#333] bg-[#222] text-white text-lg font-bold uppercase italic tracking-wider outline-none transition-colors focus:border-[#ffd400]">
          <option :value="1">1</option>
          <option :value="4">4</option>
          <option :value="6">6</option>
        </select>
      </div>
    </div>

    <hr class="my-4 opacity-60">

    <button class="menu-button menu-button-muted px-10 py-4 text-2xl mt-2" @click="$emit('back')">Back</button>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { loadDisplaySettings, saveDisplaySettings } from '../../settingsStorage.js';

const displaySettings = loadDisplaySettings();
const shadow = ref(displaySettings.shadow);
const lights = ref(displaySettings.lights);

watch([shadow, lights], () => {
  saveDisplaySettings({
    shadow: shadow.value,
    lights: lights.value,
  });
});
</script>
