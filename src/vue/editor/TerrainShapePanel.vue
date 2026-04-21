<template>
  <EditorPanel
    v-if="editor.selectedType === 'terrainShape'"
    title="Terrain Shape"
    @close="editor.closeTerrainShape()"
  >
    <!-- Shape selector -->
    <div class="text-[12px] mb-1">Shape</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.terrainShape.shape"
      @change="editor.setTerrainShapeShape($event.target.value)"
    >
      <option value="rect">Rectangle</option>
      <option value="circle">Ellipse</option>
    </select>

    <!-- Geometry controls -->
    <template v-if="true">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Width</span>
        <span>{{ editor.terrainShape.width.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="1" max="80" step="0.5"
        :value="editor.terrainShape.width"
        @input="editor.setTerrainShapeWidth(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Depth</span>
        <span>{{ editor.terrainShape.depth.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="1" max="80" step="0.5"
        :value="editor.terrainShape.depth"
        @input="editor.setTerrainShapeDepth(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Rotation</span>
        <span>{{ editor.terrainShape.rotation.toFixed(0) }}°</span>
      </div>
      <input
        type="range" min="0" max="360" step="1"
        :value="editor.terrainShape.rotation"
        @input="editor.setTerrainShapeRotation(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>

    <!-- Surface -->
    <div class="text-[12px] mb-1">Surface</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.terrainShape.terrainType"
      @change="editor.setTerrainShapeTerrainType($event.target.value)"
    >
      <option value="packed_dirt">Packed Dirt</option>
      <option value="loose_dirt">Loose Dirt</option>
      <option value="asphalt">Asphalt</option>
      <option value="mud">Mud</option>
      <option value="water">Water</option>
      <option value="rocky">Rocky</option>
      <option value="grass">Grass</option>
    </select>

    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · QE to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.duplicateTerrainShape()">Duplicate Shape</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deleteTerrainShape()">Delete Shape</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
