<template>
  <div class="w-full min-w-0 space-y-3">
    <div class="relative overflow-hidden flex ">
      <button
        type="button"
        class="z-20 inline-flex w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-white transition hover:bg-slate-800"
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
          class="min-w-[160px] max-w-[180px] rounded-xl transition border-2"
          :class="track.key === modelValue ? ' border-amber-400 bg-slate-800' : 'border-slate-700 bg-slate-900'"
          @click="selectTrack(track.key)"
        >
          <div class="h-32 overflow-hidden rounded-2xl bg-slate-950">
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
        class="z-20 inline-flex w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-white transition hover:bg-slate-800"
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

const displayTracks = computed(() => {
  return props.tracks.map(track => {
    const trackData = window.trackLoader?.getTrack(track.key);
    return {
      key: track.key,
      name: track.name,
      image: trackData?.image ? `/tracks/${trackData.image}` : null,
    };
  });
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
