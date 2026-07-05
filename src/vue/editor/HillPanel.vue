<template>
  <EditorPanel
    v-if="editor.selectedType === 'hill'"
    title="Hill"
    @close="editor.featureAction('deselectHill')"
  >
  <!-- Hint -->
  <div class="text-[10px] text-slate-400 mb-3">WASD to move · QE to rotate · Del to delete</div>

  <!-- Width Radius -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.hill.radiusX.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="3" max="40" step="0.5"
      :value="editor.hill.radiusX"
      @input="editor.setFeatureProp('hill', 'radiusX', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Depth Radius -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Depth</span>
      <span>{{ editor.hill.radiusZ.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="3" max="40" step="0.5"
      :value="editor.hill.radiusZ"
      @input="editor.setFeatureProp('hill', 'radiusZ', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rotation</span>
      <span>{{ editor.hill.rotation.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="0" max="180" step="1"
      :value="editor.hill.rotation"
      @input="editor.setFeatureProp('hill', 'rotation', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Height</span>
      <span>{{ editor.hill.height.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="-15" max="20" step="0.5"
      :value="editor.hill.height"
      @input="editor.setFeatureProp('hill', 'height', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

      <!-- Terrain Type -->
    <TerrainTypeSelect
      :model-value="editor.hill.terrainType"
      @update:modelValue="v => editor.setFeatureProp('hill', 'terrainType', v)"
    />

    <!-- Edge Blend: dithers the terrain-type boundary into surrounding terrain -->
    <template v-if="editor.hill.terrainType !== 'none'">
      <div class="flex justify-between mb-1 mt-3 text-[12px]">
        <span>Edge Blend</span>
        <span>{{ editor.hill.blendWidth.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="20" step="0.5"
        :value="editor.hill.blendWidth"
        @input="editor.setFeatureProp('hill', 'blendWidth', +$event.target.value)"
        class="w-full accent-[var(--accent)] cursor-pointer"
      />
    </template>

    <!-- Water Level -->
     <template v-if="editor.hill.terrainType == 'water'">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Water Level</span>
        <span>{{ editor.hill.waterLevelOffset.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="15" step="0.1"
        :value="editor.hill.waterLevelOffset"
        @input="editor.setFeatureProp('hill', 'waterLevelOffset', +$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <div class="flex gap-2">
      <button 
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deleteSelectedHill')"
      >Delete</button>
      <button 
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('duplicateSelectedHill')"
      >Duplicate</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import TerrainTypeSelect from './TerrainTypeSelect.vue';

const editor = useEditorStore();
</script>
