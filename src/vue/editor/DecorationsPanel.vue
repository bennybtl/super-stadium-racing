<template>
  <EditorPanel
    v-if="editor.selectedType === 'decoration'"
    title="Decoration"
    @close="editor.closeDecoration()"
  >
    <div class="mb-4">
      <label class="block text-[12px] uppercase tracking-[0.14em] text-slate-300 mb-2">Type</label>
      <select
        class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
        :value="editor.decoration.type"
        @change="editor.setDecorationType($event.target.value)"
      >
        <option value="flag">Flag</option>
        <option value="bannerString">Banner String</option>
      </select>
    </div>

    <template v-if="editor.decoration.type === 'flag'">
      <div class="text-[12px] mb-1">Color</div>
      <select
        class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
        :value="editor.decoration.color"
        @change="editor.setDecorationColor($event.target.value)"
      >
        <option value="black">Black</option>
        <option value="gray">Gray</option>
        <option value="white">White</option>
        <option value="red">Red</option>
        <option value="blue">Blue</option>
        <option value="yellow">Yellow</option>
      </select>
      <div class="text-[10px] text-slate-400 mb-3">WASD to move · Del to delete</div>
    </template>

    <template v-else>
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Width</span>
        <span>{{ editor.decoration.width }} m</span>
      </div>
      <input
        type="range"
        min="5"
        max="50"
        step="1"
        :value="editor.decoration.width"
        @input="editor.setDecorationWidth(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 mt-3 text-[12px]">
        <span>Pole Height</span>
        <span>{{ editor.decoration.poleHeight }} m</span>
      </div>
      <input
        type="range"
        min="3"
        max="24"
        step="1"
        :value="editor.decoration.poleHeight"
        @input="editor.setDecorationPoleHeight(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 mt-3 text-[12px]">
        <span>Rotation</span>
        <span>{{ editor.decoration.heading }}°</span>
      </div>
      <input
        type="range"
        min="0"
        max="180"
        step="1"
        :value="editor.decoration.heading"
        @input="editor.setDecorationHeading(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="text-[10px] text-slate-400 mb-3">WASD to move · Q/E to rotate · Del to delete</div>
    </template>
    <!-- Actions -->
    <div class="flex gap-2">
      <button 
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.deleteDecoration()">Delete</button>
      <button 
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.duplicateDecoration()">Duplicate</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>

<style scoped>
.color-btn {
  flex: 1;
  padding: 8px;
  border: 2px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-family: Arial, Helvetica, sans-serif;
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
