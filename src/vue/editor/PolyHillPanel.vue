<template>
  <EditorPanel
    v-if="editor.selectedType === 'polyHill'"
    title="Poly Hill"
    @close="editor.featureAction('deselectPolyHill')"
  >
    <!-- Selected Point Section -->
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Selected Point</div>

    <!-- Radius -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Radius</span>
      <span>{{ radiusDisplay }}</span>
    </div>
    <input
      type="range" min="0" max="30" step="0.5"
      :value="editor.polyHill.radius"
      :disabled="!editor.polyHill.canHaveRadius"
      @input="editor.setFeatureProp('polyHill', 'radius', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />
    <div v-if="!editor.polyHill.canHaveRadius && editor.polyHill.hasSelection" class="text-[10px] text-slate-400 mb-3" style="color: #ff9800;">
      First and last points cannot be rounded (unless closed loop is enabled)
    </div>

    <div class="text-[10px] text-slate-400 mb-3">WASD to move selected point</div>

    <div class="flex gap-2 mb-3">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        :class="{ 'cursor-not-allowed opacity-50': !editor.polyHill.canDeletePoint }"
        :disabled="!editor.polyHill.canDeletePoint"
        @click="editor.featureAction('deletePolyHillPoint')"
      >
        Delete Point
      </button>

      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        :class="{ 'cursor-not-allowed opacity-50': !editor.polyHill.hasSelection }"
        :disabled="!editor.polyHill.hasSelection"
        @click="editor.featureAction('insertPolyHillPoint')"
      >
        Insert Point
      </button>
    </div>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Hill Properties Section -->
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Hill Properties</div>

    <!-- Height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Height</span>
      <span>{{ editor.polyHill.height.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="-16" max="16" step="0.1"
      :value="editor.polyHill.height"
      @input="editor.setFeatureProp('polyHill', 'height', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.polyHill.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="2" max="50" step="0.5"
      :value="editor.polyHill.width"
      @input="editor.setFeatureProp('polyHill', 'width', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Closed toggle -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.polyHill.closed"
        @change="editor.setFeatureProp('polyHill', 'closed', $event.target.checked)"
        class="w-4 h-4 accent-[var(--accent)] cursor-pointer"
      />
    </div>

    <!-- Filled toggle -->
     <template v-if="editor.polyHill.closed">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Filled</span>
        <input
          type="checkbox"
          :checked="editor.polyHill.filled"
          :disabled="!editor.polyHill.closed"
          @change="editor.setFeatureProp('polyHill', 'filled', $event.target.checked)"
          class="w-4 h-4 accent-[var(--accent)] cursor-pointer disabled:opacity-50"
        />
      </div>
    </template>

    <!-- Water Level — only for a closed, filled, water-type depression -->
    <template v-if="editor.polyHill.canHaveWater">
      <div class="flex justify-between mb-1 mt-3 text-[12px]">
        <span>Water Level</span>
        <span>{{ editor.polyHill.waterLevelOffset.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="15" step="0.1"
        :value="editor.polyHill.waterLevelOffset"
        @input="editor.setFeatureProp('polyHill', 'waterLevelOffset', +$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>

    <!-- Terrain Type -->
    <TerrainTypeSelect
      :model-value="editor.polyHill.terrainType"
      @update:modelValue="v => editor.setFeatureProp('polyHill', 'terrainType', v)"
    />

    <!-- Edge Blend: dithers the terrain-type boundary into surrounding terrain -->
    <template v-if="editor.polyHill.terrainType !== 'none'">
      <div class="flex justify-between mb-1 mt-3 text-[12px]">
        <span>Edge Blend</span>
        <span>{{ editor.polyHill.blendWidth.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="20" step="0.5"
        :value="editor.polyHill.blendWidth"
        @input="editor.setFeatureProp('polyHill', 'blendWidth', +$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <div class="flex gap-2">
      <button 
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deletePolyHill')"
      >Delete</button>
      <button 
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('duplicatePolyHill')"
      >Duplicate</button>
    </div>
</EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import TerrainTypeSelect from './TerrainTypeSelect.vue';

const editor = useEditorStore();

const radiusDisplay = computed(() => {
  if (!editor.polyHill.hasSelection) return '—';
  return editor.polyHill.radius.toFixed(1);
});
</script>
