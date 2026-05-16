<template>
  <EditorPanel
    v-if="editor.selectedType === 'aiPath'"
    title="AI Path"
    @close="editor.closeAiPath"
  >
    <div class="mb-3 grid grid-cols-2 gap-2">
      <button
        class="rounded-md py-2 text-[12px] font-sans transition"
        :class="activeTab === 'path' ? 'bg-slate-200 text-slate-900' : 'bg-slate-800 text-white hover:bg-slate-700'"
        @click="activeTab = 'path'"
      >
        AI Path
      </button>
      <button
        class="rounded-md py-2 text-[12px] font-sans transition"
        :class="activeTab === 'wear' ? 'bg-slate-200 text-slate-900' : 'bg-slate-800 text-white hover:bg-slate-700'"
        @click="activeTab = 'wear'"
      >
        Path Wear
      </button>
    </div>

    <template v-if="activeTab === 'path'">
    <div class="mb-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div class="text-slate-200 text-sm font-medium mb-1">AI path editing mode</div>
      <div class="text-slate-400 text-[11px]">Click terrain to add a waypoint. Click an existing waypoint to select it.</div>
    </div>

    <div class="mb-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div class="text-slate-200 text-sm font-medium mb-2">Branches</div>
      <div class="text-[11px] text-slate-400 mb-3">Select a main waypoint and click "Create branch" to add an alternate route.</div>

      <div class="flex gap-2 mb-3">
        <button
          class="flex-1 rounded-md bg-slate-800 text-white py-2 text-[12px] font-sans hover:bg-slate-700"
          @click="editor.editMainAiPath()"
        >
          Edit Main Path
        </button>
        <button
          class="flex-1 rounded-md bg-cyan-700 text-white py-2 text-[12px] font-sans hover:bg-cyan-600"
          @click="editor.createAiPathBranchFromSelected()"
        >
          Create Branch
        </button>
      </div>

      <label class="block text-[12px] text-slate-200 mb-1">Active Branch</label>
      <select
        class="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-[12px] text-slate-100 mb-3"
        :value="editor.aiPathBranch.activeBranchId ?? ''"
        @change="editor.selectAiPathBranch($event.target.value || null)"
      >
        <option value="">Main Path</option>
        <option
          v-for="b in editor.aiPathBranches"
          :key="b.id"
          :value="b.id"
        >
          {{ b.id }} ({{ b.fromMainIndex }} -> {{ b.toMainIndex }}, {{ b.pointCount }} pts)
        </option>
      </select>

      <div class="flex justify-between mb-1 text-[12px]" :class="editor.aiPathBranch.activeBranchId ? '' : 'opacity-50'">
        <span>Branch Weight</span>
        <span>{{ editor.aiPathBranch.activeBranchWeight.toFixed(2) }}</span>
      </div>
      <input
        type="range" min="0" max="3" step="0.1"
        :disabled="!editor.aiPathBranch.activeBranchId"
        :value="editor.aiPathBranch.activeBranchWeight"
        @input="editor.setActiveAiPathBranchWeight(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <label class="block text-[12px] text-slate-200 mb-1" :class="editor.aiPathBranch.activeBranchId ? '' : 'opacity-50'">Rejoin Main Waypoint</label>
      <select
        class="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-[12px] text-slate-100 mb-3"
        :disabled="!editor.aiPathBranch.activeBranchId"
        :value="editor.aiPathBranch.activeBranchToMainIndex ?? ''"
        @change="editor.setActiveAiPathBranchRejoinIndex(+$event.target.value)"
      >
        <option
          v-for="idx in Math.max(0, editor.aiPathBranch.mainWaypointCount)"
          :key="idx - 1"
          :value="idx - 1"
          :disabled="(idx - 1) <= (editor.aiPathBranch.activeBranchFromMainIndex ?? -1)"
        >
          {{ idx - 1 }}
        </option>
      </select>

      <div class="flex gap-2">
        <button
          class="flex-1 rounded-md bg-rose-700 text-white py-2 text-[12px] font-sans hover:bg-rose-600 disabled:opacity-40"
          :disabled="!editor.aiPathBranch.activeBranchId"
          @click="editor.deleteActiveAiPathBranch()"
        >
          Delete Active Branch
        </button>
        <button
          class="flex-1 rounded-md bg-rose-900 text-white py-2 text-[12px] font-sans hover:bg-rose-800 disabled:opacity-40"
          :disabled="editor.aiPathBranches.length === 0"
          @click="editor.clearAiPathBranches()"
        >
          Clear All Branches
        </button>
      </div>
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
    </template>

    <template v-else>
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
        type="range" min="0" max="2.0" step="0.1"
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
        <span>Alpha Breakup</span>
        <span>{{ editor.aiPathWear.alphaBreakup.toFixed(2) }}</span>
      </div>
      <input
        type="range" min="0" max="1" step="0.01"
        :value="editor.aiPathWear.alphaBreakup"
        @input="editor.setAiPathWearAlphaBreakup(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Path Wander</span>
        <span>{{ editor.aiPathWear.pathWander.toFixed(2) }}</span>
      </div>
      <input
        type="range" min="0" max="1.5" step="0.01"
        :value="editor.aiPathWear.pathWander"
        @input="editor.setAiPathWearPathWander(+$event.target.value)"
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
        type="range" min="0" max="3.0" step="0.1"
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
    </template>
  </EditorPanel>
</template>

<script setup>
import { ref } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
const activeTab = ref('path');
</script>
