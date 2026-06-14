<template>
  <EditorPanel
    v-if="editor.selectedType === 'terrainPath'"
    title="Terrain Path"
    @close="editor.closeTerrainPath()"
  >
    <div class="text-[10px] text-slate-400 mb-3">
      Right-click terrain to add waypoints. Select a node to edit it. Press <kbd>Esc</kbd> to close the panel.
    </div>

    <!-- Selected Point Section -->
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Selected Point</div>
    <div class="text-[10px] text-slate-400 mb-2">WASD to move selected waypoint</div>
    <div class="flex gap-2 mb-3">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.deleteTerrainPathWaypoint()"
      >
        Delete Point
      </button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.insertTerrainPathWaypoint()"
      >
        Insert After
      </button>
    </div>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Path Properties Section -->
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Path Properties</div>

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

    <!-- Edge blend -->
     <div class="flex justify-between mb-1 text-[12px]">
      <span>Edge Blend</span>
      <span>{{ editor.terrainPath.blendWidth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0" max="20" step="0.5"
      :value="editor.terrainPath.blendWidth"
      @input="editor.setTerrainPathBlendWidth(+$event.target.value)"
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

    <!-- Closed toggle -->
    <div class="flex justify-between mt-3 mb-3 text-[12px]">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.terrainPath.closed"
        @change="editor.setTerrainPathClosed($event.target.checked)"
        class="w-4 h-4 accent-[var(--accent)] cursor-pointer"
      />
    </div>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <div class="flex gap-2">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.deleteTerrainPath()"
      >
        Delete
      </button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.duplicateTerrainPath()"
      >
        Duplicate
      </button>
    </div>

  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import TerrainTypeSelect from './TerrainTypeSelect.vue';

const editor = useEditorStore();
</script>
