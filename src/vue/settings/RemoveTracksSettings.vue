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
            <span v-else class="ml-2 rounded bg-[#5cd6a411] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#7fd6b0]">local</span>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              class="rounded-md border border-white/20 bg-white/5 px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#cbd5e1] transition-colors hover:bg-white/10"
              @click="onDownload(t)"
            >
              Download
            </button>
            <button
              class="rounded-md border border-[#e0555577] bg-[#e6151522] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#ff9a9a] transition-colors hover:bg-[#e6151544]"
              @click="pendingDelete = t"
            >
              {{ t.isBuiltin ? 'Revert' : 'Remove' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <hr class="my-4 opacity-60">

    <button class="menu-button menu-button-muted px-10 py-4 text-2xl mt-2" @click="$emit('back')">Back</button>

    <ConfirmDialog
      v-if="pendingDelete"
      :title="pendingDelete.isBuiltin ? 'REVERT TRACK?' : 'REMOVE TRACK?'"
      @confirm="onConfirmDelete"
      @cancel="pendingDelete = null"
    >
      <template v-if="pendingDelete.isBuiltin">
        This will discard your local edits to <b>{{ pendingDelete.name }}</b> and restore the built-in track.
      </template>
      <template v-else>
        This will permanently remove <b>{{ pendingDelete.name }}</b> and its lap records.
      </template>
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
    .map(key => {
      const track = trackLoader.tracks.get(key);
      const isBuiltin = trackLoader.builtinKeys.has(key);
      return {
        key,
        name: track?.name ?? key,
        image: track?.image ?? null,
        packId: track?.packId ?? null,
        packLabel: packLabel(track?.packId),
        isBuiltin,
        hasLocalEdit: trackLoader.hasStoredTrack(key),
      };
    })
    // Show pack-imported tracks, editor-created tracks, and built-in tracks
    // that were edited & saved to localStorage. Hide untouched built-ins.
    .filter(t => !t.isBuiltin || t.hasLocalEdit)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function onDownload(t) {
  const trackLoader = window.trackLoader;
  if (!trackLoader) return;
  const track = trackLoader.getTrack(t.key);
  if (track) trackLoader.downloadTrack(track);
}

async function onConfirmDelete() {
  const t = pendingDelete.value;
  if (!t) return;

  const trackLoader = window.trackLoader;
  if (t.isBuiltin) {
    // Built-in track with local edits: discard the edits, keep the track and
    // its lap records.
    if (trackLoader) await trackLoader.revertTrack(t.key);
  } else {
    if (trackLoader) trackLoader.removeTrack(t.key);
    if (t.image) removeStoredTrackImage(t.image);
    deleteHotLapRecords(t.key, false);
    deleteHotLapRecords(t.key, true);
  }

  pendingDelete.value = null;
  refresh();
  store.refreshTrackList();
}

refresh();
</script>
