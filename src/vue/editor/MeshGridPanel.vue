<template>
  <EditorPanel
    v-if="editor.selectedType === 'meshGrid'"
    title="Mesh Grid"
    default-right="20px"
    default-top="80px"
    @close="editor.closeMeshGrid()"
  >
    <!-- Point Height -->
    <div class="text-[12px] mb-1">Point Height</div>
    <input
      class="mg-height-input"
      type="number"
      step="0.1"
      :value="editor.meshGrid.hasSelection ? editor.meshGrid.pointHeight.toFixed(2) : ''"
      :placeholder="editor.meshGrid.hasSelection ? '' : '— select a point —'"
      :disabled="!editor.meshGrid.hasSelection"
      @change="editor.setMeshGridPointHeight(+$event.target.value)"
      @keydown.enter.prevent="editor.setMeshGridPointHeight(+$event.target.value)"
      @keydown.up.prevent="editor.meshGridAdjustUp()"
      @keydown.down.prevent="editor.meshGridAdjustDown()"
      @mousedown.stop
    />

    <!-- Step Size -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Step Size</span>
      <span>{{ editor.meshGrid.stepSize.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.1" max="5" step="0.1"
      :value="editor.meshGrid.stepSize"
      @input="editor.setMeshGridStepSize(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <div class="text-[10px] text-slate-400 mb-3">
      Click a sphere to select it · scroll wheel · ↑ / ↓ · [ / ] to nudge
    </div>

    <hr class="border-t border-slate-700 my-4" />
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Grid Settings</div>

    <!-- Density -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Density (cols × rows)</span>
      <span>{{ editor.meshGrid.cols }} × {{ editor.meshGrid.rows }}</span>
    </div>
    <input
      type="range" min="3" max="25" step="2"
      :value="editor.meshGrid.cols"
      @input="editor.setMeshGridDensity(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.meshGrid.width }}</span>
    </div>
    <input
      type="range" min="20" :max="editor.meshGrid.maxWidth" step="10"
      :value="editor.meshGrid.width"
      @input="editor.setMeshGridWidth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Depth -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Depth</span>
      <span>{{ editor.meshGrid.depth }}</span>
    </div>
    <input
      type="range" min="20" :max="editor.meshGrid.maxDepth" step="10"
      :value="editor.meshGrid.depth"
      @input="editor.setMeshGridDepth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.applyMeshGridSettings()">
      Apply Grid Changes
    </button>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Smoothing (live) -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Smoothing</span>
      <span>{{ editor.meshGrid.smoothing.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0" max="1" step="0.05"
      :value="editor.meshGrid.smoothing"
      @input="editor.setMeshGridSmoothing(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.flattenMeshGrid()">Flatten Grid</button>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.duplicateMeshGrid()">Duplicate</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deleteMeshGrid()">Delete</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>

<style scoped>
.mg-height-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  margin-bottom: 14px;
  background: #1a2a2a;
  color: #1ec8c8;
  border: 1px solid #1ec8c8;
  border-radius: 4px;
  font-size: 14px;
  font-family: monospace;
  outline: none;
}
.mg-height-input:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
