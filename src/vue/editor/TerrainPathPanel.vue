<template>
  <EditorPanel
    v-if="editor.selectedType === 'terrainPath'"
    title="Terrain Path"
    @close="editor.closeTerrainPath()"
  >
    <div class="mb-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div class="text-slate-200 text-sm font-medium mb-1">Terrain path editing mode</div>
      <div class="text-slate-400 text-[11px]">Click terrain to add a waypoint. Click an existing waypoint to select it.</div>
    </div>

    <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.terrainPath.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="1" max="40" step="0.5"
      :value="editor.terrainPath.width"
      @input="editor.setTerrainPathWidth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Corner radius -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Corner Radius</span>
      <span>{{ editor.terrainPath.cornerRadius.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0" max="20" step="0.5"
      :value="editor.terrainPath.cornerRadius"
      @input="editor.setTerrainPathCornerRadius(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <TerrainTypeSelect
      :model-value="editor.terrainPath.terrainType"
      @update:modelValue="editor.setTerrainPathTerrainType"
    />

    <button
      class="w-full rounded-md bg-slate-800 text-white py-2 text-[13px] font-sans mb-2 hover:bg-slate-700"
      @click="editor.deleteTerrainPathWaypoint()"
    >
      Delete selected waypoint
    </button>

    <button
      class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-3 hover:bg-rose-500"
      @click="editor.clearTerrainPath()"
    >
      Clear path
    </button>

    <div class="text-[10px] text-slate-400">
      Click terrain to add waypoints. Select a node to edit it. Press <kbd>Esc</kbd> to close the panel.
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import TerrainTypeSelect from './TerrainTypeSelect.vue';

const editor = useEditorStore();
</script>
