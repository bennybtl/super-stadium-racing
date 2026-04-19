<template>
  <EditorPanel
    v-if="editor.selectedType === 'trackSign'"
    title="Track Sign"
    accent-color="#cc0000"
    @close="editor.closeTrackSign()"
  >
    <!-- Content type -->
    <div class="ep-label">Content</div>
    <select
      class="ep-select"
      :value="editor.trackSign.contentType"
      @change="editor.setTrackSignContentType($event.target.value)"
    >
      <option value="text">Custom Text</option>
      <option value="brand">Brand Logo</option>
    </select>

    <!-- Name -->
    <div v-if="editor.trackSign.contentType === 'text'" class="ep-row">
      <span>Sign Text</span>
    </div>
    <input
      v-if="editor.trackSign.contentType === 'text'"
      class="sign-name-input"
      type="text"
      :value="editor.trackSign.name"
      @input="editor.setTrackSignName($event.target.value)"
      placeholder="Track Name"
    />

    <!-- Brand image -->
    <div v-if="editor.trackSign.contentType === 'brand'" class="ep-label">Brand Logo</div>
    <select
      v-if="editor.trackSign.contentType === 'brand'"
      class="ep-select"
      :value="editor.trackSign.brandImage"
      @change="editor.setTrackSignBrandImage($event.target.value)"
    >
      <option v-for="brand in TRACK_SIGN_BRANDS" :key="brand.value" :value="brand.value">{{ brand.label }}</option>
    </select>

    <!-- Background -->
    <div class="ep-label">Background</div>
    <select
      class="ep-select"
      :value="editor.trackSign.background"
      @change="editor.setTrackSignBackground($event.target.value)"
    >
      <option value="black">Black</option>
      <option value="gray">Gray</option>
      <option value="white">White</option>
      <option value="red">Red</option>
      <option value="blue">Blue</option>
      <option value="yellow">Yellow</option>
    </select>

    <!-- Width -->
    <div class="ep-row">
      <span>Width</span>
      <span>{{ editor.trackSign.width.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="4" max="30" step="0.5"
      :value="editor.trackSign.width"
      @input="editor.setTrackSignWidth(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Scale -->
    <div class="ep-row">
      <span>Scale</span>
      <span>{{ editor.trackSign.scale.toFixed(2) }}x</span>
    </div>
    <input
      type="range" min="0.4" max="2.5" step="0.05"
      :value="editor.trackSign.scale"
      @input="editor.setTrackSignScale(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Height -->
    <div class="ep-row">
      <span>Height Offset</span>
      <span>{{ editor.trackSign.heightOffset.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="0" max="10" step="0.1"
      :value="editor.trackSign.heightOffset"
      @input="editor.setTrackSignHeightOffset(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Rotation -->
    <div class="ep-row">
      <span>Rotation</span>
      <span>{{ editor.trackSign.rotation }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="1"
      :value="editor.trackSign.rotation"
      @input="editor.setTrackSignRotation(+$event.target.value)"
      class="ep-slider"
    />

    <!-- Hint -->
    <div class="ep-hint">WASD to move · QE to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="ep-btn-dup" @click="editor.duplicateTrackSign()">Duplicate</button>
    <button class="ep-btn-del" @click="editor.deleteTrackSign()">Delete</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import { TRACK_SIGN_BRANDS } from '../../constants.js';

const editor = useEditorStore();
</script>

<style scoped>
.sign-name-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  background: #1a1a2e;
  border: 1px solid #cc0000;
  border-radius: 4px;
  color: #ff4444;
  font-size: 14px;
  font-family: Arial, sans-serif;
  font-weight: bold;
  font-style: italic;
  margin-bottom: 6px;
  outline: none;
  transition: border-color 0.15s;
}
.sign-name-input:focus {
  border-color: #ff2222;
  box-shadow: 0 0 6px rgba(204, 0, 0, 0.5);
}
</style>
