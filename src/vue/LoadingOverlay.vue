<template>
  <div v-if="menu.loadingVisible" class="absolute inset-0 flex items-center justify-center pointer-events-auto bg-black/60 backdrop-blur-sm">
    <div class="flex flex-col items-center gap-2 p-4 rounded-xl bg-black/70 border border-white/10">
      <div class="w-8 h-8 rounded-full border-4 border-white/25 border-t-white animate-spin" aria-hidden="true"></div>
      <div class="text-white text-sm drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)] select-none">{{ menu.loadingMessage || 'Loading…' }}</div>
    </div>
  </div>
</template>

<script setup>
import { useMenuStore } from './store.js';

const menu = useMenuStore();
</script>

