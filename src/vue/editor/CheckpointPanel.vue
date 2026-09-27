<template>
  <EditorPanel
    v-if="editor.selectedType === 'checkpoint'"
    title="Checkpoint"
    @close="editor.featureAction('deselectCheckpoint')"
  >
    <!-- Hint -->
    <div class="ed-hint">WASD to move · QE to rotate · Del to delete</div>


    <!-- Width -->
    <div class="ed-label">
      <span>Width (barrel spacing)</span>
      <span>{{ editor.checkpoint.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="4" max="30" step="0.5"
      :value="editor.checkpoint.width"
      @input="editor.setFeatureProp('checkpoint', 'width', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Heading -->
    <div class="ed-label">
      <span>Rotation</span>
      <span>{{ editor.checkpoint.heading.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="5"
      :value="editor.checkpoint.heading"
      @input="editor.setFeatureProp('checkpoint', 'heading', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Order -->
    <div class="ed-label">
      <span>Order</span>
      <span class="text-slate-300" style="font-weight: bold">#{{ editor.checkpoint.orderNum }}</span>
    </div>
    <div class="ed-btn-row">
      <button class="ed-btn" @click="editor.featureAction('shiftCheckpointOrder', -1)"><i class="bi bi-arrow-left"></i> Earlier</button>
      <button class="ed-btn" @click="editor.featureAction('shiftCheckpointOrder', 1)">Later <i class="bi bi-arrow-right"></i></button>
    </div>

    <!-- Alternative route -->
    <label
      class="ed-row mb-1"
      :class="editor.checkpoint.canBeAlternative ? 'cursor-pointer' : 'text-slate-500'"
    >
      <span>Alternative to previous (same step)</span>
      <input
        type="checkbox"
        class="ed-checkbox"
        :checked="editor.checkpoint.alternative"
        :disabled="!editor.checkpoint.canBeAlternative"
        @change="editor.setFeatureProp('checkpoint', 'alternative', $event.target.checked)"
      />
    </label>
    <div class="ed-hint">
      Shares this step with the previous checkpoint — the driver passes either one to advance. Use for branching routes.
    </div>

    <!-- Joker lap -->
    <label
      class="ed-row mb-1"
      :class="editor.checkpoint.canBeJokerLap ? 'cursor-pointer' : 'text-slate-500'"
    >
      <span>Joker lap</span>
      <input
        type="checkbox"
        class="ed-checkbox"
        :checked="editor.checkpoint.jokerLap"
        :disabled="!editor.checkpoint.canBeJokerLap"
        @change="editor.setFeatureProp('checkpoint', 'jokerLap', $event.target.checked)"
      />
    </label>
    <div class="ed-hint">
      A branch off the previous checkpoint that's never required — the driver only has to take it once, on any lap, over the whole race.
    </div>

    <hr class="ed-divider" />

    <!-- Actions -->
    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deleteSelectedCheckpoint')"
      >
        Delete
      </button>
      <button
        class="ed-btn"
        @click="editor.featureAction('duplicateSelectedCheckpoint')"
      >
        Duplicate
      </button>
    </div>

</EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
