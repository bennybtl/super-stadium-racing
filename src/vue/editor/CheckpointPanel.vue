<template>
  <EditorPanel
    v-if="editor.selectedType === 'checkpoint'"
    title="Checkpoint"
    accent-color="#ff9f43"
    @close="editor.closeCheckpoint()"
  >
    <!-- Width -->
    <div class="ep-row">
      <span>Width (barrel spacing)</span>
      <span>{{ editor.checkpoint.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="4" max="30" step="0.5"
      :value="editor.checkpoint.width"
      @input="editor.setCheckpointWidth(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Heading -->
    <div class="ep-row">
      <span>Rotation</span>
      <span>{{ editor.checkpoint.heading.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="5"
      :value="editor.checkpoint.heading"
      @input="editor.setCheckpointHeading(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Order -->
    <div class="ep-row">
      <span>Order</span>
      <span class="ep-accent" style="font-weight: bold">#{{ editor.checkpoint.orderNum }}</span>
    </div>
    <div class="ep-btn-row">
      <button class="order-btn" @click="editor.shiftCheckpointOrder(-1)">← Earlier</button>
      <button class="order-btn" @click="editor.shiftCheckpointOrder(1)">Later →</button>
    </div>

    <!-- Hint -->
    <div class="ep-hint">WASD to move · QE to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="ep-btn-dup" @click="editor.duplicateCheckpoint()">Duplicate Checkpoint</button>
    <button class="ep-btn-del" @click="editor.deleteCheckpoint()">Delete Checkpoint</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>

<style scoped>
.order-btn {
  flex: 1;
  padding: 6px;
  background: #555;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: Arial;
  transition: background 0.15s;
}
.order-btn:hover { background: #777; }
</style>
