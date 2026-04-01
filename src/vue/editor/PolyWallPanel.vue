<template>
  <EditorPanel
    v-if="editor.selectedType === 'polyWall'"
    title="Poly Wall"
    accent-color="#f5a623"
    @close="editor.closePolyWall()"
  >
    <!-- Selected Point Section -->
    <div class="ep-section-title">Selected Point</div>

    <!-- Smoothing -->
    <div class="ep-row">
      <span>Smoothing</span>
      <span>{{ smoothingDisplay }}</span>
    </div>
    <input
      type="range" min="0" max="10" step="0.5"
      :value="editor.polyWall.smoothing"
      :disabled="!editor.polyWall.hasSelection"
      @input="editor.setPolyWallSmoothing(+$event.target.value)"
      class="ep-slider"
    />

    <div class="ep-hint">WASD to move selected point</div>

    <button class="ep-btn-action" @click="editor.insertPolyWallPoint()">Insert Point After</button>
    <button class="ep-btn-del" @click="editor.deletePolyWallPoint()">Delete Point</button>

    <hr class="ep-separator" />

    <!-- Wall Properties Section -->
    <div class="ep-section-title">Wall Properties</div>

    <!-- Height -->
    <div class="ep-row">
      <span>Height</span>
      <span>{{ editor.polyWall.height.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="8" step="0.5"
      :value="editor.polyWall.height"
      @input="editor.setPolyWallHeight(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Thickness -->
    <div class="ep-row">
      <span>Thickness</span>
      <span>{{ editor.polyWall.thickness.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.2" max="3" step="0.1"
      :value="editor.polyWall.thickness"
      @input="editor.setPolyWallThickness(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Closed toggle -->
    <div class="ep-row">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.polyWall.closed"
        @change="editor.setPolyWallClosed($event.target.checked)"
        class="ep-checkbox"
      />
    </div>

    <hr class="ep-separator" />

    <button class="ep-btn-del" @click="editor.deletePolyWall()">Delete Wall</button>
  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

const smoothingDisplay = computed(() => {
  if (!editor.polyWall.hasSelection) return '—';
  return editor.polyWall.smoothing.toFixed(1);
});
</script>
