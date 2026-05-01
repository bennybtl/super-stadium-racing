<template>
  <EditorPanel
    v-if="editor.selectedType === 'obstacle'"
    title="Obstacle"
    @close="editor.closeObstacle()"
  >
    <div class="text-[12px] mb-1">Obstacle Type</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.obstacle.type"
      @change="editor.setObstacleType($event.target.value)"
    >
      <option v-for="opt in editor.obstacle.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
    </select>

    <div class="flex justify-between mb-1 text-[12px]">
      <span>Scale</span>
      <span>{{ editor.obstacle.scale.toFixed(2) }}x</span>
    </div>
    <input
      type="range" min="0.1" max="3" step="0.01"
      :value="editor.obstacle.scale"
      @input="editor.setObstacleScale(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rotation</span>
      <span>{{ editor.obstacle.rotation.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="1"
      :value="editor.obstacle.rotation"
      @input="editor.setObstacleRotation(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <div class="flex justify-between mb-1 text-[12px]">
      <span>Weight</span>
      <span>{{ editor.obstacle.weight.toFixed(1) }} kg</span>
    </div>
    <input
      type="range" min="5" max="120" step="1"
      :value="editor.obstacle.weight"
      @input="editor.setObstacleWeight(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <label class="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-[12px] mb-3">
      <span>Click-to-Place Mode</span>
      <input
        type="checkbox"
        :checked="editor.obstacle.placementActive"
        @change="editor.setObstaclePlacementActive($event.target.checked)"
        class="h-4 w-4 accent-[var(--accent)]"
      />
    </label>

    <div class="text-[10px] text-slate-400 mb-3">Choose Obstacle from Add Feature, then click terrain to place. Q/E rotates hay bales when selected.</div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
