<template>
  <EditorPanel
    v-if="editor.selectedType === 'bridge'"
    title="Bridge"
    @close="editor.closeBridge()"
  >
    <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.bridge.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="5" max="60" step="1"
      :value="editor.bridge.width"
      @input="editor.setBridgeWidth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Depth -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Depth</span>
      <span>{{ editor.bridge.depth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0" max="60" step="1"
      :value="editor.bridge.depth"
      @input="editor.setBridgeDepth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Height above terrain -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Height</span>
      <span>{{ editor.bridge.height.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="40" step="0.25"
      :value="editor.bridge.height"
      @input="editor.setBridgeHeight(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Thickness -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Thickness</span>
      <span>{{ editor.bridge.thickness.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0.5" max="2.0" step="0.5"
      :value="editor.bridge.thickness"
      @input="editor.setBridgeThickness(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Rotation -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rotation</span>
      <span>{{ Math.round(editor.bridge.angle) }}°</span>
    </div>
    <input
      type="range" min="0" max="180" step="1"
      :value="editor.bridge.angle"
      @input="editor.setBridgeAngle(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <TerrainTypeSelect
      :model-value="editor.bridge.materialType"
      @update:modelValue="editor.setBridgeMaterialType"
    />

    <!-- Bridge transitions -->
    <div class="flex justify-between mb-1 text-[12px]">
      <label class="flex items-center gap-2">
        <span>Enable Transitions</span>
        <input
          type="checkbox"
          :checked="editor.bridge.transitionEnabled"
          @change="editor.setBridgeTransitionEnabled($event.target.checked)"
        />
      </label>
    </div>

    <template v-if="editor.bridge.transitionEnabled">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Transition Depth</span>
        <span>{{ editor.bridge.transitionDepth.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="4" max="30" step="0.5"
        :value="editor.bridge.transitionDepth"
        @input="editor.setBridgeTransitionDepth(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Transition Y Offset</span>
        <span>{{ editor.bridge.transitionYOffset.toFixed(2) }}</span>
      </div>
      <input
        type="range" min="-6" max="0" step="0.1"
        :value="editor.bridge.transitionYOffset"
        @input="editor.setBridgeTransitionYOffset(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>

    <div class="text-[10px] text-slate-400 mb-3">Collision end caps use fixed defaults.</div>

    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Q/E to rotate · Del to delete</div>

    <!-- Actions -->
    <div class="flex gap-2 mb-3">
      <button 
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.deleteBridge()">Delete Bridge</button>
      <button 
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.duplicateBridge()">Duplicate Bridge</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import TerrainTypeSelect from './TerrainTypeSelect.vue';

const editor = useEditorStore();
</script>
