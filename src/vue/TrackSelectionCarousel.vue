
<template>
  <div class="w-full min-w-0 space-y-3">
    <h3 class="mb-2 text-xs uppercase italic tracking-[0.14em] text-white text-center">Track Selection</h3>
    <div v-if="availablePacks.length > 1" class="flex justify-center gap-2 flex-wrap">
      <button
        v-for="pack in packOptions"
        :key="pack.value"
        type="button"
        class="px-3 py-1 text-xs rounded-full border transition duration-150"
        :class="selectedPack === pack.value
          ? 'border-amber-400 bg-amber-400 text-black font-bold'
          : 'border-[#555] bg-[#1a1a1a] text-slate-300 hover:border-white hover:text-white'"
        @click="setPackFilter(pack.value)"
      >{{ pack.label }}</button>
    </div>
    <div class="relative overflow-hidden flex ">
      <button
        type="button"
        class="rounded-3xl border-2 border-[#444] bg-[#101010] px-2 py-2.5 text-[48px] text-base font-bold text-white transition duration-200 [-webkit-text-stroke:1px_#000] hover:border-white hover:text-[#ffe066]"
        @click="selectAdjacent(-1)"
        :disabled="!canSelectLeft"
        aria-label="Select previous track"
      >
        ‹
      </button>

      <div
        ref="scroller"
        class="flex w-full min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto px-14 py-4 scrollbar-none"
        @scroll="updateScrollState"
      >
      <button
          v-for="track in displayTracks"
          :key="track.key"
          type="button"
          :data-track-key="track.key"
          class="min-w-[160px] max-w-[180px] rounded-xl transition"
          :class="track.key === modelValue ? ' border-2 border-amber-400' : ''"
          @click="selectTrack(track.key)"
        >
          <div class="h-32 overflow-hidden rounded-2xl">
            <img
              v-if="track.image"
              :src="track.image"
              :alt="track.name"
              class="h-full w-full object-cover"
            />
            <div v-else class="flex h-full items-center justify-center bg-slate-800 text-slate-500 text-xs uppercase tracking-[0.15em]">No image</div>
          </div>
          <div class="mt-2 truncate text-sm font-semibold text-white text-center">{{ track.name }}</div>
        </button>
      </div>
      <button
        type="button"
        class="rounded-3xl border-2 border-[#444] bg-[#101010] px-2 py-2.5 text-[48px] text-base font-bold text-white transition duration-200 [-webkit-text-stroke:1px_#000] hover:border-white hover:text-[#ffe066]"
        @click="selectAdjacent(1)"
        :disabled="!canSelectRight"
        aria-label="Select next track"
      >
        ›
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue';

const props = defineProps({
  tracks: {
    type: Array,
    default: () => [],
  },
  modelValue: {
    type: String,
    default: null,
  },
});
const emit = defineEmits(['update:modelValue']);

const scroller = ref(null);
const scrollPosition = ref(0);
const selectedPack = ref('all');

const availablePacks = computed(() => {
  const packs = new Set();
  for (const t of props.tracks) {
    if (t.packId) packs.add(t.packId);
  }
  return [...packs].sort();
});

const packOptions = computed(() => [
  { value: 'all', label: 'All' },
  ...availablePacks.value.map(p => ({ value: p, label: p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })),
]);

function setPackFilter(pack) {
  selectedPack.value = pack;
  // If current selection is no longer visible, pick first in filtered list
  if (props.modelValue && !filteredTracks.value.find(t => t.key === props.modelValue)) {
    if (filteredTracks.value.length > 0) emit('update:modelValue', filteredTracks.value[0].key);
  }
}

const filteredTracks = computed(() => {
  return props.tracks.filter(track => {
    const trackData = window.trackLoader?.getTrack(track.key);
    if (!trackData || trackData.hidden === true) return false;
    if (selectedPack.value !== 'all' && track.packId !== selectedPack.value) return false;
    return true;
  });
});

const displayTracks = computed(() => {
  return filteredTracks.value.map(trackData => ({
    key: trackData.key,
    name: trackData.name,
    image: trackData?.image ? `${import.meta.env.BASE_URL}tracks/${trackData.image}` : null,
  }));
});

const selectedIndex = computed(() => {
  return displayTracks.value.findIndex(track => track.key === props.modelValue);
});

const canSelectLeft = computed(() => selectedIndex.value > 0);
const canSelectRight = computed(() => selectedIndex.value >= 0 && selectedIndex.value < displayTracks.value.length - 1);

function selectTrack(key) {
  emit('update:modelValue', key);
}

function selectAdjacent(direction) {
  const index = selectedIndex.value;
  if (index === -1) {
    if (direction > 0 && displayTracks.value.length > 0) {
      selectTrack(displayTracks.value[0].key);
    }
    return;
  }
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= displayTracks.value.length) return;
  selectTrack(displayTracks.value[nextIndex].key);
}

function centerSelectedTrack() {
  const element = scroller.value;
  if (!element || !props.modelValue) return;
  const selectedButton = element.querySelector(`[data-track-key="${props.modelValue}"]`);
  if (!selectedButton) return;

  const targetCenter = selectedButton.offsetLeft + selectedButton.offsetWidth / 4;
  const scrollTo = targetCenter - element.clientWidth / 2;
  element.scrollTo({ left: scrollTo, behavior: 'smooth' });
}

function updateScrollState() {
  const element = scroller.value;
  if (!element) return;
  scrollPosition.value = element.scrollLeft;
}

function scroll(direction) {
  const element = scroller.value;
  if (!element) return;
  const amount = element.clientWidth * 0.75;
  element.scrollBy({ left: direction * amount, behavior: 'smooth' });
  requestAnimationFrame(() => {
    setTimeout(updateScrollState, 150);
  });
}

onMounted(() => {
  updateScrollState();
  centerSelectedTrack();
});

watch(() => props.modelValue, () => {
  centerSelectedTrack();
});

watch(displayTracks, () => {
  centerSelectedTrack();
});
</script>

<style scoped>
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
.scrollbar-none {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
