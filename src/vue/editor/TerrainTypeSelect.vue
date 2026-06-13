<template>
  <div class="text-[12px] mb-1">{{ label }}</div>
  <select
    class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
    :value="modelValue"
    v-bind="$attrs"
    @change="$emit('update:modelValue', $event.target.value)"
  >
    <option v-if="includeNone" :value="noneValue">{{ noneLabel }}</option>
    <option v-if="includeInherit" :value="inheritValue">{{ inheritLabel }}</option>
    <option value="packed_dirt">Packed Dirt</option>
    <option value="loose_dirt">Loose Dirt</option>
    <option value="loamy_dirt">Loamy Dirt</option>
    <option value="asphalt">Asphalt</option>
    <option value="mud">Mud</option>
    <option value="water">Water</option>
    <option value="rocky">Rocky</option>
    <option value="grass">Grass</option>
  </select>
</template>

<script setup>
defineProps({
  label : {
    type: String,
    default: 'Terrain Type',
  },
  modelValue: {
    type: String,
    default: 'packed_dirt',
  },
  includeNone: {
    type: Boolean,
    default: true,
  },
  includeInherit: {
    type: Boolean,
    default: false,
  },
  noneLabel: {
    type: String,
    default: 'Default',
  },
  noneValue: {
    type: String,
    default: 'none',
  },
  inheritLabel: {
    type: String,
    default: 'Inherit',
  },
  inheritValue: {
    type: String,
    default: 'inherit',
  },
});

defineEmits(['update:modelValue']);
</script>