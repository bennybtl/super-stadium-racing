<template>
  <EditorPanel
    v-if="editor.selectedType === 'squareHill'"
    title="Square Hill"
    @close="editor.featureAction('deselectSquareHill')"
  >
    <!-- Hint -->
    <div class="ed-hint">WASD to move · Q/E to rotate · Del to delete</div>

    <div class="ed-heading">Shape</div>

    <!-- Mode toggle: Flat | Sloped -->
    <div class="ed-label">Mode</div>
    <div class="ed-btn-row">
      <button class="ed-seg" :style="modeStyle(false)" @click="editor.setSquareHillMode(false)">Flat</button>
      <button class="ed-seg" :style="modeStyle(true)"  @click="editor.setSquareHillMode(true)">Sloped</button>
    </div>

    <!-- Width -->
    <div class="ed-label">
      <span>Width</span>
      <span>{{ editor.squareHill.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="60" step="0.5"
      :value="editor.squareHill.width"
      @input="editor.setFeatureProp('squareHill', 'width', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Depth -->
    <div class="ed-label">
      <span>Depth</span>
      <span>{{ editor.squareHill.depth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="60" step="0.5"
      :value="editor.squareHill.depth"
      @input="editor.setFeatureProp('squareHill', 'depth', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Angle -->
    <div class="ed-label">
      <span>Rotation</span>
      <span>{{ editor.squareHill.angle.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="5"
      :value="editor.squareHill.angle"
      @input="editor.setFeatureProp('squareHill', 'angle', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Flat section -->
    <template v-if="!editor.squareHill.slopeMode">
      <div class="ed-label">
        <span>Height</span>
        <span>{{ editor.squareHill.height.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="-10" max="10" step="0.2"
        :value="editor.squareHill.height"
        @input="editor.setFeatureProp('squareHill', 'height', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <!-- Sloped section -->
    <template v-else>
      <div class="ed-label">
        <span>Height (− edge)</span>
        <span>{{ editor.squareHill.heightAtMin.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="-10" max="10" step="0.5"
        :value="editor.squareHill.heightAtMin"
        @input="editor.setSquareHillHeightMin(+$event.target.value)"
        class="ed-slider"
      />
      <div class="ed-label">
        <span>Height (+ edge)</span>
        <span>{{ editor.squareHill.heightAtMax.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="-10" max="10" step="0.5"
        :value="editor.squareHill.heightAtMax"
        @input="editor.setSquareHillHeightMax(+$event.target.value)"
        class="ed-slider"
      />
    </template>

    <!-- Transition -->
    <div class="ed-label">
      <span>Transition</span>
      <span>{{ editor.squareHill.transition.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="15" step="0.5"
      :value="editor.squareHill.transition"
      @input="editor.setFeatureProp('squareHill', 'transition', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Edge: falloff profile across the smoothing band — low = gentle toe,
         high = holds height then drops late (mesa) -->
    <div class="ed-label">
      <span>Edge</span>
      <span>{{ editor.squareHill.edgeShape.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0.6" max="3" step="0.05"
      :value="editor.squareHill.edgeShape"
      @input="editor.setFeatureProp('squareHill', 'edgeShape', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Jitter: irregular outline instead of a perfect rect -->
    <div class="ed-label">
      <span>Jitter</span>
      <span class="flex items-center gap-2">
        <button
          v-if="editor.squareHill.jitter > 0"
          class="ed-link"
          @click="editor.featureAction('rerollSquareHillJitter')"
        >Reroll</button>
        {{ (editor.squareHill.jitter * 100).toFixed(0) }}%
      </span>
    </div>
    <input
      type="range" min="0" max="0.5" step="0.01"
      :value="editor.squareHill.jitter"
      @input="editor.setFeatureProp('squareHill', 'jitter', +$event.target.value)"
      class="ed-slider"
    />

    <hr class="ed-divider" />
    <div class="ed-heading">Surface</div>

    <TerrainTypeSelect
      :model-value="editor.squareHill.terrainType"
      @update:modelValue="v => editor.setFeatureProp('squareHill', 'terrainType', v)"
    />

    <!-- Edge Blend: dithers the terrain-type boundary into surrounding terrain -->
    <template v-if="editor.squareHill.terrainType !== 'none'">
      <div class="ed-label">
        <span>Edge Blend</span>
        <span>{{ editor.squareHill.blendWidth.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="10" step="0.5"
        :value="editor.squareHill.blendWidth"
        @input="editor.setFeatureProp('squareHill', 'blendWidth', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <!-- Water Level (also fills a mud-painted depression with muddy water) -->
    <template v-if="editor.squareHill.terrainType == 'water' || editor.squareHill.terrainType == 'mud'" >
      <div class="ed-label">
        <span>{{ editor.squareHill.terrainType == 'mud' ? 'Mud Level' : 'Water Level' }}</span>
        <span>{{ editor.squareHill.waterLevelOffset.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="5" step="0.5"
        :value="editor.squareHill.waterLevelOffset"
        @input="editor.setFeatureProp('squareHill', 'waterLevelOffset', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <hr class="ed-divider" />

    <!-- Reverse-race override -->
    <div class="ed-heading">Reverse</div>

    <div class="ed-row">
      <span>Reverse Mode</span>
      <select
        :value="editor.squareHill.reverseMode"
        @change="editor.setFeatureProp('squareHill', 'reverseMode', $event.target.value)"
        class="ed-select-inline"
      >
        <option value="active">Active</option>
        <option value="rotate180">Rotate 180</option>
        <option value="remove">Remove</option>
        <option value="only">Only</option>
      </select>
    </div>
    <div class="ed-hint">What happens to this hill in reverse mode?</div>

    <hr class="ed-divider" />

    <!-- Actions -->
    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deleteSelectedSquareHill')"
      >Delete</button>

      <button 
        class="ed-btn"
        @click="editor.featureAction('duplicateSelectedSquareHill')"
      >Duplicate</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import TerrainTypeSelect from './TerrainTypeSelect.vue';

const editor = useEditorStore();

function modeStyle(isSloped) {
  const active = editor.squareHill.slopeMode === isSloped;
  return {
    background: active ? '#f0a020' : 'transparent',
    color:      active ? '#000'    : '#f0a020',
    border:     '1px solid #f0a020',
  };
}
</script>
