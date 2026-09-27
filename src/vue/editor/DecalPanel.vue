<template>
  <EditorPanel
    v-if="mode"
    :title="editing ? 'Edit Decal' : 'Place Decal'"
    @close="close"
  >
    <!-- Hint -->
    <div v-if="editing" class="ed-hint">Drag to move{{ s.shape === 'polyline' ? '' : ' · QE to rotate' }} · Del to delete{{ s.shape === 'polyline' ? ' point/decal' : '' }} · Duplicate for another</div>
    <div v-else class="ed-hint">Pick a shape, then click any surface — ground, deck, wall — to place it. You'll edit it right after.</div>

    <!-- Polyline point editing (placed decal only) -->
    <template v-if="editing && s.shape === 'polyline'">
      <div class="ed-heading">Selected Point</div>
      <div class="ed-label">
        <span>Points</span>
        <span>{{ s.pointCount }}</span>
      </div>
      <div class="ed-label">
        <span>Selected Point</span>
        <span>{{ s.selectedPointIndex >= 0 ? s.selectedPointIndex + 1 : 'Center' }}</span>
      </div>
      <template v-if="s.selectedPointIndex >= 0">
        <div class="ed-label">
          <span>Corner Radius</span>
          <span>{{ s.radius.toFixed(1) }}m</span>
        </div>
        <input type="range" min="0" max="30" step="0.5"
          :value="s.radius"
          :disabled="!s.canHaveRadius"
          @input="set('radius', +$event.target.value)"
          class="ed-slider"
        />
        <div v-if="!s.canHaveRadius" class="ed-hint">
          Endpoints can't be rounded — needs a point on both sides.
        </div>
        <div v-else class="mb-3"></div>
      </template>
      <div class="ed-btn-row">
        <button
          class="ed-btn-danger"
          @click="editor.featureAction('deleteDecalPoint')"
        >Delete Point</button>
        <button
          class="ed-btn"
          @click="editor.featureAction('insertDecalPoint')"
        >Insert Point</button>
      </div>
      <hr class="ed-divider" />
    </template>

    <div class="ed-heading">Shape</div>

    <!-- Shape (stamp mode only — a placed decal keeps its shape) -->
    <template v-if="!editing">
      <select
        class="ed-select"
        :value="s.shape"
        @change="set('shape', $event.target.value)"
      >
        <option v-for="shape in s.shapes" :key="shape" :value="shape">
          {{ formatLabel(shape) }}
        </option>
      </select>
    </template>

    <!-- Rotation — for a polyline this only orients the initial 2-point seed,
         so it stops applying once the line is placed and edited by its points. -->
    <template v-if="!editing || s.shape !== 'polyline'">
      <div class="ed-label">
        <span>Rotation</span>
        <span>{{ s.rotation }}°</span>
      </div>
      <input type="range" min="-180" max="180" step="1"
        :value="s.rotation"
        @input="set('rotation', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <!-- Uniform scale toggle (not for polyline — it only has a length) -->
    <label v-if="s.shape !== 'polyline'" class="ed-row cursor-pointer">
      <span>Uniform Scale</span>
      <input type="checkbox" class="ed-checkbox" :checked="s.linkScale" @change="set('linkScale', $event.target.checked)" />
    </label>

    <!-- Size — a polyline has no "Height"; its length only seeds the initial
         2-point line (a placed one is reshaped via its points instead). -->
    <template v-if="!editing || s.shape !== 'polyline'">
      <div class="ed-label">
        <span>{{ s.shape === 'polyline' ? 'Length' : (s.linkScale ? 'Scale' : (s.shape === 'line' ? 'Thickness' : 'Width')) }}</span>
        <span>{{ s.width }}m</span>
      </div>
      <input type="range" min="0.5" max="30" step="0.5"
        :value="s.width"
        @input="set('width', +$event.target.value)"
        class="ed-slider"
      />
    </template>
    <template v-if="s.shape !== 'polyline' && !s.linkScale">
      <div class="ed-label">
        <span>{{ s.shape === 'line' ? 'Length' : 'Height' }}</span>
        <span>{{ s.height }}m</span>
      </div>
      <input type="range" min="0.5" max="30" step="0.5"
        :value="s.height"
        @input="set('height', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <!-- Thickness (polyline only — the drawn line's stroke width) -->
    <template v-if="s.shape === 'polyline'">
      <div class="ed-label">
        <span>Thickness</span>
        <span>{{ s.thickness.toFixed(1) }}m</span>
      </div>
      <input type="range" min="0.1" max="5" step="0.1"
        :value="s.thickness"
        @input="set('thickness', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <hr class="ed-divider" />
    <div class="ed-heading">Appearance</div>

    <template v-if="s.hasText">
      <div class="ed-label">Text</div>
      <input
        type="text"
        class="ed-input"
        :value="s.text"
        @input="set('text', $event.target.value)"
        placeholder="Enter text"
      />
    </template>

    <template v-if="s.hasBrand">
      <div class="ed-label">Brand</div>
      <select
        class="ed-select"
        :value="s.brand"
        @change="set('brand', $event.target.value)"
      >
        <option v-for="b in s.brands" :key="b.value" :value="b.value">{{ b.label }}</option>
      </select>
    </template>

    <label v-if="s.hasOutline" class="ed-row cursor-pointer">
      <span>Outline</span>
      <input type="checkbox" class="ed-checkbox" :checked="s.outline" @change="set('outline', $event.target.checked)" />
    </label>

    <template v-if="s.hasCount">
      <div class="ed-label">
        <span>Repeats</span>
        <span>{{ s.count }}</span>
      </div>
      <input type="range" min="1" max="12" step="1"
        :value="s.count"
        @input="set('count', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <!-- Primary color (text + border) -->
    <div class="ed-row">
      <span>Color</span>

      <select
        class="ed-select-inline"
        :value="s.color"
        @change="set('color', $event.target.value)"
      >
        <option v-for="c in s.colors" :key="c" :value="c">{{ formatLabel(c) }}</option>
      </select>
    </div>

    <!-- Opacity -->
    <div class="ed-label">
      <span>Opacity</span>
      <span>{{ Math.round(s.opacity * 100) }}%</span>
    </div>
    <input type="range" min="0.1" max="1" step="0.05"
      :value="s.opacity"
      @input="set('opacity', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Reverse-race override (edit mode only — nothing to override before it's placed) -->
    <template v-if="editing">
      <hr class="ed-divider" />
      <div class="ed-heading">Reverse</div>
      <div class="ed-row">
        <span>Reverse Mode</span>
        <select
          :value="s.reverseMode"
          @change="editor.setFeatureProp('decal', 'reverseMode', $event.target.value)"
          class="ed-select-inline"
        >
          <option value="active">Active</option>
          <option value="rotate180">Rotate 180</option>
          <option value="remove">Remove</option>
          <option value="only">Only</option>
        </select>
      </div>
      <div class="ed-hint">Only takes effect when racing in reverse — use "Test Reverse" in the status bar to preview. Doesn't change how this decal looks here.</div>
      <hr class="ed-divider" />
    </template>

    <!-- Actions (edit mode only) -->
    <div v-if="editing" class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deleteSelectedDecal')"
      >Delete</button>
      <button
        class="ed-btn"
        @click="editor.featureAction('duplicateSelectedDecal')"
      >Duplicate</button>
    </div>

  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

// One panel: placing ('decal') and editing ('decalEdit') a decal on any
// surface. Both modes share the `decal` slice; each repopulates it on entry
// (stamp from the editor's pending settings, edit from the selected feature).
const mode = computed(() =>
  editor.selectedType === 'decal' || editor.selectedType === 'decalEdit');
const editing = computed(() => editor.selectedType === 'decalEdit');
const s = computed(() => editor.decal);

const cap = (p) => p.charAt(0).toUpperCase() + p.slice(1);

function set(prop, val) {
  if (editing.value) editor.setFeatureProp('decal', prop, val);
  else editor.featureAction('setDecal' + cap(prop), val);
}

function close() {
  editor.featureAction(editing.value ? 'deselectDecal' : 'closeDecalStamp');
}

function formatLabel(type) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
</script>
