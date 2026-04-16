<template>
  <EditorPanel
    v-if="editor.selectedType === 'flag'"
    title="Flag"
    accent-color="#e74c3c"
    @close="closeFlag()"
  >
    <!-- Color -->
    <div class="ep-row">
      <span>Color</span>
      <span>{{ editor.flag.color }}</span>
    </div>
    <div class="ep-btn-row">
      <button 
        class="color-btn red" 
        :class="{ active: editor.flag.color === 'red' }"
        @click="editor.setFlagColor('red')"
      >
        Red
      </button>
      <button 
        class="color-btn blue" 
        :class="{ active: editor.flag.color === 'blue' }"
        @click="editor.setFlagColor('blue')"
      >
        Blue
      </button>
    </div>

    <!-- Hint -->
    <div class="ep-hint">WASD to move · Del to delete</div>

    <!-- Actions -->
    <button class="ep-btn-dup" @click="editor.duplicateFlag()">Duplicate</button>
    <button class="ep-btn-del" @click="editor.deleteFlag()">Delete</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

function closeFlag() {
  editor.selectedType = null;
}
</script>

<style scoped>
.color-btn {
  flex: 1;
  padding: 8px;
  border: 2px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-family: Arial;
  font-weight: bold;
  color: white;
  transition: all 0.15s;
}

.color-btn.red {
  background: #e74c3c;
}

.color-btn.red:hover {
  background: #c0392b;
}

.color-btn.red.active {
  border-color: #fff;
  box-shadow: 0 0 10px rgba(231, 76, 60, 0.8);
}

.color-btn.blue {
  background: #3498db;
}

.color-btn.blue:hover {
  background: #2980b9;
}

.color-btn.blue.active {
  border-color: #fff;
  box-shadow: 0 0 10px rgba(52, 152, 219, 0.8);
}
</style>
