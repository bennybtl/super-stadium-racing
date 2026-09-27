<template>
  <EditorPanel
    v-if="editor.selectedType === 'tunnel'"
    title="Tunnel"
    @close="editor.featureAction('closeTunnel')"
  >
    <div class="ed-hint">
      Right-click to lay the centreline through the hill. The line drawn outside the hill at each end is cut down to the tunnel floor, which meets the ground at the two end points. Press <kbd>Esc</kbd> to close the panel.
    </div>

    <div v-if="editor.tunnel.status" class="ed-hint" style="color: #ff9800;">
      {{ editor.tunnel.status }}
    </div>

    <!-- Selected Point Section -->
    <div class="ed-heading">Selected Point</div>

    <!-- Radius -->
    <div class="ed-label">
      <span>Corner Radius</span>
      <span :style="editor.tunnel.radius > editor.tunnel.maxRadius ? { color: '#ff4444' } : {}">{{ radiusDisplay }}</span>
    </div>
    <input
      type="range" min="0" max="30" step="0.5"
      :value="editor.tunnel.radius"
      :disabled="!editor.tunnel.canHaveRadius"
      @input="editor.setFeatureProp('tunnel', 'radius', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Floor height -->
    <div class="ed-label">
      <span>Floor Height</span>
      <label class="flex items-center gap-1 text-slate-400 cursor-pointer">
        <input
          type="checkbox"
          :checked="editor.tunnel.floorAuto"
          :disabled="!editor.tunnel.hasSelection"
          @change="editor.setFeatureProp('tunnel', 'floorAuto', $event.target.checked)"
          class="ed-checkbox"
        />
        Auto
      </label>
    </div>
    <div class="ed-label text-slate-400">
      <span>{{ editor.tunnel.floorAuto ? 'Ramped between the ends' : 'Pinned' }}</span>
      <span>{{ floorDisplay }}</span>
    </div>
    <input
      type="range" min="-30" max="60" step="0.1"
      :value="editor.tunnel.floorY"
      :disabled="!editor.tunnel.hasSelection || editor.tunnel.floorAuto"
      @input="editor.setFeatureProp('tunnel', 'floorY', +$event.target.value)"
      class="ed-slider"
    />

    <div class="ed-hint">WASD to move selected point</div>

    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deleteTunnelPoint')"
      >Delete Point</button>
      <button
        class="ed-btn"
        @click="editor.featureAction('insertTunnelPoint')"
      >Insert Point</button>
    </div>
    <hr class="ed-divider" />

    <div class="ed-heading">Shape</div>

    <div class="ed-label">
      <span>Width</span>
      <span>{{ editor.tunnel.width.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="6" max="24" step="0.5"
      :value="editor.tunnel.width"
      @input="editor.setFeatureProp('tunnel', 'width', +$event.target.value)"
      class="ed-slider"
    />

    <div class="ed-label">
      <span>Height</span>
      <span>{{ editor.tunnel.height.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="4" max="14" step="0.5"
      :value="editor.tunnel.height"
      @input="editor.setFeatureProp('tunnel', 'height', +$event.target.value)"
      class="ed-slider"
    />

    <div class="ed-label">
      <span>Min Cover</span>
      <span>{{ editor.tunnel.cover.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="0" max="10" step="0.5"
      :value="editor.tunnel.cover"
      @input="editor.setFeatureProp('tunnel', 'cover', +$event.target.value)"
      class="ed-slider"
    />

    <hr class="ed-divider" />

    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deleteTunnel')"
      >Delete</button>
      <button
        class="ed-btn"
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
