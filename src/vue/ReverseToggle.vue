<template>
  <button
    class="rounded-[10px] border-2 bg-[#101010] px-3 py-2.5 text-base font-bold uppercase italic tracking-[0.1em] text-white transition duration-200 [-webkit-text-stroke:1px_#000] hover:scale-[1.01] hover:border-white hover:text-[#ffe066]"
    :class="store.selectedReverse ? 'border-[#ffe066] text-[#ffe066]' : 'border-[#444]'"
    @click="store.setSelectedReverse(!store.selectedReverse)"
  >
    <i class="bi mr-1"
      :class="{
        'bi-square-fill': !store.selectedReverse,
        'bi-check-square-fill': store.selectedReverse
      }"></i> Reverse
  </button>
</template>

<script setup>
import { useMenuStore } from './store.js';

const store = useMenuStore();
</script>
