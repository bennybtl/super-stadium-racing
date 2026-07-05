<template>
  <EditorPanel
    v-if="editor.selectedType === 'bridgeMesh'"
    id="bridge-mesh-panel"
    title="Bridge Mesh"
    default-right="20px"
    default-top="80px"
    @close="editor.featureAction('closeBridgeMesh')"
  >

    <div class="text-[10px] text-slate-400 mb-3">
      Click a control sphere to edit point height. Click center sphere to move mesh with WASD.
    </div>

    <!-- Point Height -->
    <div class="text-[12px] mb-1">Point Height</div>
    <input
      class="mg-height-input"
      type="number"
      min="-30"
      max="30"
      :step="editor.bridgeMesh.stepSize"
      :value="editor.bridgeMesh.hasSelection ? editor.bridgeMesh.pointHeight.toFixed(2) : ''"
      :placeholder="editor.bridgeMesh.hasSelection ? '' : '— select a point —'"
      :disabled="!editor.bridgeMesh.hasSelection"
      @change="editor.setBridgeMeshPointHeight(+$event.target.value)"
      @keydown.enter.prevent="editor.setBridgeMeshPointHeight(+$event.target.value)"
      @keydown.up.prevent="editor.featureAction('bridgeMeshAdjustUp')"
      @keydown.down.prevent="editor.featureAction('bridgeMeshAdjustDown')"
      @mousedown.stop
    />


    <!-- Step Size -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Step Size</span>
      <span>{{ editor.bridgeMesh.stepSize.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.1" max="2" step="0.1"
      :value="editor.bridgeMesh.stepSize"
      @input="editor.setFeatureProp('bridgeMesh', 'stepSize', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <hr class="border-t border-slate-700 my-4" />
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Grid Settings</div>

        <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.bridgeMesh.width }}</span>
    </div>
    <input
      type="range" min="4" max="60" step="2"
      :value="editor.bridgeMesh.width"
      @input="editor.bridgeMesh.width = +$event.target.value"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Depth -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Depth</span>
      <span>{{ editor.bridgeMesh.depth }}</span>
    </div>
    <input
      type="range" min="4" max="60" step="2"
      :value="editor.bridgeMesh.depth"
      @input="editor.bridgeMesh.depth = +$event.target.value"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Roation -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rotation</span>
      <span>{{ editor.bridgeMesh.rotation.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="1"
      :value="editor.bridgeMesh.rotation"
      @input="editor.setFeatureProp('bridgeMesh', 'rotation', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />


    <!-- Cols -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Columns</span>
      <span>{{ editor.bridgeMesh.cols }}</span>
    </div>
    <input
      type="range" min="2" max="16" step="1"
      :value="editor.bridgeMesh.cols"
      @input="editor.bridgeMesh.cols = +$event.target.value"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Rows -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rows</span>
      <span>{{ editor.bridgeMesh.rows }}</span>
    </div>
    <input
      type="range" min="2" max="16" step="1"
      :value="editor.bridgeMesh.rows"
      @input="editor.bridgeMesh.rows = +$event.target.value"
      class="w-full accent-[var(--accent)] mb-6 cursor-pointer"
    />

    <div class="flex gap-2 mb-6">
      <button
        class="flex-2 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('flattenBridgeMesh')"
      >
        Flatten
      </button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.applyBridgeMeshSettings()"
      >
        Apply
      </button>
    </div>

    <div class="flex justify-between mb-1 text-[12px]">
      <span>Mesh Thickness</span>
      <span>{{ editor.bridgeMesh.thickness.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0.1" max="5" step="0.05"
      :value="editor.bridgeMesh.thickness"
      @input="editor.setBridgeMeshThickness(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- <div class="text-[12px] mb-1">Layer Id</div>
    <input
      class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
      type="number"
      min="0"
      max="20"
      step="1"
      :value="editor.bridgeMesh.layerId"
      @change="editor.setBridgeMeshLayerId(+$event.target.value)"
      @keydown.enter.prevent="editor.setBridgeMeshLayerId(+$event.target.value)"
      @mousedown.stop
    /> -->

    <hr class="border-t border-slate-700 my-4" />

    <div class="flex gap-2">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deleteBridgeMesh')"
      >Delete</button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('duplicateBridgeMesh')"
      >Duplicate</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>

<style scoped>
.mg-height-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  margin-bottom: 14px;
  background: #1a2a2a;
  color: #1ec8c8;
  border: 1px solid #1ec8c8;
  border-radius: 4px;
  font-size: 14px;
  font-family: monospace;
  outline: none;
}
.mg-height-input:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
