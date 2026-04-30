<template>
  <EditorPanel
    v-if="editor.selectedType === 'aiPath'"
    title="AI Path"
    @close="editor.closeAiPath"
  >
    <div class="mb-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div class="text-slate-200 text-sm font-medium mb-1">AI path editing mode</div>
      <div class="text-slate-400 text-[11px]">Click terrain to add a waypoint. Click an existing waypoint to select it.</div>
    </div>

    <div class="mb-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <label class="flex items-center justify-between gap-3 text-[12px] text-slate-200 mb-3">
        <span>Wear Overlay</span>
        <input
          type="checkbox"
          class="h-4 w-4 accent-[var(--accent)]"
          :checked="editor.aiPathWear.enabled"
          @change="editor.setAiPathWearEnabled($event.target.checked)"
        />
      </label>

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Wear Width</span>
        <span>{{ editor.aiPathWear.width.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="1" max="12" step="0.1"
        :value="editor.aiPathWear.width"
        @input="editor.setAiPathWearWidth(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Intensity</span>
        <span>{{ editor.aiPathWear.intensity.toFixed(2) }}</span>
      </div>
      <input
        type="range" min="0" max="0.6" step="0.01"
        :value="editor.aiPathWear.intensity"
        @input="editor.setAiPathWearIntensity(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Lane Spacing</span>
        <span>{{ editor.aiPathWear.laneSpacing.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="0.5" max="4" step="0.1"
        :value="editor.aiPathWear.laneSpacing"
        @input="editor.setAiPathWearLaneSpacing(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Breakup</span>
        <span>{{ editor.aiPathWear.breakup.toFixed(2) }}</span>
      </div>
      <input
        type="range" min="0" max="1" step="0.01"
        :value="editor.aiPathWear.breakup"
        @input="editor.setAiPathWearBreakup(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Edge Softness</span>
        <span>{{ editor.aiPathWear.edgeSoftness.toFixed(2) }}</span>
      </div>
      <input
        type="range" min="0.1" max="1.5" step="0.01"
        :value="editor.aiPathWear.edgeSoftness"
        @input="editor.setAiPathWearEdgeSoftness(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Secondary Paths</span>
        <span>{{ editor.aiPathWear.secondaryPathCount.toFixed(0) }}</span>
      </div>
      <input
        type="range" min="0" max="100" step="1"
        :value="editor.aiPathWear.secondaryPathCount"
        @input="editor.setAiPathWearSecondaryPathCount(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Secondary Strength</span>
        <span>{{ editor.aiPathWear.secondaryPathStrength.toFixed(2) }}</span>
      </div>
      <input
        type="range" min="0" max="1.5" step="0.01"
        :value="editor.aiPathWear.secondaryPathStrength"
        @input="editor.setAiPathWearSecondaryPathStrength(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Secondary Spacing</span>
        <span>{{ editor.aiPathWear.secondaryPathSpacing.toFixed(2) }}</span>
      </div>
      <input
        type="range" min="0" max="0.25" step="0.01"
        :value="editor.aiPathWear.secondaryPathSpacing"
        @input="editor.setAiPathWearSecondaryPathSpacing(+$event.target.value)"
        class="w-full accent-[var(--accent)] cursor-pointer"
      />
    </div>

    <button
      class="w-full rounded-md bg-slate-800 text-white py-2 text-[13px] font-sans mb-3 hover:bg-slate-700"
      @click="editor.deleteAiWaypoint()"
    >
      Delete selected waypoint
    </button>

    <button
      class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-3 hover:bg-rose-500"
      @click="editor.clearAiPath()"
    >
      Clear AI path
    </button>

    <div class="text-[10px] text-slate-400">
      Click terrain to add waypoints. Select a node to edit it. Press <kbd>Esc</kbd> to close the panel.
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
