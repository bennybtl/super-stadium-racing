<template>
  <EditorPanel
    v-if="editor.selectedType === 'polyHill'"
    title="Poly Hill"
    @close="editor.featureAction('deselectPolyHill')"
  >
    <!-- Selected Point Section -->
    <div class="ed-heading">Selected Point</div>

    <!-- Radius -->
    <div class="ed-label">
      <span>Corner Radius</span>
      <span>{{ radiusDisplay }}</span>
    </div>
    <input
      type="range" min="0" max="30" step="0.5"
      :value="editor.polyHill.radius"
      :disabled="!editor.polyHill.canHaveRadius"
      @input="editor.setFeatureProp('polyHill', 'radius', +$event.target.value)"
      class="ed-slider"
    />
    <div v-if="!editor.polyHill.canHaveRadius && editor.polyHill.hasSelection" class="ed-hint" style="color: #ff9800;">
      First and last points cannot be rounded (unless closed loop is enabled)
    </div>

    <div class="ed-hint">WASD to move selected point</div>

    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        :disabled="!editor.polyHill.canDeletePoint"
        @click="editor.featureAction('deletePolyHillPoint')"
      >
        <i class="bi bi-trash"></i> Point
      </button>

      <button
        class="ed-btn"
        :disabled="!editor.polyHill.hasSelection"
        @click="editor.featureAction('insertPolyHillPoint')"
      >
        <i class="bi bi-plus-circle-fill"></i> Point
      </button>
    </div>

    <hr class="ed-divider" />

    <div class="ed-heading">Shape</div>

    <!-- Width -->
    <div class="ed-label">
      <span>Width</span>
      <span>{{ editor.polyHill.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="2" max="50" step="0.5"
      :value="editor.polyHill.width"
      @input="editor.setFeatureProp('polyHill', 'width', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Height -->
    <div class="ed-label">
      <span>Height</span>
      <span>{{ editor.polyHill.height.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="-10" max="10" step="0.2"
      :value="editor.polyHill.height"
      @input="editor.setFeatureProp('polyHill', 'height', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Edge: falloff profile — low = gentle toe, high = mesa-like -->
    <div class="ed-label">
      <span>Edge</span>
      <span>{{ editor.polyHill.edgeShape.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0.6" max="3" step="0.05"
      :value="editor.polyHill.edgeShape"
      @input="editor.setFeatureProp('polyHill', 'edgeShape', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Jitter: irregular, organic outline -->
    <div class="ed-label">
      <span>Jitter</span>
      <span class="flex items-center gap-2">
        <button
          v-if="editor.polyHill.jitter > 0"
          class="ed-link"
          @click="editor.featureAction('rerollPolyHillJitter')"
        >Reroll</button>
        {{ (editor.polyHill.jitter * 100).toFixed(0) }}%
      </span>
    </div>
    <input
      type="range" min="0" max="0.5" step="0.01"
      :value="editor.polyHill.jitter"
      @input="editor.setFeatureProp('polyHill', 'jitter', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Closed toggle -->
    <div class="ed-row">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.polyHill.closed"
        @change="editor.setFeatureProp('polyHill', 'closed', $event.target.checked)"
        class="ed-checkbox"
      />
    </div>

    <!-- End Taper toggle — open hills only: fade the ends down to the ground -->
    <template v-if="!editor.polyHill.closed">
      <div class="ed-row">
        <span>End Taper</span>
        <input
          type="checkbox"
          :checked="editor.polyHill.endTaper"
          @change="editor.setFeatureProp('polyHill', 'endTaper', $event.target.checked)"
          class="ed-checkbox"
        />
      </div>
    </template>

    <!-- Filled toggle -->
     <template v-if="editor.polyHill.closed">
      <div class="ed-row">
        <span>Filled</span>
        <input
          type="checkbox"
          :checked="editor.polyHill.filled"
          :disabled="!editor.polyHill.closed"
          @change="editor.setFeatureProp('polyHill', 'filled', $event.target.checked)"
          class="ed-checkbox"
        />
      </div>
    </template>

    <hr class="ed-divider" />
    <div class="ed-heading">Surface</div>

    <!-- Terrain Type -->
    <TerrainTypeSelect
      :model-value="editor.polyHill.terrainType"
      @update:modelValue="v => editor.setFeatureProp('polyHill', 'terrainType', v)"
    />

    <!-- Edge Blend: dithers the terrain-type boundary into surrounding terrain -->
    <template v-if="editor.polyHill.terrainType !== 'none'">
      <div class="ed-label">
        <span>Edge Blend</span>
        <span>{{ editor.polyHill.blendWidth.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="10" step="0.5"
        :value="editor.polyHill.blendWidth"
        @input="editor.setFeatureProp('polyHill', 'blendWidth', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <!-- Water Level — only for a closed, filled, water- or mud-type depression -->
    <template v-if="editor.polyHill.canHaveWater">
      <div class="ed-label">
        <span>{{ editor.polyHill.isMudWater ? 'Mud Level' : 'Water Level' }}</span>
        <span>{{ editor.polyHill.waterLevelOffset.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="5" step="0.1"
        :value="editor.polyHill.waterLevelOffset"
        @input="editor.setFeatureProp('polyHill', 'waterLevelOffset', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <hr class="ed-divider" />

    <!-- Actions -->
    <div class="ed-btn-row">
      <button 
        class="ed-btn-danger"
        @click="editor.featureAction('deletePolyHill')"
      >Delete</button>
      <button 
        class="ed-btn"
        @click="editor.featureAction('duplicatePolyHill')"
      >Duplicate</button>
    </div>
</EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import TerrainTypeSelect from './TerrainTypeSelect.vue';

const editor = useEditorStore();

const radiusDisplay = computed(() => {
  if (!editor.polyHill.hasSelection) return '—';
  return editor.polyHill.radius.toFixed(1);
});
</script>
