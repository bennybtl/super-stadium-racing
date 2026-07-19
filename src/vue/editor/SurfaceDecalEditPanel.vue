<template>
  <EditorPanel
    v-if="editor.selectedType === 'surfaceDecalEdit'"
    title="Edit Decal"
    @close="editor.featureAction('deselectSurfaceDecalEdit')"
  >
    <!-- Rotation -->
    <div class="mb-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div class="flex justify-between items-center mb-1">
        <span class="text-slate-400 text-[11px] uppercase tracking-widest">Rotation</span>
        <span class="text-slate-200 text-[11px]">{{ editor.surfaceDecalEdit.angle }}°</span>
      </div>
      <input
        type="range" min="0" max="360" step="1"
        :value="editor.surfaceDecalEdit.angle"
        @input="editor.setFeatureProp('surfaceDecalEdit', 'angle', +$event.target.value)"
        class="w-full accent-sky-500"
      />
    </div>

    <!-- Size -->
    <div class="mb-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div class="flex justify-between items-center mb-1">
        <span class="text-slate-400 text-[11px] uppercase tracking-widest">Width</span>
        <span class="text-slate-200 text-[11px]">{{ editor.surfaceDecalEdit.width }}m</span>
      </div>
      <input type="range" min="0.5" max="20" step="0.5"
        :value="editor.surfaceDecalEdit.width"
        @input="editor.setFeatureProp('surfaceDecalEdit', 'width', +$event.target.value)"
        class="w-full accent-sky-500"
      />
      <div class="flex justify-between items-center mb-1 mt-2">
        <span class="text-slate-400 text-[11px] uppercase tracking-widest">Depth</span>
        <span class="text-slate-200 text-[11px]">{{ editor.surfaceDecalEdit.depth }}m</span>
      </div>
      <input type="range" min="0.5" max="20" step="0.5"
        :value="editor.surfaceDecalEdit.depth"
        @input="editor.setFeatureProp('surfaceDecalEdit', 'depth', +$event.target.value)"
        class="w-full accent-sky-500"
      />
    </div>

    <!-- Opacity -->
    <div class="mb-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div class="flex justify-between items-center mb-1">
        <span class="text-slate-400 text-[11px] uppercase tracking-widest">Opacity</span>
        <span class="text-slate-200 text-[11px]">{{ Math.round(editor.surfaceDecalEdit.opacity * 100) }}%</span>
      </div>
      <input type="range" min="0.1" max="1" step="0.05"
        :value="editor.surfaceDecalEdit.opacity"
        @input="editor.setFeatureProp('surfaceDecalEdit', 'opacity', +$event.target.value)"
        class="w-full accent-sky-500"
      />
    </div>

    <button
      class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500"
      @click="editor.featureAction('deleteSelectedSurfaceDecal')"
    >Delete Decal</button>

    <!-- Instructions -->
    <div class="rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-[10px] text-slate-500 leading-5">
      <div><kbd class="text-slate-300">Drag</kbd> to move</div>
      <div><kbd class="text-slate-300">Q / E</kbd> rotate in 15° steps</div>
      <div><kbd class="text-slate-300">Del</kbd> delete</div>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
