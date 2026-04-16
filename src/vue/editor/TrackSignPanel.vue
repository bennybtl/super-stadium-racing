<template>
  <EditorPanel
    v-if="editor.selectedType === 'trackSign'"
    title="Track Sign"
    accent-color="#cc0000"
    @close="editor.closeTrackSign()"
  >
    <!-- Name -->
    <div class="ep-row">
      <span>Sign Text</span>
    </div>
    <input
      class="sign-name-input"
      type="text"
      :value="editor.trackSign.name"
      @input="editor.setTrackSignName($event.target.value)"
      placeholder="Track Name"
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
