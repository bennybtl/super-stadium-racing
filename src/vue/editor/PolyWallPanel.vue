<template>
  <EditorPanel
    v-if="editor.selectedType === 'polyWall'"
    title="Poly Wall"
    @close="editor.featureAction('closePolyWall')"
  >
    <div class="ed-hint">
      Right-click terrain to add points. Select a point to edit it. Press <kbd>Esc</kbd> to close the panel.
    </div>

    <!-- Selected Point Section -->
    <div class="ed-heading">Selected Point</div>

    <!-- Radius -->
    <div class="ed-label">
      <span>Corner Radius</span>
      <span
        :style="
          editor.polyWall.radius > editor.polyWall.maxRadius
            ? { color: '#ff4444' }
            : {}
        "
        >{{ radiusDisplay }}</span
      >
    </div>
    <input
      type="range"
      min="0"
      max="30"
      step="0.5"
      :value="editor.polyWall.radius"
      :disabled="!editor.polyWall.canHaveRadius"
      @input="editor.setFeatureProp('polyWall', 'radius', +$event.target.value)"
      class="ed-slider"
    />
    <div
      v-if="!editor.polyWall.canHaveRadius && editor.polyWall.hasSelection"
      class="ed-hint"
      style="color: #ff9800"
    >
      First and last points cannot be rounded (unless closed loop is enabled)
    </div>

    <!-- Terrain Smoothing: how closely the wall top follows the terrain at this node.
         Most (1) = flat, slowly-changing top; Least (0) = follows terrain exactly. -->
    <div class="ed-label">
      <span>Terrain Smoothing</span>
      <span>{{ smoothingDisplay }}</span>
    </div>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      :value="editor.polyWall.smoothing"
      :disabled="!editor.polyWall.hasSelection"
      @input="
        editor.setFeatureProp('polyWall', 'smoothing', +$event.target.value)
      "
      class="ed-slider"
    />

    <div class="ed-hint">
      WASD to move selected point
    </div>

    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deletePolyWallPoint')"
      >
        Delete Point
      </button>
      <button
        class="ed-btn"
        @click="editor.featureAction('insertPolyWallPoint')"
      >
        Insert Point
      </button>
    </div>

    <hr class="ed-divider" />

    <div class="ed-heading">Shape</div>

    <!-- Thickness -->
    <div class="ed-label">
      <span>Thickness</span>
      <span>{{ editor.polyWall.thickness.toFixed(1) }}</span>
    </div>
    <input
      type="range"
      min="0.2"
      max="2"
      step="0.1"
      :value="editor.polyWall.thickness"
      @input="
        editor.setFeatureProp('polyWall', 'thickness', +$event.target.value)
      "
      class="ed-slider"
    />

    <!-- Height -->
    <div class="ed-label">
      <span>Height</span>
      <span>{{ editor.polyWall.height.toFixed(1) }}</span>
    </div>
    <input
      type="range"
      min="0.5"
      max="8"
      step="0.5"
      :value="editor.polyWall.height"
      @input="editor.setFeatureProp('polyWall', 'height', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Collision Barrier Height -->
    <div class="ed-label">
      <span>Collision Height</span>
      <span>{{ editor.polyWall.collisionHeight.toFixed(1) }}</span>
    </div>
    <input
      type="range"
      min="0.5"
      max="12"
      step="0.5"
      :value="editor.polyWall.collisionHeight"
      @input="
        editor.setFeatureProp(
          'polyWall',
          'collisionHeight',
          +$event.target.value,
        )
      "
      class="ed-slider"
    />
    <div class="ed-hint">
      Collision height defaults to the visual height unless adjusted separately.
    </div>

    <!-- Closed toggle -->
    <div class="ed-row">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.polyWall.closed"
        @change="
          editor.setFeatureProp('polyWall', 'closed', $event.target.checked)
        "
        class="ed-checkbox"
      />
    </div>

    <hr class="ed-divider" />
    <div class="ed-heading">Appearance</div>

    <!-- Chain-link fence: metal tubing from the wall top up to the collision top -->
    <div class="ed-row">
      <span>Chain-Link Fence</span>
      <input
        type="checkbox"
        :checked="editor.polyWall.fence"
        @change="
          editor.setFeatureProp('polyWall', 'fence', $event.target.checked)
        "
        class="ed-checkbox"
      />
    </div>
    <div class="ed-hint">
      <template v-if="editor.polyWall.fence">
        Fence fills {{ fenceHeightDisplay }} between the wall top and the
        collision height — raise Collision Height for a taller fence.
      </template>
      <template v-else>
        Adds posts and a top rail rising to the collision height.
      </template>
    </div>

    <!-- Stripe colours (1–3, any combination) -->
    <StripeColorPicker
      :model-value="editor.polyWall.colors"
      @update:model-value="editor.setFeatureProp('polyWall', 'colors', $event)"
    />

    <hr class="ed-divider" />

    <!-- Actions -->
    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deletePolyWall')"
      >
        Delete
      </button>
      <button
        class="ed-btn"
        @click="editor.featureAction('duplicatePolyWall')"
      >
        Duplicate
      </button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { computed } from "vue";
import { useEditorStore } from "../store.js";
import EditorPanel from "./EditorPanel.vue";
import StripeColorPicker from "./StripeColorPicker.vue";

const editor = useEditorStore();

const radiusDisplay = computed(() => {
  if (!editor.polyWall.hasSelection) return "—";
  return editor.polyWall.radius.toFixed(1);
});

const fenceHeightDisplay = computed(() => {
  const gap = editor.polyWall.collisionHeight - editor.polyWall.height;
  return `${Math.max(0, gap).toFixed(1)}`;
});

const smoothingDisplay = computed(() => {
  if (!editor.polyWall.hasSelection) return "—";
  return `${Math.round(editor.polyWall.smoothing * 100)}%`;
});
</script>
