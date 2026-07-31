<template>
  <div>
    <h3 class="mb-2 text-xs uppercase italic tracking-[0.14em] text-white">Purchase Upgrades</h3>
    <div class="flex flex-row justify-center">
      <section class="flex flex-1 flex-col gap-4 max-w-[512px]">
        <div
          v-for="u in store.upgrades"
          :key="u.id"
          class="text-xs uppercase italic items-center tracking-[0.14em] text-white min-w-0 flex flex-row basis-0">
          <div
              class="text-right flex-1 text-base font-bold uppercase italic tracking-[0.1em] text-white"      
            >
            {{ u.label }}
          </div>
          <div class="text-right flex-1 px-3 py-1 text-base font-bold uppercase italic tracking-[0.1em] text-white">
            <template v-if="u.id === 'nitro'">
              <span>{{ u.level }} / {{ u.maxLevel }}</span>
            </template>
            <template v-else>
              <span v-for="n in u.maxLevel" :key="n">{{ n <= u.level ? '●' : '○' }}</span>
            </template>
          </div>
          <div class="text-left flex-1 mx-4">
            <button
              class="w-full rounded-[10px] flex-grow border-2 border-[#444] bg-[#101010] px-3 py-1 text-base font-bold uppercase italic tracking-[0.1em] text-white transition duration-200 hover:scale-[1.02] hover:border-white hover:text-[#ffe066]"
              :class="!disablePurchase(u) ? 'hover:bg-[#222] hover:border-white hover:text-[#ffe066]' : 'cursor-not-allowed'"
              :disabled="disablePurchase(u)"
              @click="store.purchaseUpgrade(u.id)"
            >
              <template v-if="u.level >= u.maxLevel">MAX</template>
              <template v-else>${{ u.cost.toLocaleString() }}</template>
            </button>
          </div>
        </div>
        <div
          v-if="store.mode !== 'championship'"
          class="text-xs uppercase italic tracking-[0.14em] text-white">
          &nbsp;
          <button @click="store.resetUpgrades()"
            class="w-full rounded-[10px] flex-grow border-2 border-[#444] bg-[#101010] px-3 py-1 text-base font-bold uppercase italic tracking-[0.1em] text-white transition duration-200 hover:scale-[1.02] hover:border-white hover:text-[#ffe066]">
            RESET UPGRADES</button>
        </div>
    </section>
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