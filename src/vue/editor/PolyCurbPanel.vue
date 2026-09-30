<template>
  <EditorPanel
    v-if="editor.selectedType === 'polyCurb'"
    title="Poly Curb"
    @close="editor.featureAction('closePolyCurb')"
  >
    <div class="ed-hint">
      Right-click terrain to add points. Select a point to edit it. Press <kbd>Esc</kbd> to close the panel.
    </div>

    <!-- Selected Point Section -->
    <div class="ed-heading">Selected Point</div>

    <!-- Radius -->
    <div class="ed-label">
      <span>Corner Radius</span>
      <span :style="editor.polyCurb.radius > editor.polyCurb.maxRadius ? { color: '#ff4444' } : {}">{{ radiusDisplay }}</span>
    </div>
    <input
      type="range" min="0" max="30" step="0.5"
      :value="editor.polyCurb.radius"
      :disabled="!editor.polyCurb.canHaveRadius"
      @input="editor.setFeatureProp('polyCurb', 'radius', +$event.target.value)"
      class="ed-slider"
    />
    <div v-if="!editor.polyCurb.canHaveRadius && editor.polyCurb.hasSelection" class="ed-hint" style="color: #ff9800;">
      First and last points cannot be rounded (unless closed loop is enabled)
    </div>

    <div class="ed-hint">WASD to move selected point</div>

    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deletePolyCurbPoint')"
      ><i class="bi bi-trash"></i> Point</button>
      <button
        class="ed-btn"
        @click="editor.featureAction('insertPolyCurbPoint')"
      ><i class="bi bi-plus-circle-fill"></i> Point</button>
    </div>
    <hr class="ed-divider" />

    <div class="ed-heading">Shape</div>

    <!-- Width (lateral strip width) -->
    <div class="ed-label">
      <span>Width</span>
      <span>{{ editor.polyCurb.width.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="0.25" max="2.5" step="0.25"
      :value="editor.polyCurb.width"
      @input="editor.setFeatureProp('polyCurb', 'width', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Height (bump height) -->
    <div class="ed-label">
      <span>Height</span>
      <span>{{ editor.polyCurb.height.toFixed(2) }} m</span>
    </div>
    <input
      type="range" min="0.08" max="0.5" step="0.02"
      :value="editor.polyCurb.height"
      @input="editor.setFeatureProp('polyCurb', 'height', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Closed toggle -->
    <div class="ed-row">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.polyCurb.closed"
        @change="editor.setFeatureProp('polyCurb', 'closed', $event.target.checked)"
        class="ed-checkbox"
      />
    </div>

    <hr class="ed-divider" />
    <div class="ed-heading">Appearance</div>

    <!-- Stripe colours (1–3, any combination) -->
    <StripeColorPicker
      :model-value="editor.polyCurb.colors"
      @update:model-value="editor.setFeatureProp('polyCurb', 'colors', $event)"
    />

    <hr class="ed-divider" />

    <!-- Actions -->
    <div class="ed-btn-row">
    <button 
        class="ed-btn-danger"
      @click="editor.featureAction('deletePolyCurb')"
    >Delete</button>
    <button 
        class="ed-btn"
      @click="editor.featureAction('duplicatePolyCurb')"
    >Duplicate</button>

  </div>
  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import StripeColorPicker from './StripeColorPicker.vue';

const editor = useEditorStore();

const radiusDisplay = computed(() => {
  if (!editor.polyCurb.hasSelection) return '—';
  return editor.polyCurb.radius.toFixed(1);
});
</script>
