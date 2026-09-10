<template>
  <EditorPanel
    v-if="editor.selectedType === 'trackLight'"
    title="Track Light"
    @close="editor.featureAction('deselectTrackLight')"
  >
    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Q/E to rotate · Del to delete · brightest at night</div>

    <!-- Count / limit -->
    <div class="flex justify-between mb-3 text-[11px]"
         :class="editor.trackLight.count >= editor.trackLight.max ? 'text-amber-400' : 'text-slate-400'">
      <span>Track lights</span>
      <span>{{ editor.trackLight.count }} / {{ editor.trackLight.max }}<template v-if="editor.trackLight.count >= editor.trackLight.max"> — limit reached</template></span>
    </div>

    <!-- Color -->
    <div class="flex justify-between items-center mb-3 text-[12px]">
      <span>Color</span>
      <select
        class="bg-slate-700 text-white text-[12px] rounded px-2 py-0.5 cursor-pointer"
        :value="editor.trackLight.color"
        @change="editor.setFeatureProp('trackLight', 'color', $event.target.value)"
      >
        <option value="warm">Warm</option>
        <option value="white">White</option>
        <option value="cool">Cool</option>
        <option value="amber">Amber</option>
      </select>
    </div>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Height</span>
      <span>{{ editor.trackLight.height.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="3" max="24" step="0.5"
      :value="editor.trackLight.height"
      @input="editor.setFeatureProp('trackLight', 'height', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Tilt -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Tilt</span>
      <span>{{ editor.trackLight.tilt }}° {{ editor.trackLight.tilt >= 89 ? '(straight down)' : editor.trackLight.tilt <= 1 ? '(level)' : 'down' }}</span>
    </div>
    <input
      type="range" min="0" max="90" step="1"
      :value="editor.trackLight.tilt"
      @input="editor.setFeatureProp('trackLight', 'tilt', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Rotation -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rotation</span>
      <span>{{ Math.round(editor.trackLight.rotation) }}°</span>
    </div>
    <input
      type="range" min="0" max="359" step="1"
      :value="editor.trackLight.rotation"
      @input="editor.setFeatureProp('trackLight', 'rotation', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Spread -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Spread</span>
      <span>{{ editor.trackLight.spread }}°</span>
    </div>
    <input
      type="range" min="10" max="120" step="1"
      :value="editor.trackLight.spread"
      @input="editor.setFeatureProp('trackLight', 'spread', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Intensity -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Intensity</span>
      <span>{{ editor.trackLight.intensity.toFixed(0) }}</span>
    </div>
    <input
      type="range" min="0" max="120" step="1"
      :value="editor.trackLight.intensity"
      @input="editor.setFeatureProp('trackLight', 'intensity', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-1 cursor-pointer"
    />

    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <div class="flex gap-2">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deleteTrackLight')"
      >Delete</button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-800"
        :disabled="editor.trackLight.count >= editor.trackLight.max"
        :title="editor.trackLight.count >= editor.trackLight.max ? `Limit is ${editor.trackLight.max} track lights per track` : ''"
        @click="editor.featureAction('duplicateTrackLight')"
      >Duplicate</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
