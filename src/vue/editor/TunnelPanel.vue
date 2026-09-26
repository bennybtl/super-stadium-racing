<template>
  <EditorPanel
    v-if="editor.selectedType === 'tunnel'"
    title="Tunnel"
    @close="editor.featureAction('closeTunnel')"
  >
    <div class="text-[10px] text-slate-400 mb-3 max-w-48">
      Right-click to lay the centreline through the hill. The line drawn outside the hill at each end is cut down to the tunnel floor, which meets the ground at the two end points. Press <kbd>Esc</kbd> to close the panel.
    </div>

    <div v-if="editor.tunnel.status" class="text-[10px] mb-3 max-w-48" style="color: #ff9800;">
      {{ editor.tunnel.status }}
    </div>

    <!-- Selected Point Section -->
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Selected Point</div>

    <!-- Radius -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Corner Radius</span>
      <span :style="editor.tunnel.radius > editor.tunnel.maxRadius ? { color: '#ff4444' } : {}">{{ radiusDisplay }}</span>
    </div>
    <input
      type="range" min="0" max="30" step="0.5"
      :value="editor.tunnel.radius"
      :disabled="!editor.tunnel.canHaveRadius"
      @input="editor.setFeatureProp('tunnel', 'radius', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Floor height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Floor Height</span>
      <label class="flex items-center gap-1 text-[11px] text-slate-400">
        <input
          type="checkbox"
          :checked="editor.tunnel.floorAuto"
          :disabled="!editor.tunnel.hasSelection"
          @change="editor.setFeatureProp('tunnel', 'floorAuto', $event.target.checked)"
          class="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
        />
        Auto
      </label>
    </div>
    <div class="flex justify-between mb-1 text-[11px] text-slate-400">
      <span>{{ editor.tunnel.floorAuto ? 'Ramped between the ends' : 'Pinned' }}</span>
      <span>{{ floorDisplay }}</span>
    </div>
    <input
      type="range" min="-30" max="60" step="0.1"
      :value="editor.tunnel.floorY"
      :disabled="!editor.tunnel.hasSelection || editor.tunnel.floorAuto"
      @input="editor.setFeatureProp('tunnel', 'floorY', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <div class="text-[10px] text-slate-400 mb-3">WASD to move selected point</div>

    <div class="flex gap-2 mb-3">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deleteTunnelPoint')"
      >Delete Point</button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('insertTunnelPoint')"
      >Insert After</button>
    </div>
    <hr class="border-t border-slate-700 my-4" />

    <!-- Tunnel Properties Section -->
    <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Tunnel Properties</div>

    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.tunnel.width.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="6" max="24" step="0.5"
      :value="editor.tunnel.width"
      @input="editor.setFeatureProp('tunnel', 'width', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <div class="flex justify-between mb-1 text-[12px]">
      <span>Height</span>
      <span>{{ editor.tunnel.height.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="4" max="14" step="0.5"
      :value="editor.tunnel.height"
      @input="editor.setFeatureProp('tunnel', 'height', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <div class="flex justify-between mb-1 text-[12px]">
      <span>Min Cover</span>
      <span>{{ editor.tunnel.cover.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="0" max="10" step="0.5"
      :value="editor.tunnel.cover"
      @input="editor.setFeatureProp('tunnel', 'cover', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <hr class="border-t border-slate-700 my-4" />

    <div class="flex gap-2">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deleteTunnel')"
      >Delete</button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('duplicateTunnel')"
      >Duplicate</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

const radiusDisplay = computed(() => {
  if (!editor.tunnel.hasSelection) return '—';
  return editor.tunnel.radius.toFixed(1);
});

const floorDisplay = computed(() => {
  if (!editor.tunnel.hasSelection) return '—';
  return `${editor.tunnel.floorY.toFixed(1)} m`;
});
</script>
