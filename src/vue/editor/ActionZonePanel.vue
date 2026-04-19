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
      <option value="outOfBounds">Out of Bounds</option>
    </select>

    <!-- Zone shape -->
    <div class="ep-label">Shape</div>
    <select
      class="ep-select"
      :value="editor.actionZone.shape"
      @change="editor.setActionZoneShape($event.target.value)"
    >
      <option value="circle">Circle</option>
      <option value="polygon">Polygon</option>
    </select>

    <!-- Circle controls -->
    <div v-if="editor.actionZone.shape === 'circle'" class="ep-row">
      <span>Radius</span>
      <span>{{ editor.actionZone.radius }} m</span>
    </div>
    <input
      v-if="editor.actionZone.shape === 'circle'"
      type="range"
      class="ep-slider"
      min="4" max="60" step="0.5"
      :value="editor.actionZone.radius"
      @input="editor.setActionZoneRadius(+$event.target.value)"
    />

    <!-- Polygon controls -->
    <template v-else>
      <div class="ep-row">
        <span>Points</span>
        <span>{{ editor.actionZone.pointCount }}</span>
      </div>
      <div class="ep-row">
        <span>Selected Point</span>
        <span>{{ editor.actionZone.selectedPointIndex >= 0 ? editor.actionZone.selectedPointIndex + 1 : 'Center' }}</span>
      </div>
      <button class="ep-btn" @click="editor.insertActionZonePoint()">Insert Point</button>
      <button class="ep-btn-del" @click="editor.deleteActionZonePoint()">Delete Point</button>
    </template>

    <!-- Hint -->
    <div class="ep-hint">WASD to move · Del to delete{{ editor.actionZone.shape === 'polygon' ? ' point/zone' : '' }}</div>

    <!-- Actions -->
    <button class="ep-btn-dup" @click="editor.duplicateActionZone()">Duplicate</button>
    <button class="ep-btn-del" @click="editor.deleteActionZone()">Delete</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
