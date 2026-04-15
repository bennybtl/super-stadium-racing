<template>
  <EditorPanel
    v-if="editor.selectedType === 'polyHill'"
    title="Poly Hill"
    accent-color="#88c440"
    @close="editor.closePolyHill()"
  >
    <!-- Selected Point Section -->
    <div class="ep-section-title">Selected Point</div>

    <!-- Radius -->
    <div class="ep-row">
      <span>Radius</span>
      <span>{{ radiusDisplay }}</span>
    </div>
    <input
      type="range" min="0" max="30" step="0.5"
      :value="editor.polyHill.radius"
      :disabled="!editor.polyHill.canHaveRadius"
      @input="editor.setPolyHillRadius(+$event.target.value)"
      class="ep-slider"
    />
    <div v-if="!editor.polyHill.canHaveRadius && editor.polyHill.hasSelection" class="ep-hint" style="color: #ff9800;">
      First and last points cannot be rounded (unless closed loop is enabled)
    </div>

    <div class="ep-hint">WASD to move selected point</div>

    <button class="ep-btn-action" @click="editor.insertPolyHillPoint()">Insert Point After</button>
    <button class="ep-btn-del" @click="editor.deletePolyHillPoint()">Delete Point</button>

    <hr class="ep-separator" />

    <!-- Hill Properties Section -->
    <div class="ep-section-title">Hill Properties</div>

    <!-- Height -->
    <div class="ep-row">
      <span>Height</span>
      <span>{{ editor.polyHill.height.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="10" step="0.5"
      :value="editor.polyHill.height"
      @input="editor.setPolyHillHeight(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Width -->
    <div class="ep-row">
      <span>Width</span>
      <span>{{ editor.polyHill.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="2" max="50" step="0.5"
      :value="editor.polyHill.width"
      @input="editor.setPolyHillWidth(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Closed toggle -->
    <div class="ep-row">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.polyHill.closed"
        @change="editor.setPolyHillClosed($event.target.checked)"
        class="ep-checkbox"
      />
    </div>

    <hr class="ep-separator" />
    <div class="ep-btn-row">
      <button class="ep-btn-dup" @click="editor.duplicatePolyHill()">Duplicate</button>
      <button class="ep-btn-del" @click="editor.deletePolyHill()">Delete</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

const radiusDisplay = computed(() => {
  if (!editor.polyHill.hasSelection) return '—';
  return editor.polyHill.radius.toFixed(1);
});
</script>
