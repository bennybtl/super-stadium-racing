<template>
  <EditorPanel
    v-if="editor.selectedType === 'bridgeMesh'"
    id="bridge-mesh-panel"
    title="Bridge Mesh"
    default-right="20px"
    default-top="80px"
    @close="editor.closeBridgeMesh()"
  >
    <!-- Point Height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Point Height</span>
      <span>{{ editor.bridgeMesh.pointHeight }}</span>
    </div>
    <input
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      type="range"
      min="-20"
      max="20"
      :step="tor.bridgeMesh.stepSize"
      :value="editor.bridgeMesh.hasSelection ? editor.bridgeMesh.pointHeight.toFixed(2) : ''"
      :placeholder="editor.bridgeMesh.hasSelection ? '' : '— select a point —'"
      :disabled="!editor.bridgeMesh.hasSelection"
      @input="editor.setBridgeMeshPointHeight(+$event.target.value)"
    />

    <!-- Step Size -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Step Size</span>
      <span>{{ editor.bridgeMesh.stepSize.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.1" max="2" step="0.1"
      :value="editor.bridgeMesh.stepSize"
      @input="editor.setBridgeMeshStepSize(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <div class="text-[10px] text-slate-400 mb-3">
      Click a control sphere to edit point height. Click center sphere to move mesh with WASD.
    </div>

    <hr class="border-t border-slate-700 my-4" />
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Grid Settings</div>

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
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

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

    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rotation</span>
      <span>{{ editor.bridgeMesh.rotation.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="1"
      :value="editor.bridgeMesh.rotation"
      @input="editor.setBridgeMeshRotation(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <div class="flex gap-2 mb-3">
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.applyBridgeMeshSettings()"
      >
        Apply Grid
      </button>
    </div>

    <div class="flex justify-between mb-1 text-[12px]">
      <span>Thickness</span>
      <span>{{ editor.bridgeMesh.thickness.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0.1" max="5" step="0.05"
      :value="editor.bridgeMesh.thickness"
      @input="editor.setBridgeMeshThickness(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <div class="text-[12px] mb-1">Layer Id</div>
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
    />

    <hr class="border-t border-slate-700 my-4" />

    <div class="flex gap-2">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.flattenBridgeMesh()"
      >
        Flatten
      </button>
    </div>

    <div class="flex gap-2">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.deleteBridgeMesh()"
      >Delete</button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.duplicateBridgeMesh()"
      >Duplicate</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
