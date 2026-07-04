<template>
  <h3 class="mb-2 text-xs uppercase italic tracking-[0.14em] text-white">Choose Your Truck</h3>
  <section class="flex flex-row gap-4">
      <div class="min-w-0 flex-1 basis-0">
        <select
          class="w-full rounded-[10px] flex-grow border-2 border-[#444] bg-[#101010] px-3 py-2.5 text-base font-bold uppercase italic tracking-[0.1em] text-white transition duration-200 [-webkit-text-stroke:1px_#000] hover:scale-[1.01] hover:border-white hover:text-[#ffe066]"
          :value="selectedVehicle"
          @change="$emit('update:selectedVehicle', $event.target.value)"
        >
          <option v-for="vehicle in vehicles" :key="vehicle.key" :value="vehicle.key">{{ vehicle.name }}</option>
        </select>

      </div>

      <div class="min-w-0 flex-1 basis-0">
        <div class="flex min-h-[122px] items-center justify-center overflow-hidden rounded-[10px] border-2 border-[#666] bg-[#0d0d0d]">
          <VehiclePreview3D
            class="h-[170px] max-w-[200px]"
            :vehicle="selectedVehicleData"
            :selectedColor="selectedColor"
            :colorOptions="colorOptions"
          />
        </div>
      </div>

      <div class="min-w-0 flex-1 basis-0">
        <div class="flex flex-row flex-wrap gap-3">
          <button
            v-for="option in colorOptions"
            :key="option.key"
            type="button"
            class="aspect-square w-8 h-8 rounded-lg border-2 border-[#555] transition duration-150 hover:scale-105 hover:border-white"
            :class="{ 'border-white shadow-[inset_0_0_0_2px_#111]': option.key === selectedColor }"
            :title="option.key"
            :aria-label="`Select ${option.key} color`"
            :style="{ backgroundColor: toCssColor(option.value) }"
            @click="$emit('update:selectedColor', option.key)"
          ></button>
        </div>
      </div>

  </section>
</template>

<script setup>
import { computed } from 'vue';
import VehiclePreview3D from './VehiclePreview3D.vue';

const props = defineProps({
  vehicles: {
    type: Array,
    default: () => [],
  },
  selectedVehicle: {
    type: String,
    default: null,
  },
  colorOptions: {
    type: Array,
    default: () => [],
  },
  selectedColor: {
    type: String,
    default: null,
  },
});

defineEmits(['update:selectedVehicle', 'update:selectedColor']);

const selectedVehicleData = computed(() => {
  return props.vehicles.find((vehicle) => vehicle.key === props.selectedVehicle) ?? null;
});

function toCssColor(colorValue) {
  if (typeof colorValue === 'string') return colorValue;
  if (colorValue?.diffuse?.toHexString) return colorValue.diffuse.toHexString();
  if (colorValue?.toHexString) return colorValue.toHexString();
  return '#666666';
}
</script>
