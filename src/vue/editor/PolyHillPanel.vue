<template>
  <EditorPanel
    v-if="editor.selectedType === 'polyHill'"
    title="Poly Hill"
    @close="editor.closePolyHill()"
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
      @input="editor.setPolyHillRadius(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />
    <div v-if="!editor.polyHill.canHaveRadius && editor.polyHill.hasSelection" class="text-[10px] text-slate-400 mb-3" style="color: #ff9800;">
      First and last points cannot be rounded (unless closed loop is enabled)
    </div>

    <div class="text-[10px] text-slate-400 mb-3">WASD to move selected point</div>

    <div class="flex gap-2 mb-3">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        :disabled="!editor.polyHill.canDeletePoint"
        @click="editor.deletePolyHillPoint()"
      >
        Delete Point
      </button>

      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        :disabled="!editor.polyHill.hasSelection"
        @click="editor.insertPolyHillPoint()"
      >
        Insert Point
      </button>
      <div v-if="editor.polyHill.hasSelection && !editor.polyHill.canDeletePoint" class="text-[10px] text-slate-400 mb-3" style="color: #ff9800;">
        A hill must have more than 2 points before a point can be deleted.
      </div>
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
      type="range" min="0.5" max="10" step="0.5"
      :value="editor.polyHill.height"
      @input="editor.setPolyHillHeight(+$event.target.value)"
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
      @input="editor.setPolyHillWidth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Terrain Type -->
    <TerrainTypeSelect
      :model-value="editor.polyHill.terrainType"
      @update:modelValue="editor.setPolyHillTerrainType"
    />

    <!-- Closed toggle -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.polyHill.closed"
        @change="editor.setPolyHillClosed($event.target.checked)"
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
          @change="editor.setPolyHillFilled($event.target.checked)"
          class="w-4 h-4 accent-[var(--accent)] cursor-pointer disabled:opacity-50"
        />
      </div>
    </template>
  
    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <div class="flex gap-2 mb-3">
      <button 
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.deletePolyHill()"
      >Delete</button>
      <button 
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.duplicatePolyHill()"
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
