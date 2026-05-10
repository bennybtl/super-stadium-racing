<template>
  <div class="w-[min(90vw,480px)] mx-auto px-12 py-10 text-center">
    <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Sound</h2>

    <div class="flex flex-col gap-7 items-stretch mb-8">
      <div class="w-full flex items-center gap-6">
        <div class="grow min-w-[140px] text-right text-xl font-bold italic uppercase text-white pr-4">Engine Volume</div>
        <input type="range" min="0" max="100" v-model="engine" class="basis-[180px] shrink-0 accent-[#ffd400] h-1 rounded bg-[#222]" />
        <span class="min-w-10 inline-block w-12 text-left text-lg font-mono text-yellow-300 pl-2">{{ engine }}</span>
      </div>
      <div class="w-full flex items-center gap-6">
        <div class="grow min-w-[140px] text-right text-xl font-bold italic uppercase text-white pr-4">Effects Volume</div>
        <input type="range" min="0" max="100" v-model="effects" class="basis-[180px] shrink-0 accent-[#ffd400] h-1 rounded bg-[#222]" />
        <span class="min-w-10 inline-block w-12 text-left text-lg font-mono text-yellow-300 pl-2">{{ effects }}</span>
      </div>
      <div class="w-full flex items-center gap-6">
        <div class="grow min-w-[140px] text-right text-xl font-bold italic uppercase text-white pr-4">Music Volume</div>
        <input type="range" min="0" max="100" v-model="music" class="basis-[180px] shrink-0 accent-[#ffd400] h-1 rounded bg-[#222]" />
        <span class="min-w-10 inline-block w-12 text-left text-lg font-mono text-yellow-300 pl-2">{{ music }}</span>
      </div>
    </div>

    <hr class="my-4 opacity-60">

    <button class="menu-button menu-button-muted px-10 py-4 text-2xl mt-2" @click="$emit('back')">Back</button>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { loadAudioSettings, saveAudioSettings } from '../../settingsStorage.js';

const audioSettings = loadAudioSettings();
const engine = ref(audioSettings.engine);
const effects = ref(audioSettings.effects);
const music = ref(audioSettings.music);

watch([engine, effects, music], () => {
  saveAudioSettings({
    engine: engine.value,
    effects: effects.value,
    music: music.value,
  });
});
</script>
