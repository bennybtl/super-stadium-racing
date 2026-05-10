<template>
  <div class="w-[min(90vw,480px)] mx-auto px-12 py-10 text-center">
    <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Manage Tracks</h2>

    <div class="w-full flex flex-col gap-5 items-stretch mb-8">
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
