<template>
  <EditorPanel
    v-if="editor.selectedType === 'terrainCircle'"
    title="Terrain Circle"
    accent-color="#4a9eff"
    @close="editor.closeTerrainCircle()"
  >
    <!-- Radius -->
    <div class="ep-row">
      <span>Radius</span>
      <span>{{ editor.terrainCircle.radius.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="1" max="40" step="0.5"
      :value="editor.terrainCircle.radius"
      @input="editor.setTerrainCircleRadius(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Surface -->
    <div class="ep-label">Surface</div>
    <select
      class="ep-select"
      :value="editor.terrainCircle.terrainType"
      @change="editor.setTerrainCircleTerrainType($event.target.value)"
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
    <button class="ep-btn-dup" @click="editor.duplicateTerrainCircle()">Duplicate Terrain Circle</button>
    <button class="ep-btn-del" @click="editor.deleteTerrainCircle()">Delete Terrain Circle</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
