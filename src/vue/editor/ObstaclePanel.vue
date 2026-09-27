<template>
  <EditorPanel
    v-if="editor.selectedType === 'obstacle'"
    title="Obstacle"
    @close="editor.featureAction('closeObstacle')"
  >
    <div class="ed-hint">
      Right-click terrain to place copy of selected obstacle.
      <br>WASD to move · QE to rotate · Del to delete
    </div>

    <div class="ed-label">Obstacle Type</div>
    <select
      class="ed-select"
      :value="editor.obstacle.type"
      @change="editor.setObstacleType($event.target.value)"
    >
      <option v-for="opt in obstacleTypes" :key="opt.id" :value="opt.id">{{ opt.name }}</option>
    </select>

    <template v-if="currentSpec?.stack">
      <div class="ed-label">
        <span>Tires</span>
        <span>{{ editor.obstacle.count }}</span>
      </div>
      <input
        type="range" :min="currentSpec.stack.min" :max="currentSpec.stack.max" step="1"
        :value="editor.obstacle.count"
        @input="editor.setFeatureProp('obstacle', 'count', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <div class="ed-label">
      <span>Scale</span>
      <span>{{ editor.obstacle.scale.toFixed(2) }}x</span>
    </div>
    <input
      type="range" min="0.5" max="2.5" step="0.1"
      :value="editor.obstacle.scale"
      @input="editor.setFeatureProp('obstacle', 'scale', +$event.target.value)"
      class="ed-slider"
    />

    <template v-if="editor.obstacle.type !== 'tireStack' && editor.obstacle.type !== 'barrel'">
      <div class="ed-label">
        <span>Rotation</span>
        <span>{{ editor.obstacle.rotation.toFixed(0) }}°</span>
      </div>
      <input
        type="range" min="-180" max="180" step="5"
        :value="editor.obstacle.rotation"
        @input="editor.setFeatureProp('obstacle', 'rotation', +$event.target.value)"
        class="ed-slider"
      />
    </template>
    <div class="ed-label">
      <span>Weight</span>
      <span>{{ editor.obstacle.weight.toFixed(1) }} kg</span>
    </div>
    <input
      type="range" min="5" max="120" step="1"
      :value="editor.obstacle.weight"
      @input="editor.setFeatureProp('obstacle', 'weight', +$event.target.value)"
      class="ed-slider"
    />

    <div class="ed-label">Obstacle Color</div>
    <select
      class="ed-select"
      :value="editor.obstacle.color"
      @change="editor.setFeatureProp('obstacle', 'color', $event.target.value)"
    >
      <option v-for="opt in editor.obstacle.colorOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
    </select>

    <hr class="ed-divider" />

    <!-- Actions -->
    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deleteSelectedObstacle')"
      >
        Delete
      </button>
      <button
        class="ed-btn"
        @click="editor.featureAction('resetObstacleDefaults')"
      >
        Reset
      </button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

// Everything discovered in /src/obstacles/ (see ObstacleLoader), sorted by name.
const obstacleTypes = computed(() =>
  [...(window.obstacleLoader?.getObstacleList() ?? [])].sort((a, b) => a.name.localeCompare(b.name))
);

// Full def for the selected type — used for its `stack` config (the tire
// count slider only shows for a stackable obstacle, see tireStack.json).
const currentSpec = computed(() => window.obstacleLoader?.getObstacle(editor.obstacle.type));
</script>
