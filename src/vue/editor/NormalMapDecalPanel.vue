<template>
  <EditorPanel
    v-if="editor.selectedType === 'normalMapDecal'"
    title="Normal Map Decal"
    @close="editor.closeNormalMapDecal()"
  >
    <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.normalMapDecal.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="1" max="80" step="0.5"
      :value="editor.normalMapDecal.width"
      @input="editor.setNormalMapDecalWidth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Depth -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Depth</span>
      <span>{{ editor.normalMapDecal.depth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="1" max="80" step="0.5"
      :value="editor.normalMapDecal.depth"
      @input="editor.setNormalMapDecalDepth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Angle -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Angle</span>
      <span>{{ editor.normalMapDecal.angle.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="0" max="360" step="1"
      :value="editor.normalMapDecal.angle"
      @input="editor.setNormalMapDecalAngle(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Normal Map -->
    <div class="text-[12px] mb-1">Normal Map</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.normalMapDecal.normalMap"
      @change="editor.setNormalMapDecalNormalMap($event.target.value)"
    >
      <option value="6481-normal.jpg">6481 (Fine Gravel)</option>
      <option value="7632-normal.jpg">7632 (Rough)</option>
      <option value="sample-normal.png">Sample</option>
    </select>

    <!-- Repeat U -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Repeat U</span>
      <span>{{ editor.normalMapDecal.repeatU.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.1" max="20" step="0.1"
      :value="editor.normalMapDecal.repeatU"
      @input="editor.setNormalMapDecalRepeatU(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Repeat V -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Repeat V</span>
      <span>{{ editor.normalMapDecal.repeatV.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.1" max="20" step="0.1"
      :value="editor.normalMapDecal.repeatV"
      @input="editor.setNormalMapDecalRepeatV(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Intensity -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Intensity</span>
      <span>{{ editor.normalMapDecal.intensity.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0" max="2" step="0.05"
      :value="editor.normalMapDecal.intensity"
      @input="editor.setNormalMapDecalIntensity(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · QE to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.duplicateNormalMapDecal()">Duplicate Normal Map</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deleteNormalMapDecal()">Delete Normal Map</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
