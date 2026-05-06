<template>
  <EditorPanel
    v-if="editor.selectedType === 'squareHill'"
    title="Square Hill"
    @close="editor.closeSquareHill()"
  >
    <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.squareHill.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="60" step="0.5"
      :value="editor.squareHill.width"
      @input="editor.setSquareHillWidth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Depth -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Depth</span>
      <span>{{ editor.squareHill.depth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="60" step="0.5"
      :value="editor.squareHill.depth"
      @input="editor.setSquareHillDepth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Transition -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Transition</span>
      <span>{{ editor.squareHill.transition.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="15" step="0.5"
      :value="editor.squareHill.transition"
      @input="editor.setSquareHillTransition(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Angle -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Angle</span>
      <span>{{ editor.squareHill.angle.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="0" max="359" step="1"
      :value="editor.squareHill.angle"
      @input="editor.setSquareHillAngle(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Mode toggle: Flat | Sloped -->
    <div class="text-[12px] mb-1">Mode</div>
    <div class="flex gap-2 mb-3">
      <button class="flex-1 rounded px-2 py-1 text-[12px] font-sans transition" :style="modeStyle(false)" @click="editor.setSquareHillMode(false)">Flat</button>
      <button class="flex-1 rounded px-2 py-1 text-[12px] font-sans transition" :style="modeStyle(true)"  @click="editor.setSquareHillMode(true)">Sloped</button>
    </div>

    <!-- Flat section -->
    <template v-if="!editor.squareHill.slopeMode">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Height</span>
        <span>{{ editor.squareHill.height.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="-15" max="20" step="0.5"
        :value="editor.squareHill.height"
        @input="editor.setSquareHillHeight(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>

    <!-- Sloped section -->
    <template v-else>
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Height (− edge)</span>
        <span>{{ editor.squareHill.heightAtMin.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="-15" max="20" step="0.5"
        :value="editor.squareHill.heightAtMin"
        @input="editor.setSquareHillHeightMin(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Height (+ edge)</span>
        <span>{{ editor.squareHill.heightAtMax.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="-15" max="20" step="0.5"
        :value="editor.squareHill.heightAtMax"
        @input="editor.setSquareHillHeightMax(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>

    <div class="flex justify-between mb-1 text-[12px]">
      <span>Water Level</span>
      <span>{{ editor.squareHill.waterLevelOffset.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0" max="15" step="0.5"
      :value="editor.squareHill.waterLevelOffset"
      @input="editor.setSquareHillWaterLevelOffset(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Surface -->
    <div class="text-[12px] mb-1">Surface</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.squareHill.terrainType"
      @change="editor.setSquareHillTerrainType($event.target.value)"
    >
      <option value="none">None (Default)</option>
      <option value="packed_dirt">Packed Dirt</option>
      <option value="loose_dirt">Loose Dirt</option>
      <option value="loamy_dirt">Loamy Dirt</option>
      <option value="asphalt">Asphalt</option>
      <option value="mud">Mud</option>
      <option value="water">Water</option>
      <option value="rocky">Rocky</option>
    </select>

    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Q/E to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.duplicateSquareHill()">Duplicate Square Hill</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deleteSquareHill()">Delete Square Hill</button>
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
