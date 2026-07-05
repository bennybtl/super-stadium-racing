<template>
  <button
    type="button"
    class="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-[#555] bg-[#1a1a1a] px-4 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-slate-200 transition duration-150 hover:border-white hover:text-white"
    @click="open"
  >
    <i class="bi bi-trophy-fill text-[#ffd24a]"></i>
    <span v-if="bestMs != null" class="font-mono tabular-nums normal-case tracking-normal text-[#ffd24a]">{{ formatLapTime(bestMs) }}</span>
    <span v-else>No Lap Records</span>
  </button>

  <Teleport to="body">
    <div
      v-if="showModal"
      class="fixed inset-0 z-[2100] flex items-center justify-center bg-black/90 pointer-events-auto"
      @click.self="close"
    >
      <div class="bg-slate-950/95 border-3 border-red-500 rounded-3xl p-10 min-w-[420px] max-w-[600px] shadow-[0_12px_48px_rgba(0,0,0,0.7)]">
        <h2 class="text-red-400 uppercase tracking-[0.28em] text-sm text-center mb-2">Lap Records</h2>
        <p class="text-center text-xs text-slate-400 tracking-[0.18em] mb-6">{{ trackName }}</p>

        <p v-if="!forward.length && !reverse.length" class="text-center text-slate-400 italic uppercase tracking-wide mb-7">
          No lap records yet.
        </p>

        <template v-else>
          <section v-for="board in boards" :key="board.label" class="mb-6 last:mb-7">
            <h3 v-if="showBoardLabels" class="text-[11px] uppercase tracking-[0.2em] text-[#8ab4f8] mb-1">{{ board.label }}</h3>
            <table class="w-full border-collapse text-sm text-slate-200">
              <thead>
                <tr class="text-slate-400 text-[11px] uppercase tracking-[0.2em]">
                  <th class="py-2 px-3 text-left border-b border-slate-800">#</th>
                  <th class="py-2 px-3 text-left border-b border-slate-800">Truck</th>
                  <th class="py-2 px-3 text-right border-b border-slate-800">Time</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(rec, i) in board.records" :key="i" :class="{ 'text-white': i === 0 }">
                  <td class="py-2 px-3 font-semibold text-red-400">{{ i + 1 }}</td>
                  <td class="py-2 px-3">{{ truckName(rec.truckType) }}</td>
                  <td class="py-2 px-3 text-right font-mono tabular-nums" :class="i === 0 ? 'text-[#ffd24a]' : ''">{{ formatLapTime(rec.lapTimeMs) }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </template>

        <button
          class="mx-auto block rounded-2xl bg-gradient-to-b from-red-500 to-red-700 px-10 py-3 text-lg font-bold uppercase tracking-[0.2em] text-white shadow-lg shadow-red-950/30 transition hover:from-red-400 hover:to-red-600"
          @click="close"
        >
          Close
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { formatLapTime } from './formatTime.js';
import { loadHotLapRecords } from '../managers/HotLapStorage.js';

const props = defineProps({
  trackKey: { type: String, default: null },
});

const showModal = ref(false);
const forward = ref([]);
const reverse = ref([]);

const boards = computed(() => [
  { label: 'Forward', records: forward.value },
  { label: 'Reverse', records: reverse.value },
].filter(b => b.records.length > 0));

const showBoardLabels = computed(() => forward.value.length > 0 && reverse.value.length > 0);

// Best forward time drives the button label; recomputes when the track changes.
const bestMs = computed(() => {
  bestBump.value; // reactive dependency so the button refreshes after the modal closes
  if (!props.trackKey) return null;
  return loadHotLapRecords(props.trackKey, false)[0]?.lapTimeMs ?? null;
});
const bestBump = ref(0);

function truckName(truckType) {
  return window.vehicleLoader?.getVehicle?.(truckType)?.name ?? truckType;
}

const trackName = computed(() => window.trackLoader?.getTrack?.(props.trackKey)?.name ?? props.trackKey);

function open() {
  forward.value = loadHotLapRecords(props.trackKey, false);
  reverse.value = loadHotLapRecords(props.trackKey, true);
  showModal.value = true;
}

function close() {
  showModal.value = false;
  bestBump.value++; // re-read the best time in case it changed
}

watch(() => props.trackKey, () => { bestBump.value++; });
</script>
