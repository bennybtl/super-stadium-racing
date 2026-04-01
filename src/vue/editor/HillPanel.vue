<template>
  <EditorPanel
    v-if="editor.selectedType === 'hill'"
    title="Hill"
    accent-color="#2ecc71"
    @close="editor.closeHill()"
  >
    <!-- Radius -->
    <div class="ep-row">
      <span>Radius</span>
      <span>{{ editor.hill.radius.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="3" max="40" step="0.5"
      :value="editor.hill.radius"
      @input="editor.setHillRadius(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Height -->
    <div class="ep-row">
      <span>Height</span>
      <span>{{ editor.hill.height.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="-15" max="20" step="0.5"
      :value="editor.hill.height"
      @input="editor.setHillHeight(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Surface -->
    <div class="ep-label">Surface</div>
    <select
      class="ep-select"
      :value="editor.hill.terrainType"
      @change="editor.setHillTerrainType($event.target.value)"
    >
      <option value="none">None (Default)</option>
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
    <button class="ep-btn-dup" @click="editor.duplicateHill()">Duplicate Hill</button>
    <button class="ep-btn-del" @click="editor.deleteHill()">Delete Hill</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
