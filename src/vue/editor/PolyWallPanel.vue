<template>
  <EditorPanel
    v-if="editor.selectedType === 'polyWall'"
    title="Poly Wall"
    @close="editor.featureAction('deselectPolyWall')"
  >
    <!-- Selected Point Section -->
    <div
      class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2"
    >
      Selected Point
    </div>

    <!-- Radius -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Corner Radius</span>
      <span
        :style="
          editor.polyWall.radius > editor.polyWall.maxRadius
            ? { color: '#ff4444' }
            : {}
        "
        >{{ radiusDisplay }}</span
      >
    </div>
    <input
      type="range"
      min="0"
      max="30"
      step="0.5"
      :value="editor.polyWall.radius"
      :disabled="!editor.polyWall.canHaveRadius"
      @input="editor.setFeatureProp('polyWall', 'radius', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />
    <div
      v-if="!editor.polyWall.canHaveRadius && editor.polyWall.hasSelection"
      class="text-[10px] text-slate-400 mb-3"
      style="color: #ff9800"
    >
      First and last points cannot be rounded (unless closed loop is enabled)
    </div>

    <!-- Terrain Smoothing: how closely the wall top follows the terrain at this node.
         Most (1) = flat, slowly-changing top; Least (0) = follows terrain exactly. -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Terrain Smoothing</span>
      <span>{{ smoothingDisplay }}</span>
    </div>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      :value="editor.polyWall.smoothing"
      :disabled="!editor.polyWall.hasSelection"
      @input="
        editor.setFeatureProp('polyWall', 'smoothing', +$event.target.value)
      "
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <div class="text-[10px] text-slate-400 mb-3">
      WASD to move selected point
    </div>

    <div class="flex gap-2 mb-3">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deletePolyWallPoint')"
      >
        Delete Point
      </button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('insertPolyWallPoint')"
      >
        Insert After
      </button>
    </div>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Wall Properties Section -->
    <div
      class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2"
    >
      Wall Properties
    </div>

    <!-- Height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Height</span>
      <span>{{ editor.polyWall.height.toFixed(1) }}</span>
    </div>
    <input
      type="range"
      min="0.5"
      max="8"
      step="0.5"
      :value="editor.polyWall.height"
      @input="editor.setFeatureProp('polyWall', 'height', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Thickness -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.polyWall.thickness.toFixed(1) }}</span>
    </div>
    <input
      type="range"
      min="0.2"
      max="3"
      step="0.1"
      :value="editor.polyWall.thickness"
      @input="
        editor.setFeatureProp('polyWall', 'thickness', +$event.target.value)
      "
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Collision Barrier Height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Collision Height</span>
      <span>{{ editor.polyWall.collisionHeight.toFixed(1) }}</span>
    </div>
    <input
      type="range"
      min="0.5"
      max="12"
      step="0.5"
      :value="editor.polyWall.collisionHeight"
      @input="
        editor.setFeatureProp(
          'polyWall',
          'collisionHeight',
          +$event.target.value,
        )
      "
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />
    <div class="text-[10px] text-slate-400 mb-3">
      Collision height defaults to the visual height unless adjusted separately.
    </div>

    <!-- Closed toggle -->
    <div class="flex justify-between mb-3 text-[12px]">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.polyWall.closed"
        @change="
          editor.setFeatureProp('polyWall', 'closed', $event.target.checked)
        "
        class="w-4 h-4 accent-[var(--accent)] cursor-pointer"
      />
    </div>

    <!-- Style -->
    <div class="flex justify-between items-center mb-3 text-[12px]">
      <span>Style</span>
      <select
        :value="editor.polyWall.style"
        @change="
          editor.setFeatureProp('polyWall', 'style', $event.target.value)
        "
        class="bg-slate-700 text-white text-[12px] rounded px-2 py-0.5 cursor-pointer"
      >
        <option value="red_white">Red &amp; White</option>
        <option value="blue_white">Blue &amp; White</option>
        <option value="red_blue_white">Red, Blue &amp; White</option>
        <option value="black_yellow">Black &amp; Yellow</option>
        <option value="grey">Grey</option>
      </select>
    </div>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <div class="flex gap-2">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deletePolyWall')"
      >
        Delete
      </button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('duplicatePolyWall')"
      >
        Duplicate
      </button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { computed } from "vue";
import { useEditorStore } from "../store.js";
import EditorPanel from "./EditorPanel.vue";

const editor = useEditorStore();

const radiusDisplay = computed(() => {
  if (!editor.polyWall.hasSelection) return "—";
  return editor.polyWall.radius.toFixed(1);
});

const smoothingDisplay = computed(() => {
  if (!editor.polyWall.hasSelection) return "—";
  return `${Math.round(editor.polyWall.smoothing * 100)}%`;
});
</script>
