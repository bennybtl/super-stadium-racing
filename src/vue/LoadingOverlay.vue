<template>
  <Modal :open="menu.loadingVisible">
    <img
      :src="wheelSrc"
      alt=""
      aria-hidden="true"
      class="h-16 w-16 select-none animate-spin [animation-duration:0.9s] [filter:brightness(1.7)] drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
    />
    <div class="select-none text-sm text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
      {{ menu.loadingMessage || 'Loading…' }}
    </div>
  </Modal>
</template>

<script setup>
import { useMenuStore } from './store.js';
import Modal from './Modal.vue';

const menu = useMenuStore();
const wheelSrc = new URL('../assets/wheel.png', import.meta.url).href;
</script>
