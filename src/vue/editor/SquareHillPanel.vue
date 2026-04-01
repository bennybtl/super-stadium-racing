<template>
  <EditorPanel
    v-if="editor.selectedType === 'squareHill'"
    title="Square Hill"
    accent-color="#f0a020"
    default-right="270px"
    @close="editor.closeSquareHill()"
  >
    <!-- Width -->
    <div class="ep-row">
      <span>Width</span>
      <span>{{ editor.squareHill.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="4" max="60" step="1"
      :value="editor.squareHill.width"
      @input="editor.setSquareHillWidth(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Depth -->
    <div class="ep-row">
      <span>Depth</span>
      <span>{{ editor.squareHill.depth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="4" max="60" step="1"
      :value="editor.squareHill.depth"
      @input="editor.setSquareHillDepth(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Transition -->
    <div class="ep-row">
      <span>Transition</span>
      <span>{{ editor.squareHill.transition.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0" max="20" step="0.5"
      :value="editor.squareHill.transition"
      @input="editor.setSquareHillTransition(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Angle -->
    <div class="ep-row">
      <span>Angle</span>
      <span>{{ editor.squareHill.angle.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="0" max="359" step="1"
      :value="editor.squareHill.angle"
      @input="editor.setSquareHillAngle(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Mode toggle: Flat | Sloped -->
    <div class="ep-label">Mode</div>
    <div class="ep-btn-row">
      <button class="ep-mode-btn" :style="modeStyle(false)" @click="editor.setSquareHillMode(false)">Flat</button>
      <button class="ep-mode-btn" :style="modeStyle(true)"  @click="editor.setSquareHillMode(true)">Sloped</button>
    </div>

    <!-- Flat section -->
    <template v-if="!editor.squareHill.slopeMode">
      <div class="ep-row">
        <span>Height</span>
        <span>{{ editor.squareHill.height.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="-15" max="20" step="0.5"
        :value="editor.squareHill.height"
        @input="editor.setSquareHillHeight(+$event.target.value)"
        class="ep-slider"
      />
    </template>

    <!-- Sloped section -->
    <template v-else>
      <div class="ep-row">
        <span>Height (− edge)</span>
        <span>{{ editor.squareHill.heightAtMin.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="-15" max="20" step="0.5"
        :value="editor.squareHill.heightAtMin"
        @input="editor.setSquareHillHeightMin(+$event.target.value)"
        class="ep-slider"
      />
      <div class="ep-row">
        <span>Height (+ edge)</span>
        <span>{{ editor.squareHill.heightAtMax.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="-15" max="20" step="0.5"
        :value="editor.squareHill.heightAtMax"
        @input="editor.setSquareHillHeightMax(+$event.target.value)"
        class="ep-slider"
      />
    </template>

    <!-- Surface -->
    <div class="ep-label">Surface</div>
    <select
      class="ep-select"
      :value="editor.squareHill.terrainType"
      @change="editor.setSquareHillTerrainType($event.target.value)"
    >
      <option value="none">None (Default)</option>
      <option value="packed_dirt">Packed Dirt</option>
      <option value="loose_dirt">Loose Dirt</option>
      <option value="asphalt">Asphalt</option>
      <option value="mud">Mud</option>
      <option value="water">Water</option>
      <option value="rocky">Rocky</option>
    </select>

    <!-- Hint -->
    <div class="ep-hint">WASD to move · Q/E to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="ep-btn-dup" @click="editor.duplicateSquareHill()">Duplicate Square Hill</button>
    <button class="ep-btn-del" @click="editor.deleteSquareHill()">Delete Square Hill</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

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
