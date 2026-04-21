<template>
  <EditorPanel
    v-if="editor.selectedType === 'checkpoint'"
    title="Checkpoint"
    @close="editor.closeCheckpoint()"
  >
    <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width (barrel spacing)</span>
      <span>{{ editor.checkpoint.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="4" max="30" step="0.5"
      :value="editor.checkpoint.width"
      @input="editor.setCheckpointWidth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Heading -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rotation</span>
      <span>{{ editor.checkpoint.heading.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="5"
      :value="editor.checkpoint.heading"
      @input="editor.setCheckpointHeading(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Order -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Order</span>
      <span class="text-slate-300" style="font-weight: bold">#{{ editor.checkpoint.orderNum }}</span>
    </div>
    <div class="flex gap-2 mb-3">
      <button class="order-btn" @click="editor.shiftCheckpointOrder(-1)">← Earlier</button>
      <button class="order-btn" @click="editor.shiftCheckpointOrder(1)">Later →</button>
    </div>

    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · QE to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.duplicateCheckpoint()">Duplicate Checkpoint</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deleteCheckpoint()">Delete Checkpoint</button>
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
