<template>
  <div class="display-settings px-12 py-10 text-center">
    <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Display</h2>

    <div class="select-list flex flex-col gap-7 items-stretch mb-8">
      <div class="select-row flex items-center gap-6">
        <div class="select-label grow text-right text-xl font-bold italic uppercase text-white pr-4">Shadow Detail</div>
        <select v-model="shadow" class="select">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <div class="select-row flex items-center gap-6">
        <div class="select-label grow text-right text-xl font-bold italic uppercase text-white pr-4">Stadium Lights</div>
        <select v-model.number="lights" class="select">
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
import { ref } from 'vue';
const shadow = ref('medium');
const lights = ref(4);
</script>

<style scoped>
.display-settings {
  /* menu-panel styles already applied */
  width: min(90vw, 480px);
  margin: 0 auto;
  background-blend-mode: multiply;
}
.select-list {
  width: 100%;
}
.select-row {
  width: 100%;
}
.select-label {
  min-width: 140px;
}
.select {
  flex: 0 0 180px;
  padding: 0.5rem 1.5rem;
  border-radius: 6px;
  border: 1.5px solid #333;
  background: #222;
  color: #fff;
  font-size: 1.1rem;
  font-family: inherit;
  font-weight: 700;
  text-transform: uppercase;
  font-style: italic;
  letter-spacing: 0.08em;
  outline: none;
  transition: border-color 0.2s;
}
.select:focus {
  border-color: #ffd400;
}
</style>
