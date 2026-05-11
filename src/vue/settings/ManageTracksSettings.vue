<template>
  <div class="w-[min(90vw,480px)] mx-auto px-12 py-10 text-center">
    <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Manage Tracks</h2>

    <div class="w-full flex flex-col gap-5 items-stretch mb-8">
      <button class="menu-button px-10 py-4 text-2xl" @click="onLoadTracks">Load Tracks</button>
      <button class="menu-button px-10 py-4 text-2xl" @click="onExportTracks">Export Tracks</button>
      <button class="menu-button px-10 py-4 text-2xl" @click="showResetConfirm = true">Reset Tracks</button>
    </div>

    <p v-if="statusMessage" class="text-[#ffd400] text-sm font-bold italic uppercase tracking-wide mb-3">
      {{ statusMessage }}
    </p>

    <hr class="my-4 opacity-60">

    <button class="menu-button menu-button-muted px-10 py-4 text-2xl mt-2" @click="$emit('back')">Back</button>

    <ConfirmDialog
      v-if="showResetConfirm"
      title="ARE YOU SURE?"
      @confirm="onConfirmReset"
      @cancel="showResetConfirm = false"
    >
      Reset tracks support is planned for a later phase.
    </ConfirmDialog>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import ConfirmDialog from '../ConfirmDialog.vue';

const showResetConfirm = ref(false);
const statusMessage = ref('');

function showComingSoon(message) {
  statusMessage.value = message;
}

function onLoadTracks() {
  showComingSoon('Load Tracks coming in Phase 5');
}

function onExportTracks() {
  showComingSoon('Export Tracks coming in Phase 5');
}

function onConfirmReset() {
  showResetConfirm.value = false;
  showComingSoon('Reset Tracks coming in Phase 5');
}
</script>
