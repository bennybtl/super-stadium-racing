<template>
  <EditorPanel
    v-if="editor.selectedType === 'bezierWall'"
    title="Bezier Wall"
    accent-color="#4a9eff"
    @close="editor.closeBezierWall()"
  >
    <!-- Selected Point Section -->
    <div class="ep-section-title">Selected Point</div>

    <div class="ep-hint">WASD to move selected anchor or handle</div>

    <button class="ep-btn-action" @click="editor.insertBezierWallPoint()">Insert Point After</button>
    <button class="ep-btn-del" @click="editor.deleteBezierWallPoint()">Delete Point</button>

    <hr class="ep-separator" />

    <!-- Wall Properties Section -->
    <div class="ep-section-title">Wall Properties</div>

    <!-- Height -->
    <div class="ep-row">
      <span>Height</span>
      <span>{{ editor.bezierWall.height.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="8" step="0.5"
      :value="editor.bezierWall.height"
      @input="editor.setBezierWallHeight(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Thickness -->
    <div class="ep-row">
      <span>Thickness</span>
      <span>{{ editor.bezierWall.thickness.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.2" max="3" step="0.1"
      :value="editor.bezierWall.thickness"
      @input="editor.setBezierWallThickness(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Closed toggle -->
    <div class="ep-row">
      <span>Closed Loop</span>
      <input
        type="checkbox"
        :checked="editor.bezierWall.closed"
        @change="editor.setBezierWallClosed($event.target.checked)"
        class="ep-checkbox"
      />
    </div>

    <hr class="ep-separator" />

    <!-- Actions -->
    <button class="ep-btn-dup" @click="editor.duplicateBezierWall()">Duplicate</button>
    <button class="ep-btn-del" @click="editor.deleteBezierWall()">Delete</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
