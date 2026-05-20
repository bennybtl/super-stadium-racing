<template>
  <h3 class="mb-2 text-xs uppercase italic tracking-[0.14em] text-white">Purchase Upgrades</h3>
  <div class="mb-6 grid grid-cols-1 items-start gap-2 sm:grid-cols-2 lg:grid-cols-3">
    <div
      v-for="u in store.upgrades"
      :key="u.id"
      class="text-xs uppercase italic tracking-[0.14em] text-white">
      <template v-if="u.id === 'nitro'">
        <span>{{ u.level }} / {{ u.maxLevel }}</span>
      </template>
      <template v-else>
        <span v-for="n in u.maxLevel" :key="n">{{ n <= u.level ? '●' : '○' }}</span>
      </template>

      <button
        class="w-full rounded-[10px] flex-grow border-2 border-[#444] bg-[#101010] px-3 py-1 text-base font-bold uppercase italic tracking-[0.1em] text-white transition duration-200 hover:scale-[1.02] hover:border-white hover:text-[#ffe066]"
        :class="!disablePurchase(u) ? 'hover:bg-[#222] hover:border-white hover:text-[#ffe066]' : 'cursor-not-allowed'"
        :disabled="disablePurchase(u)"
        @click="store.purchaseUpgrade(u.id)"
      >
          {{  u.label }}
        <template v-if="u.level >= u.maxLevel">MAX</template>
        <template v-else>${{ u.cost.toLocaleString() }}</template>
      </button>
    </div>
    <div
      class="text-xs uppercase italic tracking-[0.14em] text-white">
      &nbsp;
      <button @click="store.resetUpgrades()" 
        class="w-full rounded-[10px] flex-grow border-2 border-[#444] bg-[#101010] px-3 py-1 text-base font-bold uppercase italic tracking-[0.1em] text-white transition duration-200 hover:scale-[1.02] hover:border-white hover:text-[#ffe066]">
        RESET</button>
    </div>
  </div>
</template>

<script setup>
  import { computed, onMounted, onUnmounted } from 'vue';
  import { useMenuStore } from './store.js';

  const store = useMenuStore();

  const disablePurchase = (u) => {
      return u.level >= u.maxLevel || (!u.affordable && store.mode !== 'practice');
  };
</script>