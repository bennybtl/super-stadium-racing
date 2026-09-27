<template>
  <EditorPanel
    v-if="editor.selectedType === 'bridgeMesh'"
    id="bridge-mesh-panel"
    title="Bridge Mesh"
    default-right="20px"
    default-top="80px"
    @close="editor.featureAction('closeBridgeMesh')"
  >

    <div class="ed-hint">
      Click a control sphere to select it · scroll / ↑ ↓ / [ ] set height · drag or WASD moves it in the plane.
    </div>

    <div class="ed-heading">Selected Point</div>

    <!-- Point Height -->
    <div class="ed-label">Point Height</div>
    <input
      class="mg-height-input"
      type="number"
      min="-30"
      max="30"
      :step="editor.bridgeMesh.stepSize"
      :value="editor.bridgeMesh.hasSelection ? editor.bridgeMesh.pointHeight.toFixed(2) : ''"
      :placeholder="editor.bridgeMesh.hasSelection ? '' : '— select a point —'"
      :disabled="!editor.bridgeMesh.hasSelection"
      @change="editor.setBridgeMeshPointHeight(+$event.target.value)"
      @keydown.enter.prevent="editor.setBridgeMeshPointHeight(+$event.target.value)"
      @keydown.up.prevent="editor.featureAction('bridgeMeshAdjustUp')"
      @keydown.down.prevent="editor.featureAction('bridgeMeshAdjustDown')"
      @mousedown.stop
    />


    <!-- Step Size -->
    <div class="ed-label">
      <span>Step Size</span>
      <span>{{ editor.bridgeMesh.stepSize.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.1" max="2" step="0.1"
      :value="editor.bridgeMesh.stepSize"
      @input="editor.setFeatureProp('bridgeMesh', 'stepSize', +$event.target.value)"
      class="ed-slider"
    />

    <hr class="ed-divider" />
    <div class="ed-heading">Shape</div>

    <!-- Width -->
    <div class="ed-label">
      <span>Width</span>
      <span>{{ editor.bridgeMesh.width }}</span>
    </div>
    <input
      type="range" min="10" max="150" step="2"
      :value="editor.bridgeMesh.width"
      @input="editor.bridgeMesh.width = +$event.target.value"
      class="ed-slider"
    />

    <!-- Depth -->
    <div class="ed-label">
      <span>Depth</span>
      <span>{{ editor.bridgeMesh.depth }}</span>
    </div>
    <input
      type="range" min="10" max="60" step="2"
      :value="editor.bridgeMesh.depth"
      @input="editor.bridgeMesh.depth = +$event.target.value"
      class="ed-slider"
    />

    <!-- Roation -->
    <div class="ed-label">
      <span>Rotation</span>
      <span>{{ editor.bridgeMesh.rotation.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="5"
      :value="editor.bridgeMesh.rotation"
      @input="editor.setFeatureProp('bridgeMesh', 'rotation', +$event.target.value)"
      class="ed-slider"
    />


    <!-- Cols -->
    <div class="ed-label">
      <span>Columns</span>
      <span>{{ editor.bridgeMesh.cols }}</span>
    </div>
    <input
      type="range" min="2" max="10" step="1"
      :value="editor.bridgeMesh.cols"
      @input="editor.bridgeMesh.cols = +$event.target.value"
      class="ed-slider"
    />

    <!-- Rows -->
    <div class="ed-label">
      <span>Rows</span>
      <span>{{ editor.bridgeMesh.rows }}</span>
    </div>
    <input
      type="range" min="2" max="10" step="1"
      :value="editor.bridgeMesh.rows"
      @input="editor.bridgeMesh.rows = +$event.target.value"
      class="ed-slider"
    />

    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('flattenBridgeMesh')"
      >
        Flatten
      </button>
      <button
        class="ed-btn"
        @click="editor.applyBridgeMeshSettings()"
      >
        Apply
      </button>
    </div>

    <div class="ed-label">
      <span>Mesh Thickness</span>
      <span>{{ editor.bridgeMesh.thickness.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0.1" max="5" step="0.05"
      :value="editor.bridgeMesh.thickness"
      @input="editor.setBridgeMeshThickness(+$event.target.value)"
      class="ed-slider"
    />

    <!-- Smoothing (live) — rounds the deck between control points -->
    <div class="ed-label">
      <span>Smoothing</span>
      <span>{{ editor.bridgeMesh.smoothing.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0" max="1" step="0.05"
      :value="editor.bridgeMesh.smoothing"
      @input="editor.setFeatureProp('bridgeMesh', 'smoothing', +$event.target.value)"
      class="ed-slider"
    />

    <!-- <div class="ed-label">Layer Id</div>
    <input
      class="ed-btn"
      type="number"
      min="0"
      max="20"
      step="1"
      :value="editor.bridgeMesh.layerId"
      @change="editor.setBridgeMeshLayerId(+$event.target.value)"
      @keydown.enter.prevent="editor.setBridgeMeshLayerId(+$event.target.value)"
      @mousedown.stop
    /> -->

    <hr class="ed-divider" />
    <div class="ed-heading">Appearance</div>

    <!-- Colors: terrain-blend look or flat diffuse, top and sides separately -->
    <div class="ed-row">
      <span class="flex items-center gap-2">
        <span
          class="inline-block w-3 h-3 rounded-sm border border-slate-500"
          :style="{ background: swatch(editor.bridgeMesh.color) }"
        />
        Top
      </span>
      <select
        :value="editor.bridgeMesh.color"
        @change="editor.setFeatureProp('bridgeMesh', 'color', $event.target.value)"
        class="ed-select-inline"
      >
        <option v-for="opt in colorOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </div>

    <div class="ed-row">
      <span class="flex items-center gap-2">
        <span
          class="inline-block w-3 h-3 rounded-sm border border-slate-500"
          :style="{ background: swatch(editor.bridgeMesh.sideColor) }"
        />
        Sides
      </span>
      <select
        :value="editor.bridgeMesh.sideColor"
        @change="editor.setFeatureProp('bridgeMesh', 'sideColor', $event.target.value)"
        class="ed-select-inline"
      >
        <option v-for="opt in colorOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </div>

    <hr class="ed-divider" />

    <!-- Reverse-race override -->
    <div class="ed-heading">Reverse</div>

    <div class="ed-row">
      <span>Reverse Mode</span>
      <select
        :value="editor.bridgeMesh.reverseMode"
        @change="editor.setFeatureProp('bridgeMesh', 'reverseMode', $event.target.value)"
        class="ed-select-inline"
      >
        <option value="active">Active</option>
        <option value="rotate180">Rotate 180</option>
        <option value="remove">Remove</option>
        <option value="only">Only</option>
      </select>
    </div>
    <div class="ed-hint">Only takes effect when racing in reverse — use "Test Reverse" in the status bar to preview. Doesn't change how this mesh looks here.</div>

    <hr class="ed-divider" />

    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deleteBridgeMesh')"
      >Delete</button>
      <button
        class="ed-btn"
        @click="editor.featureAction('duplicateBridgeMesh')"
      >Duplicate</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import { SURFACE_COLOR_OPTIONS as colorOptions, surfaceSwatch as swatch } from './surfaceColors.js';

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
