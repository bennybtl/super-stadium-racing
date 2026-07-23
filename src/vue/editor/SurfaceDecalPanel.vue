<template>
  <EditorPanel
    v-if="mode"
    :title="editing ? 'Edit Decal' : 'Surface Decals'"
    @close="close"
  >
    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">Drag to move · QE to rotate · Del to delete · Click terrain to stamp · Scroll to scale</div>

    <!-- Shape (stamp mode only — a placed decal keeps its shape) -->
    <template v-if="!editing">
      <div class="text-slate-400 text-[11px] mb-2 uppercase tracking-widest">Shape</div>
      <select
        class="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
        :value="s.shape"
        @change="set('shape', $event.target.value)"
      >
        <option v-for="shape in s.shapes" :key="shape" :value="shape">
          {{ formatLabel(shape) }}
        </option>
      </select>
    </template>

    <label v-if="s.hasOutline" class="flex items-center justify-between text-[12px] text-slate-200" :class="{ 'mt-3': !editing }">
      <span>Outline</span>
      <input type="checkbox" :checked="s.outline" @change="set('outline', $event.target.checked)" />
    </label>

    <template v-if="s.hasCount">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Repeats</span>
        <span>{{ s.count }}</span>
      </div>
      <input type="range" min="1" max="20" step="1"
        :value="s.count"
        @input="set('count', +$event.target.value)"
        class="w-full accent-[var(--accent)] mb-1 cursor-pointer"
      />
    </template>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Rotation -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rotation</span>
      <span>{{ s.angle }}°</span>
    </div>
    <input type="range" min="0" max="360" step="1"
      :value="s.angle"
      @input="set('angle', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Size -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ s.width }}m</span>
    </div>
    <input type="range" min="0.5" max="30" step="0.5"
      :value="s.width"
      @input="set('width', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Depth</span>
      <span>{{ s.depth }}m</span>
    </div>
    <input type="range" min="0.5" max="30" step="0.5"
      :value="s.depth"
      @input="set('depth', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-1 cursor-pointer"
    />

    <hr class="border-t border-slate-700 my-4" />

    <!-- Primary color (text + border) -->
    <div class="flex justify-between items-center mb-3 text-[12px]">
      <span>Color</span>

      <select
        class="bg-slate-700 text-white text-[12px] rounded px-2 py-0.5 cursor-pointer"
        :value="s.color"
        @change="set('color', $event.target.value)"
      >
        <option v-for="c in s.colors" :key="c" :value="c">{{ formatLabel(c) }}</option>
      </select>
    </div>

    <!-- Opacity -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Opacity</span>
      <span>{{ Math.round(s.opacity * 100) }}%</span>
    </div>
    <input type="range" min="0.1" max="1" step="0.05"
      :value="s.opacity"
      @input="set('opacity', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-1 cursor-pointer"
    />

    <hr class="border-t border-slate-700 my-4" />
    
    <!-- Actions (edit mode only) -->
    <div v-if="editing" class="flex gap-2 mb-3">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deleteSelectedSurfaceDecal')"
      >Delete Decal</button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('duplicateSelectedSurfaceDecal')"
      >Duplicate Decal</button>
    </div>

</EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

// One panel for both placing new decals ('surfaceDecal') and editing a placed
// one ('surfaceDecalEdit'). Same controls; only the plumbing differs.
const mode = computed(() =>
  editor.selectedType === 'surfaceDecal' || editor.selectedType === 'surfaceDecalEdit');
const editing = computed(() => editor.selectedType === 'surfaceDecalEdit');
// Both modes share the one `surfaceDecal` slice; each repopulates it on entry
// (stamp from the editor's pending settings, edit from the selected feature).
const s = computed(() => editor.surfaceDecal);

const cap = (p) => p.charAt(0).toUpperCase() + p.slice(1);

function set(prop, val) {
  if (editing.value) editor.setFeatureProp('surfaceDecal', prop, val);
  else editor.featureAction('setSurfaceDecal' + cap(prop), val);
}

function close() {
  editor.featureAction(editing.value ? 'deselectSurfaceDecal' : 'closeSurfaceDecalStamp');
}

function formatLabel(type) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
</script>
