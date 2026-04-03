<template>
  <EditorPanel
    v-if="editor.selectedType === 'normalMapDecal'"
    title="Normal Map Decal"
    accent-color="#c850ff"
    @close="editor.closeNormalMapDecal()"
  >
    <!-- Width -->
    <div class="ep-row">
      <span>Width</span>
      <span>{{ editor.normalMapDecal.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="1" max="80" step="0.5"
      :value="editor.normalMapDecal.width"
      @input="editor.setNormalMapDecalWidth(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Depth -->
    <div class="ep-row">
      <span>Depth</span>
      <span>{{ editor.normalMapDecal.depth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="1" max="80" step="0.5"
      :value="editor.normalMapDecal.depth"
      @input="editor.setNormalMapDecalDepth(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Angle -->
    <div class="ep-row">
      <span>Angle</span>
      <span>{{ editor.normalMapDecal.angle.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="0" max="360" step="1"
      :value="editor.normalMapDecal.angle"
      @input="editor.setNormalMapDecalAngle(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Normal Map -->
    <div class="ep-label">Normal Map</div>
    <select
      class="ep-select"
      :value="editor.normalMapDecal.normalMap"
      @change="editor.setNormalMapDecalNormalMap($event.target.value)"
    >
      <option value="6481-normal.jpg">6481 (Fine Gravel)</option>
      <option value="7632-normal.jpg">7632 (Rough)</option>
      <option value="sample-normal.png">Sample</option>
    </select>

    <!-- Repeat U -->
    <div class="ep-row">
      <span>Repeat U</span>
      <span>{{ editor.normalMapDecal.repeatU.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.1" max="20" step="0.1"
      :value="editor.normalMapDecal.repeatU"
      @input="editor.setNormalMapDecalRepeatU(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Repeat V -->
    <div class="ep-row">
      <span>Repeat V</span>
      <span>{{ editor.normalMapDecal.repeatV.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.1" max="20" step="0.1"
      :value="editor.normalMapDecal.repeatV"
      @input="editor.setNormalMapDecalRepeatV(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Intensity -->
    <div class="ep-row">
      <span>Intensity</span>
      <span>{{ editor.normalMapDecal.intensity.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0" max="2" step="0.05"
      :value="editor.normalMapDecal.intensity"
      @input="editor.setNormalMapDecalIntensity(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Hint -->
    <div class="ep-hint">WASD to move · QE to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="ep-btn-dup" @click="editor.duplicateNormalMapDecal()">Duplicate Normal Map</button>
    <button class="ep-btn-del" @click="editor.deleteNormalMapDecal()">Delete Normal Map</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
