<template>
  <EditorPanel
    v-if="editor.selectedType === 'driveBox'"
    title="Drive Box"
    @close="editor.featureAction('deselectDriveBox')"
  >
    <!-- Hint -->
    <div class="ed-hint">WASD to move · Q/E to rotate · Del to delete</div>

    <div class="ed-heading">Shape</div>

    <!-- Mode toggle: Flat | Wedge -->
    <div class="ed-label">Mode</div>
    <div class="ed-btn-row">
      <button class="ed-seg" :style="modeStyle(false)" @click="editor.setFeatureProp('driveBox', 'slopeMode', false)">Flat</button>
      <button class="ed-seg" :style="modeStyle(true)"  @click="editor.setFeatureProp('driveBox', 'slopeMode', true)">Wedge</button>
    </div>

    <!-- Width -->
    <div class="ed-label">
      <span>Width</span>
      <span>{{ editor.driveBox.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="1" max="40" step="0.5"
      :value="editor.driveBox.width"
      @input="editor.setFeatureProp('driveBox', 'width', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Depth -->
    <div class="ed-label">
      <span>Depth</span>
      <span>{{ editor.driveBox.depth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="1" max="40" step="0.5"
      :value="editor.driveBox.depth"
      @input="editor.setFeatureProp('driveBox', 'depth', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Rotation -->
    <div class="ed-label">
      <span>Rotation</span>
      <span>{{ editor.driveBox.rotation.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="2"
      :value="editor.driveBox.rotation"
      @input="editor.setFeatureProp('driveBox', 'rotation', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Flat section -->
    <template v-if="!editor.driveBox.slopeMode">
      <div class="ed-label">
        <span>Height</span>
        <span>{{ editor.driveBox.height.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="-2" max="8" step="0.5"
        :value="editor.driveBox.height"
        @input="editor.setFeatureProp('driveBox', 'height', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <!-- Wedge section -->
    <template v-else>
      <div class="ed-label">
        <span>Height (− edge)</span>
        <span>{{ editor.driveBox.heightAtMin.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="8" step="0.5"
        :value="editor.driveBox.heightAtMin"
        @input="editor.setFeatureProp('driveBox', 'heightAtMin', +$event.target.value)"
        class="ed-slider"
      />
      <div class="ed-label">
        <span>Height (+ edge)</span>
        <span>{{ editor.driveBox.heightAtMax.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="8" step="0.5"
        :value="editor.driveBox.heightAtMax"
        @input="editor.setFeatureProp('driveBox', 'heightAtMax', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <!-- Base toggle: Solid | Slab -->
    <div class="ed-label">Base</div>
    <div class="ed-btn-row">
      <button class="ed-seg" :style="baseStyle(true)"  @click="editor.setFeatureProp('driveBox', 'solidBase', true)">Solid</button>
      <button class="ed-seg" :style="baseStyle(false)" @click="editor.setFeatureProp('driveBox', 'solidBase', false)">Slab</button>
    </div>

    <!-- Thickness (slab only) -->
    <template v-if="!editor.driveBox.solidBase">
      <div class="ed-label">
        <span>Thickness</span>
        <span>{{ editor.driveBox.thickness.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0.1" max="2" step="0.1"
        :value="editor.driveBox.thickness"
        @input="editor.setFeatureProp('driveBox', 'thickness', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <!-- Support legs -->
    <label class="ed-row cursor-pointer">
      <span>Supports</span>
      <input type="checkbox" class="ed-checkbox" :checked="editor.driveBox.legs" @change="editor.setFeatureProp('driveBox', 'legs', $event.target.checked)" />
    </label>

    <!-- Layer -->
    <div class="ed-label">
      <span>Layer</span>
      <span>{{ editor.driveBox.layerId }}</span>
    </div>
    <input
      type="range" min="0" max="2" step="1"
      :value="editor.driveBox.layerId"
      @input="editor.setFeatureProp('driveBox', 'layerId', +$event.target.value)"
      class="ed-slider"
    />

    <hr class="ed-divider" />
    <div class="ed-heading">Appearance</div>

    <!-- Colors: terrain-blend look or flat diffuse, top and sides separately -->
    <div class="ed-row">
      <span class="flex items-center gap-2">
        <span
          class="inline-block w-3 h-3 rounded-sm border border-slate-500"
          :style="{ background: swatch(editor.driveBox.color) }"
        />
        Top
      </span>
      <select
        :value="editor.driveBox.color"
        @change="editor.setFeatureProp('driveBox', 'color', $event.target.value)"
        class="ed-select-inline"
      >
        <option v-for="opt in colorOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </div>

    <div class="ed-row">
      <span class="flex items-center gap-2">
        <span
          class="inline-block w-3 h-3 rounded-sm border border-slate-500"
          :style="{ background: swatch(editor.driveBox.sideColor) }"
        />
        Sides
      </span>
      <select
        :value="editor.driveBox.sideColor"
        @change="editor.setFeatureProp('driveBox', 'sideColor', $event.target.value)"
        class="ed-select-inline"
      >
        <option v-for="opt in colorOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </div>

    <hr class="ed-divider" />

    <!-- Reverse-race override -->
    <div class="ed-heading">Reverse</div>

    <div class="ed-row">
      <span>Reverse Mode</span>
      <select
        :value="editor.driveBox.reverseMode"
        @change="editor.setFeatureProp('driveBox', 'reverseMode', $event.target.value)"
        class="ed-select-inline"
      >
        <option value="active">Active</option>
        <option value="rotate180">Rotate 180</option>
        <option value="remove">Remove</option>
        <option value="only">Only</option>
      </select>
    </div>
    <div class="ed-hint">What happens to this box in reverse mode?</div>

    <hr class="ed-divider" />

    <!-- Actions -->
    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deleteSelectedDriveBox')"
      >Delete</button>

      <button
        class="ed-btn"
        @click="editor.featureAction('duplicateSelectedDriveBox')"
      >Duplicate</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import { SURFACE_COLOR_OPTIONS as colorOptions, surfaceSwatch as swatch } from './surfaceColors.js';

const editor = useEditorStore();

function modeStyle(isSloped) {
  const active = editor.driveBox.slopeMode === isSloped;
  return {
    background: active ? '#f0a020' : 'transparent',
    color:      active ? '#000'    : '#f0a020',
    border:     '1px solid #f0a020',
  };
}

function baseStyle(isSolid) {
  const active = editor.driveBox.solidBase === isSolid;
  return {
    background: active ? '#f0a020' : 'transparent',
    color:      active ? '#000'    : '#f0a020',
    border:     '1px solid #f0a020',
  };
}
</script>
