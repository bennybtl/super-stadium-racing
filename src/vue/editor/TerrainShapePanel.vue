<template>
  <EditorPanel
    v-if="editor.selectedType === 'terrainShape'"
    title="Terrain Shape"
    @close="editor.featureAction('deselectTerrainShape')"
  >
    <!-- Hint -->
    <div class="ed-hint">WASD to move{{ editor.terrainShape.shape === 'polygon' ? '' : ' · QE to rotate' }} · Del to delete{{ editor.terrainShape.shape === 'polygon' ? ' point/shape' : '' }}</div>

    <div class="ed-heading">Shape</div>

    <!-- Shape selector -->
    <select
      class="ed-select"
      :value="editor.terrainShape.shape"
      @change="editor.setFeatureProp('terrainShape', 'shape', $event.target.value)"
    >
      <option value="rect">Rectangle</option>
      <option value="circle">Ellipse</option>
      <option value="polygon">Polygon</option>
    </select>

    <!-- Geometry controls (rect/ellipse) -->
    <template v-if="editor.terrainShape.shape !== 'polygon'">
      <div class="ed-label">
        <span>Width</span>
        <span>{{ editor.terrainShape.width.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="1" max="80" step="0.5"
        :value="editor.terrainShape.width"
        @input="editor.setFeatureProp('terrainShape', 'width', +$event.target.value)"
        class="ed-slider"
      />

      <div class="ed-label">
        <span>Depth</span>
        <span>{{ editor.terrainShape.depth.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="1" max="80" step="0.5"
        :value="editor.terrainShape.depth"
        @input="editor.setFeatureProp('terrainShape', 'depth', +$event.target.value)"
        class="ed-slider"
      />

      <div class="ed-label">
        <span>Rotation</span>
        <span>{{ editor.terrainShape.rotation.toFixed(0) }}°</span>
      </div>
      <input
        type="range" min="-180" max="180" step="2"
        :value="editor.terrainShape.rotation"
        @input="editor.setFeatureProp('terrainShape', 'rotation', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <!-- Polygon controls -->
    <template v-else>
      <div class="ed-label">
        <span>Points</span>
        <span>{{ editor.terrainShape.pointCount }}</span>
      </div>
      <div class="ed-label">
        <span>Selected Point</span>
        <span>{{ editor.terrainShape.selectedPointIndex >= 0 ? editor.terrainShape.selectedPointIndex + 1 : 'Center' }}</span>
      </div>
      <div class="ed-btn-row">
        <button
          class="ed-btn-danger"
          @click="editor.featureAction('deleteTerrainShapePoint')"
        ><i class="bi bi-trash"></i> Point</button>
        <button
          class="ed-btn"
          @click="editor.featureAction('insertTerrainShapePoint')"
        >Insert Point</button>
      </div>
    </template>
    <hr class="ed-divider" />
    <div class="ed-heading">Surface</div>

    <TerrainTypeSelect
      :model-value="editor.terrainShape.terrainType"
      @update:modelValue="v => editor.setFeatureProp('terrainShape', 'terrainType', v)"
    />

    <template v-if="editor.terrainShape.terrainType != 'none'">
      <div class="ed-label">
        <span>Edge Blend</span>
        <span>{{ editor.terrainShape.blendWidth.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="20" step="0.5"
        :value="editor.terrainShape.blendWidth"
        @input="editor.setFeatureProp('terrainShape', 'blendWidth', +$event.target.value)"
        class="ed-slider"
      />

      <div class="ed-label">
        <span>Roughness</span>
        <span>{{ editor.terrainShape.roughness.toFixed(2) }}</span>
      </div>
      <input
        type="range" min="0" max="1" step="0.05"
        :value="editor.terrainShape.roughness"
        @input="editor.setFeatureProp('terrainShape', 'roughness', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <hr class="ed-divider" />

    <!-- Actions -->
    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deleteSelectedTerrainShape')"
      >Delete</button>
      <button
        class="ed-btn"
        @click="editor.featureAction('duplicateSelectedTerrainShape')"
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
