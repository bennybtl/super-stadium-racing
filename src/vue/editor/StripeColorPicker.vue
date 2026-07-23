<template>
  <!-- Stripe count -->
  <div class="flex justify-between items-center mb-3 text-[12px]">
    <span>Stripe Colors</span>
    <select
      :value="count"
      @change="setCount(+$event.target.value)"
      class="bg-slate-700 text-white text-[12px] rounded px-2 py-0.5 cursor-pointer"
    >
      <option :value="1">1 color</option>
      <option :value="2">2 colors</option>
      <option :value="3">3 colors</option>
    </select>
  </div>

  <!-- One dropdown per stripe slot -->
  <div
    v-for="(name, i) in colors"
    :key="i"
    class="flex justify-between items-center mb-2 text-[12px]"
  >
    <span class="flex items-center gap-2">
      <span
        class="inline-block w-3 h-3 rounded-sm border border-slate-500"
        :style="{ background: swatch(name) }"
      />
      Color {{ i + 1 }}
    </span>
    <select
      :value="name"
      @change="setColorAt(i, $event.target.value)"
      class="bg-slate-700 text-white text-[12px] rounded px-2 py-0.5 cursor-pointer capitalize"
    >
      <option v-for="opt in options" :key="opt" :value="opt">{{ opt }}</option>
    </select>
  </div>
</template>

<script setup>
import { computed } from "vue";
import {
  STRIPE_PALETTE,
  STRIPE_COLOR_NAMES,
  DEFAULT_STRIPE_COLORS,
} from "../../objects/stripeColors.js";

const props = defineProps({
  /** Current stripe colour names (1–3). */
  modelValue: { type: Array, default: () => [...DEFAULT_STRIPE_COLORS] },
});
const emit = defineEmits(["update:modelValue"]);

const options = STRIPE_COLOR_NAMES;

const colors = computed(() =>
  props.modelValue?.length ? props.modelValue : [...DEFAULT_STRIPE_COLORS],
);
const count = computed(() => colors.value.length);

/** CSS colour for the swatch, from the shared 0–1 RGB palette. */
function swatch(name) {
  const c = STRIPE_PALETTE[name];
  if (!c) return "transparent";
  const to255 = (v) => Math.round(v * 255);
  return `rgb(${to255(c[0])}, ${to255(c[1])}, ${to255(c[2])})`;
}

function setCount(n) {
  const next = colors.value.slice(0, n);
  // Growing: fill new slots with the first unused palette colour so the added
  // stripe is visibly distinct rather than a duplicate.
  while (next.length < n) {
    next.push(options.find((o) => !next.includes(o)) ?? options[0]);
  }
  emit("update:modelValue", next);
}

function setColorAt(i, val) {
  const next = colors.value.slice();
  next[i] = val;
  emit("update:modelValue", next);
}
</script>
