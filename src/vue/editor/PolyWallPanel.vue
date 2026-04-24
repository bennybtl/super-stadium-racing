<template>
  <EditorPanel
    v-if="editor.selectedType === 'polyWall'"
    title="Poly Wall"
    @close="editor.closePolyWall()"
  >
    <!-- Selected Point Section -->
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Selected Point</div>

    <!-- Radius -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Radius</span>
      <span :style="editor.polyWall.radius > editor.polyWall.maxRadius ? { color: '#ff4444' } : {}">{{ radiusDisplay }}</span>
    </div>
    <input
      type="range" min="0" max="30" step="0.5"
      :value="editor.polyWall.radius"
      :disabled="!editor.polyWall.canHaveRadius"
      @input="editor.setPolyWallRadius(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />
    <div v-if="!editor.polyWall.canHaveRadius && editor.polyWall.hasSelection" class="text-[10px] text-slate-400 mb-3" style="color: #ff9800;">
      First and last points cannot be rounded (unless closed loop is enabled)
    </div>

    <div class="text-[10px] text-slate-400 mb-3">WASD to move selected point</div>

    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.insertPolyWallPoint()">Insert Point After</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deletePolyWallPoint()">Delete Point</button>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Wall Properties Section -->
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Wall Properties</div>

    <!-- Height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Height</span>
      <span>{{ editor.polyWall.height.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="8" step="0.5"
      :value="editor.polyWall.height"
      @input="editor.setPolyWallHeight(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Collision Barrier Height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Collision Height</span>
      <span>{{ editor.polyWall.collisionHeight.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="12" step="0.5"
      :value="editor.polyWall.collisionHeight"
      @input="editor.setPolyWallCollisionHeight(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />
    <div class="text-[10px] text-slate-400 mb-3">Collision height defaults to the visual height unless adjusted separately.</div>

    <!-- Thickness -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Thickness</span>
      <span>{{ editor.polyWall.thickness.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.2" max="3" step="0.1"
      :value="editor.polyWall.thickness"
      @input="editor.setPolyWallThickness(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Closed toggle -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.polyWall.closed"
        @change="editor.setPolyWallClosed($event.target.checked)"
        class="w-4 h-4 accent-[var(--accent)] cursor-pointer"
      />
    </div>

    <div class="text-[10px] text-slate-400 mb-3">WASD to move</div>

    <!-- Actions -->
    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.duplicatePolyWall()">Duplicate</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deletePolyWall()">Delete</button>
  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

const radiusDisplay = computed(() => {
  if (!editor.polyWall.hasSelection) return '—';
  return editor.polyWall.radius.toFixed(1);
});
</script>
