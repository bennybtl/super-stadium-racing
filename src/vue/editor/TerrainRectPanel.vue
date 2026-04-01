<template>
  <EditorPanel
    v-if="editor.selectedType === 'terrainRect'"
    title="Terrain Rect"
    accent-color="#4a9eff"
    @close="editor.closeTerrainRect()"
  >
    <!-- Width -->
    <div class="ep-row">
      <span>Width</span>
      <span>{{ editor.terrainRect.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="1" max="80" step="0.5"
      :value="editor.terrainRect.width"
      @input="editor.setTerrainRectWidth(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Depth -->
    <div class="ep-row">
      <span>Depth</span>
      <span>{{ editor.terrainRect.depth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="1" max="80" step="0.5"
      :value="editor.terrainRect.depth"
      @input="editor.setTerrainRectDepth(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Surface -->
    <div class="ep-label">Surface</div>
    <select
      class="ep-select"
      :value="editor.terrainRect.terrainType"
      @change="editor.setTerrainRectTerrainType($event.target.value)"
    >
      <option value="packed_dirt">Packed Dirt</option>
      <option value="loose_dirt">Loose Dirt</option>
      <option value="asphalt">Asphalt</option>
      <option value="mud">Mud</option>
      <option value="water">Water</option>
      <option value="rocky">Rocky</option>
    </select>

    <!-- Hint -->
    <div class="ep-hint">WASD to move · Del to delete</div>

    <!-- Actions -->
    <button class="ep-btn-dup" @click="editor.duplicateTerrainRect()">Duplicate Terrain Rect</button>
    <button class="ep-btn-del" @click="editor.deleteTerrainRect()">Delete Terrain Rect</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
