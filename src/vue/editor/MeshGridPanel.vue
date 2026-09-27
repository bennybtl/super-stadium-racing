<template>
  <EditorPanel
    v-if="editor.selectedType === 'meshGrid'"
    title="Terrain Mesh"
    default-right="20px"
    default-top="80px"
    @close="editor.featureAction('closeMeshGrid')"
  >

  <div class="ed-hint">
    Click a sphere to select it · scroll wheel · ↑ / ↓ · [ / ] to nudge
  </div>

  <!-- Point Height -->
    <div class="ed-label">Point Height</div>
    <input
      class="mg-height-input"
      type="number"
      min="-30"
      max="30"
      :step="editor.meshGrid.stepSize"
      :value="editor.meshGrid.hasSelection ? editor.meshGrid.pointHeight.toFixed(2) : ''"
      :placeholder="editor.meshGrid.hasSelection ? '' : '— select a point —'"
      :disabled="!editor.meshGrid.hasSelection"
      @change="editor.setMeshGridPointHeight(+$event.target.value)"
      @keydown.enter.prevent="editor.setMeshGridPointHeight(+$event.target.value)"
      @keydown.up.prevent="editor.featureAction('meshGridAdjustUp')"
      @keydown.down.prevent="editor.featureAction('meshGridAdjustDown')"
      @mousedown.stop
    />

    <!-- Step Size -->
    <div class="ed-label">
      <span>Step Size</span>
      <span>{{ editor.meshGrid.stepSize.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.1" max="5" step="0.1"
      :value="editor.meshGrid.stepSize"
      @input="editor.setFeatureProp('meshGrid', 'stepSize', +$event.target.value)"
      class="ed-slider"
    />

    <hr class="ed-divider" />
    <div class="ed-heading">Shape</div>


    <!-- Width -->
    <div class="ed-label">
      <span>Width</span>
      <span>{{ editor.meshGrid.width }}</span>
    </div>
    <input
      type="range" min="20" :max="editor.meshGrid.maxWidth" step="10"
      :value="editor.meshGrid.width"
      @input="editor.setMeshGridWidth(+$event.target.value)"
      class="ed-slider"
    />

    <!-- Depth -->
    <div class="ed-label">
      <span>Depth</span>
      <span>{{ editor.meshGrid.depth }}</span>
    </div>
    <input
      type="range" min="20" :max="editor.meshGrid.maxDepth" step="10"
      :value="editor.meshGrid.depth"
      @input="editor.setMeshGridDepth(+$event.target.value)"
      class="ed-slider"
    />

    <!-- Rotation (live) -->
    <div class="ed-label">
      <span>Rotation</span>
      <span>{{ editor.meshGrid.angle.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="2"
      :value="editor.meshGrid.angle"
      @input="editor.setFeatureProp('meshGrid', 'angle', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Density -->
    <div class="ed-label">
      <span>Density (cols × rows)</span>
      <span>{{ editor.meshGrid.cols }} × {{ editor.meshGrid.rows }}</span>
    </div>
    <input
      type="range" min="3" max="15" step="2"
      :value="editor.meshGrid.cols"
      @input="editor.setMeshGridDensity(+$event.target.value)"
      class="ed-slider"
    />

    <!-- Edge Blend / falloff (regional meshes only, live) -->
    <template v-if="editor.meshGrid.regional">
      <div class="ed-label">
        <span>Edge Blend</span>
        <span>{{ editor.meshGrid.falloff.toFixed(0) }}</span>
      </div>
      <input
        type="range" min="0" max="60" step="1"
        :value="editor.meshGrid.falloff"
        @input="editor.setFeatureProp('meshGrid', 'falloff', +$event.target.value)"
        class="ed-slider"
      />
      <div class="ed-hint">Width of the band where this region blends into surrounding terrain. 0 = hard edge.</div>
    </template>

    <div class="ed-btn-row">
      <button 
        class="ed-btn-danger"
        @click="editor.featureAction('flattenMeshGrid')"
      >
        Flatten
      </button>

      <button
        class="ed-btn"
        :disabled="!editor.meshGrid.hasSelection"
        @click="editor.applyMeshGridSettings()"
      >
        Apply
      </button>
    </div>


    <!-- Smoothing (live) -->
    <div class="ed-label">
      <span>Smoothing</span>
      <span>{{ editor.meshGrid.smoothing.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0" max="1" step="0.05"
      :value="editor.meshGrid.smoothing"
      @input="editor.setFeatureProp('meshGrid', 'smoothing', +$event.target.value)"
      class="ed-slider"
    />
  
    <hr class="ed-divider" />

    <!-- Actions -->
    <div class="ed-btn-row">
      <button 
        class="ed-btn-danger"
        @click="editor.featureAction('deleteMeshGrid')"
      >Delete</button>
      <button 
        class="ed-btn"
        @click="editor.featureAction('duplicateMeshGrid')"
      >Duplicate</button>
    </div>
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
