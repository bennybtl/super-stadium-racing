<template>
  <div class="w-[min(90vw,480px)] mx-auto px-4 py-10 text-center">
    <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Lap Records</h2>

    <p v-if="tracks.length === 0" class="text-[#cbb] italic uppercase tracking-wide mb-8">
      No lap records saved yet.
    </p>

    <div v-else class="w-full flex flex-col gap-3 items-stretch mb-8">
      <div
        v-for="t in tracks"
        :key="t.trackKey + (t.reverse ? '::rev' : '')"
        class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left"
      >
        <div class="flex items-center gap-2">
          <span class="truncate font-bold uppercase tracking-wide text-white">{{ t.name }}</span>
          <span v-if="t.reverse" class="shrink-0 rounded bg-[#ffe06622] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#ffe066]">Rev</span>
        </div>
        <div class="mt-1 flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1 truncate font-mono text-sm text-[#8ab4f8] tabular-nums">
            Best {{ formatLapTime(t.records[0].lapTimeMs) }}
            <span class="text-[#8a8a8a]">· {{ t.records.length }} lap{{ t.records.length === 1 ? '' : 's' }}</span>
          </div>
          <button
            class="shrink-0 rounded-md border border-[#e0555577] bg-[#e6151522] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#ff9a9a] transition-colors hover:bg-[#e6151544]"
            @click="pendingDelete = t"
          >
            Delete
          </button>
        </div>
      </div>
    </div>

    <hr class="my-4 opacity-60">

    <button class="menu-button menu-button-muted px-10 py-4 text-2xl mt-2" @click="$emit('back')">Back</button>

    <ConfirmDialog
      v-if="pendingDelete"
      title="DELETE LAP RECORDS?"
      @confirm="onConfirmDelete"
      @cancel="pendingDelete = null"
    >
      This permanently removes all saved laps and the ghost for
      <b>{{ pendingDelete.label }}</b>.
    </ConfirmDialog>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import ConfirmDialog from '../ConfirmDialog.vue';
import { formatLapTime } from '../formatTime.js';
import { listHotLapTracks, deleteHotLapRecords } from '../../managers/HotLapStorage.js';

const tracks = ref([]);
const pendingDelete = ref(null);

function trackName(trackKey) {
  return window.trackLoader?.getTrack?.(trackKey)?.name ?? trackKey;
}

function refresh() {
  tracks.value = listHotLapTracks()
    .map(t => {
      const name = trackName(t.trackKey);
      return { ...t, name, label: name + (t.reverse ? ' (Reverse)' : '') };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function onConfirmDelete() {
  if (pendingDelete.value) {
    deleteHotLapRecords(pendingDelete.value.trackKey, pendingDelete.value.reverse);
  }
  pendingDelete.value = null;
  refresh();
}

refresh();
</script>
