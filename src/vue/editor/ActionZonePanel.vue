<template>
  <EditorPanel
    v-if="editor.selectedType === 'actionZone'"
    title="Action Zone"
    accent-color="#ff3399"
    @close="editor.closeActionZone()"
  >
    <!-- Zone type -->
    <div class="ep-label">Zone Type</div>
    <select
      class="ep-select"
      :value="editor.actionZone.zoneType"
      @change="editor.setActionZoneType($event.target.value)"
    >
      <option value="pickupSpawn">Pickup Spawn</option>
      <option value="slowZone">Slow Zone</option>
    </select>

    <!-- Radius -->
    <div class="ep-row">
      <span>Radius</span>
      <span>{{ editor.actionZone.radius }} m</span>
    </div>
    <input
      type="range"
      class="ep-slider"
      min="4" max="60" step="0.5"
      :value="editor.actionZone.radius"
      @input="editor.setActionZoneRadius(+$event.target.value)"
    />

    <!-- Hint -->
    <div class="ep-hint">WASD to move · Del to delete</div>

    <!-- Delete -->
    <button class="ep-btn-del" @click="editor.deleteActionZone()">Delete Zone</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
