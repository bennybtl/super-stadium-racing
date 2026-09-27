<template>
  <EditorPanel
    v-if="editor.selectedType === 'trackLight'"
    title="Track Light"
    @close="editor.featureAction('deselectTrackLight')"
  >
    <!-- Hint -->
    <div class="ed-hint">WASD to move · Q/E to rotate · Del to delete · brightest at night</div>

    <!-- Count / limit -->
    <div class="ed-row text-[11px]"
         :class="editor.trackLight.count >= editor.trackLight.max ? 'text-amber-400' : 'text-slate-400'">
      <span>Track lights</span>
      <span>{{ editor.trackLight.count }} / {{ editor.trackLight.max }}<template v-if="editor.trackLight.count >= editor.trackLight.max"> — limit reached</template></span>
    </div>

    <!-- Rotation -->
    <div class="ed-label">
      <span>Rotation</span>
      <span>{{ Math.round(editor.trackLight.rotation) }}°</span>
    </div>
    <input
      type="range" min="0" max="359" step="1"
      :value="editor.trackLight.rotation"
      @input="editor.setFeatureProp('trackLight', 'rotation', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Height -->
    <div class="ed-label">
      <span>Height</span>
      <span>{{ editor.trackLight.height.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="3" max="24" step="0.5"
      :value="editor.trackLight.height"
      @input="editor.setFeatureProp('trackLight', 'height', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Tilt -->
    <div class="ed-label">
      <span>Tilt</span>
      <span>{{ editor.trackLight.tilt }}° {{ editor.trackLight.tilt >= 89 ? '(straight down)' : editor.trackLight.tilt <= 1 ? '(level)' : 'down' }}</span>
    </div>
    <input
      type="range" min="0" max="90" step="1"
      :value="editor.trackLight.tilt"
      @input="editor.setFeatureProp('trackLight', 'tilt', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Spread -->
    <div class="ed-label">
      <span>Spread</span>
      <span>{{ editor.trackLight.spread }}°</span>
    </div>
    <input
      type="range" min="40" max="150" step="1"
      :value="editor.trackLight.spread"
      @input="editor.setFeatureProp('trackLight', 'spread', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Intensity -->
    <div class="ed-label">
      <span>Intensity</span>
      <span>{{ editor.trackLight.intensity.toFixed(0) }}</span>
    </div>
    <input
      type="range" min="0" max="50" step="1"
      :value="editor.trackLight.intensity"
      @input="editor.setFeatureProp('trackLight', 'intensity', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Color -->
    <div class="ed-row">
      <span>Color</span>
      <select
        class="ed-select-inline"
        :value="editor.trackLight.color"
        @change="editor.setFeatureProp('trackLight', 'color', $event.target.value)"
      >
        <option value="warm">Warm</option>
        <option value="white">White</option>
        <option value="cool">Cool</option>
        <option value="amber">Amber</option>
      </select>
    </div>


    <hr class="ed-divider" />

    <!-- Actions -->
    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deleteTrackLight')"
      >Delete</button>
      <button
        class="ed-btn"
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
