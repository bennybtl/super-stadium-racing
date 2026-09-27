<template>
  <EditorPanel
    v-if="editor.selectedType === 'startPosition'"
    title="Start Position"
    @close="editor.featureAction('deselectStartPosition')"
  >
    <!-- Hint -->
    <div class="ed-hint">WASD to move · QE to rotate · Del to delete</div>

    <div class="ed-hint">
      Overrides the default grid behind the finish line. Click a pad to pick a slot — keep the
      whole grid behind the finish line so the first lap still counts.
    </div>

    <!-- Layout mode -->
    <div class="ed-row">
      <span>Layout</span>
      <select
        :value="sp.mode"
        @change="editor.setFeatureProp('startPosition', 'mode', $event.target.value)"
        class="ed-select-inline"
      >
        <option value="grid">Grid</option>
        <option value="custom">Custom</option>
      </select>
    </div>
    <div class="ed-hint">
      {{ sp.mode === 'custom'
        ? 'Drag each pad on its own; the marker moves and turns the whole set.'
        : 'Rows are generated from the settings below.' }}
    </div>

    <!-- Rotation -->
    <div class="ed-label">
      <span>Rotation</span>
      <span>{{ sp.rotation.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="5"
      :value="sp.rotation"
      @input="editor.setFeatureProp('startPosition', 'rotation', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Grid shape -->
    <template v-if="sp.mode === 'grid'">
      <div class="ed-label">
        <span>Trucks Per Row</span>
        <span>{{ sp.columns }}</span>
      </div>
      <input
        type="range" min="1" max="10" step="1"
        :value="sp.columns"
        @input="editor.setFeatureProp('startPosition', 'columns', +$event.target.value)"
        class="ed-slider"
      />
      <div class="ed-hint">10 makes a single-row land rush start.</div>

      <div class="ed-label">
        <span>Row Spread</span>
        <span>{{ sp.colSpacing.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="2.5" max="10" step="0.5"
        :value="sp.colSpacing"
        @input="editor.setFeatureProp('startPosition', 'colSpacing', +$event.target.value)"
        class="ed-slider"
      />

      <div class="ed-label">
        <span>Row Gap</span>
        <span>{{ sp.rowSpacing.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="4" max="16" step="0.5"
        :value="sp.rowSpacing"
        @input="editor.setFeatureProp('startPosition', 'rowSpacing', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <!-- Custom layout -->
    <template v-else>
      <button
        class="ed-btn w-full mb-3"
        @click="editor.featureAction('resetStartPositionLayout')"
      >
        Reset to grid layout
      </button>
    </template>

    <hr class="ed-divider" />

    <!-- Selected slot -->
    <div class="ed-heading">Selected Slot</div>
    <div v-if="sp.selectedSlot < 0" class="ed-hint">
      Click a pad to pick the slot to edit.
    </div>
    <template v-else>
      <div class="ed-row">
        <span>Starts</span>
        <span class="text-slate-300 font-bold">
          {{ isPole ? 'Pole' : ordinal(sp.slotOrder) }}
        </span>
      </div>

      <button
        class="ed-btn w-full mb-3"
        :disabled="isPole"
        @click="editor.featureAction('setStartPositionPole')"
      >
        {{ isPole ? 'Is pole position' : 'Set as pole position' }}
      </button>

      <template v-if="sp.mode === 'custom'">
        <div class="ed-label">
          <span>Slot Rotation</span>
          <span>{{ sp.slotRotation.toFixed(0) }}°</span>
        </div>
        <input
          type="range" min="-180" max="180" step="5"
          :value="sp.slotRotation"
          @input="editor.setFeatureProp('startPosition', 'slotRotation', +$event.target.value)"
          class="ed-slider"
        />
      </template>
    </template>

    <hr class="ed-divider" />

    <button
      class="ed-btn-danger w-full"
      @click="editor.featureAction('deleteStartPosition')"
    >
      Delete
    </button>
  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
const sp = computed(() => editor.startPosition);
const isPole = computed(() => sp.value.selectedSlot === sp.value.poleIndex);

const ordinal = (n) => {
  const rest = n % 100;
  const suffix = rest >= 11 && rest <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
};
</script>
