<template>
  <EditorPanel
    v-if="editor.selectedType === 'polyCurb'"
    title="Poly Curb"
    @close="editor.featureAction('closePolyCurb')"
  >
    <div class="text-[10px] text-slate-400 mb-3">
      Right-click terrain to add points. Select a point to edit it. Press <kbd>Esc</kbd> to close the panel.
    </div>

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
      @input="editor.setFeatureProp('polyCurb', 'radius', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />
    <div v-if="!editor.polyCurb.canHaveRadius && editor.polyCurb.hasSelection" class="text-[10px] text-slate-400 mb-3" style="color: #ff9800;">
      First and last points cannot be rounded (unless closed loop is enabled)
    </div>

    <div class="text-[10px] text-slate-400 mb-3">WASD to move selected point</div>

    <div class="flex gap-2 mb-3">
      <button 
          class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deletePolyCurbPoint')"
      >Delete Point</button>
      <button 
          class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('insertPolyCurbPoint')"
      >Insert After</button>
    </div>
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
      @input="editor.setFeatureProp('polyCurb', 'height', +$event.target.value)"
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
      @input="editor.setFeatureProp('polyCurb', 'width', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Closed toggle -->
    <div class="flex justify-between mb-3 text-[12px]">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.polyCurb.closed"
        @change="editor.setFeatureProp('polyCurb', 'closed', $event.target.checked)"
        class="w-4 h-4 accent-[var(--accent)] cursor-pointer"
      />
    </div>

    <!-- Stripe colours (1–3, any combination) -->
    <StripeColorPicker
      :model-value="editor.polyCurb.colors"
      @update:model-value="editor.setFeatureProp('polyCurb', 'colors', $event)"
    />

    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <div class="flex gap-2">
    <button 
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
      @click="editor.featureAction('deletePolyCurb')"
    >Delete</button>
    <button 
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
      @click="editor.featureAction('duplicatePolyCurb')"
    >Duplicate</button>

  </div>
  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import StripeColorPicker from './StripeColorPicker.vue';

const editor = useEditorStore();

const radiusDisplay = computed(() => {
  if (!editor.polyCurb.hasSelection) return '—';
  return editor.polyCurb.radius.toFixed(1);
});
</script>
