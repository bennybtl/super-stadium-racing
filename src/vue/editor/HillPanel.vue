<template>
  <EditorPanel
    v-if="editor.selectedType === 'hill'"
    title="Hill"
    @close="editor.closeHill()"
  >
    <!-- Width Radius -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width Radius</span>
      <span>{{ editor.hill.radiusX.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="3" max="40" step="0.5"
      :value="editor.hill.radiusX"
      @input="editor.setHillRadiusX(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Depth Radius -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Depth Radius</span>
      <span>{{ editor.hill.radiusZ.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="3" max="40" step="0.5"
      :value="editor.hill.radiusZ"
      @input="editor.setHillRadiusZ(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rotation</span>
      <span>{{ editor.hill.rotation.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="0" max="180" step="1"
      :value="editor.hill.rotation"
      @input="editor.setHillRotation(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Height</span>
      <span>{{ editor.hill.height.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="-15" max="20" step="0.5"
      :value="editor.hill.height"
      @input="editor.setHillHeight(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Water Level -->
     <template v-if="editor.hill.terrainType == 'water'">
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Water Level</span>
      <span>{{ editor.hill.waterLevelOffset.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0" max="15" step="0.1"
      :value="editor.hill.waterLevelOffset"
      @input="editor.setHillWaterLevelOffset(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />
</template>
    <!-- Surface -->
    <div class="text-[12px] mb-1">Surface</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.hill.terrainType"
      @change="editor.setHillTerrainType($event.target.value)"
    >
      <option value="none">None (Default)</option>
      <option value="packed_dirt">Packed Dirt</option>
      <option value="loose_dirt">Loose Dirt</option>
      <option value="loamy_dirt">Loamy Dirt</option>
      <option value="asphalt">Asphalt</option>
      <option value="mud">Mud</option>
      <option value="water">Water</option>
      <option value="rocky">Rocky</option>
    </select>

    <!-- Actions -->
    <div class="flex gap-2 mb-3">
      <button 
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.deleteHill()"
      >Delete Hill</button>
      <button 
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.duplicateHill()"
      >Duplicate Hill</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
