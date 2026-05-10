<template>
  <div class="sound-settings px-12 py-10 text-center">
    <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Sound</h2>

    <div class="slider-list flex flex-col gap-7 items-stretch mb-8">
      <div class="slider-row flex items-center gap-6">
        <div class="slider-label grow text-right text-xl font-bold italic uppercase text-white pr-4">Engine Volume</div>
        <input type="range" min="0" max="100" v-model="engine" class="slider" />
        <span class="slider-value w-12 text-left text-lg font-mono text-yellow-300 pl-2">{{ engine }}</span>
      </div>
      <div class="slider-row flex items-center gap-6">
        <div class="slider-label grow text-right text-xl font-bold italic uppercase text-white pr-4">Effects Volume</div>
        <input type="range" min="0" max="100" v-model="effects" class="slider" />
        <span class="slider-value w-12 text-left text-lg font-mono text-yellow-300 pl-2">{{ effects }}</span>
      </div>
      <div class="slider-row flex items-center gap-6">
        <div class="slider-label grow text-right text-xl font-bold italic uppercase text-white pr-4">Music Volume</div>
        <input type="range" min="0" max="100" v-model="music" class="slider" />
        <span class="slider-value w-12 text-left text-lg font-mono text-yellow-300 pl-2">{{ music }}</span>
      </div>
    </div>

    <hr class="my-4 opacity-60">

    <button class="menu-button menu-button-muted px-10 py-4 text-2xl mt-2" @click="$emit('back')">Back</button>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const engine = ref(80);
const effects = ref(80);
const music = ref(0);
</script>

<style scoped>
.sound-settings {
  /* menu-panel styles already applied */
  width: min(90vw, 480px);
  margin: 0 auto;
  background-blend-mode: multiply;
}
.slider-list {
  width: 100%;
}
.slider-row {
  width: 100%;
}
.slider-label {
  min-width: 140px;
}
.slider {
  flex: 0 0 180px;
  accent-color: #ffd400;
  height: 4px;
  border-radius: 2px;
  background: #222;
}
.slider-value {
  min-width: 2.5rem;
  display: inline-block;
}
</style>
