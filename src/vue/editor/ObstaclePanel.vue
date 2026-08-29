<template>
  <EditorPanel
    v-if="editor.selectedType === 'obstacle'"
    title="Obstacle"
    @close="editor.featureAction('closeObstacle')"
  >
    <div class="text-[10px] text-slate-400 mb-3">
      Right-click terrain to place copy of selected obstacle.
      <br>WASD to move · QE to rotate · Del to delete
    </div>

    <div class="text-[12px] mb-1">Obstacle Type</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.obstacle.type"
      @change="editor.setObstacleType($event.target.value)"
    >
      <option v-for="opt in obstacleTypes" :key="opt.id" :value="opt.id">{{ opt.name }}</option>
    </select>

    <template v-if="currentSpec?.stack">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Tires</span>
        <span>{{ editor.obstacle.count }}</span>
      </div>
      <input
        type="range" :min="currentSpec.stack.min" :max="currentSpec.stack.max" step="1"
        :value="editor.obstacle.count"
        @input="editor.setFeatureProp('obstacle', 'count', +$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>

    <div class="text-[12px] mb-1">Obstacle Color</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.obstacle.color"
      @change="editor.setFeatureProp('obstacle', 'color', $event.target.value)"
    >
      <option v-for="opt in editor.obstacle.colorOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
    </select>

    <div class="flex justify-between mb-1 text-[12px]">
      <span>Scale</span>
      <span>{{ editor.obstacle.scale.toFixed(2) }}x</span>
    </div>
    <input
      type="range" min="0.5" max="5" step="0.1"
      :value="editor.obstacle.scale"
      @input="editor.setFeatureProp('obstacle', 'scale', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <template v-if="editor.obstacle.type !== 'tireStack' && editor.obstacle.type !== 'barrel'">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Rotation</span>
        <span>{{ editor.obstacle.rotation.toFixed(0) }}°</span>
      </div>
      <input
        type="range" min="-180" max="180" step="5"
        :value="editor.obstacle.rotation"
        @input="editor.setFeatureProp('obstacle', 'rotation', +$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Weight</span>
      <span>{{ editor.obstacle.weight.toFixed(1) }} kg</span>
    </div>
    <input
      type="range" min="5" max="120" step="1"
      :value="editor.obstacle.weight"
      @input="editor.setFeatureProp('obstacle', 'weight', +$event.target.value)"
      class="w-full accent-[var(--accent)] cursor-pointer"
    />

    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <div class="flex gap-2">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deleteSelectedObstacle')"
      >
        Delete
      </button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
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
