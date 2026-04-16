<template>
  <EditorPanel
    v-if="editor.selectedType === 'meshGrid'"
    title="Mesh Grid"
    accent-color="#1ec8c8"
    default-right="20px"
    default-top="80px"
    @close="editor.closeMeshGrid()"
  >
    <!-- Point Height -->
    <div class="ep-label">Point Height</div>
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
    <div class="ep-row">
      <span>Step Size</span>
      <span>{{ editor.meshGrid.stepSize.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.1" max="5" step="0.1"
      :value="editor.meshGrid.stepSize"
      @input="editor.setMeshGridStepSize(+$event.target.value)"
      class="ep-slider"
    />

    <div class="ep-hint">
      Click a sphere to select it · scroll wheel · ↑ / ↓ · [ / ] to nudge
    </div>

    <hr class="ep-separator" />
    <div class="ep-section-title">Grid Settings</div>

    <!-- Density -->
    <div class="ep-row">
      <span>Density (cols × rows)</span>
      <span>{{ editor.meshGrid.cols }} × {{ editor.meshGrid.rows }}</span>
    </div>
    <input
      type="range" min="3" max="25" step="2"
      :value="editor.meshGrid.cols"
      @input="editor.setMeshGridDensity(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Width -->
    <div class="ep-row">
      <span>Width</span>
      <span>{{ editor.meshGrid.width }}</span>
    </div>
    <input
      type="range" min="20" max="160" step="10"
      :value="editor.meshGrid.width"
      @input="editor.setMeshGridWidth(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Depth -->
    <div class="ep-row">
      <span>Depth</span>
      <span>{{ editor.meshGrid.depth }}</span>
    </div>
    <input
      type="range" min="20" max="160" step="10"
      :value="editor.meshGrid.depth"
      @input="editor.setMeshGridDepth(+$event.target.value)"
      class="ep-slider"
    />

    <button class="ep-btn-action mg-apply-btn" @click="editor.applyMeshGridSettings()">
      Apply Grid Changes
    </button>

    <hr class="ep-separator" />

    <!-- Smoothing (live) -->
    <div class="ep-row">
      <span>Smoothing</span>
      <span>{{ editor.meshGrid.smoothing.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0" max="1" step="0.05"
      :value="editor.meshGrid.smoothing"
      @input="editor.setMeshGridSmoothing(+$event.target.value)"
      class="ep-slider"
    />

    <button class="ep-btn-action" @click="editor.flattenMeshGrid()">Flatten Grid</button>

    <hr class="ep-separator" />

    <!-- Actions -->
    <button class="ep-btn-dup" @click="editor.duplicateMeshGrid()">Duplicate</button>
    <button class="ep-btn-del" @click="editor.deleteMeshGrid()">Delete</button>
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
.mg-apply-btn {
  font-weight: bold;
  background: #1ec8c8 !important;
  color: #000 !important;
  margin-bottom: 0;
}
.mg-apply-btn:hover { background: #2de0e0 !important; }
</style>
