<template>
  <EditorPanel
    v-if="editor.selectedType === 'polyCurb'"
    title="Poly Curb"
    @close="editor.closePolyCurb()"
  >
    <!-- Selected Point Section -->
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Selected Point</div>

    <!-- Radius -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Corner Radius</span>
      <span :style="editor.polyCurb.radius > editor.polyCurb.maxRadius ? { color: '#ff4444' } : {}">{{ radiusDisplay }}</span>
    </div>
    <input
      type="range" min="0" max="30" step="0.5"
      :value="editor.polyCurb.radius"
      :disabled="!editor.polyCurb.canHaveRadius"
      @input="editor.setPolyCurbRadius(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />
    <div v-if="!editor.polyCurb.canHaveRadius && editor.polyCurb.hasSelection" class="text-[10px] text-slate-400 mb-3" style="color: #ff9800;">
      First and last points cannot be rounded (unless closed loop is enabled)
    </div>

    <div class="text-[10px] text-slate-400 mb-3">WASD to move selected point</div>

    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.insertPolyCurbPoint()">Insert Point After</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deletePolyCurbPoint()">Delete Point</button>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Curb Properties Section -->
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Curb Properties</div>

    <!-- Height (bump height) -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Height</span>
      <span>{{ editor.polyCurb.height.toFixed(2) }} m</span>
    </div>
    <input
      type="range" min="0.08" max="0.5" step="0.02"
      :value="editor.polyCurb.height"
      @input="editor.setPolyCurbHeight(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Width (lateral strip width) -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.polyCurb.width.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="0.25" max="5.0" step="0.25"
      :value="editor.polyCurb.width"
      @input="editor.setPolyCurbWidth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Closed toggle -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.polyCurb.closed"
        @change="editor.setPolyCurbClosed($event.target.checked)"
        class="w-4 h-4 accent-[var(--accent)] cursor-pointer"
      />
    </div>

    <!-- Style -->
    <div class="flex justify-between items-center mb-1 text-[12px]">
      <span>Style</span>
      <select
        :value="editor.polyCurb.style"
        @change="editor.setPolyCurbStyle($event.target.value)"
        class="bg-slate-700 text-white text-[12px] rounded px-2 py-0.5 cursor-pointer"
      >
        <option value="red_white">Red &amp; White</option>
        <option value="black_yellow">Black &amp; Yellow</option>
        <option value="grey">Grey</option>
      </select>
    </div>

    <div class="text-[10px] text-slate-400 mb-3">WASD to move</div>

    <!-- Actions -->
    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.duplicatePolyCurb()">Duplicate</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deletePolyCurb()">Delete</button>
  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

const radiusDisplay = computed(() => {
  if (!editor.polyCurb.hasSelection) return '—';
  return editor.polyCurb.radius.toFixed(1);
});
</script>
