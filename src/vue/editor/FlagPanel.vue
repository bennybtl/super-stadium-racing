<template>
  <EditorPanel
    v-if="editor.selectedType === 'flag'"
    title="Flag"
    @close="closeFlag()"
  >
    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Del to delete</div>

    <!-- Color -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Color</span>
      <span>{{ editor.flag.color }}</span>
    </div>
    <div class="flex gap-2 mb-3">
      <button 
        class="color-btn red" 
        :class="{ active: editor.flag.color === 'red' }"
        @click="editor.setFeatureProp('flag', 'color', 'red')"
      >
        Red
      </button>
      <button 
        class="color-btn blue" 
        :class="{ active: editor.flag.color === 'blue' }"
        @click="editor.setFeatureProp('flag', 'color', 'blue')"
      >
        Blue
      </button>
    </div>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <div class="flex gap-2">
      <button 
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deleteFlag')"
      >
        Delete
      </button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('duplicateFlag')"
      >
        Duplicate
      </button>
    </div>
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
