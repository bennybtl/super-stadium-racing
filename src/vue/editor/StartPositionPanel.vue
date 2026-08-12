<template>
  <EditorPanel
    v-if="editor.selectedType === 'startPosition'"
    title="Start Position"
    @close="editor.featureAction('deselectStartPosition')"
  >
    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · QE to rotate · Del to delete</div>

    <div class="text-[10px] text-slate-400 mb-3 max-w-48">
      Overrides the default grid behind the finish line. Pole sits on the marker, the rest fill
      back from it — keep it behind the finish line so the first lap still counts.
    </div>

    <!-- Rotation -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rotation</span>
      <span>{{ editor.startPosition.rotation.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="5"
      :value="editor.startPosition.rotation"
      @input="editor.setFeatureProp('startPosition', 'rotation', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Columns -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Trucks per row</span>
      <span>{{ editor.startPosition.columns }}</span>
    </div>
    <input
      type="range" min="1" max="10" step="1"
      :value="editor.startPosition.columns"
      @input="editor.setFeatureProp('startPosition', 'columns', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-1 cursor-pointer"
    />
    <div class="text-[10px] text-slate-400 mb-3">10 makes a single-row land rush start.</div>

    <!-- Side-to-side spacing -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Row spread</span>
      <span>{{ editor.startPosition.colSpacing.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="2.5" max="20" step="0.5"
      :value="editor.startPosition.colSpacing"
      @input="editor.setFeatureProp('startPosition', 'colSpacing', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Front-to-back spacing -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Row gap</span>
      <span>{{ editor.startPosition.rowSpacing.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="4" max="25" step="0.5"
      :value="editor.startPosition.rowSpacing"
      @input="editor.setFeatureProp('startPosition', 'rowSpacing', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <hr class="border-t border-slate-700 my-4" />

    <button
      class="w-full rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
      @click="editor.featureAction('deleteStartPosition')"
    >
      Delete
    </button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
