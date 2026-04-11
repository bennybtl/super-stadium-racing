<template>
  <EditorPanel
    v-if="editor.selectedType === 'terrainShape'"
    title="Terrain Shape"
    accent-color="#4a9eff"
    @close="editor.closeTerrainShape()"
  >
    <!-- Shape selector -->
    <div class="ep-label">Shape</div>
    <select
      class="ep-select"
      :value="editor.terrainShape.shape"
      @change="editor.setTerrainShapeShape($event.tsarget.value)"
    >
      <option value="rect">Rectangle</option>
      <option value="circle">Circle</option>
    </select>

    <!-- Rectangle controls -->
    <template v-if="editor.terrainShape.shape === 'rect'">
      <div class="ep-row">
        <span>Width</span>
        <span>{{ editor.terrainShape.width.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="1" max="80" step="0.5"
        :value="editor.terrainShape.width"
        @input="editor.setTerrainShapeWidth(+$event.target.value)"
        class="ep-slider"
      />

      <div class="ep-row">
        <span>Depth</span>
        <span>{{ editor.terrainShape.depth.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="1" max="80" step="0.5"
        :value="editor.terrainShape.depth"
        @input="editor.setTerrainShapeDepth(+$event.target.value)"
        class="ep-slider"
      />

      <div class="ep-row">
        <span>Rotation</span>
        <span>{{ editor.terrainShape.rotation.toFixed(0) }}°</span>
      </div>
      <input
        type="range" min="0" max="360" step="1"
        :value="editor.terrainShape.rotation"
        @input="editor.setTerrainShapeRotation(+$event.target.value)"
        class="ep-slider"
      />
    </template>

    <!-- Circle controls -->
    <template v-else>
      <div class="ep-row">
        <span>Radius</span>
        <span>{{ editor.terrainShape.radius.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="1" max="40" step="0.5"
        :value="editor.terrainShape.radius"
        @input="editor.setTerrainShapeRadius(+$event.target.value)"
        class="ep-slider"
      />
    </template>

    <!-- Surface -->
    <div class="ep-label">Surface</div>
    <select
      class="ep-select"
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
    <div class="ep-hint">WASD to move · Del to delete</div>

    <!-- Actions -->
    <button class="ep-btn-dup" @click="editor.duplicateTerrainShape()">Duplicate Shape</button>
    <button class="ep-btn-del" @click="editor.deleteTerrainShape()">Delete Shape</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
