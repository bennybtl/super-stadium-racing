<template>
  <div class="tracks-settings px-12 py-10 text-center">
    <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Manage Tracks</h2>

    <div class="tracks-actions flex flex-col gap-5 items-stretch mb-8">
      <button class="menu-button px-10 py-4 text-2xl opacity-60 cursor-not-allowed" disabled>Load Tracks (zip)</button>
      <button class="menu-button px-10 py-4 text-2xl opacity-60 cursor-not-allowed" disabled>Export Tracks (zip)</button>
      <button class="menu-button px-10 py-4 text-2xl opacity-60 cursor-not-allowed" disabled>Reset Tracks</button>
    </div>

    <hr class="my-4 opacity-60">

    <button class="menu-button menu-button-muted px-10 py-4 text-2xl mt-2" @click="$emit('back')">Back</button>
  </div>
</template>

<script setup>
// UI only, no logic yet
</script>

<style scoped>
.tracks-settings {
  /* menu-panel styles already applied */
  width: min(90vw, 480px);
  margin: 0 auto;
  background-blend-mode: multiply;
}
.tracks-actions {
  width: 100%;
}
</style>
