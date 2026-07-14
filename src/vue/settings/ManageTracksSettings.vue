<template>
  <LapRecordsSettings v-if="subScreen === 'lapRecords'" @back="subScreen = ''" />
  <RemoveTracksSettings v-else-if="subScreen === 'removeTracks'" @back="subScreen = ''" />

  <div v-else class="w-[min(90vw,480px)] mx-auto px-12 py-10 text-center">
    <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Manage Tracks</h2>

    <div class="w-full flex flex-col gap-5 items-stretch mb-8">
      <button class="menu-button px-10 py-4 text-2xl" @click="subScreen = 'lapRecords'">Lap Records</button>
      <button class="menu-button px-10 py-4 text-2xl" @click="subScreen = 'removeTracks'">Remove Tracks</button>
      <button class="menu-button px-10 py-4 text-2xl" @click="onLoadTracks" :disabled="loading">
        {{ loading ? 'Loading…' : 'Load Track Pack' }}
      </button>
    </div>

    <p v-if="statusMessage" class="text-[#ffd400] text-sm font-bold italic uppercase tracking-wide mb-3">
      {{ statusMessage }}
    </p>

    <hr class="my-4 opacity-60">

    <button class="menu-button menu-button-muted px-10 py-4 text-2xl mt-2" @click="$emit('back')">Back</button>

    <input
      ref="fileInput"
      type="file"
      accept=".zip"
      class="hidden"
      @change="onFileSelected"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import LapRecordsSettings from './LapRecordsSettings.vue';
import RemoveTracksSettings from './RemoveTracksSettings.vue';
import { loadTrackPack } from '../../managers/TrackPackLoader.js';
import { useMenuStore } from '../stores/menu.js';

const store = useMenuStore();
const statusMessage = ref('');
const subScreen = ref('');
const loading = ref(false);
const fileInput = ref(null);

function onLoadTracks() {
  fileInput.value?.click();
}

async function onFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  fileInput.value.value = '';

  loading.value = true;
  statusMessage.value = '';

  try {
    const trackLoader = window.trackLoader;
    if (!trackLoader) throw new Error('TrackLoader not available');

    const result = await loadTrackPack(file, trackLoader);

    if (result.loaded > 0) {
      store.refreshTrackList();
    }

    if (result.errors.length > 0) {
      statusMessage.value = `Loaded ${result.loaded} track(s) with ${result.errors.length} error(s)`;
      console.warn('[TrackPack] Errors:', result.errors);
    } else {
      statusMessage.value = `Loaded ${result.loaded} track(s) from ${file.name}`;
    }
  } catch (e) {
    statusMessage.value = `Failed to load track pack: ${e.message}`;
    console.error('[TrackPack]', e);
  } finally {
    loading.value = false;
  }
}
</script>
