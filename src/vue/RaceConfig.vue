<template>
  <div>
    <h3 class="mb-2 text-xs uppercase italic tracking-[0.14em] text-white text-center">Race Options</h3>

    <div class="mb-6 flex flex-row items-start justify-center gap-8">
      <div v-if="showRaceCount">
        <select
          class="w-full rounded-[10px] flex-grow border-2 border-[#444] bg-[#101010] px-3 py-2.5 text-base font-bold uppercase italic tracking-[0.1em] text-white transition duration-200 hover:scale-[1.01] hover:border-white hover:text-[#ffe066]"
          :value="store.champTrackCount"
          @change="store.setChampTrackCount(Number($event.target.value))"
        >
          <option v-for="n in [4, 5, 6, 8]" :key="n" :value="n">{{ n }} Races</option>
        </select>
      </div>
      <div>
        <select
          class="w-full rounded-[10px] flex-grow border-2 border-[#444] bg-[#101010] px-3 py-2.5 text-base font-bold uppercase italic tracking-[0.1em] text-white transition duration-200 hover:scale-[1.01] hover:border-white hover:text-[#ffe066]"
          :value="store.selectedLaps"
          @change="store.setSelectedLaps(Number($event.target.value))"
        >
          <option v-for="n in [1, 3, 5, 10]" :key="n" :value="n">{{ n }} Lap{{ n > 1 ? 's' : '' }}</option>
        </select>
      </div>
      <div>
        <select
          class="w-full rounded-[10px] flex-grow border-2 border-[#444] bg-[#101010] px-3 py-2.5 text-base font-bold uppercase italic tracking-[0.1em] text-white transition duration-200 hover:scale-[1.01] hover:border-white hover:text-[#ffe066]"
          :value="store.selectedAIDrivers"
          @change="store.setSelectedAIDrivers(Number($event.target.value))"
        >
          <option v-for="n in [3, 5, 7, 9]" :key="n" :value="n">{{ n }} AI Driver{{ n !== 1 ? 's' : '' }}</option>
        </select>
      </div>
      <div>
        <select
          class="w-full rounded-[10px] flex-grow border-2 border-[#444] bg-[#101010] px-3 py-2.5 text-base font-bold uppercase italic tracking-[0.1em] text-white transition duration-200 hover:scale-[1.01] hover:border-white hover:text-[#ffe066]"
          :value="store.selectedAIVehicleType"
          @change="store.setSelectedAIVehicleType($event.target.value)"
        >
          <option v-for="vehicle in aiVehicleOptions" :key="vehicle.key" :value="vehicle.key">{{ vehicle.name }}</option>
        </select>
      </div>
      <div v-if="showReverse">
        <ReverseToggle />
      </div>
    </div>
  </div>
</template>

<script setup>
  import { computed } from 'vue';
  import { useMenuStore } from './store.js';
  import ReverseToggle from './ReverseToggle.vue';

  // `showRaceCount` adds the championship-only "Races" (track count) control;
  // `showReverse` toggles the reverse-direction control (hidden for cups).
  defineProps({
    showRaceCount: { type: Boolean, default: false },
    showReverse: { type: Boolean, default: true },
  });

  const store = useMenuStore();

  const aiVehicleOptions = computed(() => ([
    // Keep "Random" pinned at the top; sort the actual vehicles by name.
    { key: 'random', name: 'Random' },
    ...store.vehicleList
      .map(vehicle => ({
        key: vehicle.key,
        name: vehicle.name ?? vehicle.key,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ]));
</script>