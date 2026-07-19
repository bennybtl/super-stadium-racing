<template>
  <EditorPanel
    v-if="editor.selectedType === 'surfaceDecal'"
    title="Surface Decals"
    @close="editor.featureAction('closeSurfaceDecalStamp')"
  >
    <div class="mb-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div class="text-slate-400 text-[11px] mb-2 uppercase tracking-widest">Shape</div>
      <select
        class="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
        :value="editor.surfaceDecal.shape"
        @change="editor.featureAction('setSurfaceDecalShape', $event.target.value)"
      >
        <option v-for="shape in editor.surfaceDecal.shapes" :key="shape" :value="shape">
          {{ formatLabel(shape) }}
        </option>
      </select>
    </div>

    <div class="mb-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div class="flex justify-between items-center mb-1">
        <span class="text-slate-400 text-[11px] uppercase tracking-widest">Rotation</span>
        <span class="text-slate-200 text-[11px]">{{ editor.surfaceDecal.angle }}°</span>
      </div>
      <input
        type="range" min="0" max="360" step="1"
        :value="editor.surfaceDecal.angle"
        @input="editor.featureAction('setSurfaceDecalAngle', +$event.target.value)"
        class="w-full accent-sky-500"
      />
    </div>

    <!-- Size -->
    <div class="mb-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div class="flex justify-between items-center mb-1">
        <span class="text-slate-400 text-[11px] uppercase tracking-widest">Width</span>
        <span class="text-slate-200 text-[11px]">{{ editor.surfaceDecal.width }}m</span>
      </div>
      <input type="range" min="0.5" max="20" step="0.5"
        :value="editor.surfaceDecal.width"
        @input="editor.featureAction('setSurfaceDecalWidth', +$event.target.value)"
        class="w-full accent-sky-500"
      />
      <div class="flex justify-between items-center mb-1 mt-2">
        <span class="text-slate-400 text-[11px] uppercase tracking-widest">Depth</span>
        <span class="text-slate-200 text-[11px]">{{ editor.surfaceDecal.depth }}m</span>
      </div>
      <input type="range" min="0.5" max="20" step="0.5"
        :value="editor.surfaceDecal.depth"
        @input="editor.featureAction('setSurfaceDecalDepth', +$event.target.value)"
        class="w-full accent-sky-500"
      />
    </div>

    <!-- Opacity -->
    <div class="mb-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div class="flex justify-between items-center mb-1">
        <span class="text-slate-400 text-[11px] uppercase tracking-widest">Opacity</span>
        <span class="text-slate-200 text-[11px]">{{ Math.round(editor.surfaceDecal.opacity * 100) }}%</span>
      </div>
      <input type="range" min="0.1" max="1" step="0.05"
        :value="editor.surfaceDecal.opacity"
        @input="editor.featureAction('setSurfaceDecalOpacity', +$event.target.value)"
        class="w-full accent-sky-500"
      />
    </div>

    <!-- Instructions -->
    <div class="rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-[10px] text-slate-500 leading-5">
      <div><kbd class="text-slate-300">Click</kbd> terrain to stamp the decal</div>
      <div><kbd class="text-slate-300">Q / E</kbd> rotate in 15° steps</div>
      <div><kbd class="text-slate-300">Scroll</kbd> scale up / down</div>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

function formatLabel(type) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
</script>
