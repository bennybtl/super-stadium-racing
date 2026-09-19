<template>
  <button
    class="rounded-[10px] border-2 bg-[#101010] px-3 py-2.5 text-base font-bold uppercase italic tracking-[0.1em] text-white transition duration-200"
    :class="allowed
      ? ['hover:scale-[1.01] hover:border-white hover:text-[#ffe066]', store.selectedReverse ? 'border-[#ffe066] text-[#ffe066]' : 'border-[#444]']
      : 'cursor-not-allowed opacity-40 border-[#444]'"
    :disabled="!allowed"
    :title="allowed ? '' : 'This track doesn\'t support reverse'"
    @click="allowed && store.setSelectedReverse(!store.selectedReverse)"
  >
    <i class="bi mr-1"
      :class="{
        'bi-square-fill': !store.selectedReverse,
        'bi-check-square-fill': store.selectedReverse
      }"></i> Reverse
  </button>
</template>

<script setup>
import { computed, watch } from 'vue';
import { useMenuStore } from './store.js';

const store = useMenuStore();

const allowed = computed(() => {
  const track = store.trackList.find(t => t.key === store.selectedTrack);
  return track?.allowReverse !== false;
});

watch(allowed, (val) => {
  if (!val && store.selectedReverse) store.setSelectedReverse(false);
});
</script>
