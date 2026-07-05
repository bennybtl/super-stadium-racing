<template>
  <EditorPanel
    v-if="editor.selectedType === 'checkpoint'"
    title="Checkpoint"
    @close="editor.featureAction('deselectCheckpoint')"
  >
    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · QE to rotate · Del to delete</div>


    <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width (barrel spacing)</span>
      <span>{{ editor.checkpoint.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="4" max="30" step="0.5"
      :value="editor.checkpoint.width"
      @input="editor.setFeatureProp('checkpoint', 'width', +$event.target.value)"
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
      @input="editor.setFeatureProp('checkpoint', 'heading', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Order -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Order</span>
      <span class="text-slate-300" style="font-weight: bold">#{{ editor.checkpoint.orderNum }}</span>
    </div>
    <div class="flex gap-2 mb-3">
      <button class="order-btn" @click="editor.featureAction('shiftCheckpointOrder', -1)"><i class="bi bi-arrow-left"></i> Earlier</button>
      <button class="order-btn" @click="editor.featureAction('shiftCheckpointOrder', 1)">Later <i class="bi bi-arrow-right"></i></button>
    </div>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <div class="flex gap-2">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deleteSelectedCheckpoint')"
      >
        Delete
      </button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('duplicateSelectedCheckpoint')"
      >
        Duplicate
      </button>
    </div>

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
