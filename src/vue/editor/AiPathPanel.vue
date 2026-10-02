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
      <div class="ed-hint">Right-Click terrain to add waypoints. Select a node to edit it. WASD to move selected point</div>
      <div class="ed-heading">Selected Point</div>

      <div class="ed-btn-row">
        <button
          class="ed-btn-danger"
          @click="editor.featureAction('deleteAiWaypoint')"
        >
          Delete Point
        </button>
        <button
          class="ed-btn"
          @click="editor.featureAction('insertAiWaypointEntity')"
        >
          Insert Point
        </button>
      </div>

      <hr class="ed-divider" />
      <div class="ed-heading">Branches</div>
      <div class="ed-hint">Select a main waypoint and click "Create branch" to add an alternate route.</div>

      <label class="ed-label">Active Branch</label>
      <select
        class="ed-select"
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

        <div class="ed-label" :class="editor.aiPathBranch.activeBranchId ? '' : 'opacity-50'">
          <span>Branch Weight</span>
          <span>{{ editor.aiPathBranch.activeBranchWeight.toFixed(2) }}</span>
        </div>
        <input
          type="range" min="0" max="2" step="0.1"
          :disabled="!editor.aiPathBranch.activeBranchId"
          :value="editor.aiPathBranch.activeBranchWeight"
          @input="editor.setActiveAiPathBranchWeight(+$event.target.value)"
          class="ed-slider"
        />

        <label class="ed-row" :class="editor.aiPathBranch.activeBranchId ? 'cursor-pointer' : 'text-slate-500'">
          <span>Joker path</span>
          <input
            type="checkbox"
            class="ed-checkbox"
            :checked="editor.aiPathBranch.activeBranchJoker"
            :disabled="!editor.aiPathBranch.activeBranchId"
            @change="editor.setActiveAiPathBranchJoker($event.target.checked)"
          />
        </label>
        <div class="ed-hint">AI drives this branch through the Joker checkpoint once per race; weight is the chance per lap.</div>

        <label class="ed-label" :class="editor.aiPathBranch.activeBranchId ? '' : 'opacity-50'">Rejoin Main Waypoint</label>
        <select
          class="ed-select"
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

      <div class="ed-btn-row">
        <button
          class="ed-btn-danger"
          :disabled="!editor.aiPathBranch.activeBranchId"
          @click="editor.featureAction('deleteActiveAiPathBranch')"
        >
          Delete Active Branch
        </button>
        <button
          class="ed-btn"
          @click="editor.featureAction('createAiPathBranchFromSelected')"
        >
          Create Branch
        </button>
      </div>

      <hr class="ed-divider" />
      <div class="ed-btn-row">
        <button
          class="ed-btn-danger"
          @click="editor.featureAction('clearAiPath')"
        >
          Clear AI path
        </button>
      </div>
    </template>

    <template v-else>
      <div class="rounded-xl border border-slate-700 bg-slate-950/50 p-3">
        <label class="ed-row cursor-pointer">
          <span>Wear Overlay</span>
          <input
            type="checkbox"
            class="ed-checkbox"
            :checked="editor.aiPathWear.enabled"
            @change="editor.setFeatureProp('aiPathWear', 'enabled', $event.target.checked)"
          />
        </label>

        <div class="ed-label">
          <span>Wear Width</span>
          <span>{{ editor.aiPathWear.width.toFixed(1) }}</span>
        </div>
        <input
          type="range" min="2" max="8" step="0.5"
          :value="editor.aiPathWear.width"
          @input="editor.setFeatureProp('aiPathWear', 'width', +$event.target.value)"
          class="ed-slider"
        />

        <div class="ed-label">
          <span>Intensity</span>
          <span>{{ editor.aiPathWear.intensity.toFixed(2) }}</span>
        </div>
        <input
          type="range" min="0.2" max="2" step="0.1"
          :value="editor.aiPathWear.intensity"
          @input="editor.setFeatureProp('aiPathWear', 'intensity', +$event.target.value)"
          class="ed-slider"
        />

        <div class="ed-label">
          <span>Lane Spacing</span>
          <span>{{ editor.aiPathWear.laneSpacing.toFixed(1) }}</span>
        </div>
        <input
          type="range" min="0.5" max="4" step="0.1"
          :value="editor.aiPathWear.laneSpacing"
          @input="editor.setFeatureProp('aiPathWear', 'laneSpacing', +$event.target.value)"
          class="ed-slider"
        />

        <div class="ed-label">
          <span>Path Wander</span>
          <span>{{ editor.aiPathWear.pathWander.toFixed(2) }}</span>
        </div>
        <input
          type="range" min="0" max="1.5" step="0.1"
          :value="editor.aiPathWear.pathWander"
          @input="editor.setFeatureProp('aiPathWear', 'pathWander', +$event.target.value)"
          class="ed-slider"
        />

        <div class="ed-label">
          <span>Edge Softness</span>
          <span>{{ editor.aiPathWear.edgeSoftness.toFixed(2) }}</span>
        </div>
        <input
          type="range" min="0.0" max="1.5" step="0.1"
          :value="editor.aiPathWear.edgeSoftness"
          @input="editor.setFeatureProp('aiPathWear', 'edgeSoftness', +$event.target.value)"
          class="ed-slider"
        />

        <div class="ed-label">
          <span>Secondary Paths</span>
          <span>{{ editor.aiPathWear.secondaryPathCount.toFixed(0) }}</span>
        </div>
        <input
          type="range" min="20" max="80" step="5"
          :value="editor.aiPathWear.secondaryPathCount"
          @input="editor.setFeatureProp('aiPathWear', 'secondaryPathCount', +$event.target.value)"
          class="ed-slider"
        />

        <div class="ed-label">
          <span>Secondary Intensity</span>
          <span>{{ editor.aiPathWear.secondaryPathStrength.toFixed(2) }}</span>
        </div>
        <input
          type="range" min="0.4" max="2" step="0.1"
          :value="editor.aiPathWear.secondaryPathStrength"
          @input="editor.setFeatureProp('aiPathWear', 'secondaryPathStrength', +$event.target.value)"
          class="ed-slider"
        />

        <div class="ed-label">
          <span>Secondary Spacing</span>
          <span>{{ editor.aiPathWear.secondaryPathSpacing.toFixed(2) }}</span>
        </div>
        <input
          type="range" min="0" max="0.15" step="0.01"
          :value="editor.aiPathWear.secondaryPathSpacing"
          @input="editor.setFeatureProp('aiPathWear', 'secondaryPathSpacing', +$event.target.value)"
          class="ed-slider"
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
