<template>
  <EditorPanel
    v-if="editor.selectedType === 'driveBox'"
    title="Drive Box"
    @close="editor.featureAction('deselectDriveBox')"
  >
    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Q/E to rotate · Del to delete</div>

    <!-- Mode toggle: Flat | Wedge -->
    <div class="text-[12px] mb-1">Mode</div>
    <div class="flex gap-2 mb-3">
      <button class="flex-1 rounded px-2 py-1 text-[12px] font-sans transition" :style="modeStyle(false)" @click="editor.setFeatureProp('driveBox', 'slopeMode', false)">Flat</button>
      <button class="flex-1 rounded px-2 py-1 text-[12px] font-sans transition" :style="modeStyle(true)"  @click="editor.setFeatureProp('driveBox', 'slopeMode', true)">Wedge</button>
    </div>

    <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.driveBox.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="60" step="0.5"
      :value="editor.driveBox.width"
      @input="editor.setFeatureProp('driveBox', 'width', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Depth -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Depth</span>
      <span>{{ editor.driveBox.depth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="60" step="0.5"
      :value="editor.driveBox.depth"
      @input="editor.setFeatureProp('driveBox', 'depth', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Rotation -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rotation</span>
      <span>{{ editor.driveBox.rotation.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="0" max="360" step="1"
      :value="editor.driveBox.rotation"
      @input="editor.setFeatureProp('driveBox', 'rotation', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Flat section -->
    <template v-if="!editor.driveBox.slopeMode">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Height</span>
        <span>{{ editor.driveBox.height.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0.5" max="20" step="0.5"
        :value="editor.driveBox.height"
        @input="editor.setFeatureProp('driveBox', 'height', +$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>

    <!-- Wedge section -->
    <template v-else>
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Height (− edge)</span>
        <span>{{ editor.driveBox.heightAtMin.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="20" step="0.5"
        :value="editor.driveBox.heightAtMin"
        @input="editor.setFeatureProp('driveBox', 'heightAtMin', +$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Height (+ edge)</span>
        <span>{{ editor.driveBox.heightAtMax.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0" max="20" step="0.5"
        :value="editor.driveBox.heightAtMax"
        @input="editor.setFeatureProp('driveBox', 'heightAtMax', +$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>

    <!-- Surface colors: terrain-blend look or flat diffuse, top and sides separately -->
    <div class="flex justify-between items-center mb-3 text-[12px]">
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
        class="bg-slate-700 text-white text-[12px] rounded px-2 py-0.5 cursor-pointer"
      >
        <option v-for="opt in colorOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </div>

    <div class="flex justify-between items-center mb-3 text-[12px]">
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
        class="bg-slate-700 text-white text-[12px] rounded px-2 py-0.5 cursor-pointer"
      >
        <option v-for="opt in colorOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </div>

    <!-- Base toggle: Solid | Slab -->
    <div class="text-[12px] mb-1">Base</div>
    <div class="flex gap-2 mb-3">
      <button class="flex-1 rounded px-2 py-1 text-[12px] font-sans transition" :style="baseStyle(true)"  @click="editor.setFeatureProp('driveBox', 'solidBase', true)">Solid</button>
      <button class="flex-1 rounded px-2 py-1 text-[12px] font-sans transition" :style="baseStyle(false)" @click="editor.setFeatureProp('driveBox', 'solidBase', false)">Slab</button>
    </div>

    <!-- Thickness (slab only) -->
    <template v-if="!editor.driveBox.solidBase">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Thickness</span>
        <span>{{ editor.driveBox.thickness.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0.1" max="2" step="0.1"
        :value="editor.driveBox.thickness"
        @input="editor.setFeatureProp('driveBox', 'thickness', +$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>

    <!-- Layer -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Layer</span>
      <span>{{ editor.driveBox.layerId }}</span>
    </div>
    <input
      type="range" min="0" max="2" step="1"
      :value="editor.driveBox.layerId"
      @input="editor.setFeatureProp('driveBox', 'layerId', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <div class="flex gap-2">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deleteSelectedDriveBox')"
      >Delete</button>

      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('duplicateSelectedDriveBox')"
      >Duplicate</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

const colorOptions = [
  { value: 'terrain', label: 'Terrain' },
  { value: '#9aa0a8', label: 'Grey' },
  { value: '#4a4f55', label: 'Dark Grey' },
  { value: '#e8e8e8', label: 'White' },
  { value: '#1a1a1a', label: 'Black' },
  { value: '#b3342e', label: 'Red' },
  { value: '#2e5cb3', label: 'Blue' },
  { value: '#e0b32e', label: 'Yellow' },
  { value: '#3f7a3a', label: 'Green' },
  { value: '#6e4f2f', label: 'Brown' },
];

function swatch(value) {
  return value === 'terrain' ? 'transparent' : value;
}

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
