<template>
  <EditorPanel
    v-if="editor.selectedType === 'terrainPath'"
    title="Terrain Path"
    @close="editor.featureAction('closeTerrainPath')"
  >
    <div class="ed-hint">
      Right-click terrain to add waypoints. Select a node to edit it. Press <kbd>Esc</kbd> to close the panel.
    </div>

    <!-- Selected Point Section -->
    <div class="ed-heading">Selected Point</div>
    <div class="ed-hint">WASD to move selected waypoint</div>
    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deleteTerrainPathWaypoint')"
      >
        Delete Point
      </button>
      <button
        class="ed-btn"
        @click="editor.featureAction('insertTerrainPathWaypoint')"
      >
        Insert Point
      </button>
    </div>

    <hr class="ed-divider" />

    <div class="ed-heading">Shape</div>

    <!-- Width -->
    <div class="ed-label">
      <span>Width</span>
      <span>{{ editor.terrainPath.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="1" max="40" step="0.5"
      :value="editor.terrainPath.width"
      @input="editor.setFeatureProp('terrainPath', 'width', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Corner radius -->
    <div class="ed-label">
      <span>Corner Radius</span>
      <span>{{ editor.terrainPath.cornerRadius.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0" max="20" step="0.5"
      :value="editor.terrainPath.cornerRadius"
      @input="editor.setFeatureProp('terrainPath', 'cornerRadius', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Closed toggle -->
    <div class="ed-row">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.terrainPath.closed"
        @change="editor.setFeatureProp('terrainPath', 'closed', $event.target.checked)"
        class="ed-checkbox"
      />
    </div>


    <hr class="ed-divider" />
    <div class="ed-heading">Surface</div>

    <TerrainTypeSelect
      :model-value="editor.terrainPath.terrainType"
      @update:modelValue="v => editor.setFeatureProp('terrainPath', 'terrainType', v)"
    />

    <!-- Edge blend -->
    <template v-if="editor.terrainPath.terrainType !== 'none'">
      <div class="ed-label">
        <span>Edge Blend</span>
        <span>{{ editor.terrainPath.blendWidth.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="10" step="0.5"
        :value="editor.terrainPath.blendWidth"
        @input="editor.setFeatureProp('terrainPath', 'blendWidth', +$event.target.value)"
        class="ed-slider"
      />

      <div class="ed-label">
        <span>Roughness</span>
        <span>{{ editor.terrainPath.roughness.toFixed(2) }}</span>
      </div>
      <input
        type="range" min="0" max="1" step="0.05"
        :value="editor.terrainPath.roughness"
        @input="editor.setFeatureProp('terrainPath', 'roughness', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <hr class="ed-divider" />

    <!-- Actions -->
    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deleteTerrainPath')"
      >
        Delete
      </button>
      <button
        class="ed-btn"
        @click="editor.featureAction('duplicateTerrainPath')"
      >
        Duplicate
      </button>
    </div>

  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import TerrainTypeSelect from './TerrainTypeSelect.vue';

const editor = useEditorStore();
</script>
