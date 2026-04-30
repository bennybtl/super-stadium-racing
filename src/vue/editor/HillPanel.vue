<template>
  <EditorPanel
    v-if="editor.selectedType === 'hill'"
    title="Round Hill"
    @close="editor.closeHill()"
  >
    <!-- Radius -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Radius</span>
      <span>{{ editor.hill.radius.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="3" max="40" step="0.5"
      :value="editor.hill.radius"
      @input="editor.setHillRadius(+$event.target.value)"
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
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Del to delete</div>

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
