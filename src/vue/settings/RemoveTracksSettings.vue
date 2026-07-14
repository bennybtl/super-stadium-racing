<template>
  <div class="w-[min(90vw,480px)] mx-auto px-4 py-10 text-center">
    <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Remove Tracks</h2>

    <p v-if="tracks.length === 0" class="text-[#cbb] italic uppercase tracking-wide mb-8">
      No removable tracks found.
    </p>

    <div v-else class="w-full flex flex-col gap-3 items-stretch mb-8">
      <div
        v-for="t in tracks"
        :key="t.key"
        class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <span class="truncate font-bold uppercase tracking-wide text-white">{{ t.name }}</span>
            <span v-if="t.packId" class="ml-2 rounded bg-[#ffffff11] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#aaa]">{{ t.packLabel }}</span>
          </div>
          <button
            class="shrink-0 rounded-md border border-[#e0555577] bg-[#e6151522] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#ff9a9a] transition-colors hover:bg-[#e6151544]"
            @click="pendingDelete = t"
          >
            Remove
          </button>
        </div>
      </div>
    </div>

    <hr class="my-4 opacity-60">

    <button class="menu-button menu-button-muted px-10 py-4 text-2xl mt-2" @click="$emit('back')">Back</button>

    <ConfirmDialog
      v-if="pendingDelete"
      title="REMOVE TRACK?"
      @confirm="onConfirmDelete"
      @cancel="pendingDelete = null"
    >
      This will permanently remove <b>{{ pendingDelete.name }}</b> and its lap records.
    </ConfirmDialog>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import ConfirmDialog from '../ConfirmDialog.vue';
import { deleteHotLapRecords } from '../../managers/HotLapStorage.js';
import { removeStoredTrackImage } from '../../managers/TrackPackLoader.js';
import { useMenuStore } from '../stores/menu.js';

const store = useMenuStore();
const tracks = ref([]);
const pendingDelete = ref(null);

function packLabel(packId) {
  if (!packId) return '';
  return packId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function refresh() {
  const trackLoader = window.trackLoader;
  if (!trackLoader) return;

  tracks.value = trackLoader.getTrackList()
    .filter(key => !trackLoader.builtinKeys.has(key))
    .map(key => {
      const track = trackLoader.tracks.get(key);
      return {
        key,
        name: track?.name ?? key,
        image: track?.image ?? null,
        packId: track?.packId ?? null,
        packLabel: packLabel(track?.packId),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function onConfirmDelete() {
  const t = pendingDelete.value;
  if (!t) return;

  const trackLoader = window.trackLoader;
  if (trackLoader) {
    trackLoader.removeTrack(t.key);
  }

  if (t.image) removeStoredTrackImage(t.image);
  deleteHotLapRecords(t.key, false);
  deleteHotLapRecords(t.key, true);

  pendingDelete.value = null;
  refresh();
  store.refreshTrackList();
}

refresh();
</script>
