<template>
  <EditorPanel
    v-if="editor.selectedType === 'bridge'"
    title="Bridge"
    accent-color="#c87830"
    @close="editor.closeBridge()"
  >
    <!-- Width -->
    <div class="ep-row">
      <span>Width</span>
      <span>{{ editor.bridge.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="2" max="60" step="0.5"
      :value="editor.bridge.width"
      @input="editor.setBridgeWidth(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Depth -->
    <div class="ep-row">
      <span>Depth</span>
      <span>{{ editor.bridge.depth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="2" max="30" step="0.5"
      :value="editor.bridge.depth"
      @input="editor.setBridgeDepth(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Height above terrain -->
    <div class="ep-row">
      <span>Height</span>
      <span>{{ editor.bridge.height.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="20" step="0.25"
      :value="editor.bridge.height"
      @input="editor.setBridgeHeight(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Thickness -->
    <div class="ep-row">
      <span>Thickness</span>
      <span>{{ editor.bridge.thickness.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0.1" max="2.0" step="0.05"
      :value="editor.bridge.thickness"
      @input="editor.setBridgeThickness(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Angle -->
    <div class="ep-row">
      <span>Angle</span>
      <span>{{ Math.round(editor.bridge.angle) }}°</span>
    </div>
    <input
      type="range" min="0" max="360" step="1"
      :value="editor.bridge.angle"
      @input="editor.setBridgeAngle(+$event.target.value)"
      class="ep-slider"
    />

    <div class="ep-hint">Collision proxy</div>

    <div class="ep-row">
      <span>Collision Width</span>
      <span>{{ editor.bridge.collisionWidth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="2" max="60" step="0.5"
      :value="editor.bridge.collisionWidth"
      @input="editor.setBridgeCollisionWidth(+$event.target.value)"
      class="ep-slider"
    />

    <div class="ep-row">
      <span>Collision Depth</span>
      <span>{{ editor.bridge.collisionDepth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="2" max="30" step="0.5"
      :value="editor.bridge.collisionDepth"
      @input="editor.setBridgeCollisionDepth(+$event.target.value)"
      class="ep-slider"
    />

    <div class="ep-row">
      <span>Collision Thickness</span>
      <span>{{ editor.bridge.collisionThickness.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0.1" max="2.0" step="0.05"
      :value="editor.bridge.collisionThickness"
      @input="editor.setBridgeCollisionThickness(+$event.target.value)"
      class="ep-slider"
    />

    <div class="ep-row">
      <span>Collision Y Offset</span>
      <span>{{ editor.bridge.collisionYOffset.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="-1.0" max="1.0" step="0.05"
      :value="editor.bridge.collisionYOffset"
      @input="editor.setBridgeCollisionYOffset(+$event.target.value)"
      class="ep-slider"
    />

    <div class="ep-hint">Collision end caps</div>

    <label class="ep-check-row">
      <span>Enable End Caps</span>
      <input
        type="checkbox"
        :checked="editor.bridge.collisionEndCaps"
        @change="editor.setBridgeCollisionEndCaps($event.target.checked)"
      />
    </label>

    <template v-if="editor.bridge.collisionEndCaps">
      <label class="ep-check-row">
        <span>Caps On Depth Ends</span>
        <input
          type="checkbox"
          :checked="editor.bridge.collisionEndCapsOnDepth"
          @change="editor.setBridgeCollisionEndCapsOnDepth($event.target.checked)"
        />
      </label>

      <label class="ep-check-row">
        <span>Caps On Width Sides</span>
        <input
          type="checkbox"
          :checked="editor.bridge.collisionEndCapsOnWidth"
          @change="editor.setBridgeCollisionEndCapsOnWidth($event.target.checked)"
        />
      </label>

      <div class="ep-row">
        <span>End Cap Thickness</span>
        <span>{{ editor.bridge.collisionEndCapThickness.toFixed(2) }}</span>
      </div>
      <input
        type="range" min="0.2" max="6.0" step="0.1"
        :value="editor.bridge.collisionEndCapThickness"
        @input="editor.setBridgeCollisionEndCapThickness(+$event.target.value)"
        class="ep-slider"
      />

      <div class="ep-row">
        <span>End Cap Drop</span>
        <span>{{ editor.bridge.collisionEndCapDrop.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="2" max="80" step="1"
        :value="editor.bridge.collisionEndCapDrop"
        @input="editor.setBridgeCollisionEndCapDrop(+$event.target.value)"
        class="ep-slider"
      />

      <div class="ep-row">
        <span>End Cap Span (Depth)</span>
        <span>{{ editor.bridge.collisionEndCapSpanDepth.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="1" max="80" step="0.5"
        :value="editor.bridge.collisionEndCapSpanDepth"
        @input="editor.setBridgeCollisionEndCapSpanDepth(+$event.target.value)"
        class="ep-slider"
      />

      <div class="ep-row">
        <span>End Cap Span (Width)</span>
        <span>{{ editor.bridge.collisionEndCapSpanWidth.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="1" max="80" step="0.5"
        :value="editor.bridge.collisionEndCapSpanWidth"
        @input="editor.setBridgeCollisionEndCapSpanWidth(+$event.target.value)"
        class="ep-slider"
      />
    </template>

    <!-- Hint -->
    <div class="ep-hint">WASD to move · Q/E to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="ep-btn-dup" @click="editor.duplicateBridge()">Duplicate Bridge</button>
    <button class="ep-btn-del" @click="editor.deleteBridge()">Delete Bridge</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
