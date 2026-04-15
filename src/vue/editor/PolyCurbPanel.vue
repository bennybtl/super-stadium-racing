<template>
  <EditorPanel
    v-if="editor.selectedType === 'polyCurb'"
    title="Poly Curb"
    accent-color="#1ab8b0"
    @close="editor.closePolyCurb()"
  >
    <!-- Selected Point Section -->
    <div class="ep-section-title">Selected Point</div>

    <!-- Radius -->
    <div class="ep-row">
      <span>Corner Radius</span>
      <span :style="editor.polyCurb.radius > editor.polyCurb.maxRadius ? { color: '#ff4444' } : {}">{{ radiusDisplay }}</span>
    </div>
    <input
      type="range" min="0" max="30" step="0.5"
      :value="editor.polyCurb.radius"
      :disabled="!editor.polyCurb.canHaveRadius"
      @input="editor.setPolyCurbRadius(+$event.target.value)"
      class="ep-slider"
    />
    <div v-if="!editor.polyCurb.canHaveRadius && editor.polyCurb.hasSelection" class="ep-hint" style="color: #ff9800;">
      First and last points cannot be rounded (unless closed loop is enabled)
    </div>

    <div class="ep-hint">WASD to move selected point</div>

    <button class="ep-btn-action" @click="editor.insertPolyCurbPoint()">Insert Point After</button>
    <button class="ep-btn-del" @click="editor.deletePolyCurbPoint()">Delete Point</button>

    <hr class="ep-separator" />

    <!-- Curb Properties Section -->
    <div class="ep-section-title">Curb Properties</div>

    <!-- Height (bump height) -->
    <div class="ep-row">
      <span>Height</span>
      <span>{{ editor.polyCurb.height.toFixed(2) }} m</span>
    </div>
    <input
      type="range" min="0.08" max="0.5" step="0.02"
      :value="editor.polyCurb.height"
      @input="editor.setPolyCurbHeight(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Width (lateral strip width) -->
    <div class="ep-row">
      <span>Width</span>
      <span>{{ editor.polyCurb.width.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="0.25" max="5.0" step="0.25"
      :value="editor.polyCurb.width"
      @input="editor.setPolyCurbWidth(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Closed toggle -->
    <div class="ep-row">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.polyCurb.closed"
        @change="editor.setPolyCurbClosed($event.target.checked)"
        class="ep-checkbox"
      />
    </div>

    <hr class="ep-separator" />
    <div class="ep-btn-row">
      <button class="ep-btn-dup" @click="editor.duplicatePolyCurb()">Duplicate</button>
      <button class="ep-btn-del" @click="editor.deletePolyCurb()">Delete</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

const radiusDisplay = computed(() => {
  if (!editor.polyCurb.hasSelection) return '—';
  return editor.polyCurb.radius.toFixed(1);
});
</script>
