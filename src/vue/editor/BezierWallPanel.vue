<template>
  <EditorPanel
    v-if="editor.selectedType === 'bezierWall'"
    title="Bezier Wall"
    @close="editor.closeBezierWall()"
  >
    <!-- Selected Point Section -->
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Selected Point</div>

    <div class="text-[10px] text-slate-400 mb-3">WASD to move selected anchor or handle</div>

    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.insertBezierWallPoint()">Insert Point After</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deleteBezierWallPoint()">Delete Point</button>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Wall Properties Section -->
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Wall Properties</div>

    <!-- Height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Height</span>
      <span>{{ editor.bezierWall.height.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="8" step="0.5"
      :value="editor.bezierWall.height"
      @input="editor.setBezierWallHeight(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Thickness -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Thickness</span>
      <span>{{ editor.bezierWall.thickness.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.2" max="3" step="0.1"
      :value="editor.bezierWall.thickness"
      @input="editor.setBezierWallThickness(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Closed toggle -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.bezierWall.closed"
        @change="editor.setBezierWallClosed($event.target.checked)"
        class="w-4 h-4 accent-[var(--accent)] cursor-pointer"
      />
    </div>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.duplicateBezierWall()">Duplicate</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deleteBezierWall()">Delete</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
