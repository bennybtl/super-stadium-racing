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
      type="range" min="0" max="359" step="1"
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
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Water Level</span>
      <span>{{ editor.hill.waterLevelOffset.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0" max="15" step="0.5"
      :value="editor.hill.waterLevelOffset"
      @input="editor.setHillWaterLevelOffset(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

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

    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Q/E to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.duplicateHill()">Duplicate Hill</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deleteHill()">Delete Hill</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
